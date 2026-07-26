/**
 * Text-to-speech abstraction.
 * MVP: browser speechSynthesis with British-first voice selection.
 * Future: swap for Piper / Kokoro / ElevenLabs behind the same interface.
 */

export interface TextToSpeechService {
  readonly supported: boolean;
  speak(text: string, opts?: { onStart?: () => void; onEnd?: () => void }): void;
  stop(): void;
}

/** Ranked British / natural voice names available on macOS + Chrome. */
const VOICE_PREFERENCE = [
  // macOS premium / enhanced British
  /daniel \(enhanced\)/i,
  /kate \(enhanced\)/i,
  /serena \(enhanced\)/i,
  /martha \(enhanced\)/i,
  /daniel/i,
  /kate/i,
  /serena/i,
  /martha/i,
  /arthur/i,
  // Chrome Google UK voices (often the best in Chrome)
  /google uk english female/i,
  /google uk english male/i,
  /en-gb-.*neural/i,
  /british/i,
];

function scoreVoice(voice: SpeechSynthesisVoice): number {
  const name = voice.name;
  const lang = voice.lang.toLowerCase();

  let score = 0;

  if (lang === 'en-gb' || lang.startsWith('en-gb')) score += 100;
  else if (lang.startsWith('en')) score += 20;
  else return -1;

  for (let i = 0; i < VOICE_PREFERENCE.length; i += 1) {
    if (VOICE_PREFERENCE[i].test(name)) {
      score += 80 - i;
      break;
    }
  }

  if (/enhanced|premium|neural|natural|siri/i.test(name)) score += 40;
  if (/compact/i.test(name)) score -= 25;
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
    .replace(/([.!?])\s+/g, '$1 ')
    .replace(/,\s*/g, ', ')
    .trim();
}

export class BrowserTextToSpeech implements TextToSpeechService {
  readonly supported: boolean;
  private cachedVoice: SpeechSynthesisVoice | null = null;
  private voicesReady = false;

  constructor() {
    this.supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
    if (this.supported) {
      this.warmVoices();
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

    // Chrome sometimes stalls if cancel() races speak(); clear then speak next tick.
    window.speechSynthesis.cancel();

    const speakNow = () => {
      const utterance = new SpeechSynthesisUtterance(humanizeForSpeech(text));
      utterance.lang = 'en-GB';
      // Slightly slower + lower pitch reads less robotic on system voices.
      utterance.rate = 0.94;
      utterance.pitch = 0.92;
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

      // Safari/Chrome quirk: keep the synth awake for longer utterances.
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
    };

    // Allow voice list to populate on first utterance.
    if (!this.voicesReady && window.speechSynthesis.getVoices().length === 0) {
      window.setTimeout(speakNow, 120);
      return;
    }

    window.setTimeout(speakNow, 20);
  }

  stop(): void {
    if (this.supported) window.speechSynthesis.cancel();
  }
}
