// Renders the PNG icons from icons/icon.svg with the Playwright Chromium already used by the
// tests. Dev tooling only — not part of the app.  Usage: bun install && node icons/make-icons.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
// Inline the SVG: a page set with setContent() is about:blank, which may not load file:// URLs,
// so an <img src="file://..."> renders as a broken-image placeholder.
const svg = readFileSync(new URL('./icon.svg', import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const page = (size, scale) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>
     html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden;background:#121419}
     body{display:grid;place-items:center}svg{display:block;width:${size * scale}px;height:${size * scale}px}
   </style></head><body>${svg}</body></html>`;

const jobs = [
  ['icon-512.png', 512, 1],
  ['icon-192.png', 192, 1],
  ['apple-touch-icon.png', 180, 1],
  ['maskable-512.png', 512, 0.8], // maskable: full-bleed background, glyph inside the 80% safe zone
];

const browser = await chromium.launch();
const tab = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, size, scale] of jobs) {
  await tab.setViewportSize({ width: size, height: size });
  await tab.setContent(page(size, scale), { waitUntil: 'load' });
  await tab.screenshot({ path: `${here}${name}`, omitBackground: scale === 1 });
  console.log(`wrote icons/${name}`);
}
await browser.close();
