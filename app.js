// Read Aloud — a static, browser-only audiobook reader.
// Text extraction: pdf.js (vendored) for PDF, TextDecoder for .txt.
// Speech: the browser's Web Speech API, read in short chunks so long books never stall.
import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.mjs';

const MAX_CHUNK = 160;      // characters per utterance — Chrome silently cuts utterances after ~15 s of speech
const RESTART_DELAY = 80;   // ms between cancel() and speak(); Chrome drops a speak() issued in the same tick
const KEY_TEXT = 'read-aloud.text';
const KEY_STATE = 'read-aloud.state';
const KEY_PREFS = 'read-aloud.prefs';
const CORE_LANGS = ['he', 'en', 'ru'];
const RTL_LANGS = new Set(['he', 'ar', 'fa', 'ur', 'yi']);
const DEFAULT_TAG = { he: 'he-IL', en: 'en-US', ru: 'ru-RU' };
const SCANNED_MESSAGE =
  'This PDF has no text layer — it looks like a scanned document. It needs OCR before it can be read aloud, and this app does not do OCR.';

const $ = (id) => document.getElementById(id);
const el = {
  file: $('file'), empty: $('empty'), book: $('book'), title: $('title'), stats: $('stats'),
  lang: $('lang'), voice: $('voice'), rate: $('rate'), notice: $('notice'), persist: $('persist'),
  text: $('text'), error: $('error'), chips: $('chips'), progress: $('progress'), fill: $('fill'),
  position: $('position'), play: $('play'), stop: $('stop'), status: $('status'),
};

const synth = window.speechSynthesis;
let voices = [];
let book = null;                                   // { title, text, pages, chunks, cum, total }
let state = { lang: 'en', index: 0, offset: 0, status: 'idle' };
let prefs = { rate: 1, voices: {} };               // voices: { [lang]: voiceURI }
let gen = 0;                                       // bumped on every cancel; events from older utterances are ignored
let loadSeq = 0;                                   // bumped per upload; a slower, older load must never land on top of a newer one
let current = null;                                // keep the live utterance referenced — Chrome drops events of GC'd utterances
let statusOverride = '';

// ---------- text extraction ----------

function baseName(name) {
  return (name || 'Untitled').replace(/\.[^.]+$/, '').trim() || 'Untitled';
}

const NOT_UTF8 = 'This .txt file is not UTF-8 encoded. Save it as UTF-8 and upload it again.';

async function readTxt(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  const text = new TextDecoder(encoding).decode(bytes);
  if (text.includes('\0')) throw new Error(NOT_UTF8); // a NUL in a text file means UTF-16 without a BOM, not UTF-8
  const bad = (text.match(/\uFFFD/g) || []).length;
  if (bad > 2 && bad * 100 > text.length) throw new Error(NOT_UTF8);
  return { title: baseName(file.name), text, pages: null };
}

// A page of prose carries 1,000+ non-space characters; a scanner's watermark, a date stamp or a
// page number carries a few dozen. Judge the typical (median) page so a stamp on every page of
// a scanned book does not pass as a text layer.
function looksScanned(pages) {
  const counts = pages.map((p) => p.replace(/\s+/g, '').length).sort((a, b) => a - b);
  return counts[Math.floor(counts.length / 2)] < 60;
}

// pdf.js only marks line ends. A paragraph break (or a heading) shows up as a vertical gap
// clearly larger than the page's usual line spacing, or as a change of font size — mark
// those with a blank line so chunking does not glue a heading to the sentence after it.
function pageText(items) {
  // The EOL marker is often an empty item already positioned on the next line, so measure
  // from the last item of the line that actually carries text.
  const lines = [];
  let line = '';
  let lastText = null;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    line += item.str;
    if (item.str && item.str.trim()) lastText = item;
    if (!item.hasEOL) continue;
    let next = null;
    for (let j = i + 1; j < items.length; j++) if (items[j].str && items[j].str.trim()) { next = items[j]; break; }
    const gap = lastText && next ? Math.abs(lastText.transform[5] - next.transform[5]) : 0;
    lines.push({ text: line, gap, height: lastText ? lastText.height || 0 : 0, nextHeight: next ? next.height || 0 : 0 });
    line = '';
    lastText = null;
  }
  if (line) lines.push({ text: line, gap: 0, height: 0, nextHeight: 0 });
  const gaps = lines.map((l) => l.gap).filter((g) => g > 0).sort((a, b) => a - b);
  const usual = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
  let out = '';
  lines.forEach((l, i) => {
    out += l.text;
    if (i === lines.length - 1) return;
    const sizeChange = l.height && l.nextHeight && Math.abs(l.height - l.nextHeight) > 0.2 * Math.max(l.height, l.nextHeight);
    out += (usual && l.gap > 1.3 * usual) || sizeChange ? '\n\n' : '\n';
  });
  return out;
}

async function readPdf(file, onProgress) {
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data });
  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (err) {
    loadingTask.destroy();
    if (err && err.name === 'PasswordException') {
      throw new Error('This PDF is password-protected. Remove the password and upload it again.');
    }
    throw new Error('This file could not be opened as a PDF. It may be damaged or not really a PDF.');
  }
  try {
    const meta = await pdf.getMetadata().catch(() => null);
    const metaTitle = String((meta && meta.info && meta.info.Title) || '').trim();
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      onProgress(p, pdf.numPages);
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      pages.push(pageText(content.items));
      page.cleanup();
    }
    if (looksScanned(pages)) throw new Error(SCANNED_MESSAGE);
    let text = pages.join('\n\n');
    // Legacy non-Unicode Hebrew fonts leave a text layer of accented Latin gibberish (no ToUnicode map).
    const ascii = (text.match(/[A-Za-z]/g) || []).length;
    const latinExt = (text.match(/[\u00C0-\u024F]/g) || []).length;
    if (latinExt > 50 && latinExt > ascii) {
      throw new Error("This PDF's text layer is unreadable (it was made with a non-Unicode font). It needs OCR before it can be read aloud, and this app does not do OCR.");
    }
    text = text.replace(/(\p{Ll})[-\u00AD]\n(\p{Ll})/gu, '$1$2'); // re-join words hyphenated across a line break (any script)
    const title = metaTitle.replace(/^Microsoft Word - /, '').replace(/\.(docx?|odt|rtf|txt)$/i, '').trim();
    return { title: title || baseName(file.name), text, pages: pdf.numPages };
  } finally {
    loadingTask.destroy(); // releases the document and its worker
  }
}

// ---------- language & chunking ----------

function detectLang(text) {
  const counts = { he: 0, ru: 0, en: 0 };
  for (const ch of text.slice(0, 20000)) {
    const c = ch.codePointAt(0);
    if (c >= 0x0590 && c <= 0x05ff) counts.he++;
    else if (c >= 0x0400 && c <= 0x04ff) counts.ru++;
    else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0xc0 && c <= 0x24f)) counts.en++;
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? best : null;
}

function sentenceSpans(str, lang) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    try {
      // Paragraph breaks were split off already, so a newline here is a line wrap, not a sentence
      // end — but ICU treats every newline as one. Segment a same-length copy with wraps as spaces.
      const seg = new Intl.Segmenter(lang || undefined, { granularity: 'sentence' });
      return Array.from(seg.segment(str.replace(/[\r\n]/g, ' ')), (s) => [s.index, s.index + s.segment.length]);
    } catch { /* fall through to the regex */ }
  }
  const spans = [];
  const re = /[.!?…]+["'”’)\]]*\s+/g;
  let start = 0, m;
  while ((m = re.exec(str))) { spans.push([start, m.index + m[0].length]); start = re.lastIndex; }
  if (start < str.length) spans.push([start, str.length]);
  return spans;
}

function hardSplit(text, s, e, max) {
  const parts = [];
  let a = s;
  while (e - a > max) {
    const window = text.slice(a, a + max);
    const comma = window.lastIndexOf(', ');
    const space = window.lastIndexOf(' ');
    const cut = comma >= max / 3 ? comma + 2 : space >= max / 3 ? space + 1 : max;
    parts.push([a, a + cut]);
    a += cut;
  }
  parts.push([a, e]);
  return parts;
}

function buildChunks(text, lang) {
  const chunks = [];
  const push = (s, e, para) => {
    const spoken = text.slice(s, e).replace(/\s+/g, ' ').trim();
    if (spoken) chunks.push({ start: s, end: e, text: spoken, para });
  };
  const paraBreak = /\n[ \t\r]*\n\s*/g;
  const paras = [];
  let last = 0, m;
  while ((m = paraBreak.exec(text))) { paras.push([last, m.index]); last = paraBreak.lastIndex; }
  paras.push([last, text.length]);

  paras.forEach(([ps, pe], para) => {
    const str = text.slice(ps, pe);
    if (!str.trim()) return;
    let cur = null;
    const flush = () => { if (cur) { push(cur[0], cur[1], para); cur = null; } };
    for (const [a, b] of sentenceSpans(str, lang)) {
      const s = ps + a, e = ps + b;
      const len = text.slice(s, e).trim().length;
      if (!len) continue;
      if (len > MAX_CHUNK) {
        flush();
        for (const [x, y] of hardSplit(text, s, e, MAX_CHUNK)) push(x, y, para);
      } else if (cur && e - cur[0] <= MAX_CHUNK) {
        cur[1] = e;
      } else {
        flush();
        cur = [s, e];
      }
    }
    flush();
  });
  return chunks;
}

// ---------- voices ----------

function baseLang(tag) {
  const b = String(tag || '').toLowerCase().replace('_', '-').split('-')[0];
  return b === 'iw' ? 'he' : b; // 'iw' is the legacy code Chrome/Android still use for Hebrew
}
const voicesFor = (lang) => voices.filter((v) => baseLang(v.lang) === lang);

let displayNames = null;
try { displayNames = new Intl.DisplayNames(['en'], { type: 'language' }); } catch { /* old browser */ }
function langName(code) {
  try { return (displayNames && displayNames.of(code)) || code; } catch { return code; }
}

function selectedVoice() {
  const list = voicesFor(state.lang);
  return list.find((v) => v.voiceURI === prefs.voices[state.lang]) || list.find((v) => v.default) || list[0] || null;
}

let voicesSettled = false; // true once voices arrived or we gave up waiting
function refreshVoices() {
  if (!synth) return;
  voices = synth.getVoices().slice().sort((a, b) => a.name.localeCompare(b.name));
  if (voices.length) voicesSettled = true;
  render();
}

// ---------- persistence ----------

function saveText() {
  try {
    localStorage.setItem(KEY_TEXT, JSON.stringify({ title: book.title, text: book.text, pages: book.pages }));
    el.persist.hidden = true;
  } catch {
    el.persist.hidden = false;
  }
}
const bookId = () => (book ? `${book.title}:${book.text.length}` : '');
function saveState() {
  try { localStorage.setItem(KEY_STATE, JSON.stringify({ id: bookId(), lang: state.lang, index: state.index, offset: state.offset })); } catch { /* quota */ }
}
function savePrefs() {
  try { localStorage.setItem(KEY_PREFS, JSON.stringify(prefs)); } catch { /* quota */ }
}
function clearStored() {
  try { localStorage.removeItem(KEY_TEXT); localStorage.removeItem(KEY_STATE); } catch { /* ignore */ }
}
function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function restore() {
  const p = readJson(KEY_PREFS);
  if (p && typeof p === 'object') prefs = { rate: Number(p.rate) || 1, voices: p.voices || {} };
  const t = readJson(KEY_TEXT);
  if (!t || typeof t.text !== 'string' || !t.text.trim()) return;
  setBook(t.title, t.text, t.pages, detectLang(t.text) || 'en');
  const s = readJson(KEY_STATE);
  if (s && s.id === bookId()) { // a position another tab saved for another book is ignored
    if (s.lang) state.lang = s.lang;
    state.index = Math.min(Math.max(0, s.index | 0), book.chunks.length - 1);
    state.offset = Math.max(0, s.offset | 0);
  }
}

// ---------- book lifecycle ----------

function setBook(title, text, pages, lang) {
  const chunks = buildChunks(text, detectLang(text) || 'en');
  const cum = [0];
  for (const c of chunks) cum.push(cum[cum.length - 1] + c.text.length);
  book = { title, text, pages, chunks, cum, total: cum[cum.length - 1] || 1 };
  state = { lang, index: 0, offset: 0, status: 'idle' };
  renderBook();
}

async function loadFile(file) {
  if (!file) return;
  hideError();
  const name = file.name || 'book';
  const ext = name.toLowerCase().split('.').pop();
  const isPdf = ext === 'pdf' || file.type === 'application/pdf';
  const isTxt = ext === 'txt' || file.type === 'text/plain';
  const kept = book ? ' Your current book was kept.' : '';
  if (!isPdf && !isTxt) {
    showError(`"${name}" is not supported. Upload a PDF or a plain-text (.txt) file.${kept}`);
    return;
  }
  if (state.status === 'playing') pause();
  const my = ++loadSeq; // if a newer upload starts while this one is still extracting, this one is dropped
  el.play.disabled = true;
  setStatus('Reading file…');
  try {
    const result = isPdf
      ? await readPdf(file, (p, n) => { if (my === loadSeq) setStatus(`Extracting text… page ${p} of ${n}`); })
      : await readTxt(file);
    if (my !== loadSeq) return;
    if (!result.text.trim()) throw new Error(`"${name}" is empty — there is no text to read.`);
    gen++;
    if (synth) synth.cancel();
    clearStored(); // the previous book and its progress are gone for good
    const lang = detectLang(result.text);
    setBook(result.title, result.text, result.pages, lang || 'en');
    saveText();
    saveState();
    if (!lang) showError('Could not tell which language this book is in. Pick one from the Language menu.');
    window.scrollTo({ top: 0 });
  } catch (err) {
    if (my === loadSeq) showError((err && err.message ? err.message : String(err)) + kept);
  } finally {
    if (my === loadSeq) { setStatus(''); render(); }
  }
}

// ---------- playback ----------

const canPlay = () => !!book && !!synth && voicesFor(state.lang).length > 0;

function togglePlay() {
  if (!book) return;
  if (state.status === 'playing') pause();
  else play();
}

function play() {
  statusOverride = '';
  hideError();
  if (!canPlay()) { render(); return; }
  if (state.index >= book.chunks.length) { state.index = 0; state.offset = 0; }
  state.status = 'playing';
  render();
  restart();
}

// (Re)start speaking from the current position after cancelling whatever is live.
function restart() {
  const my = ++gen;
  synth.cancel();
  setTimeout(() => { if (my === gen && state.status === 'playing') speakChunk(); }, RESTART_DELAY);
}

function speakChunk() {
  const chunk = book.chunks[state.index];
  if (!chunk) { finish(); return; }
  if (state.offset >= chunk.text.length) { state.index++; state.offset = 0; speakChunk(); return; }
  const text = chunk.text.slice(state.offset);
  const voice = selectedVoice();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.lang = voice ? voice.lang : DEFAULT_TAG[state.lang] || state.lang;
  u.rate = prefs.rate;
  const my = gen;
  const base = state.offset;
  u.onboundary = (e) => {
    if (my !== gen) return;
    if (typeof e.charIndex === 'number' && e.charIndex >= 0) state.offset = base + e.charIndex;
  };
  u.onend = () => {
    if (my !== gen) return;
    state.index++;
    state.offset = 0;
    saveState();
    if (state.index >= book.chunks.length) finish();
    else { renderProgress(); speakChunk(); }
  };
  u.onerror = (e) => {
    if (my !== gen) return;
    if (e.error === 'interrupted' || e.error === 'canceled') return;
    showError(`The speech engine stopped: ${e.error || 'unknown error'}. Press Play to continue.`);
    pause();
  };
  current = u;
  renderProgress();
  synth.speak(u);
}

function pause() {
  gen++;
  if (synth) synth.cancel();
  state.status = 'paused';
  saveState();
  render();
}

function stop() {
  statusOverride = '';
  gen++;
  if (synth) synth.cancel();
  state.status = 'idle';
  state.index = 0;
  state.offset = 0;
  saveState();
  render();
}

function finish() {
  gen++;
  state.status = 'idle';
  state.index = 0;
  state.offset = 0;
  saveState();
  render();
  setStatus('Finished');
}

function seekTo(index) {
  if (!book) return;
  statusOverride = '';
  state.index = Math.min(Math.max(0, index), book.chunks.length - 1);
  state.offset = 0;
  saveState();
  if (state.status === 'playing') restart();
  render();
}

// ---------- rendering ----------

function showError(msg) {
  el.error.textContent = msg;
  el.error.hidden = false;
  el.error.scrollIntoView({ block: 'center' }); // the Upload button is sticky, so the user may be anywhere in the book
}
function hideError() { el.error.hidden = true; el.error.textContent = ''; }

function setStatus(text) {
  statusOverride = text;
  renderStatus();
}

function renderStatus() {
  if (statusOverride) { el.status.textContent = statusOverride; return; }
  el.status.textContent = state.status === 'playing' ? 'Playing' : state.status === 'paused' ? 'Paused' : 'Ready';
}

function renderBook() {
  el.title.textContent = book.title;
  const minutes = Math.max(1, Math.round(book.total / 850));
  el.stats.textContent =
    (book.pages ? `${book.pages} page${book.pages === 1 ? '' : 's'} · ` : '') +
    `${book.chunks.length.toLocaleString()} segments · ${book.text.length.toLocaleString()} characters · about ${minutes} min at 1×`;
  const frag = document.createDocumentFragment();
  let p = null, lastPara = -1;
  book.chunks.forEach((c, i) => {
    if (c.para !== lastPara) {
      p = document.createElement('p');
      p.dir = 'auto';
      frag.appendChild(p);
      lastPara = c.para;
    } else {
      p.appendChild(document.createTextNode(' '));
    }
    const span = document.createElement('span');
    span.className = 'chunk';
    span.dataset.i = String(i);
    span.textContent = c.text;
    p.appendChild(span);
  });
  el.text.replaceChildren(frag);
}

function renderLangOptions() {
  const langs = new Set(CORE_LANGS);
  if (state.lang) langs.add(state.lang);
  for (const v of voices) if (baseLang(v.lang)) langs.add(baseLang(v.lang));
  const extra = [...langs].filter((l) => !CORE_LANGS.includes(l)).sort((a, b) => langName(a).localeCompare(langName(b)));
  el.lang.replaceChildren(
    ...[...CORE_LANGS, ...extra].map((code) => {
      const n = voicesFor(code).length;
      const o = document.createElement('option');
      o.value = code;
      o.textContent = n ? `${langName(code)} (${n} voice${n === 1 ? '' : 's'})` : `${langName(code)} — no voice installed`;
      return o;
    }),
  );
  el.lang.value = state.lang;
}

function renderVoiceOptions() {
  const list = voicesFor(state.lang);
  const chosen = selectedVoice();
  el.voice.replaceChildren(
    ...list.map((v) => {
      const o = document.createElement('option');
      o.value = v.voiceURI;
      o.textContent = `${v.name} (${v.lang})`;
      return o;
    }),
  );
  if (!list.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = 'No voice for this language';
    el.voice.appendChild(o);
  }
  el.voice.value = chosen ? chosen.voiceURI : '';
  el.voice.disabled = !list.length;
  el.rate.value = String(prefs.rate);
}

function renderNotice() {
  if (!book) { el.notice.hidden = true; return; }
  if (!synth) {
    el.notice.innerHTML = '<strong>This browser has no speech engine.</strong> Open this page in Chrome, Edge, Safari or Firefox.';
    el.notice.hidden = false;
    return;
  }
  if (voicesFor(state.lang).length) { el.notice.hidden = true; return; }
  const name = langName(state.lang);
  el.notice.innerHTML = voices.length
    ? `<strong>No ${name} voice is installed on this device</strong>, so this book will not be read in ${name} — ` +
      `reading it with another language's voice would sound wrong. Install one and reload this page:<br>` +
      `macOS → System Settings → Accessibility → Spoken Content → System Voice → Manage Voices… · ` +
      `Windows → Settings → Time &amp; Language → Speech → Add voices · ` +
      `iPhone/iPad → Settings → Accessibility → Spoken Content → Voices · ` +
      `Android → Settings → Google Text-to-speech → Install voice data.<br>` +
      `Or pick another language from the menu above if the book is really in that language.`
    : '<strong>Loading voices…</strong> If this message stays, your browser reports no speech voices at all.';
  el.notice.hidden = false;
}

function renderChips() {
  el.chips.replaceChildren(
    ...CORE_LANGS.map((code) => {
      const n = voicesFor(code).length;
      const chip = document.createElement('span');
      const loading = !n && !voicesSettled;
      chip.className = 'chip ' + (n ? 'ok' : loading ? '' : 'missing');
      chip.textContent = n ? `${langName(code)} ✓` : loading ? `${langName(code)} …` : `${langName(code)} ✗ no voice`;
      chip.title = n ? voicesFor(code).map((v) => v.name).join(', ') : `No ${langName(code)} voice installed on this device`;
      return chip;
    }),
  );
}

function renderProgress() {
  if (!book) {
    el.fill.style.width = '0%';
    el.progress.setAttribute('aria-valuenow', '0');
    el.position.textContent = '—';
    return;
  }
  const n = book.chunks.length;
  const i = Math.min(state.index, n);
  const done = (book.cum[i] || 0) + (i < n ? Math.min(state.offset, book.chunks[i].text.length) : 0);
  const pct = Math.round((100 * done) / book.total);
  el.fill.style.width = `${pct}%`;
  el.progress.setAttribute('aria-valuenow', String(pct));
  el.progress.setAttribute('aria-valuetext', `${pct}%, segment ${Math.min(i + 1, n)} of ${n}`);
  el.position.textContent = `${pct}% · ${Math.min(i + 1, n)} / ${n}`;
  const prev = el.text.querySelector('.chunk.active');
  if (prev && Number(prev.dataset.i) === i) return;
  // Follow the voice only while the reader is following it: if the previous sentence has been
  // scrolled off screen, the reader went to look at something else — leave the page there.
  const following = !prev || (({ top, bottom }) => bottom > 0 && top < window.innerHeight)(prev.getBoundingClientRect());
  if (prev) prev.classList.remove('active');
  const cur = el.text.querySelector(`.chunk[data-i="${i}"]`);
  if (cur) {
    cur.classList.add('active');
    if (state.status === 'playing' && following) {
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      cur.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    }
  }
}

function render() {
  const has = !!book;
  el.empty.hidden = has;
  el.book.hidden = !has;
  // Only the book text follows the language's direction; the controls stay LTR so
  // the English labels and numbers do not get bidi-scrambled in Hebrew.
  if (has) {
    el.text.dir = RTL_LANGS.has(state.lang) ? 'rtl' : 'ltr';
    el.text.lang = state.lang;
  }
  renderLangOptions();
  renderVoiceOptions();
  renderNotice();
  renderChips();
  renderProgress();
  renderStatus();
  const playing = state.status === 'playing';
  el.play.classList.toggle('playing', playing);
  el.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  el.play.disabled = !canPlay();
  el.stop.disabled = !has || (state.status === 'idle' && state.index === 0 && state.offset === 0);
}

// ---------- wiring ----------

el.file.addEventListener('change', () => { loadFile(el.file.files && el.file.files[0]); el.file.value = ''; });
el.play.addEventListener('click', togglePlay);
el.stop.addEventListener('click', stop);

el.lang.addEventListener('change', () => {
  state.lang = el.lang.value;
  hideError();
  saveState();
  if (state.status === 'playing') { if (canPlay()) restart(); else pause(); }
  render();
});
el.voice.addEventListener('change', () => {
  prefs.voices[state.lang] = el.voice.value;
  savePrefs();
  if (state.status === 'playing') restart();
});
el.rate.addEventListener('change', () => {
  prefs.rate = Number(el.rate.value) || 1;
  savePrefs();
  if (state.status === 'playing') restart();
});

el.text.addEventListener('click', (e) => {
  const span = e.target.closest('.chunk');
  if (span) seekTo(Number(span.dataset.i));
});

el.progress.addEventListener('click', (e) => {
  if (!book) return;
  const r = el.progress.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  seekTo(Math.floor(ratio * book.chunks.length));
});
el.progress.addEventListener('keydown', (e) => {
  if (!book) return;
  const keys = { ArrowLeft: state.index - 1, ArrowRight: state.index + 1, Home: 0, End: book.chunks.length - 1 };
  if (e.key in keys) { e.preventDefault(); seekTo(keys[e.key]); }
});

document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || ['SELECT', 'INPUT', 'BUTTON', 'TEXTAREA'].includes(e.target.tagName)) return;
  e.preventDefault();
  togglePlay();
});

document.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('drag'); });
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('drag'); });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('drag');
  loadFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
});

window.addEventListener('pagehide', () => {
  gen++;
  if (synth) synth.cancel();
  if (state.status === 'playing') { state.status = 'paused'; saveState(); render(); }
});

if (!synth) {
  showError('This browser has no speech engine (Web Speech API). Open this page in Chrome, Edge, Safari or Firefox.');
} else {
  synth.addEventListener('voiceschanged', refreshVoices);
  // Safari may never fire voiceschanged and some engines deliver voices seconds later: poll for a while.
  let tries = 0;
  const poll = setInterval(() => {
    if (!voices.length) refreshVoices();
    if (voices.length || ++tries >= 24) { clearInterval(poll); voicesSettled = true; render(); }
  }, 500);
}
restore();
refreshVoices();
render();

// PWA: installable and usable offline (sw.js precaches the app shell and pdf.js).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is a bonus, never a blocker */ });
}
// When installed, the OS can hand a PDF/.txt straight to the app ("Open with…").
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (launch) => {
    const handle = launch.files && launch.files[0];
    if (handle) loadFile(await handle.getFile());
  });
}
