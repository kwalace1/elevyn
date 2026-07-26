/**
 * Elevyn speech output.
 * Prefers neural British TTS (Edge Sonia) via the brain, played sentence by
 * sentence so long replies start fast and stop the instant Kevin interrupts.
 * Falls back to browser speechSynthesis if the TTS endpoint fails.
 * Exposes a live amplitude level so the orb can react while speaking.
 */

import type { TextToSpeechService } from './synthesis';
import { BrowserTextToSpeech } from './synthesis';
import { API_BASE, authHeaders } from '../api/config';

/** Soften punctuation so Sonia cadence stays natural. */
function humanizeForSpeech(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/;\s*/g, '. ')
    .replace(/:\s+/g, ', ')
    .trim();
}

/** Split a reply into speakable chunks (sentences, merged when tiny). */
function chunkText(text: string): string[] {
  const sentences = humanizeForSpeech(text)
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
      // Prefer a short first chunk so Sonia starts sooner.
      if (current.length >= 28 || /[.!?…]$/.test(current)) {
        chunks.push(current);
        current = '';
      }
      continue;
    }
    if (current.length < 50 || current.length + sentence.length < 120) {
      current += ' ' + sentence;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [humanizeForSpeech(text)];
}

export class ElevynSpeech implements TextToSpeechService {
  readonly supported = true;
  private readonly browserFallback = new BrowserTextToSpeech();
  private currentAudio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  /** Bumps on every speak/stop so a stale chunk loop can never keep playing. */
  private session = 0;

  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelListeners = new Set<(level: number) => void>();
  private raf = 0;
  private freqData: Uint8Array<ArrayBuffer> | null = null;
  /** Synthetic amplitude pulse (no MediaElement graph available). */
  private pulseActive = false;

  /** Subscribe to 0–1 speech amplitude while Elevyn is talking. */
  subscribeLevel(listener: (level: number) => void): () => void {
    this.levelListeners.add(listener);
    return () => this.levelListeners.delete(listener);
  }

  speak(
    text: string,
    opts: { onStart?: () => void; onEnd?: () => void } = {},
  ): void {
    void this.speakAsync(text, opts);
  }

  stop(): void {
    this.session += 1;
    this.stopMeter();
    if (this.currentAudio) {
      // Detach first — pause/src clear can fire onended and double-resume listening.
      this.currentAudio.onended = null;
      this.currentAudio.onerror = null;
      this.currentAudio.onplay = null;
      this.currentAudio.pause();
      this.currentAudio.src = '';
      this.currentAudio = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.browserFallback.stop();
    this.emitLevel(0);
  }

  private emitLevel(level: number): void {
    for (const listener of this.levelListeners) listener(level);
  }

  private stopMeter(): void {
    this.pulseActive = false;
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.analyser = null;
    this.freqData = null;
  }

  private ensureContext(): AudioContext | null {
    try {
      if (!this.audioCtx) {
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!AC) return null;
        this.audioCtx = new AC();
      }
      if (this.audioCtx.state === 'suspended') {
        void this.audioCtx.resume();
      }
      return this.audioCtx;
    } catch {
      return null;
    }
  }

  private startMeter(audio: HTMLAudioElement): void {
    this.stopMeter();
    const ctx = this.ensureContext();
    if (!ctx) return;
    try {
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      analyser.connect(ctx.destination);
      this.analyser = analyser;
      this.freqData = new Uint8Array(
        analyser.frequencyBinCount,
      ) as Uint8Array<ArrayBuffer>;

      const tick = () => {
        if (!this.analyser || !this.freqData || !this.currentAudio) {
          this.emitLevel(0);
          return;
        }
        this.analyser.getByteFrequencyData(this.freqData);
        let sum = 0;
        const len = this.freqData.length;
        for (let i = 0; i < len; i++) sum += this.freqData[i];
        const avg = sum / len / 255;
        // Emphasize mid speech energy so the orb feels alive.
        this.emitLevel(Math.min(1, Math.pow(avg, 0.85) * 1.65));
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    } catch {
      // Browser may refuse a second MediaElementSource — fall back to soft pulse.
      this.fakeMeter();
    }
  }

  /**
   * Soft synthetic pulse when Web Audio metering is unavailable.
   * `free` = keep pulsing until stopMeter (browser TTS has no HTMLAudioElement).
   */
  private fakeMeter(opts: { free?: boolean } = {}): void {
    this.stopMeter();
    this.pulseActive = true;
    const free = Boolean(opts.free);
    const started = performance.now();
    const tick = () => {
      if (!this.pulseActive) {
        this.emitLevel(0);
        return;
      }
      if (!free && (!this.currentAudio || this.currentAudio.paused)) {
        this.emitLevel(0);
        return;
      }
      const t = (performance.now() - started) / 1000;
      const level =
        0.28 +
        0.35 * Math.abs(Math.sin(t * 6.2)) +
        0.12 * Math.abs(Math.sin(t * 13));
      this.emitLevel(Math.min(1, level));
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private async fetchChunk(text: string): Promise<Blob> {
    const attempt = async (): Promise<Blob> => {
      const res = await fetch(`${API_BASE}/api/speak`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`TTS failed: ${res.status}`);
      const contentType = res.headers.get('Content-Type') ?? 'audio/mpeg';
      const buffer = await res.arrayBuffer();
      return new Blob([buffer], { type: contentType });
    };

    try {
      return await attempt();
    } catch {
      // One quick retry before surrendering to robotic browser TTS.
      await new Promise((r) => window.setTimeout(r, 160));
      return attempt();
    }
  }

  private playBlob(blob: Blob, session: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (session !== this.session) {
        resolve();
        return;
      }
      const url = URL.createObjectURL(blob);
      this.objectUrl = url;
      const audio = new Audio(url);
      this.currentAudio = audio;
      this.startMeter(audio);

      // Never leave the UI stuck on one chunk if audio hangs.
      const watchdog = window.setTimeout(() => {
        this.cleanup();
        this.emitLevel(0);
        resolve();
      }, 20_000);

      audio.onended = () => {
        window.clearTimeout(watchdog);
        this.stopMeter();
        this.emitLevel(0);
        this.cleanup();
        resolve();
      };
      audio.onerror = () => {
        window.clearTimeout(watchdog);
        this.stopMeter();
        this.emitLevel(0);
        this.cleanup();
        reject(new Error('audio playback failed'));
      };

      audio.play().catch((err) => {
        window.clearTimeout(watchdog);
        this.stopMeter();
        this.emitLevel(0);
        this.cleanup();
        reject(err instanceof Error ? err : new Error('audio play rejected'));
      });
    });
  }

  private async speakAsync(
    text: string,
    opts: { onStart?: () => void; onEnd?: () => void },
  ): Promise<void> {
    this.stop();
    const session = this.session;

    const trimmed = text.trim();
    if (!trimmed) {
      opts.onEnd?.();
      return;
    }

    const chunks = chunkText(trimmed);
    let started = false;
    const markStart = () => {
      if (!started) {
        started = true;
        opts.onStart?.();
      }
    };

    let index = 0;
    try {
      // Prefetch pipeline: fetch the next chunk while the current one plays.
      let nextFetch: Promise<Blob> = this.fetchChunk(chunks[0]);
      for (index = 0; index < chunks.length; index++) {
        const blob = await nextFetch;
        if (session !== this.session) return;
        if (index + 1 < chunks.length) {
          nextFetch = this.fetchChunk(chunks[index + 1]);
        }
        markStart();
        await this.playBlob(blob, session);
        if (session !== this.session) return;
      }
      opts.onEnd?.();
    } catch {
      if (session !== this.session) return;
      // Neural voice unavailable — finish what's left with the browser voice.
      this.fakeMeter({ free: true });
      this.browserFallback.speak(chunks.slice(index).join(' '), {
        onStart: markStart,
        onEnd: () => {
          this.stopMeter();
          this.emitLevel(0);
          if (session !== this.session) return;
          opts.onEnd?.();
        },
      });
    }
  }

  private cleanup(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.currentAudio = null;
  }
}
