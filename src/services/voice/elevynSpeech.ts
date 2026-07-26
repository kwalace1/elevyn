/**
 * Elevyn speech output.
 * Prefers neural British TTS (Edge Sonia) via the brain, played sentence by
 * sentence so long replies start fast and stop the instant Kevin interrupts.
 * Falls back to browser speechSynthesis if the TTS endpoint fails.
 */

import type { TextToSpeechService } from './synthesis';
import { BrowserTextToSpeech } from './synthesis';
import { API_BASE, authHeaders } from '../api/config';

/** Split a reply into speakable chunks (sentences, merged when tiny). */
function chunkText(text: string): string[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
    } else if (current.length < 60 || current.length + sentence.length < 140) {
      current += ' ' + sentence;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text];
}

export class ElevynSpeech implements TextToSpeechService {
  readonly supported = true;
  private readonly browserFallback = new BrowserTextToSpeech();
  private currentAudio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  /** Bumps on every speak/stop so a stale chunk loop can never keep playing. */
  private session = 0;

  speak(
    text: string,
    opts: { onStart?: () => void; onEnd?: () => void } = {},
  ): void {
    void this.speakAsync(text, opts);
  }

  stop(): void {
    this.session += 1;
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
  }

  private async fetchChunk(text: string): Promise<Blob> {
    const res = await fetch(`${API_BASE}/api/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`TTS failed: ${res.status}`);
    const contentType = res.headers.get('Content-Type') ?? 'audio/mpeg';
    const buffer = await res.arrayBuffer();
    return new Blob([buffer], { type: contentType });
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

      // Never leave the UI stuck on one chunk if audio hangs.
      const watchdog = window.setTimeout(() => {
        this.cleanup();
        resolve();
      }, 20_000);

      audio.onended = () => {
        window.clearTimeout(watchdog);
        this.cleanup();
        resolve();
      };
      audio.onerror = () => {
        window.clearTimeout(watchdog);
        this.cleanup();
        reject(new Error('audio playback failed'));
      };

      audio.play().catch((err) => {
        window.clearTimeout(watchdog);
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
      this.browserFallback.speak(chunks.slice(index).join(' '), {
        onStart: markStart,
        onEnd: () => {
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
