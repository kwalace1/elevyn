/**
 * Text-to-speech abstraction.
 * MVP: browser speechSynthesis with British-first voice selection.
 * Future: swap for Piper / Kokoro / ElevenLabs behind the same interface.
 */

export interface TextToSpeechService {
  readonly supported: boolean;
  speak(text: string, opts?: { onStart?: () => void; onEnd?: () => void }): void;
  stop(): void;
  /** Call from a user gesture (mic tap) so iOS allows later Audio.play / TTS. */
  unlock?(): void;
}

/** Ranked natural feminine voices — Elevyn should never sound male by default. */
const VOICE_PREFERENCE = [
  // macOS / iOS premium feminine.
  /karen \(enhanced\)/i,
  /moira \(enhanced\)/i,
  /fiona \(enhanced\)/i,
  /kate \(enhanced\)/i,
  /serena \(enhanced\)/i,
  /martha \(enhanced\)/i,
  /samantha \(enhanced\)/i,
  /ava \(premium\)/i,
  /zoe \(premium\)/i,
  /allison \(enhanced\)/i,
  /samantha/i,
  /karen/i,
  /moira/i,
  /fiona/i,
  /kate/i,
  /serena/i,
  /martha/i,
  /ava/i,
  /zoe/i,
  /allison/i,
  /susan/i,
  /victoria/i,
  /tessa/i,
  /nicky/i,
  /flo/i,
  // Chrome / Edge cloud feminine.
  /google uk english female/i,
  /google us english female/i,
  /microsoft.*(sonia|libby|jenny|aria|sara|zira)/i,
  /en-gb-.*neural/i,
  /en-us-.*neural/i,
  /british.*female/i,
];

const MALE_VOICE = /\b(daniel|david|tom|fred|alex|jorge|diego|aaron|arthur|ryan|guy|davis|tony|rishi|reed)\b/i;

function scoreVoice(voice: SpeechSynthesisVoice): number {
  const name = voice.name;
  const lang = voice.lang.toLowerCase();

  let score = 0;

  if (lang === 'en-gb' || lang.startsWith('en-gb')) score += 40;
  else if (lang.startsWith('en')) score += 25;
  else return -1;

  // Never pick a clearly male system voice for Elevyn.
  if (MALE_VOICE.test(name)) score -= 400;

  for (let i = 0; i < VOICE_PREFERENCE.length; i += 1) {
    if (VOICE_PREFERENCE[i].test(name)) {
      score += 300 - i * 4;
      break;
    }
  }

  if (/enhanced|premium|neural|natural|siri/i.test(name)) score += 120;
  if (/compact|eloquence|novelty|whisper|zarvox/i.test(name)) score -= 120;
  if (/\bfemale\b/i.test(name)) score += 80;
  if (/\bmale\b/i.test(name)) score -= 200;
  if (voice.default) score += 8;
  if (voice.localService) score += 10;

  return score;
}

function pickBritishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;

  const ranked = [...voices]
    .map((voice) => ({ voice, score: scoreVoice(voice) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.voice ?? null;
}

/**
 * Soften cadence slightly so short Elevyn replies feel less clipped.
 */
function humanizeForSpeech(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/;\s*/g, '. ')
    .replace(/:\s+/g, ', ')
    .replace(/([.!?])\s+/g, '$1 ')
    .replace(/,\s*/g, ', ')
    .trim();
}

export class BrowserTextToSpeech implements TextToSpeechService {
  readonly supported: boolean;
  private cachedVoice: SpeechSynthesisVoice | null = null;
  private voicesReady = false;
  private readonly appleTouch = isAppleTouchDevice();

  constructor() {
    this.supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
    if (this.supported) {
      this.warmVoices();
    }
  }

  /** Call from a tap so iOS allows later speechSynthesis.speak(). */
  unlock(): void {
    if (!this.supported) return;
    try {
      // Do not cancel immediately — iOS needs a real speak() in the gesture.
      const warm = new SpeechSynthesisUtterance(' ');
      warm.volume = 0;
      warm.rate = 2;
      window.speechSynthesis.speak(warm);
    } catch {
      // ignore
    }
  }

  private warmVoices(): void {
    const load = () => {
      const voices = window.speechSynthesis.getVoices();
      if (!voices.length) return;
      this.cachedVoice = pickBritishVoice(voices);
      this.voicesReady = true;
    };

    load();
    if (typeof window.speechSynthesis.addEventListener === 'function') {
      window.speechSynthesis.addEventListener('voiceschanged', load);
    } else {
      // Safari
      window.speechSynthesis.onvoiceschanged = load;
    }
  }

  private resolveVoice(): SpeechSynthesisVoice | null {
    if (this.cachedVoice) return this.cachedVoice;
    const voices = window.speechSynthesis.getVoices();
    this.cachedVoice = pickBritishVoice(voices);
    return this.cachedVoice;
  }

  speak(
    text: string,
    opts: { onStart?: () => void; onEnd?: () => void } = {},
  ): void {
    if (!this.supported || !text.trim()) {
      opts.onEnd?.();
      return;
    }

    const speakNow = () => {
      // iOS can leave synthesis in a paused state where speak() is a no-op.
      try {
        window.speechSynthesis.resume();
      } catch {
        // ignore
      }
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(humanizeForSpeech(text));
      utterance.lang = 'en-GB';
      // Slightly warmer / brighter for a more feminine presence on system TTS.
      utterance.rate = this.appleTouch ? 0.98 : 0.96;
      utterance.pitch = this.appleTouch ? 1.08 : 1.02;
      utterance.volume = 1;

      const voice = this.resolveVoice();
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang || 'en-GB';
      }

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        opts.onEnd?.();
      };

      utterance.onstart = () => opts.onStart?.();
      utterance.onend = finish;
      utterance.onerror = finish;

      window.speechSynthesis.speak(utterance);

      // Chrome quirk only — pause/resume keepAlive cancels speech on iOS Safari.
      if (!this.appleTouch) {
        const keepAlive = window.setInterval(() => {
          if (!window.speechSynthesis.speaking) {
            window.clearInterval(keepAlive);
            return;
          }
          window.speechSynthesis.pause();
          window.speechSynthesis.resume();
        }, 8_000);

        utterance.onend = () => {
          window.clearInterval(keepAlive);
          finish();
        };
        utterance.onerror = () => {
          window.clearInterval(keepAlive);
          finish();
        };
      }

      // iOS sometimes never fires onend — watchdog so callers aren't stuck.
      if (this.appleTouch) {
        const ms = Math.min(20_000, 2000 + text.length * 80);
        window.setTimeout(() => {
          if (!finished) finish();
        }, ms);
      }
    };

    // Allow voice list to populate on first utterance (desktop).
    if (!this.appleTouch && !this.voicesReady && window.speechSynthesis.getVoices().length === 0) {
      window.setTimeout(speakNow, 120);
      return;
    }

    // Apple: speak synchronously — any delay drops the unlock chain for gesture calls.
    if (this.appleTouch) {
      speakNow();
      return;
    }

    window.setTimeout(speakNow, 20);
  }

  stop(): void {
    if (this.supported) window.speechSynthesis.cancel();
  }
}

function isAppleTouchDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}
