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

/** Ranked natural voice names available across macOS, Chrome, and Edge. */
const VOICE_PREFERENCE = [
  // macOS premium / enhanced voices. Quality wins over accent.
  /daniel \(enhanced\)/i,
  /kate \(enhanced\)/i,
  /serena \(enhanced\)/i,
  /martha \(enhanced\)/i,
  /ava \(premium\)/i,
  /samantha \(enhanced\)/i,
  /zoe \(premium\)/i,
  /allison \(enhanced\)/i,
  /tom \(enhanced\)/i,
  /ava/i,
  /samantha/i,
  /daniel/i,
  /kate/i,
  /serena/i,
  /martha/i,
  /arthur/i,
  // Chrome / Edge cloud and natural voices.
  /google uk english female/i,
  /google uk english male/i,
  /google us english/i,
  /microsoft.*natural/i,
  /microsoft.*online/i,
  /en-gb-.*neural/i,
  /en-us-.*neural/i,
  /british/i,
];

function scoreVoice(voice: SpeechSynthesisVoice): number {
  const name = voice.name;
  const lang = voice.lang.toLowerCase();

  let score = 0;

  if (lang === 'en-gb' || lang.startsWith('en-gb')) score += 40;
  else if (lang.startsWith('en')) score += 25;
  else return -1;

  for (let i = 0; i < VOICE_PREFERENCE.length; i += 1) {
    if (VOICE_PREFERENCE[i].test(name)) {
      score += 300 - i * 4;
      break;
    }
  }

  if (/enhanced|premium|neural|natural|siri/i.test(name)) score += 120;
  if (/compact|eloquence|novelty|whisper|zarvox/i.test(name)) score -= 120;
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

    // Chrome sometimes stalls if cancel() races speak(); clear then speak next tick.
    window.speechSynthesis.cancel();

    const speakNow = () => {
      const utterance = new SpeechSynthesisUtterance(humanizeForSpeech(text));
      utterance.lang = 'en-GB';
      // Natural cadence: close to the voice's recorded baseline. Large pitch
      // shifts make system voices noticeably synthetic.
      utterance.rate = 0.96;
      utterance.pitch = 1;
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
    };

    // Allow voice list to populate on first utterance.
    if (!this.voicesReady && window.speechSynthesis.getVoices().length === 0) {
      window.setTimeout(speakNow, 120);
      return;
    }

    // On Apple, speak sooner — delay can drop the gesture/unlock chain.
    window.setTimeout(speakNow, this.appleTouch ? 0 : 20);
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
