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
const KEY_UI = 'read-aloud.ui';              // the interface language the user picked, if any

// ---------- WhatsApp contact — the ONLY place the business number lives ----------
const WHATSAPP_NUMBER = '972545312632';       // international format, digits only, no "+" 
const CORE_LANGS = ['he', 'en', 'ru'];
const RTL_LANGS = new Set(['he', 'ar', 'fa', 'ur', 'yi']);
const DEFAULT_TAG = { he: 'he-IL', en: 'en-US', ru: 'ru-RU' };
const $ = (id) => document.getElementById(id);
const el = {
  file: $('file'), empty: $('empty'), book: $('book'), title: $('title'), stats: $('stats'),
  credit: $('credit'), lang: $('lang'), voice: $('voice'), rate: $('rate'), notice: $('notice'), persist: $('persist'),
  text: $('text'), error: $('error'), chips: $('chips'), progress: $('progress'), fill: $('fill'),
  position: $('position'), play: $('play'), stop: $('stop'), speed: $('speed'), status: $('status'),
  uiLang: $('ui-lang'), uploadLabel: $('upload-label'), emptyTitle: $('empty-title'), emptyDesc: $('empty-desc'),
  creditMade: $('credit-made'), creditTag: $('credit-tag'), wa: $('wa'), waLabel: $('wa-label'),
  labelLang: $('label-lang'), labelVoice: $('label-voice'), labelRate: $('label-rate'),
};

// ---------- interface language (i18n) ----------
// Every visible string lives here. Plural forms are objects keyed by Intl.PluralRules categories
// (one / two / few / many / other); a missing category falls back to "other".
// Strings marked REVIEW are the ones a native speaker should check (mostly OS menu names).
const I18N = {
  en: {
    upload: 'Upload PDF or .txt',
    uiLanguage: 'Interface language',
    voicesOnDevice: 'Voices installed on this device',
    emptyTitle: 'Tap here to choose a book',
    emptyDesc: 'One PDF or plain-text (.txt) file at a time — or drop it anywhere on this page. Everything happens in your browser; nothing is uploaded anywhere.',
    madeBy: 'Made by',
    tagline: 'we build automations and useful apps',
    whatsapp: 'Message us on WhatsApp',
    waMessage: "Hi! I found you through the Read Aloud app and I'd like to hear about an app or automation.",
    readingLanguage: 'Reading language',
    voice: 'Voice',
    speed: 'Speed',
    persist: 'This book is too large to remember after a reload — it stays loaded until you leave the page.',
    play: 'Play', pause: 'Pause', stop: 'Stop', position: 'Position in book',
    ready: 'Ready', playing: 'Playing', paused: 'Paused', finished: 'Finished',
    readingFile: 'Reading file…',
    extracting: 'Extracting text… page {page} of {pages}',
    dropToLoad: 'Drop to load',
    untitled: 'Untitled',
    pages: { one: '{n} page', other: '{n} pages' },
    segments: { one: '{n} segment', other: '{n} segments' },
    characters: { one: '{n} character', other: '{n} characters' },
    aboutMinutes: 'about {n} min at 1×',
    positionText: '{pct}%, segment {i} of {n}',
    voicesCount: { one: '{n} voice', other: '{n} voices' },
    noVoiceInstalled: '— no voice installed',
    noVoiceForLanguage: 'No voice for this language',
    chipMissing: '✗ no voice',
    chipTitleMissing: 'No {lang} voice installed on this device',
    noEngineTitle: 'This viewer has no speech engine.',
    noEngineBody: 'Open this page in Chrome or Safari (share icon → open in browser).',
    noEngineError: 'This viewer has no speech engine, so nothing can be read aloud here. If you opened this page inside another app, open it in Chrome or Safari instead (share icon → open in browser) — file upload also works only there.',
    noVoiceTitle: 'No {lang} voice is installed on this device',
    noVoiceBody: ", so this book will not be read in {lang} — reading it with another language's voice would sound wrong. Install one and reload this page:",
    voiceInstallSteps: 'macOS → System Settings → Accessibility → Spoken Content → System Voice → Manage Voices… · Windows → Settings → Time & Language → Speech → Add voices · iPhone/iPad → Settings → Accessibility → Spoken Content → Voices · Android → Settings → Google Text-to-speech → Install voice data.',
    orPickLanguage: 'Or pick another language from the menu above if the book is really in that language.',
    loadingVoicesTitle: 'Loading voices…',
    loadingVoicesBody: 'If this message stays, your browser reports no speech voices at all.',
    errUnsupported: '"{name}" is not supported. Upload a PDF or a plain-text (.txt) file.',
    errEmpty: '"{name}" is empty — there is no text to read.',
    errKept: ' Your current book was kept.',
    errNotUtf8: 'This .txt file is not UTF-8 encoded. Save it as UTF-8 and upload it again.',
    errScanned: 'This PDF has no text layer — it looks like a scanned document. It needs OCR before it can be read aloud, and this app does not do OCR.',
    errPassword: 'This PDF is password-protected. Remove the password and upload it again.',
    errNotPdf: 'This file could not be opened as a PDF. It may be damaged or not really a PDF.',
    errUnreadableLayer: "This PDF's text layer is unreadable (it was made with a non-Unicode font). It needs OCR before it can be read aloud, and this app does not do OCR.",
    errLangUnknown: 'Could not tell which language this book is in. Pick one from the Reading language menu.',
    errEngine: 'The speech engine stopped: {error}. Press Play to continue.',
  },
  he: {
    upload: 'העלאת PDF או TXT',
    uiLanguage: 'שפת הממשק',
    voicesOnDevice: 'קולות שמותקנים במכשיר הזה',
    emptyTitle: 'הקישו כאן לבחירת ספר',
    emptyDesc: 'קובץ PDF או טקסט (TXT) אחד בכל פעם — או גררו אותו לכל מקום בדף. הכול קורה בדפדפן שלכם; שום דבר לא נשלח לשום מקום.',
    madeBy: 'נבנה על ידי',
    tagline: 'אנחנו בונים אוטומציות ואפליקציות שימושיות',
    whatsapp: 'כתבו לנו בוואטסאפ',
    waMessage: 'היי! הגעתי אליכם דרך האפליקציה Read Aloud ואשמח לשמוע על אפליקציה או אוטומציה.',
    readingLanguage: 'שפת הקריאה',
    voice: 'קול',
    speed: 'מהירות',
    persist: 'הספר הזה גדול מכדי להישמר אחרי רענון — הוא נשאר טעון עד שתעזבו את הדף.',
    play: 'ניגון', // REVIEW: "הפעלה" is the other common choice
    pause: 'השהיה', stop: 'עצירה', position: 'מיקום בספר',
    ready: 'מוכן',
    playing: 'מקריא', // REVIEW
    paused: 'מושהה', finished: 'הסתיים',
    readingFile: 'קורא את הקובץ…',
    extracting: 'מחלץ טקסט… עמוד {page} מתוך {pages}',
    dropToLoad: 'שחררו כדי לטעון',
    untitled: 'ללא שם',
    pages: { one: 'עמוד אחד', other: '{n} עמודים' },
    segments: { one: 'קטע אחד', other: '{n} קטעים' }, // REVIEW: "קטע" for a spoken segment
    characters: { one: 'תו אחד', other: '{n} תווים' },
    aboutMinutes: 'בערך {n} דק׳ במהירות רגילה',
    positionText: '{pct}%, קטע {i} מתוך {n}',
    voicesCount: { one: 'קול אחד', other: '{n} קולות' },
    noVoiceInstalled: '— אין קול מותקן',
    noVoiceForLanguage: 'אין קול לשפה הזו',
    chipMissing: '✗ אין קול',
    chipTitleMissing: 'במכשיר הזה לא מותקן קול ב{lang}',
    noEngineTitle: 'לתצוגה הזו אין מנוע דיבור.',
    noEngineBody: 'פתחו את הדף ב-Chrome או ב-Safari (סמל השיתוף ← פתיחה בדפדפן).',
    noEngineError: 'לתצוגה הזו אין מנוע דיבור, ולכן אי אפשר להקריא כאן. אם פתחתם את הדף בתוך אפליקציה אחרת, פתחו אותו ב-Chrome או ב-Safari (סמל השיתוף ← פתיחה בדפדפן) — גם העלאת קבצים עובדת רק שם.',
    noVoiceTitle: 'במכשיר הזה לא מותקן קול ב{lang}',
    noVoiceBody: ', ולכן הספר לא יוקרא ב{lang} — הקראה בקול של שפה אחרת תישמע לא נכון. התקינו קול וטענו את הדף מחדש:',
    // REVIEW: OS menu names depend on the device language; arrows point in reading direction.
    voiceInstallSteps: 'macOS ← הגדרות המערכת ← נגישות ← תוכן מדובר ← קול המערכת ← ניהול קולות… · Windows ← הגדרות ← שעה ושפה ← דיבור ← הוספת קולות · iPhone/iPad ← הגדרות ← נגישות ← תוכן מדובר ← קולות · Android ← הגדרות ← Google Text-to-speech ← התקנת נתוני קול.',
    orPickLanguage: 'או בחרו שפה אחרת בתפריט למעלה אם הספר באמת כתוב בשפה הזו.',
    loadingVoicesTitle: 'טוען קולות…',
    loadingVoicesBody: 'אם ההודעה הזו נשארת, הדפדפן לא מדווח על קולות דיבור בכלל.',
    errUnsupported: 'הקובץ "{name}" אינו נתמך. העלו קובץ PDF או קובץ טקסט (TXT).',
    errEmpty: 'הקובץ "{name}" ריק — אין טקסט להקראה.',
    errKept: ' הספר הנוכחי נשמר.',
    errNotUtf8: 'קובץ ה-TXT הזה אינו בקידוד UTF-8. שמרו אותו כ-UTF-8 והעלו שוב.',
    errScanned: 'ל-PDF הזה אין שכבת טקסט — נראה שזה מסמך סרוק. הוא זקוק ל-OCR לפני שאפשר להקריא אותו, והאפליקציה הזו לא מבצעת OCR.',
    errPassword: 'ה-PDF הזה מוגן בסיסמה. הסירו את הסיסמה והעלו שוב.',
    errNotPdf: 'לא ניתן לפתוח את הקובץ כ-PDF. ייתכן שהוא פגום או שאינו באמת PDF.',
    errUnreadableLayer: 'שכבת הטקסט של ה-PDF הזה אינה קריאה (הוא נוצר עם גופן שאינו Unicode). הוא זקוק ל-OCR לפני שאפשר להקריא אותו, והאפליקציה הזו לא מבצעת OCR.',
    errLangUnknown: 'לא הצלחנו לזהות באיזו שפה הספר כתוב. בחרו שפה בתפריט "שפת הקריאה".',
    errEngine: 'מנוע הדיבור נעצר: {error}. לחצו על ניגון כדי להמשיך.',
  },
  ru: {
    upload: 'Загрузить PDF/TXT',
    uiLanguage: 'Язык интерфейса',
    voicesOnDevice: 'Голоса, установленные на этом устройстве',
    emptyTitle: 'Нажмите здесь, чтобы выбрать книгу',
    emptyDesc: 'Один файл PDF или текстовый (TXT) за раз — или перетащите его в любое место страницы. Всё происходит в вашем браузере; ничего никуда не отправляется.',
    madeBy: 'Сделано',
    tagline: 'мы создаём автоматизации и полезные приложения',
    whatsapp: 'Напишите нам в WhatsApp',
    waMessage: 'Здравствуйте! Пишу из приложения Read Aloud — хочу узнать о приложении или автоматизации.',
    readingLanguage: 'Язык чтения',
    voice: 'Голос',
    speed: 'Скорость',
    persist: 'Эта книга слишком большая, чтобы сохраниться после перезагрузки — она остаётся открытой, пока вы не покинете страницу.',
    play: 'Воспроизвести', pause: 'Пауза', stop: 'Стоп', position: 'Место в книге',
    ready: 'Готово',
    playing: 'Читает', // REVIEW
    paused: 'Пауза', finished: 'Завершено',
    readingFile: 'Читаю файл…',
    extracting: 'Извлекаю текст… страница {page} из {pages}',
    dropToLoad: 'Отпустите, чтобы загрузить',
    untitled: 'Без названия',
    pages: { one: '{n} страница', few: '{n} страницы', many: '{n} страниц', other: '{n} страницы' },
    segments: { one: '{n} сегмент', few: '{n} сегмента', many: '{n} сегментов', other: '{n} сегмента' },
    characters: { one: '{n} знак', few: '{n} знака', many: '{n} знаков', other: '{n} знака' },
    aboutMinutes: 'около {n} мин на обычной скорости',
    positionText: '{pct}%, сегмент {i} из {n}',
    voicesCount: { one: '{n} голос', few: '{n} голоса', many: '{n} голосов', other: '{n} голоса' },
    noVoiceInstalled: '— голос не установлен',
    noVoiceForLanguage: 'Нет голоса для этого языка',
    chipMissing: '✗ нет голоса',
    chipTitleMissing: 'На этом устройстве не установлен голос для языка «{lang}»',
    noEngineTitle: 'В этом окне нет речевого движка.',
    noEngineBody: 'Откройте страницу в Chrome или Safari (значок «Поделиться» → открыть в браузере).',
    noEngineError: 'В этом окне нет речевого движка, поэтому читать вслух здесь нельзя. Если вы открыли страницу внутри другого приложения, откройте её в Chrome или Safari (значок «Поделиться» → открыть в браузере) — загрузка файлов тоже работает только там.',
    noVoiceTitle: 'На этом устройстве не установлен голос для языка «{lang}»',
    noVoiceBody: ', поэтому книга не будет прочитана на этом языке — чтение голосом другого языка звучало бы неправильно. Установите голос и перезагрузите страницу:',
    // REVIEW: OS menu names depend on the device language.
    voiceInstallSteps: 'macOS → Системные настройки → Универсальный доступ → Устный контент → Системный голос → Управление голосами… · Windows → Параметры → Время и язык → Речь → Добавить голоса · iPhone/iPad → Настройки → Универсальный доступ → Устный контент → Голоса · Android → Настройки → Синтез речи Google → Установить голосовые данные.',
    orPickLanguage: 'Или выберите другой язык в меню выше, если книга действительно на нём написана.',
    loadingVoicesTitle: 'Загружаю голоса…',
    loadingVoicesBody: 'Если это сообщение не исчезает, браузер вообще не сообщает о голосах.',
    errUnsupported: 'Файл «{name}» не поддерживается. Загрузите PDF или текстовый файл (TXT).',
    errEmpty: 'Файл «{name}» пуст — читать нечего.',
    errKept: ' Текущая книга сохранена.',
    errNotUtf8: 'Этот TXT-файл не в кодировке UTF-8. Сохраните его в UTF-8 и загрузите снова.',
    errScanned: 'У этого PDF нет текстового слоя — похоже, это скан. Ему нужно распознавание (OCR), а это приложение OCR не делает.',
    errPassword: 'Этот PDF защищён паролем. Снимите пароль и загрузите снова.',
    errNotPdf: 'Не удалось открыть файл как PDF. Возможно, он повреждён или это не PDF.',
    errUnreadableLayer: 'Текстовый слой этого PDF нечитаем (он сделан шрифтом без Unicode). Ему нужно распознавание (OCR), а это приложение OCR не делает.',
    errLangUnknown: 'Не удалось определить язык книги. Выберите его в меню «Язык чтения».',
    errEngine: 'Речевой движок остановился: {error}. Нажмите «Воспроизвести», чтобы продолжить.',
  },
};

let uiLangSaved = null; // explicit choice from the header switcher, persisted
try { uiLangSaved = localStorage.getItem(KEY_UI); } catch { /* storage blocked */ }

function browserUiLang() {
  const tags = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  for (const tag of tags) { const b = baseLang(tag); if (I18N[b]) return b; }
  return 'en';
}
// The saved choice wins; otherwise the interface follows the book's reading language, then the browser.
function uiLang() {
  if (uiLangSaved && I18N[uiLangSaved]) return uiLangSaved;
  if (book && I18N[state.lang]) return state.lang;
  return browserUiLang();
}
function t(key, params) {
  const lang = uiLang();
  const s = (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
  return params ? s.replace(/\{(\w+)\}/g, (_, k) => (params[k] === undefined ? '' : String(params[k]))) : s;
}
function tn(key, n) {
  const lang = uiLang();
  const forms = (I18N[lang] && I18N[lang][key]) || I18N.en[key];
  let category = 'other';
  try { category = new Intl.PluralRules(lang).select(n); } catch { /* old browser */ }
  return (forms[category] || forms.other).replace('{n}', n.toLocaleString(lang));
}

const synth = window.speechSynthesis;
let voices = [];
let book = null;                                   // { title, text, pages, chunks, cum, total }
let state = { lang: 'en', index: 0, offset: 0, status: 'idle' };
let prefs = { rate: 1, voices: {} };               // voices: { [lang]: voiceURI }
let gen = 0;                                       // bumped on every cancel; events from older utterances are ignored
let loadSeq = 0;                                   // bumped per upload; a slower, older load must never land on top of a newer one
let current = null;                                // keep the live utterance referenced — Chrome drops events of GC'd utterances
let statusOverride = null;                         // { key, params } shown instead of the playback state, e.g. while loading

// ---------- text extraction ----------

function baseName(name) {
  return (name || '').replace(/\.[^.]+$/, '').trim() || t('untitled');
}

async function readTxt(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  const text = new TextDecoder(encoding).decode(bytes);
  if (text.includes('\0')) throw new Error(t('errNotUtf8')); // a NUL in a text file means UTF-16 without a BOM, not UTF-8
  const bad = (text.match(/\uFFFD/g) || []).length;
  if (bad > 2 && bad * 100 > text.length) throw new Error(t('errNotUtf8'));
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
// Returns the page twice: `fixed` with brackets mirrored back in right-to-left text, and
// `plain` without, for PDFs whose Hebrew comes out mirrored and is reversed back later.
function pageText(items) {
  // The EOL marker is often an empty item already positioned on the next line, so measure
  // from the last item of the line that actually carries text.
  const lines = [];
  let line = [];
  let lastText = null;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.str) line.push(item);
    if (item.str && item.str.trim()) lastText = item;
    if (!item.hasEOL) continue;
    let next = null;
    for (let j = i + 1; j < items.length; j++) if (items[j].str && items[j].str.trim()) { next = items[j]; break; }
    const gap = lastText && next ? Math.abs(lastText.transform[5] - next.transform[5]) : 0;
    lines.push({ items: line, gap, height: lastText ? lastText.height || 0 : 0, nextHeight: next ? next.height || 0 : 0 });
    line = [];
    lastText = null;
  }
  if (line.length) lines.push({ items: line, gap: 0, height: 0, nextHeight: 0 });
  const gaps = lines.map((l) => l.gap).filter((g) => g > 0).sort((a, b) => a - b);
  const usual = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
  let rtl = 0, ltr = 0;
  for (const it of items) for (const ch of it.str) { const t = strongType(ch); if (t === 'R') rtl++; else if (t === 'L') ltr++; }
  const rtlPage = rtl > ltr;
  // `plain` keeps every pdf.js line; `fixed` also rejoins table cells that wrapped onto a second line.
  const join = (rows, render) => {
    const at = (i) => rows[i] || lines[i];
    let out = '';
    for (let i = 0; i < lines.length; i++) {
      if (rows[i] === null) continue; // the second line of a wrapped row, already part of the row above
      const l = at(i);
      out += render(l);
      let n = i + 1;
      while (n < lines.length && rows[n] === null) n++;
      if (n >= lines.length) break;
      const sizeChange = l.height && l.nextHeight && Math.abs(l.height - l.nextHeight) > 0.2 * Math.max(l.height, l.nextHeight);
      out += (usual && l.gap > 1.3 * usual) || sizeChange ? '\n\n' : '\n';
    }
    return out;
  };
  const plain = join([], (l) => lineText(l.items, false, rtlPage));
  const fixed = join(joinWrappedCells(lines, rtlPage), (l) => l.text ?? lineText(l.items, true, rtlPage));
  return { plain, fixed };
}

// ---- one line of a PDF page, rebuilt from where its pieces sit ----
// pdf.js hands over a line as pieces in drawing order. Three things go wrong with Hebrew:
// 1. A space is added only when the pen moves forward, but a Hebrew table is drawn right to
//    left, so its cells come out glued together ("אופן תשלוםתאריך פירעון").
// 2. Some producers (Chrome among them) draw a line's runs left to right, so a line with a
//    number or an English word comes out in screen order ("2026 תשלום חודש").
// 3. pdf.js turns screen order into reading order but never mirrors brackets back, so
//    "(₪)" comes out ")₪(".
// So right-to-left lines are put back in reading order from the pieces' positions (the
// Unicode bidi rules applied to whole pieces), a space goes wherever a visible gap separates
// two pieces, and brackets that were reversed are mirrored back.
const RTL_LETTER = /[\u05D0-\u05EA\u05F0-\u05F2\u0620-\u064A\u066E-\u06D3\uFB1D-\uFDFF\uFE70-\uFEFC]/;
const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«', '‹': '›', '›': '‹' };
const PEEL = /[\s.,:;!?|'"\u2026\u2013\u2014]/; // punctuation that can sit on either side of an English word or a number

function strongType(ch) {
  if (RTL_LETTER.test(ch)) return 'R';
  if (/\p{L}/u.test(ch)) return 'L';
  if (/\p{Nd}/u.test(ch)) return 'EN';
  return null;
}

// Inside one piece that pdf.js reversed: a bracket between right-to-left text (or numbers)
// was reversed with it and must be mirrored; one inside an English run was not.
function mirrorBrackets(str, para) {
  if (!/[()[\]{}<>«»‹›]/.test(str)) return str;
  const chars = Array.from(str);
  const types = chars.map(strongType);
  let last = para;
  for (let i = 0; i < types.length; i++) {
    if (types[i] === 'EN') { if (last === 'L') types[i] = 'L'; } else if (types[i]) last = types[i];
  }
  const side = (i, step) => {
    for (let j = i + step; j >= 0 && j < types.length; j += step) if (types[j]) return types[j] === 'L' ? 'L' : 'R';
    return para;
  };
  return chars.map((c, i) => {
    if (!MIRROR[c]) return c;
    const before = side(i, -1), after = side(i, 1);
    return (before === after ? before : para) === 'R' ? MIRROR[c] : c;
  }).join('');
}

function box(item) {
  const x = item.transform[4], w = item.width || 0;
  return { left: Math.min(x, x + w), right: Math.max(x, x + w) };
}
// Two pieces with daylight between them are separate words or cells.
function apart(a, b, size) {
  const A = box(a), B = box(b);
  return Math.max(B.left - A.right, A.left - B.right) > 0.15 * size || Math.abs(a.transform[5] - b.transform[5]) > 0.5 * size;
}
const flat = (item) => item.transform[0] > 0 && Math.abs(item.transform[1]) < 1e-3 && Math.abs(item.transform[2]) < 1e-3;

// A table row whose cells wrap is drawn by some programs line by line: all the cells' first
// lines, then all their second lines, so it reads "אופן תאריך חברת / תשלום פירעון אשראי".
// Lines that sit closer together than the lines around them, with every piece of a lower
// line under a different column of the top line, are one row: each column's lines are
// joined and the columns read in order. A dense table looks the same, so a block of three
// or four lines is joined only when it looks like wrapping: the second line has fewer pieces
// than the first and none has more than the line above (only the longest cells go on) and no column holds a number on two lines
// (numbers do not wrap; a column of numbers is a table column).
function columns(items, size) {
  const segs = [];
  const sorted = items.filter((it) => it.str.trim()).map((it) => ({ it, ...box(it) })).sort((a, b) => a.left - b.left);
  for (const b of sorted) {
    const s = segs[segs.length - 1];
    if (s && b.left - s.right <= 0.8 * size) { s.items.push(b.it); s.right = Math.max(s.right, b.right); }
    else segs.push({ left: b.left, right: b.right, items: [b.it] });
  }
  return segs;
}
const NUMBER = /^[\d\s.,/:%\u20AA$€+-]+$/u;
function joinWrappedCells(lines, rtlPage) {
  const rows = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const A = lines[i];
    const size = Math.max(...A.items.map((it) => it.height || 0)) || 10;
    const step = A.gap;
    if (rows[i] !== undefined || !(step > 0 && step <= 1.35 * size)) continue;
    let j = i + 1; // the tight block is lines i..j, evenly spaced
    while (j + 1 < lines.length && j - i < 3 && Math.abs(lines[j].gap - step) <= 0.15 * step) j++;
    const block = lines.slice(i, j + 1);
    const before = i > 0 && lines[i - 1].gap ? lines[i - 1].gap : Infinity;
    const after = j + 1 < lines.length && lines[j].gap ? lines[j].gap : Infinity;
    if (before < 1.25 * step || after < 1.25 * step || !block.every((l) => l.items.every(flat))) continue;
    const top = columns(A.items, size);
    const below = block.slice(1).map((l) => columns(l.items, size));
    if (top.length < 2) continue;
    const homes = below.map((segs) => segs.map((b) => top.filter((t) => Math.min(t.right, b.right) - Math.max(t.left, b.left) > 0)));
    if (homes.some((h) => !h.length || h.some((u) => u.length !== 1) || new Set(h.map((u) => u[0])).size !== h.length)) continue;
    if (below.length > 1) {
      const counts = [top.length, ...below.map((segs) => segs.length)];
      if (counts[1] >= counts[0] || counts.some((c, k) => k > 1 && c > counts[k - 1])) continue;
      const numbers = new Map(top.map((t) => [t, NUMBER.test(t.items.map((it) => it.str).join('')) ? 1 : 0]));
      below.forEach((segs, k) => segs.forEach((b, n) => { if (NUMBER.test(b.items.map((it) => it.str).join(''))) numbers.set(homes[k][n][0], numbers.get(homes[k][n][0]) + 1); }));
      if ([...numbers.values()].some((v) => v > 1)) continue;
    }
    let rtl = 0, ltr = 0;
    for (const l of block) for (const it of l.items) for (const ch of it.str) { const t = strongType(ch); if (t === 'R') rtl++; else if (t === 'L') ltr++; }
    const order = rtl && rtl >= ltr ? [...top].sort((a, b) => b.right - a.right) : top;
    const text = order
      .map((t) => [t.items, ...below.flatMap((segs, k) => segs.filter((_, n) => homes[k][n][0] === t).map((b) => b.items))]
        .map((part) => lineText(part, true, rtlPage)).join(' '))
      .join(' ');
    const last = lines[j];
    rows[i] = { text, gap: last.gap, height: A.height, nextHeight: last.nextHeight };
    for (let k = i + 1; k <= j; k++) rows[k] = null;
  }
  return rows;
}

function lineText(items, mirror, rtlPage) {
  if (!items.length) return '';
  const own = (it) => (mirror && RTL_LETTER.test(it.str) ? mirrorBrackets(it.str, it.dir === 'rtl' ? 'R' : 'L') : it.str);
  const size = Math.max(...items.map((it) => it.height || 0)) || 10;
  let rtl = 0, ltr = 0;
  for (const it of items) for (const ch of it.str) { const t = strongType(ch); if (t === 'R') rtl++; else if (t === 'L') ltr++; }
  const geometry = items.every(flat);

  // Left-to-right (or unmeasurable) lines keep pdf.js's order; only missing spaces are added.
  if (!rtl || rtl < ltr || !geometry) {
    let out = '', prev = null, spaced = true;
    for (const it of items) {
      const s = own(it);
      if (!s.trim()) { out += s; spaced = true; continue; }
      if (prev && geometry && !spaced && !/\s$/.test(out) && !/^\s/.test(s) && apart(prev, it, size)) out += ' ';
      out += s;
      prev = it;
      spaced = /\s$/.test(s);
    }
    // An English sentence on a Hebrew page is drawn with its full stop at the left end.
    const stray = !rtl && rtlPage && out.match(/^([.,:;!?]+)(\p{L}[^]*)$/u);
    return stray ? stray[2] + stray[1] : out;
  }

  // Right-to-left line: pieces in screen order (left to right), as units of one direction.
  const sorted = items.map((it, i) => ({ it, i, left: box(it).left })).sort((a, b) => a.left - b.left || a.i - b.i);
  const units = [];
  let prev = null;
  for (const { it } of sorted) {
    const s = it.str;
    if (!s.trim()) { units.push({ t: s, c: 'N' }); prev = null; continue; }
    if (prev && apart(prev, it, size)) units.push({ t: ' ', c: 'N' });
    prev = it;
    if (RTL_LETTER.test(s)) { units.push({ t: own(it), c: 'R' }); continue; }
    const c = /\p{L}/u.test(s) ? 'L' : /\p{Nd}/u.test(s) ? 'EN' : 'N';
    if (c === 'N') { units.push({ t: s, c }); continue; }
    // Punctuation glued to the outside of an English word or a number belongs to the
    // right-to-left text around it (the full stop of "באמצעות ACME Books." is drawn at the left).
    const chars = Array.from(s);
    let a = 0, b = chars.length;
    while (a < b && PEEL.test(chars[a])) a++;
    while (b > a && PEEL.test(chars[b - 1])) b--;
    for (const ch of chars.slice(0, a)) units.push({ t: ch, c: 'N' });
    units.push({ t: chars.slice(a, b).join(''), c });
    for (const ch of chars.slice(b)) units.push({ t: ch, c: 'N' });
  }
  // The bidi rules (W7, N1, N2, I2, L2) over whole units, paragraph right to left.
  let last = 'R';
  for (const u of units) {
    if (u.c === 'EN') { if (last === 'L') u.c = 'L'; } else if (u.c !== 'N') last = u.c;
  }
  const strong = (i, step) => {
    for (let j = i; j >= 0 && j < units.length; j += step) if (units[j].c !== 'N') return units[j].c === 'L' ? 'L' : 'R';
    return 'R';
  };
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u.c === 'N') u.level = strong(i, -1) === 'L' && strong(i, 1) === 'L' ? 2 : 1;
    else u.level = u.c === 'R' ? 1 : 2;
  }
  const order = [];
  for (let i = 0; i < units.length;) {
    let j = i;
    while (j < units.length && (units[j].level === 2) === (units[i].level === 2)) j++;
    const run = units.slice(i, j);
    order.push(...(units[i].level === 2 ? run : run.reverse()));
    i = j;
  }
  // The runs above are in screen order with right-to-left runs already reversed; reading
  // order is the whole sequence of runs from right to left.
  const runs = [];
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j < order.length && (order[j].level === 2) === (order[i].level === 2)) j++;
    runs.push(order.slice(i, j));
    i = j;
  }
  return runs
    .reverse()
    .flat()
    .map((u) => (mirror && u.c === 'N' && u.level === 1 ? Array.from(u.t, (ch) => MIRROR[ch] || ch).join('') : u.t))
    .join('')
    .replace(/ {2,}/g, ' ');
}

// Some Hebrew PDFs store each line's glyphs in logical order and place them right-to-left,
// and pdf.js's visual-to-logical pass then mirrors every line: final-form letters (ך ם ן ף ץ)
// end up at the START of words and the full stop at the start of the line. Correct Hebrew
// never starts a word with a final letter, so that is the signal.
const HEBREW_FINAL = /[\u05DA\u05DD\u05DF\u05E3\u05E5]/;
function hebrewLooksMirrored(text) {
  let atStart = 0, atEnd = 0;
  for (const w of text.match(/[\u05D0-\u05EA]{2,}/g) || []) {
    if (HEBREW_FINAL.test(w[0])) atStart++;
    if (HEBREW_FINAL.test(w[w.length - 1])) atEnd++;
  }
  return atStart >= 3 && atStart > atEnd;
}
// Mirror a line back (keeping diacritics on their letters), then restore the inner order of
// Latin/digit runs, which were already correct and must not be flipped.
const LTR_RUN = /[A-Za-z0-9\u00C0-\u024F](?:[A-Za-z0-9\u00C0-\u024F .,'’"&/:%+-]*[A-Za-z0-9\u00C0-\u024F])?/g;
function unmirrorLine(line) {
  if (!/[\u0590-\u05FF]/.test(line)) return line;
  const mirrored = (line.match(/\P{M}\p{M}*/gu) || []).reverse().join('');
  return mirrored.replace(LTR_RUN, (run) => Array.from(run).reverse().join(''));
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
      throw new Error(t('errPassword'));
    }
    throw new Error(t('errNotPdf'));
  }
  try {
    const meta = await pdf.getMetadata().catch(() => null);
    const metaTitle = String((meta && meta.info && meta.info.Title) || '').trim();
    const pages = [];
    const fixedPages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      onProgress(p, pdf.numPages);
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const { plain, fixed } = pageText(content.items);
      pages.push(plain);
      fixedPages.push(fixed);
      page.cleanup();
    }
    if (looksScanned(pages)) throw new Error(t('errScanned'));
    let text = pages.join('\n\n');
    // Legacy non-Unicode Hebrew fonts leave a text layer of accented Latin gibberish (no ToUnicode map).
    const ascii = (text.match(/[A-Za-z]/g) || []).length;
    const latinExt = (text.match(/[\u00C0-\u024F]/g) || []).length;
    if (latinExt > 50 && latinExt > ascii) {
      throw new Error(t('errUnreadableLayer'));
    }
    if (hebrewLooksMirrored(text)) text = text.split('\n').map(unmirrorLine).join('\n');
    else text = fixedPages.join('\n\n'); // same text, brackets mirrored back where pdf.js reversed them
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

const displayNames = {}; // per interface language
function langName(code) {
  const lang = uiLang();
  try {
    displayNames[lang] = displayNames[lang] || new Intl.DisplayNames([lang], { type: 'language' });
    return displayNames[lang].of(code) || code;
  } catch { return code; }
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
  const kept = book ? t('errKept') : '';
  if (!isPdf && !isTxt) {
    showError(t('errUnsupported', { name }) + kept);
    return;
  }
  if (state.status === 'playing') pause();
  const my = ++loadSeq; // if a newer upload starts while this one is still extracting, this one is dropped
  el.play.disabled = true;
  setStatus('readingFile');
  try {
    const result = isPdf
      ? await readPdf(file, (p, n) => { if (my === loadSeq) setStatus('extracting', { page: p, pages: n }); })
      : await readTxt(file);
    if (my !== loadSeq) return;
    if (!result.text.trim()) throw new Error(t('errEmpty', { name }));
    gen++;
    if (synth) synth.cancel();
    clearStored(); // the previous book and its progress are gone for good
    const lang = detectLang(result.text);
    setBook(result.title, result.text, result.pages, lang || 'en');
    saveText();
    saveState();
    if (!lang) showError(t('errLangUnknown'));
    window.scrollTo({ top: 0 });
  } catch (err) {
    if (my === loadSeq) showError((err && err.message ? err.message : String(err)) + kept);
  } finally {
    if (my === loadSeq) { setStatus(null); render(); }
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
  statusOverride = null;
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
    showError(t('errEngine', { error: e.error || 'unknown' }));
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
  statusOverride = null;
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
  setStatus('finished');
}

function seekTo(index) {
  if (!book) return;
  statusOverride = null;
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

function setStatus(key, params) {
  statusOverride = key ? { key, params } : null;
  renderStatus();
}

function renderStatus() {
  if (statusOverride) { el.status.textContent = t(statusOverride.key, statusOverride.params); return; }
  el.status.textContent = t(state.status === 'playing' ? 'playing' : state.status === 'paused' ? 'paused' : 'ready');
}

function renderStats() {
  const minutes = Math.max(1, Math.round(book.total / 850));
  el.stats.textContent = [
    book.pages ? tn('pages', book.pages) : null,
    tn('segments', book.chunks.length),
    tn('characters', book.text.length),
    t('aboutMinutes', { n: minutes }),
  ].filter(Boolean).join(' · ');
}

function renderBook() {
  el.title.textContent = book.title;
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
      o.textContent = n ? `${langName(code)} (${tn('voicesCount', n)})` : `${langName(code)} ${t('noVoiceInstalled')}`;
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
    o.textContent = t('noVoiceForLanguage');
    el.voice.appendChild(o);
  }
  el.voice.value = chosen ? chosen.voiceURI : '';
  el.voice.disabled = !list.length;
  el.rate.value = String(prefs.rate);
}

// Builds the notice from text nodes (never innerHTML with translated strings).
function noticeContent(title, ...rest) {
  const strong = document.createElement('strong');
  strong.textContent = title;
  const nodes = [strong];
  rest.forEach((part, i) => {
    if (i > 0) nodes.push(document.createElement('br'));
    nodes.push(document.createTextNode(part));
  });
  el.notice.replaceChildren(...nodes);
  el.notice.hidden = false;
}

function renderNotice() {
  if (!book) { el.notice.hidden = true; return; }
  if (!synth) { noticeContent(t('noEngineTitle'), ' ' + t('noEngineBody')); return; }
  if (voicesFor(state.lang).length) { el.notice.hidden = true; return; }
  const lang = langName(state.lang);
  if (voices.length) {
    noticeContent(t('noVoiceTitle', { lang }), t('noVoiceBody', { lang }), t('voiceInstallSteps'), t('orPickLanguage'));
  } else {
    noticeContent(t('loadingVoicesTitle'), ' ' + t('loadingVoicesBody'));
  }
}

function renderChips() {
  el.chips.replaceChildren(
    ...CORE_LANGS.map((code) => {
      const n = voicesFor(code).length;
      const chip = document.createElement('span');
      const loading = !n && !voicesSettled;
      chip.className = 'chip ' + (n ? 'ok' : loading ? '' : 'missing');
      chip.textContent = n ? `${langName(code)} ✓` : loading ? `${langName(code)} …` : `${langName(code)} ${t('chipMissing')}`;
      chip.title = n ? voicesFor(code).map((v) => v.name).join(', ') : t('chipTitleMissing', { lang: langName(code) });
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
  el.progress.setAttribute('aria-valuetext', t('positionText', { pct, i: Math.min(i + 1, n), n }));
  // Three spans with the same text as before ("35% · 12 / 340"), so phones can stack the
  // percentage over the segment count instead of wrapping it at a random space.
  const part = (cls, text) => Object.assign(document.createElement('span'), { className: cls, textContent: text });
  el.position.replaceChildren(part('pct', `${pct}%`), part('sep', ' · '), part('seg', `${Math.min(i + 1, n)} / ${n}`));
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

// Static strings: everything that is not rebuilt by the render* functions below.
function applyI18n() {
  const lang = uiLang();
  document.documentElement.lang = lang;
  document.documentElement.dir = RTL_LANGS.has(lang) ? 'rtl' : 'ltr';
  el.uiLang.value = lang;
  el.uiLang.setAttribute('aria-label', t('uiLanguage'));
  el.uploadLabel.textContent = t('upload');
  el.file.setAttribute('aria-label', t('upload'));
  el.chips.setAttribute('aria-label', t('voicesOnDevice'));
  el.emptyTitle.textContent = t('emptyTitle');
  el.emptyDesc.textContent = t('emptyDesc');
  el.creditMade.textContent = t('madeBy');
  el.creditTag.textContent = t('tagline');
  el.waLabel.textContent = t('whatsapp');
  el.wa.href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(t('waMessage'))}`;
  el.labelLang.textContent = t('readingLanguage');
  el.labelVoice.textContent = t('voice');
  el.labelRate.textContent = t('speed');
  el.persist.textContent = t('persist');
  el.stop.setAttribute('aria-label', t('stop'));
  el.progress.setAttribute('aria-label', t('position'));
  document.body.dataset.dropLabel = t('dropToLoad');
}

// The speed button in the player bar mirrors the Speed list: same values, same saved preference.
function renderSpeed() {
  const label = `${prefs.rate}×`;
  el.speed.textContent = label;
  el.speed.setAttribute('aria-label', `${t('speed')} ${label}`);
  el.speed.disabled = !book;
}

function render() {
  const has = !!book;
  applyI18n();
  el.empty.hidden = has;
  el.book.hidden = !has; // the credit after it stays: under the start panel, or under the book text
  // The controls follow the interface language (page dir); the book text follows the
  // reading language, so a Hebrew book keeps its RTL text inside an English interface and vice versa.
  if (has) {
    el.text.dir = RTL_LANGS.has(state.lang) ? 'rtl' : 'ltr';
    el.text.lang = state.lang;
    renderStats();
  }
  renderLangOptions();
  renderVoiceOptions();
  renderNotice();
  renderChips();
  renderProgress();
  renderStatus();
  const playing = state.status === 'playing';
  el.play.classList.toggle('playing', playing);
  el.play.setAttribute('aria-label', t(playing ? 'pause' : 'play'));
  el.play.disabled = !canPlay();
  el.stop.disabled = !has || (state.status === 'idle' && state.index === 0 && state.offset === 0);
  renderSpeed();
}

// ---------- wiring ----------

el.file.addEventListener('change', () => { loadFile(el.file.files && el.file.files[0]); el.file.value = ''; });
el.uiLang.addEventListener('change', () => {
  uiLangSaved = el.uiLang.value;
  try { localStorage.setItem(KEY_UI, uiLangSaved); } catch { /* storage blocked — the choice lasts for this visit */ }
  hideError();
  render();
});
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
  renderSpeed();
  if (state.status === 'playing') restart();
});
// Next speed in the list, wrapping round; it goes through the Speed list's own change handler.
el.speed.addEventListener('click', () => {
  const rates = [...el.rate.options].map((o) => Number(o.value));
  const next = rates.find((r) => r > prefs.rate) ?? rates[0];
  el.rate.value = String(next);
  el.rate.dispatchEvent(new Event('change'));
});
// A mouse click must not leave focus on the button, or the page-wide Space shortcut (play/pause)
// would step the speed instead. Keyboard users still Tab to it and press Enter or Space.
el.speed.addEventListener('mousedown', (e) => e.preventDefault());

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
  showError(t('noEngineError'));
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
