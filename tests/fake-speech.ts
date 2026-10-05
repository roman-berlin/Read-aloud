// A fake Web Speech API for tests. Headless Chromium on Linux has no voices at all, so the
// real engine cannot be exercised in CI. This stand-in mimics the parts the app relies on:
// getVoices()/voiceschanged, speak() with start/boundary/end events, and cancel() firing
// an "interrupted" error on the live utterance (Chrome's behaviour). Every call is logged
// on window.__tts so tests can assert what the app asked the engine to do.
import type { Page } from '@playwright/test';

export type FakeVoice = { name: string; lang: string; default?: boolean };

export const ALL_VOICES: FakeVoice[] = [
  { name: 'Carmit', lang: 'he-IL' },
  { name: 'Google עברית', lang: 'iw-IL' }, // the legacy Hebrew code Chrome/Android still report
  { name: 'Samantha', lang: 'en-US', default: true },
  { name: 'Daniel', lang: 'en-GB' },
  { name: 'Milena', lang: 'ru-RU' },
  { name: 'Amélie', lang: 'fr-CA' },
];

export type SpeakEntry = { type: 'speak'; text: string; lang: string; voice: string | null; rate: number };
export type LogEntry = SpeakEntry | { type: 'cancel' } | { type: 'pause' } | { type: 'resume' };

export type FakeSpeechOptions = { voices?: FakeVoice[]; msPerWord?: number; voicesDelayMs?: number };

export async function installFakeSpeech(page: Page, opts: FakeSpeechOptions = {}): Promise<void> {
  await page.addInitScript(fakeSpeechInit, {
    voices: opts.voices ?? ALL_VOICES,
    msPerWord: opts.msPerWord ?? 25,
    voicesDelayMs: opts.voicesDelayMs ?? 0,
  });
}

export const ttsLog = (page: Page): Promise<LogEntry[]> =>
  page.evaluate(() => (window as unknown as { __tts: { log: LogEntry[] } }).__tts.log);

export const spoken = async (page: Page): Promise<SpeakEntry[]> =>
  (await ttsLog(page)).filter((e): e is SpeakEntry => e.type === 'speak');

function fakeSpeechInit(cfg: { voices: FakeVoice[]; msPerWord: number; voicesDelayMs: number }): void {
  const log: unknown[] = [];
  const voices = cfg.voices.map((v) => ({
    name: v.name, lang: v.lang, default: !!v.default, localService: true, voiceURI: 'fake:' + v.name,
  }));
  let ready = cfg.voicesDelayMs === 0;

  class FakeUtterance extends EventTarget {
    text: string; lang = ''; voice: unknown = null; rate = 1; pitch = 1; volume = 1;
    onstart: unknown = null; onend: unknown = null; onerror: unknown = null; onboundary: unknown = null;
    constructor(text?: string) { super(); this.text = text ?? ''; }
  }

  type U = FakeUtterance & Record<string, unknown>;
  const fire = (u: U, type: string, extra: Record<string, unknown> = {}) => {
    const ev = Object.assign(new Event(type), { utterance: u, charIndex: 0, charLength: 0, name: '' }, extra);
    const handler = u['on' + type];
    if (typeof handler === 'function') handler.call(u, ev);
    u.dispatchEvent(ev);
  };

  let live: U | null = null;
  let timers: ReturnType<typeof setTimeout>[] = [];
  const queue: U[] = [];
  const clearTimers = () => { for (const t of timers) clearTimeout(t); timers = []; };

  class FakeSynth extends EventTarget {
    speaking = false; pending = false; paused = false; onvoiceschanged: unknown = null;
    getVoices() { return ready ? voices : []; }
    speak(u: U) {
      const voice = u.voice as { name: string } | null;
      log.push({ type: 'speak', text: u.text, lang: u.lang, voice: voice ? voice.name : null, rate: u.rate });
      queue.push(u);
      if (!live) startNext();
    }
    cancel() {
      log.push({ type: 'cancel' });
      clearTimers();
      const u = live;
      live = null;
      queue.length = 0;
      this.speaking = false;
      this.pending = false;
      if (u) fire(u, 'error', { error: 'interrupted' });
    }
    pause() { log.push({ type: 'pause' }); this.paused = true; }
    resume() { log.push({ type: 'resume' }); this.paused = false; }
  }
  const synth = new FakeSynth();

  function startNext() {
    live = queue.shift() ?? null;
    synth.speaking = !!live;
    synth.pending = queue.length > 0;
    if (!live) return;
    const u = live;
    const words: { index: number; length: number }[] = [];
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(u.text))) words.push({ index: m.index, length: m[0].length });
    timers.push(setTimeout(() => fire(u, 'start'), 5));
    words.forEach((w, i) =>
      timers.push(setTimeout(() => fire(u, 'boundary', { name: 'word', charIndex: w.index, charLength: w.length }), 5 + i * cfg.msPerWord)),
    );
    timers.push(setTimeout(() => {
      live = null;
      synth.speaking = false;
      fire(u, 'end');          // the app usually calls speak() for the next chunk from inside this handler
      if (!live) startNext();  // only pull from the queue if that did not already start something
    }, 5 + words.length * cfg.msPerWord));
  }

  if (!ready) {
    setTimeout(() => {
      ready = true;
      if (typeof synth.onvoiceschanged === 'function') synth.onvoiceschanged(new Event('voiceschanged'));
      synth.dispatchEvent(new Event('voiceschanged'));
    }, cfg.voicesDelayMs);
  }

  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = FakeUtterance;
  (window as unknown as { __tts: unknown }).__tts = { log, isSpeaking: () => !!live };
}
