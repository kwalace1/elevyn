/**
 * Elevyn speech output.
 * Prefers neural British TTS (Edge Sonia) via the local brain.
 * Falls back to browser speechSynthesis if the brain TTS endpoint fails.
 */

import type { TextToSpeechService } from './synthesis';
import { BrowserTextToSpeech } from './synthesis';
import { API_BASE, authHeaders } from '../api/config';

export class ElevynSpeech implements TextToSpeechService {
  readonly supported = true;
  private readonly browserFallback = new BrowserTextToSpeech();
  private currentAudio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;

  speak(
    text: string,
    opts: { onStart?: () => void; onEnd?: () => void } = {},
  ): void {
    void this.speakAsync(text, opts);
  }

  stop(): void {
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

  private async speakAsync(
    text: string,
    opts: { onStart?: () => void; onEnd?: () => void },
  ): Promise<void> {
    this.stop();

    const trimmed = text.trim();
    if (!trimmed) {
      opts.onEnd?.();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      this.cleanup();
      opts.onEnd?.();
    };

    // Never leave the UI stuck in "speaking" if audio hangs.
    const watchdog = window.setTimeout(finish, 12_000);

    try {
      const res = await fetch(`${API_BASE}/api/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ text: trimmed }),
      });

      if (!res.ok) {
        throw new Error(`TTS failed: ${res.status}`);
      }

      const contentType = res.headers.get('Content-Type') ?? 'audio/mpeg';
      const buffer = await res.arrayBuffer();
      const blob = new Blob([buffer], { type: contentType });
      const url = URL.createObjectURL(blob);
      this.objectUrl = url;

      const audio = new Audio(url);
      this.currentAudio = audio;

      audio.onplay = () => opts.onStart?.();
      audio.onended = () => {
        window.clearTimeout(watchdog);
        finish();
      };
      audio.onerror = () => {
        window.clearTimeout(watchdog);
        this.cleanup();
        this.browserFallback.speak(trimmed, {
          onStart: opts.onStart,
          onEnd: () => {
            window.clearTimeout(watchdog);
            finish();
          },
        });
      };

      await audio.play();
    } catch {
      window.clearTimeout(watchdog);
      this.browserFallback.speak(trimmed, {
        onStart: opts.onStart,
        onEnd: finish,
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
