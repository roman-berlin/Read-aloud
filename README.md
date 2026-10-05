# Read Aloud

A tiny web app that reads a book aloud like an audiobook. Built for Anatoly: one
person, one book, no login, no account, no server. Everything runs inside the
browser — the file never leaves the computer.

- Upload **one** PDF or plain-text (`.txt`) file. The text is extracted in the
  browser (pdf.js for PDF).
- A Spotify-style bar with **Play / Pause**, **Stop** and a progress line. Tap any
  sentence, or the progress line, to jump there.
- The book is read with the browser's own speech engine (Web Speech API), in short
  segments, so long books do not stall and Pause / Resume always work.
- The language is detected from the text (Hebrew, English, Russian; anything else
  can be picked by hand). The voice list only shows voices for that language.
- If the computer has no voice for the book's language (for example no Hebrew
  voice), the app says so and explains how to install one instead of reading in
  the wrong language.
- Only one book exists at a time. Uploading a new file deletes the old book and
  its progress. The current book and position are remembered across reloads.
- It is a **PWA**: install it like an app (desktop, Android, iPhone) and it keeps
  working with no internet, book included.

## Run it

Needs [Bun](https://bun.sh) (already used by this repo). From this folder:

```bash
bun run start
```

Then open <http://localhost:8090>. That's it. Any static file server works too,
for example `python3 -m http.server 8090` from this folder — the only requirement
is `http://`, because browsers refuse to load pdf.js's worker from `file://`.

## Install it as an app (PWA)

After the first visit the service worker has everything cached, so the app opens
and reads with no internet connection.

- **Desktop Chrome / Edge:** click the install icon at the right end of the
  address bar (or ⋮ → *Install Read Aloud*).
- **Android (Chrome):** ⋮ → *Add to Home screen* / *Install app*.
- **iPhone / iPad (Safari):** Share → *Add to Home Screen*.
- Once installed, PDF and `.txt` files offer *Open with → Read Aloud* on Chrome
  desktop and Android.

**Vercel:** import this repository in the Vercel dashboard (Add New → Project),
set *Root Directory* to `audiobook-reader`, *Framework Preset* to *Other*, leave
build and output empty, and pick the branch to deploy. `vercel.json` here only
sets cache headers (the service worker is never cached, pdf.js is cached for a
year). There is nothing to build.

Browsers only install PWAs from `https://` or from `localhost`. `bun run start`
on the same computer is enough for a desktop install. To put it on a phone, host
this folder on any static host (Vercel, GitHub Pages, Netlify — there is nothing
to build) and open that address once on the phone.

Updating: the service worker fetches the page files network-first, so an edit is
live on the next reload; pdf.js under `vendor/` is served cache-first because it
only changes together with its folder. To force every client to refetch all
files, bump `CACHE` in `sw.js`.

## Files

| File | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The whole app. No build step, no framework. |
| `manifest.webmanifest`, `sw.js`, `icons/` | What makes it installable and offline-capable. `node icons/make-icons.mjs` renders the PNGs from `icons/icon.svg` with the test browser. |
| `vendor/pdfjs/` | pdf.js (`pdfjs-dist` 6.4.299, legacy build, Apache-2.0) — the only dependency. See `vendor/pdfjs/VERSION`. |
| `serve.ts` | A 20-line static file server for `bun run start`. Not part of the app. |
| `tests/` | Playwright checks (see below) and the fixture books. |

## Browser notes

- Works in Chrome, Edge, Safari and Firefox, on desktop and phone. Chrome and Edge
  have the best voices; Safari on iPhone works too (the first Play must be a tap).
- **Hebrew voice.** The app checks for one at start (the chips under the header
  show which of Hebrew / English / Russian have a voice). To add one:
  macOS → *System Settings → Accessibility → Spoken Content → System Voice →
  Manage Voices…* (Carmit); Windows → *Settings → Time & Language → Speech → Add
  voices*; iPhone → *Settings → Accessibility → Spoken Content → Voices*;
  Android → *Settings → Google Text-to-speech → Install voice data*. Reload the
  page afterwards.
- Scanned PDFs (pictures of pages, no text layer) are refused with a message: they
  need OCR first, and this app deliberately has none.
- `.txt` files must be UTF-8 (UTF-16 with a byte-order mark, as Windows Notepad
  saves "Unicode", is accepted too). Any other encoding is refused with a message
  rather than read as gibberish.
- The book is kept in the browser's local storage so it survives a reload. Very
  large books (over roughly 4–5 MB of text) stay loaded only until the page is
  closed; the app tells you when that is the case.

## Tests

`tests/pwa.spec.ts` checks the manifest, the icons, the service-worker precache,
and that the app still opens and reads a PDF with the network switched off.

The checks in `tests/reader.spec.ts` cover the acceptance list: a Hebrew PDF, an
English `.txt` and a Russian `.txt`; Play, Pause, Resume, Stop; replacing the
book; the "no Hebrew voice" message; the error messages for an unsupported file,
an empty file, a scanned PDF and a non-UTF-8 file; chunking; language override;
seeking; and reload persistence. They run on a desktop and a phone viewport.

```bash
bun install                         # once — installs Playwright (dev only, not part of the app)
bunx playwright install chromium    # once — the browser the tests drive
bun run test
```

Headless browsers have no speech voices, so the tests install a small **fake
speech engine** (`tests/fake-speech.ts`) that logs what the app asks it to say
and fires the same events a real engine does. That proves the app's logic end to
end; what it cannot prove is how a real voice sounds. To hear it, open the app in
a browser and load `tests/fixtures/hebrew.pdf`, `english.txt` and `russian.txt`.

The PDF fixtures are generated from `tests/fixtures/src/*.html` by
`tests/fixtures/src/make-pdfs.sh` (headless Chromium). All fixture texts are
original and written for these tests.

## Deliberately not here

No backend, no login, no OCR, no paid API, no framework, no build step, no
analytics. The app is a single folder you can copy anywhere and open from any
static server.
