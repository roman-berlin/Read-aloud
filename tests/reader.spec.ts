import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ALL_VOICES, installFakeSpeech, spoken, ttsLog, type CancelEntry, type SpeakEntry, type FakeSpeechOptions } from './fake-speech';

const fx = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const FIRST_ENGLISH_LINE = "The Lighthouse Keeper's Ledger";

// The interface language follows the book's language unless the user picked one, so most tests
// pin it to English (as a user who picked English would) to keep their assertions readable.
// Pass { uiLang: null } to exercise the defaulting itself.
async function open(page: Page, opts?: FakeSpeechOptions & { uiLang?: string | null }) {
  const ui = opts?.uiLang === undefined ? 'en' : opts.uiLang;
  if (ui) await page.addInitScript((lang) => localStorage.setItem('read-aloud.ui', lang), ui);
  await installFakeSpeech(page, opts);
  await page.goto('/');
}
const upload = (page: Page, file: string) => page.setInputFiles('#file', fx(file));
const status = (page: Page) => page.locator('#status');
const position = (page: Page) => page.locator('#position');
const playBtn = (page: Page) => page.getByRole('button', { name: 'Play' });
const pauseBtn = (page: Page) => page.getByRole('button', { name: 'Pause' });
const stopBtn = (page: Page) => page.getByRole('button', { name: 'Stop' });
const voiceOptions = (page: Page) => page.locator('#voice option').allTextContents();
const spokenCount = (page: Page) => spoken(page).then((s) => s.length);

test('English .txt: title, language, voices, and Play / Pause / Resume / Stop', async ({ page }) => {
  await open(page, { msPerWord: 40 });
  await upload(page, 'english.txt');

  await expect(page.locator('#title')).toHaveText('english');
  await expect(page.locator('#lang')).toHaveValue('en');
  expect(await voiceOptions(page)).toEqual(['Daniel (en-GB)', 'Samantha (en-US)']);
  await expect(page.locator('#voice')).toHaveValue('fake:Samantha'); // the engine's default voice wins
  await expect(page.locator('#text')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('#stats')).toContainText('segments');
  await expect(stopBtn(page)).toBeDisabled();

  // Play
  await playBtn(page).click();
  await expect(status(page)).toHaveText('Playing');
  await expect.poll(() => spokenCount(page)).toBeGreaterThanOrEqual(3);
  const early = await spoken(page);
  expect(early[0].text).toBe(FIRST_ENGLISH_LINE);
  for (const s of early) {
    expect(s.text.length).toBeLessThanOrEqual(160);
    expect(s.lang).toBe('en-US');
    expect(s.voice).toBe('Samantha');
    expect(s.rate).toBe(1);
  }
  await expect(position(page)).not.toHaveText(/^0%/);
  await expect(page.locator('.chunk.active')).toHaveCount(1);

  // Pause mid-segment (after at least two spoken words): the engine is cancelled and stays silent
  await expect.poll(() => page.evaluate(() => (window as unknown as { __tts: { live: () => { boundaries: number } | null } }).__tts.live()?.boundaries ?? 0)).toBeGreaterThanOrEqual(2);
  await pauseBtn(page).click();
  await expect(status(page)).toHaveText('Paused');
  const atPause = await ttsLog(page);
  const cancel = atPause[atPause.length - 1] as CancelEntry;
  expect(cancel.type).toBe('cancel');
  expect(cancel.text).not.toBeNull(); // something was being spoken when Pause was pressed
  const spokenAtPause = (await spoken(page)).length;
  await page.waitForTimeout(400);
  expect((await ttsLog(page)).length).toBe(atPause.length);

  // Resume: continues the cut-off segment from its last spoken word, not from the top
  await playBtn(page).click();
  await expect(status(page)).toHaveText('Playing');
  await expect.poll(() => spokenCount(page)).toBeGreaterThan(spokenAtPause);
  const resumed = (await spoken(page))[spokenAtPause];
  const interrupted = cancel.text as string;
  expect(resumed.text.length).toBeGreaterThan(0);
  expect(interrupted.endsWith(resumed.text)).toBe(true);
  // The first boundary event is at offset 0, so only from the second word on is there anything to skip.
  if (cancel.boundaries > 1) expect(resumed.text.length).toBeLessThan(interrupted.length); // words already heard are not repeated
  else expect(resumed.text).toBe(interrupted); // cut off within its first word: the whole segment is due

  // Stop: back to the beginning, engine cancelled and silent
  await stopBtn(page).click();
  await expect(status(page)).toHaveText('Ready');
  await expect(position(page)).toHaveText(/^0% · 1 \//);
  await expect(page.locator('#progress')).toHaveAttribute('aria-valuenow', '0');
  await expect(stopBtn(page)).toBeDisabled();
  const afterStop = await ttsLog(page);
  expect(afterStop[afterStop.length - 1].type).toBe('cancel');
  await page.waitForTimeout(300);
  expect((await ttsLog(page)).length).toBe(afterStop.length);

  // Play again starts from the first line
  const beforeRestart = (await spoken(page)).length;
  await playBtn(page).click();
  await expect.poll(() => spokenCount(page)).toBeGreaterThan(beforeRestart);
  expect((await spoken(page))[beforeRestart].text).toBe(FIRST_ENGLISH_LINE);
});

test('Russian .txt is detected as Russian and read with the Russian voice', async ({ page }) => {
  await open(page);
  await upload(page, 'russian.txt');
  await expect(page.locator('#title')).toHaveText('russian');
  await expect(page.locator('#lang')).toHaveValue('ru');
  expect(await voiceOptions(page)).toEqual(['Milena (ru-RU)']);
  await expect(page.locator('#text')).toHaveAttribute('dir', 'ltr');

  await playBtn(page).click();
  await expect.poll(() => spokenCount(page)).toBeGreaterThanOrEqual(2);
  const [first, second] = await spoken(page);
  expect(first).toMatchObject({ text: 'Письмо с северной станции', lang: 'ru-RU', voice: 'Milena' });
  expect(second.text).toContain('Дорогая Лена');
  await pauseBtn(page).click();
  await expect(status(page)).toHaveText('Paused');
  await stopBtn(page).click();
  await expect(status(page)).toHaveText('Ready');
});

test('Hebrew PDF: title from PDF metadata, RTL layout, Hebrew voices (incl. the legacy "iw" code)', async ({ page }) => {
  await open(page);
  await upload(page, 'hebrew.pdf');
  await expect(page.locator('#title')).toHaveText('מסע אל הנגב');
  await expect(page.locator('#lang')).toHaveValue('he');
  await expect(page.locator('#text')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#stats')).toContainText('2 pages');
  expect(await voiceOptions(page)).toEqual(['Carmit (he-IL)', 'Google עברית (iw-IL)']);

  await playBtn(page).click();
  await expect(status(page)).toHaveText('Playing');
  await expect.poll(() => spokenCount(page)).toBeGreaterThanOrEqual(3);
  const s = await spoken(page);
  expect(s[0].text).toBe('מסע אל הנגב');
  expect(s[1].text).toContain('בבוקר הראשון של הטיול');
  for (const u of s) {
    expect(u.lang).toBe('he-IL');
    expect(u.voice).toBe('Carmit');
    expect(u.text.length).toBeLessThanOrEqual(160);
  }
  await pauseBtn(page).click();
  await expect(status(page)).toHaveText('Paused');
  await playBtn(page).click();
  await expect(status(page)).toHaveText('Playing');
  await stopBtn(page).click();
  await expect(status(page)).toHaveText('Ready');
  await expect(position(page)).toHaveText(/^0%/);
});

test('a Hebrew PDF whose text layer comes out mirrored is repaired before reading', async ({ page }) => {
  // tests/fixtures/hebrew-mirrored.pdf stores each line in logical order, which pdf.js mirrors
  // (final letters at word starts, full stop first). The app must un-mirror it, keeping
  // Latin words and numbers intact.
  await open(page);
  await upload(page, 'hebrew-mirrored.pdf');
  await expect(page.locator('#title')).toHaveText('בית הרוח');
  await expect(page.locator('#lang')).toHaveValue('he');
  const expected = await readFile(fx('hebrew-mirrored.expected.txt'), 'utf8');
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  expect(norm(await page.locator('#text').innerText())).toBe(norm(expected));
  await playBtn(page).click();
  await expect.poll(() => spokenCount(page)).toBeGreaterThanOrEqual(2);
  const s = await spoken(page);
  expect(s[0].text).toBe('בית הרוח');
  expect(s[1].text).toContain('HOUSE OF SPIRIT');
  expect(s[1].text).toContain('משפחה יקרה');
});

for (const [file, how] of [
  ['receipt-visual.pdf', 'cells drawn right to left, Hebrew stored in screen order (the way many invoicing programs write it)'],
  ['receipt-chrome.pdf', 'printed from Chrome, which draws a line\'s Hebrew and numbers left to right as separate pieces'],
]) {
  test(`a Hebrew receipt with a table reads in order, with spaces between cells and brackets the right way round: ${file}`, async ({ page }) => {
    // ${how}. pdf.js glued the cells together ("אופן תשלוםתאריך פירעון"), returned "(₪)" as
    // ")₪(", and for Chrome put numbers before the words they follow ("2026 הערות: תשלום").
    await open(page, { msPerWord: 20 });
    await upload(page, file);
    await expect(page.locator('#lang')).toHaveValue('he');
    const expected = await readFile(fx(file.replace('.pdf', '.expected.txt')), 'utf8');
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    expect(norm(await page.locator('#text').innerText())).toBe(norm(expected));
    // What the voice is given: the cells as separate words, the amount as one number.
    await playBtn(page).click();
    const segments = await page.locator('.chunk').count();
    await expect.poll(() => spokenCount(page)).toBeGreaterThanOrEqual(Math.min(3, segments)); // a short receipt may already be finished
    expect((await spoken(page)).map((u) => u.text).join(' ')).not.toMatch(/\)₪\(|[\u05D0-\u05EA]\d|\d[\u05D0-\u05EA]/);
    const all = (await page.locator('.chunk').allTextContents()).join(' ');
    expect(all).toContain('אופן תשלום תאריך פירעון חברת אשראי');
    expect(all).toContain('סה"כ (₪)');
    expect(all).toContain('לאומי קארד 0690 01/32 1 75.76');
    expect(all).toContain('הערות: תשלום חודש אוגוסט 2026 (כולל מע"מ)');
    expect(all).not.toMatch(/\)₪\(|[\u05D0-\u05EA]\d|\d[\u05D0-\u05EA]/); // no reversed brackets, no word glued to a number
  });
}

test('table cells that wrap onto a second or third line read cell by cell, and dense tables keep their rows', async ({ page }) => {
  // tests/fixtures/receipt-wrapped.pdf: a header row drawn line by line (all first lines, then all
  // second lines), which read "אופן תאריך חברת… / תשלום פירעון אשראי…"; rows drawn cell by cell
  // with tight leading; and a dense three-row table that must not be read column by column.
  await open(page);
  await upload(page, 'receipt-wrapped.pdf');
  await expect(page.locator('#title')).toHaveText('פירוט תשלומים');
  const expected = await readFile(fx('receipt-wrapped.expected.txt'), 'utf8');
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const text = norm(await page.locator('#text').innerText());
  expect(text).toBe(norm(expected));
  expect(text).toContain('אופן תשלום תאריך פירעון חברת אשראי מס\' כרטיס תוקף כרטיס סה"כ (₪)');
  expect(text).toContain('מוצר כמות מחיר שמן מנורה 2 4.50 פתילה 5 1.20');
  // three-line cells, and a dense table whose last row lacks a cell (still rows, not columns)
  expect(text).toContain('אופן תשלום בפועל תאריך פירעון חברת אשראי מנפיקה מס\' כרטיס תוקף כרטיס אשראי סה"כ');
  expect(text).toContain('מוצר כמות מחיר שמן מנורה 2 4.50 פתילה 5 1.20 גפרורים 0.90');
});

test('without a Hebrew voice the app explains instead of reading in the wrong language', async ({ page }) => {
  await open(page, { voices: ALL_VOICES.filter((v) => !/^(he|iw)/.test(v.lang)) });
  await expect(page.locator('#chips')).toContainText('Hebrew ✗');
  await expect(page.locator('#chips')).toContainText('English ✓');

  await upload(page, 'hebrew.pdf');
  await expect(page.locator('#notice')).toBeVisible();
  await expect(page.locator('#notice')).toContainText('No Hebrew voice is installed on this device');
  await expect(page.locator('#notice')).toContainText('macOS');
  await expect(playBtn(page)).toBeDisabled();
  await page.keyboard.press('Space'); // the keyboard shortcut must not bypass the guard
  await page.waitForTimeout(250);
  expect(await spoken(page)).toHaveLength(0);

  // The override is the user's call: pick English and reading proceeds with an English voice
  await page.selectOption('#lang', 'en');
  await expect(page.locator('#notice')).toBeHidden();
  await expect(playBtn(page)).toBeEnabled();
  await playBtn(page).click();
  await expect.poll(() => spokenCount(page)).toBeGreaterThanOrEqual(1);
  expect((await spoken(page))[0].lang).toBe('en-US');
});

test('uploading a new file stops playback, deletes the old book and its progress, and starts the new one', async ({ page }) => {
  await open(page);
  await upload(page, 'english.txt');
  await playBtn(page).click();
  await expect.poll(() => spokenCount(page)).toBeGreaterThanOrEqual(2);

  await upload(page, 'russian.txt');
  await expect(page.locator('#title')).toHaveText('russian');
  await expect(status(page)).toHaveText('Ready');
  await expect(position(page)).toHaveText(/^0% · 1 \//);
  await expect(page.locator('#lang')).toHaveValue('ru');
  const log = await ttsLog(page);
  expect(log[log.length - 1].type).toBe('cancel');
  await expect(page.locator('#text')).not.toContainText('Lighthouse');
  await expect(page.locator('#text')).toContainText('Письмо');

  const stored = await page.evaluate(() => ({
    text: JSON.parse(localStorage.getItem('read-aloud.text') || 'null'),
    state: JSON.parse(localStorage.getItem('read-aloud.state') || 'null'),
  }));
  expect(stored.text.title).toBe('russian');
  expect(stored.text.text).not.toContain('Lighthouse');
  expect(stored.state).toMatchObject({ index: 0, offset: 0, lang: 'ru' });

  await page.reload();
  await expect(page.locator('#title')).toHaveText('russian');
  await expect(page.locator('#lang')).toHaveValue('ru');
  await expect(position(page)).toHaveText(/^0% · 1 \//);
});

test('the book and the reading position survive a reload', async ({ page }) => {
  await open(page);
  await upload(page, 'english.txt');
  await playBtn(page).click();
  await expect.poll(() => spokenCount(page)).toBeGreaterThanOrEqual(3);
  await pauseBtn(page).click();
  const pos = (await position(page).textContent()) ?? '';
  expect(pos).not.toMatch(/^0%/);

  await page.reload();
  await expect(page.locator('#title')).toHaveText('english');
  await expect(position(page)).toHaveText(pos);
  await expect(stopBtn(page)).toBeEnabled();
  await playBtn(page).click();
  await expect.poll(() => spokenCount(page)).toBeGreaterThanOrEqual(1);
  expect((await spoken(page))[0].text).not.toBe(FIRST_ENGLISH_LINE);
});

test.describe('errors are explained clearly', () => {
  const cases: Array<[string, string]> = [
    ['notes.docx', 'is not supported'],
    ['empty.txt', 'is empty'],
    ['scanned.pdf', 'needs OCR'],
    ['cp1251.txt', 'not UTF-8'],
    ['utf16-nobom.txt', 'not UTF-8'],
  ];
  for (const [file, fragment] of cases) {
    test(`${file} → "${fragment}"`, async ({ page }) => {
      await open(page);
      await upload(page, file);
      await expect(page.locator('#error')).toBeVisible();
      await expect(page.locator('#error')).toContainText(fragment);
      await expect(page.locator('#book')).toBeHidden();
      await expect(page.locator('#empty')).toBeVisible();
      await expect(playBtn(page)).toBeDisabled();
      await expect(status(page)).toHaveText('Ready');
    });
  }

  test('UTF-16 with a byte-order mark (Windows Notepad "Unicode") is decoded, not refused', async ({ page }) => {
    await open(page);
    await upload(page, 'utf16.txt');
    await expect(page.locator('#error')).toBeHidden();
    await expect(page.locator('#title')).toHaveText('utf16');
    await expect(page.locator('#text')).toContainText('Hello from Notepad');
  });

  test('a failed upload keeps the current book', async ({ page }) => {
    await open(page);
    await upload(page, 'english.txt');
    await upload(page, 'scanned.pdf');
    await expect(page.locator('#error')).toContainText('needs OCR');
    await expect(page.locator('#error')).toContainText('Your current book was kept');
    await expect(page.locator('#title')).toHaveText('english');
    await expect(playBtn(page)).toBeEnabled();
  });
});

test('a long text is read in short chunks and reaches the end', async ({ page }) => {
  await open(page, { msPerWord: 1 });
  await upload(page, 'english.txt');
  await playBtn(page).click();
  await expect(status(page)).toHaveText('Finished', { timeout: 20_000 });
  const s = await spoken(page);
  expect(s.length).toBeGreaterThan(10);
  expect(Math.max(...s.map((x) => x.text.length))).toBeLessThanOrEqual(160);
  expect(s.map((x) => x.text).join(' ')).toContain('stopped counting the steps.');
  await expect(position(page)).toHaveText(/^0%/);
  await expect(page.locator('#progress')).toHaveAttribute('aria-valuenow', '0');
});

test('language override changes the voice list, the direction and the spoken language', async ({ page }) => {
  await open(page);
  await upload(page, 'english.txt');
  const langs = await page.locator('#lang option').allTextContents();
  expect(langs.slice(0, 3)).toEqual(['Hebrew (2 voices)', 'English (2 voices)', 'Russian (1 voice)']);
  expect(langs).toContain('French (1 voice)');

  await page.selectOption('#lang', 'he');
  expect(await voiceOptions(page)).toEqual(['Carmit (he-IL)', 'Google עברית (iw-IL)']);
  await expect(page.locator('#text')).toHaveAttribute('dir', 'rtl');
  await page.selectOption('#voice', 'fake:Google עברית');
  await page.selectOption('#rate', '1.5');
  await playBtn(page).click();
  await expect.poll(() => spokenCount(page)).toBeGreaterThanOrEqual(1);
  expect((await spoken(page))[0]).toMatchObject({ lang: 'iw-IL', voice: 'Google עברית', rate: 1.5 });

  // switching language while playing restarts with the new voice
  await page.selectOption('#lang', 'ru');
  await expect.poll(async () => (await spoken(page)).at(-1)?.lang).toBe('ru-RU');
  await expect(page.locator('#text')).toHaveAttribute('dir', 'ltr');
});

test('tapping a sentence or the progress bar jumps there', async ({ page }) => {
  await open(page);
  await upload(page, 'english.txt');
  const chunks = page.locator('.chunk');
  const n = await chunks.count();
  expect(n).toBeGreaterThan(10);

  await chunks.nth(5).click();
  await expect(position(page)).toHaveText(new RegExp(`· 6 / ${n}$`));
  await expect(chunks.nth(5)).toHaveClass(/active/);

  const bar = page.locator('#progress');
  const box = await bar.boundingBox();
  await bar.click({ position: { x: box!.width / 2, y: box!.height / 2 } });
  const idx = Number((await position(page).textContent())!.split('·')[1].split('/')[0]);
  expect(Math.abs(idx - 1 - Math.floor(n / 2))).toBeLessThanOrEqual(1);

  await playBtn(page).click();
  await expect.poll(() => spokenCount(page)).toBeGreaterThanOrEqual(1);
  expect((await spoken(page))[0].text).not.toBe(FIRST_ENGLISH_LINE);
});

test('with a book open, the start panel is gone and the text begins above the player bar', async ({ page }) => {
  await open(page);
  await upload(page, 'hebrew.pdf');
  await expect(page.locator('#title')).toHaveText('מסע אל הנגב');
  await expect(page.locator('#empty')).toBeHidden();
  const firstText = await page.locator('.chunk').first().boundingBox();
  const bar = await page.locator('#player').boundingBox();
  expect(firstText!.y).toBeLessThan(bar!.y); // the book text is visible without scrolling
});

test('interface language: Hebrew flips the page to RTL and translates every visible string; the choice survives a reload', async ({ page }) => {
  await open(page, { uiLang: null }); // no pinned value: the init script would re-pin English on every reload
  await page.selectOption('#ui-lang', 'he');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('dir', 'rtl');
  await expect(html).toHaveAttribute('lang', 'he');
  await expect(page.locator('#upload-label')).toHaveText('העלאת PDF או TXT');
  await expect(page.locator('#empty-title')).toHaveText('הקישו כאן לבחירת ספר');
  await expect(page.locator('#credit')).toContainText('נבנה על ידי Automatixy');
  await expect(page.locator('#credit')).toContainText('אנחנו בונים אוטומציות');
  const wa = page.locator('#wa');
  await expect(wa).toHaveText('כתבו לנו בוואטסאפ');
  const href = (await wa.getAttribute('href'))!;
  expect(href.startsWith('https://wa.me/972545312632?text=')).toBe(true);
  expect(decodeURIComponent(href.split('text=')[1])).toContain('Read Aloud');
  await expect(page.locator('#chips')).toContainText('עברית ✓');
  await expect(page.locator('#status')).toHaveText('מוכן');
  await expect(page.getByRole('button', { name: 'ניגון' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'עצירה' })).toBeVisible();

  // Inside a book: labels, stats, option texts and the status follow too.
  await upload(page, 'hebrew.pdf');
  await expect(page.locator('#title')).toHaveText('מסע אל הנגב');
  await expect(page.locator('#label-lang')).toHaveText('שפת הקריאה');
  await expect(page.locator('#stats')).toContainText('עמודים');
  await expect(page.locator('#stats')).toContainText('קטעים');
  await expect(page.locator('#lang option').first()).toContainText('עברית (');
  await page.getByRole('button', { name: 'ניגון' }).click();
  await expect(page.locator('#status')).toHaveText('מקריא');
  await page.getByRole('button', { name: 'עצירה' }).click();
  await expect(page.locator('#status')).toHaveText('מוכן');

  // Survives a reload (the saved choice beats the book's language).
  await page.reload();
  await expect(html).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#ui-lang')).toHaveValue('he');
  await expect(page.locator('#upload-label')).toHaveText('העלאת PDF או TXT');

  // Russian: lang=ru, left-to-right, Russian strings.
  await page.selectOption('#ui-lang', 'ru');
  await expect(html).toHaveAttribute('lang', 'ru');
  await expect(html).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('#upload-label')).toHaveText('Загрузить PDF/TXT');
  await expect(page.locator('#status')).toHaveText('Готово');
  await expect(page.locator('#stats')).toContainText('сегментов');
  await expect(page.locator('#label-lang')).toHaveText('Язык чтения');
});

test('interface language defaults to the book language, then to the browser language', async ({ page }) => {
  await open(page, { uiLang: null }); // nothing saved; Playwright's browser is en-US
  const html = page.locator('html');
  await expect(html).toHaveAttribute('lang', 'en');
  await expect(page.locator('#upload-label')).toHaveText('Upload PDF or .txt');
  await expect(page.locator('#credit')).toContainText('Made by Automatixy');

  await upload(page, 'hebrew.pdf');
  await expect(page.locator('#title')).toHaveText('מסע אל הנגב');
  await expect(html).toHaveAttribute('lang', 'he'); // follows the book
  await expect(html).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#status')).toHaveText('מוכן');

  await upload(page, 'russian.txt');
  await expect(html).toHaveAttribute('lang', 'ru');
  await expect(page.locator('#status')).toHaveText('Готово');

  // An explicit pick sticks, whatever book comes next.
  await page.selectOption('#ui-lang', 'en');
  await upload(page, 'hebrew.pdf');
  await expect(html).toHaveAttribute('lang', 'en');
  await expect(page.locator('#status')).toHaveText('Ready');
  await page.reload();
  await expect(html).toHaveAttribute('lang', 'en');
  expect(await page.evaluate(() => localStorage.getItem('read-aloud.ui'))).toBe('en');
});

test('the Automatixy credit shows under the start panel, and under the book text once a book is open', async ({ page }) => {
  await open(page);
  const credit = page.locator('#credit');
  await expect(credit).toBeVisible();
  await expect(credit).toContainText('Made by Automatixy');
  const wa = page.getByRole('link', { name: 'Message us on WhatsApp' });
  await expect(wa).toHaveAttribute('href', /^https:\/\/wa\.me\/972545312632\?text=/);
  await expect(wa).toHaveAttribute('target', '_blank');
  await expect(wa).toHaveAttribute('rel', /noopener/);

  // Visible without scrolling: the button ends above the fixed player bar.
  const button = await wa.boundingBox();
  const bar = await page.locator('#player').boundingBox();
  expect(button!.y + button!.height).toBeLessThanOrEqual(bar!.y);

  // With a book open it stays, after the last line of the book, and scrolls clear of the player bar.
  await upload(page, 'english.txt');
  await expect(page.locator('#book')).toBeVisible();
  await expect(credit).toBeVisible();
  await expect(wa).toHaveAttribute('href', /^https:\/\/wa\.me\/972545312632\?text=/);
  const last = await page.locator('.chunk').last().boundingBox();
  const below = await credit.boundingBox();
  expect(below!.y).toBeGreaterThan(last!.y + last!.height);
  await wa.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const atEnd = await wa.boundingBox();
  const barAtEnd = await page.locator('#player').boundingBox();
  expect(atEnd!.y + atEnd!.height).toBeLessThanOrEqual(barAtEnd!.y);
});

test('after a mouse click on the speed button, Space still pauses instead of stepping the speed again', async ({ page }) => {
  await open(page, { msPerWord: 200 });
  await upload(page, 'english.txt');
  await page.locator('.chunk').first().click();
  await page.keyboard.press('Space');
  await expect(status(page)).toHaveText('Playing');
  await page.locator('#speed').click();
  await expect(page.locator('#speed')).toHaveText('1.25×');
  await expect(page.locator('#speed')).not.toBeFocused();
  await page.keyboard.press('Space');
  await expect(status(page)).toHaveText('Paused');
  await expect(page.locator('#speed')).toHaveText('1.25×');
});

test('Tab goes from the book settings to the player, not to the credit at the end of the book', async ({ page }) => {
  await open(page);
  await upload(page, 'english.txt');
  await page.locator('#rate').focus();
  const y = await page.evaluate(() => window.scrollY);
  await page.keyboard.press('Tab');
  await expect(page.locator('#progress')).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(y); // no jump to the last screen of the book
  await page.keyboard.press('Tab');
  await expect(page.locator('#play')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#speed')).toBeFocused(); // Stop is skipped while disabled
  await page.keyboard.press('Tab');
  await expect(page.locator('#wa')).toBeFocused(); // the credit comes last
});

test('the position reads "35% · 12 / 340"; on narrow screens the percentage stacks over the count', async ({ page }) => {
  await open(page);
  await upload(page, 'english.txt');
  await page.locator('.chunk').nth(3).click();
  const n = await page.locator('.chunk').count();
  await expect(position(page)).toHaveText(new RegExp(`^\\d+% · 4 / ${n}$`)); // the text itself never changes
  const pct = await page.locator('#position .pct').boundingBox();
  const seg = await page.locator('#position .seg').boundingBox();
  if (page.viewportSize()!.width <= 600) {
    expect(seg!.y).toBeGreaterThan(pct!.y + pct!.height - 1); // two lines: "35%" over "4 / 22"
  } else {
    expect(Math.abs(seg!.y - pct!.y)).toBeLessThan(4); // one line on a wide screen
  }
});

test('the speed button in the player bar steps through the speeds and stays in sync with the Speed list', async ({ page }) => {
  await open(page, { msPerWord: 40 });
  const speed = page.locator('#speed');
  await expect(speed).toBeDisabled(); // nothing to read yet
  await expect(speed).toHaveText('1×');

  await upload(page, 'english.txt');
  await expect(speed).toBeEnabled();
  await expect(speed).toHaveAccessibleName('Speed 1×');

  // A tap moves to the next speed and is the same setting as the list in the book settings.
  await speed.click();
  await expect(speed).toHaveText('1.25×');
  await expect(page.locator('#rate')).toHaveValue('1.25');
  await playBtn(page).click();
  await expect.poll(() => spokenCount(page)).toBeGreaterThanOrEqual(1);
  expect((await spoken(page))[0].rate).toBe(1.25);

  // While reading, a tap restarts the current sentence at the new speed (the list's own behaviour).
  // The app cancels only on load / restart / pause / stop, so a cancel right before the first 1.5×
  // utterance can only be the restart — and it must pick up the same sentence, not the next one.
  const before = (await ttsLog(page)).length;
  await speed.click();
  await expect(speed).toHaveText('1.5×');
  await expect.poll(async () => (await spoken(page)).at(-1)?.rate).toBe(1.5);
  const log = (await ttsLog(page)).slice(before);
  const i = log.findIndex((e) => e.type === 'speak' && e.rate === 1.5);
  const cut = log[i - 1] as CancelEntry | undefined;
  expect(cut?.type).toBe('cancel');
  expect(cut!.text!.endsWith((log[i] as SpeakEntry).text)).toBe(true);
  await expect(status(page)).toHaveText('Playing');

  // The list drives the button too, and the last speed wraps round to the first.
  await page.selectOption('#rate', '2');
  await expect(speed).toHaveText('2×');
  await speed.click();
  await expect(speed).toHaveText('0.75×');
  await expect(page.locator('#rate')).toHaveValue('0.75');

  // The choice is remembered, and the button is labelled in the interface language.
  await pauseBtn(page).click();
  await page.reload();
  await expect(speed).toHaveText('0.75×');
  await page.selectOption('#ui-lang', 'he');
  await expect(speed).toHaveAccessibleName('מהירות 0.75×');
});

test('voices that load late enable Play once they arrive', async ({ page }) => {
  await open(page, { voicesDelayMs: 600 });
  await upload(page, 'english.txt');
  await expect(page.locator('#notice')).toContainText('Loading voices');
  await expect(playBtn(page)).toBeDisabled();
  await expect(playBtn(page)).toBeEnabled({ timeout: 5_000 });
  await expect(page.locator('#notice')).toBeHidden();
  await expect(page.locator('#chips')).toContainText('Hebrew ✓');
});
