import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { ALL_VOICES, installFakeSpeech, spoken, ttsLog, type FakeSpeechOptions } from './fake-speech';

const fx = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const FIRST_ENGLISH_LINE = "The Lighthouse Keeper's Ledger";

async function open(page: Page, opts?: FakeSpeechOptions) {
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
  expect(atPause[atPause.length - 1].type).toBe('cancel');
  const spokenAtPause = (await spoken(page)).length;
  await page.waitForTimeout(400);
  expect((await ttsLog(page)).length).toBe(atPause.length);

  // Resume: continues the interrupted segment from the last spoken word, not from the top
  await playBtn(page).click();
  await expect(status(page)).toHaveText('Playing');
  await expect.poll(() => spokenCount(page)).toBeGreaterThan(spokenAtPause);
  const all = await spoken(page);
  const interrupted = all[spokenAtPause - 1];
  const resumed = all[spokenAtPause];
  expect(resumed.text.length).toBeGreaterThan(0);
  expect(resumed.text.length).toBeLessThan(interrupted.text.length); // not from the top of the segment
  expect(interrupted.text.endsWith(resumed.text)).toBe(true);

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

test('voices that load late enable Play once they arrive', async ({ page }) => {
  await open(page, { voicesDelayMs: 600 });
  await upload(page, 'english.txt');
  await expect(page.locator('#notice')).toContainText('Loading voices');
  await expect(playBtn(page)).toBeDisabled();
  await expect(playBtn(page)).toBeEnabled({ timeout: 5_000 });
  await expect(page.locator('#notice')).toBeHidden();
  await expect(page.locator('#chips')).toContainText('Hebrew ✓');
});
