// Renders the PNG icons from icons/icon.svg with the Playwright Chromium already used by the
// tests. Dev tooling only — not part of the app.  Usage: bun install && node icons/make-icons.mjs
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const svg = fileURLToPath(new URL('./icon.svg', import.meta.url));
const page = (size, scale) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>
     html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden;background:#121419}
     body{display:grid;place-items:center}img{display:block;width:${size * scale}px;height:${size * scale}px}
   </style></head><body><img src="file://${svg}"></body></html>`;

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
