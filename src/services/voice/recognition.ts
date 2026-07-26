/**
 * Speech recognition abstraction.
 * MVP: Web Speech API with continuous wake-word support.
 * Future: Whisper.cpp / Porcupine implementing the same interface.
 */

export type RecognitionMode = 'command' | 'wake';

export interface SpeechRecognitionHandlers {
  onResult: (transcript: string, isFinal: boolean) => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
}

export interface SpeechRecognitionService {
  readonly supported: boolean;
  start(handlers: SpeechRecognitionHandlers, mode?: RecognitionMode): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives?: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    length: number;
    [index: number]: { transcript: string; confidence?: number };
  }>;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class BrowserSpeechRecognition implements SpeechRecognitionService {
  private recognition: SpeechRecognitionLike | null = null;
  private intentionalStop = false;
  /** Bumps on every start/abort so stale Chrome onend/onerror can't kill a new session. */
  private sessionId = 0;
  readonly supported: boolean;

  constructor() {
    this.supported = Boolean(getSpeechRecognitionCtor());
  }

  start(
    handlers: SpeechRecognitionHandlers,
    mode: RecognitionMode = 'command',
  ): void {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      throw new Error('Speech recognition is not supported in this browser.');
    }

    this.abort();
    const session = ++this.sessionId;
    this.intentionalStop = false;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    // A few alternatives help when Elevyn is misheard.
    recognition.maxAlternatives = 3;

    recognition.onresult = (event) => {
      if (session !== this.sessionId) return;
      // Full session transcript (not just the latest chunk) so
      // "hey" + "elevyn open cursor" still matches as one address.
      let transcript = '';
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        // Prefer the alternative that looks most like our wake name.
        let best = result[0]?.transcript ?? '';
        for (let a = 0; a < result.length; a += 1) {
          const alt = result[a]?.transcript ?? '';
          if (
            /\b(elevyn|eleven|evelyn|elevan|elevin|elevation|ellen|11)\b/i.test(
              alt,
            )
          ) {
            best = alt;
            break;
          }
        }
        transcript += `${best} `;
      }
      const cleaned = transcript.replace(/\s+/g, ' ').trim();
      if (!cleaned) return;
      // Chrome often never flips older segments; treat the latest as authority.
      const last = event.results[event.results.length - 1];
      handlers.onResult(cleaned, Boolean(last?.isFinal));
    };

    recognition.onerror = (event) => {
      if (session !== this.sessionId) return;
      // `no-speech` / `aborted` are normal in continuous listening.
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      handlers.onError?.(event.error);
    };

    recognition.onend = () => {
      // Stale session — a newer start()/abort() already took over.
      if (session !== this.sessionId) return;
      this.recognition = null;
      if (!this.intentionalStop) {
        handlers.onEnd?.();
      }
    };

    this.recognition = recognition;

    try {
      recognition.start();
    } catch {
      // Already started — ignore.
    }

    void mode;
  }

  stop(): void {
    this.intentionalStop = true;
    this.sessionId += 1;
    try {
      this.recognition?.stop();
    } catch {
      // ignore
    }
  }

  abort(): void {
    this.intentionalStop = true;
    this.sessionId += 1;
    const active = this.recognition;
    this.recognition = null;
    if (!active) return;
    // Detach handlers before abort so Chrome can't fire into a dead session.
    active.onresult = null;
    active.onerror = null;
    active.onend = null;
    try {
      active.abort();
    } catch {
      // ignore
    }
  }
}
