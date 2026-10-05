import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { installFakeSpeech } from './fake-speech';

const fx = (name: string) => fileURLToPath(new URL(`../samples/${name}`, import.meta.url));

test('manifest is valid and its icons are served', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', 'manifest.webmanifest');
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);

  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest.name).toBe('Read Aloud');
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('./');
  const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons as Array<{ src: string }>) {
    const r = await request.get('/' + icon.src);
    expect(r.ok(), icon.src).toBe(true);
    expect(r.headers()['content-type'], icon.src).toContain('image/png');
  }
  expect(manifest.file_handlers[0].accept).toMatchObject({ 'application/pdf': ['.pdf'], 'text/plain': ['.txt'] });
});

test('the service worker precaches the app shell and the app works offline', async ({ page, context }) => {
  await installFakeSpeech(page);
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 10_000 }).toBe(true);

  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const cache = await caches.open(keys[0]);
    return (await cache.keys()).map((r) => new URL(r.url).pathname);
  });
  for (const path of ['/index.html', '/app.js', '/styles.css', '/vendor/pdfjs/pdf.min.mjs', '/vendor/pdfjs/pdf.worker.min.mjs', '/icons/icon-512.png']) {
    expect(cached, path).toContain(path);
  }

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.locator('#empty')).toBeVisible();
    await page.setInputFiles('#file', fx('hebrew.pdf')); // pdf.js and its worker come from the cache
    await expect(page.locator('#title')).toHaveText('מסע אל הנגב');
    await expect(page.locator('#error')).toBeHidden();
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.locator('#status')).toHaveText('Playing');
  } finally {
    await context.setOffline(false);
  }
});
