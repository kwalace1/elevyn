/**
 * Elevyn speech output.
 *
 * Desktop: neural British TTS (Edge Sonia) via /api/speak, chunked for speed.
 * iPad / iPhone (Safari + Chrome/WebKit): system speechSynthesis is primary —
 * HTML5/WebAudio MP3 often "plays" successfully but is silent (mute switch /
 * media session). Neural Sonia stays available via speakInGesture() for an
 * explicit Tap to hear control.
 */

import type { TextToSpeechService } from './synthesis';
import { BrowserTextToSpeech } from './synthesis';
import { API_BASE, authHeaders } from '../api/config';

function humanizeForSpeech(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/;\s*/g, '. ')
    .replace(/:\s+/g, ', ')
    .trim();
}

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

export function isAppleTouchDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod|CriOS|FxiOS/.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

const SILENT_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';

export class ElevynSpeech implements TextToSpeechService {
  readonly supported = true;
  private readonly browserFallback = new BrowserTextToSpeech();
  private readonly appleTouch = isAppleTouchDevice();
  private player: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private session = 0;
  private bufferSource: AudioBufferSourceNode | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelListeners = new Set<(level: number) => void>();
  private raf = 0;
  private freqData: Uint8Array<ArrayBuffer> | null = null;
  private pulseActive = false;

  get isAppleTouch(): boolean {
    return this.appleTouch;
  }

  subscribeLevel(listener: (level: number) => void): () => void {
    this.levelListeners.add(listener);
    return () => this.levelListeners.delete(listener);
  }

  /**
   * Must run inside a tap (pointerdown on mic). Unlocks AudioContext,
   * persistent Audio element, speechSynthesis, and briefly opens the mic
   * so iOS enters an active media session.
   */
  unlock(): void {
    this.browserFallback.unlock();

    const ctx = this.ensureContext();
    if (ctx) {
      void ctx.resume();
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.0001;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.05);
      } catch {
        // ignore
      }
    }

    const player = this.ensurePlayer();
    try {
      player.volume = 0.01;
      player.src = SILENT_WAV;
      void player.play().then(() => {
        player.pause();
        player.currentTime = 0;
      });
    } catch {
      // ignore
    }

    // Opening the mic during the gesture often unlocks playback on iOS.
    if (this.appleTouch && navigator.mediaDevices?.getUserMedia) {
      void navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          for (const track of stream.getTracks()) track.stop();
        })
        .catch(() => {
          // Permission may already be tied to speech recognition.
        });
    }
  }

  speak(
    text: string,
    opts: { onStart?: () => void; onEnd?: () => void } = {},
  ): void {
    void this.speakAsync(text, opts);
  }

  /**
   * Play a reply inside a fresh user gesture (Tap to hear).
   * Uses system voice first on Apple; tries neural on desktop.
   */
  speakInGesture(
    text: string,
    opts: { onStart?: () => void; onEnd?: () => void } = {},
  ): void {
    this.unlock();
    if (this.appleTouch) {
      this.stop();
      const session = this.session;
      this.fakeMeter({ free: true });
      this.browserFallback.speak(text, {
        onStart: opts.onStart,
        onEnd: () => {
          this.stopMeter();
          this.emitLevel(0);
          if (session === this.session) opts.onEnd?.();
        },
      });
      return;
    }
    this.speak(text, opts);
  }

  stop(): void {
    this.session += 1;
    this.stopMeter();
    if (this.bufferSource) {
      try {
        this.bufferSource.onended = null;
        this.bufferSource.stop();
      } catch {
        // already stopped
      }
      this.bufferSource.disconnect();
      this.bufferSource = null;
    }
    if (this.player) {
      this.player.onended = null;
      this.player.onerror = null;
      this.player.onplay = null;
      this.player.pause();
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

  private ensurePlayer(): HTMLAudioElement {
    if (this.player) return this.player;
    const audio = document.createElement('audio');
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('webkit-playsinline', 'true');
    (audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
    audio.preload = 'auto';
    audio.style.display = 'none';
    document.body.appendChild(audio);
    this.player = audio;
    return audio;
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
    if (this.appleTouch) {
      this.fakeMeter();
      return;
    }
    const ctx = this.ensureContext();
    if (!ctx) {
      this.fakeMeter();
      return;
    }
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
        if (!this.analyser || !this.freqData || !this.player || this.player.paused) {
          this.emitLevel(0);
          return;
        }
        this.analyser.getByteFrequencyData(this.freqData);
        let sum = 0;
        const len = this.freqData.length;
        for (let i = 0; i < len; i++) sum += this.freqData[i];
        const avg = sum / len / 255;
        this.emitLevel(Math.min(1, Math.pow(avg, 0.85) * 1.65));
        this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    } catch {
      this.fakeMeter();
    }
  }

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
      const elementPlaying = this.player && !this.player.paused;
      const bufferPlaying = Boolean(this.bufferSource);
      if (!free && !elementPlaying && !bufferPlaying) {
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
      await new Promise((r) => window.setTimeout(r, 160));
      return attempt();
    }
  }

  private async playBlobViaContext(
    blob: Blob,
    session: number,
  ): Promise<void> {
    const ctx = this.ensureContext();
    if (!ctx) throw new Error('no audio context');
    if (ctx.state === 'suspended') await ctx.resume();
    if (session !== this.session) return;

    const raw = await blob.arrayBuffer();
    if (session !== this.session) return;
    const copy = raw.slice(0);
    const audioBuffer = await ctx.decodeAudioData(copy);
    if (session !== this.session) return;

    await new Promise<void>((resolve, reject) => {
      if (session !== this.session) {
        resolve();
        return;
      }
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      this.bufferSource = source;
      this.fakeMeter();

      const watchdog = window.setTimeout(() => {
        try {
          source.stop();
        } catch {
          // ignore
        }
        this.bufferSource = null;
        this.stopMeter();
        this.emitLevel(0);
        resolve();
      }, 20_000);

      source.onended = () => {
        window.clearTimeout(watchdog);
        this.bufferSource = null;
        this.stopMeter();
        this.emitLevel(0);
        resolve();
      };

      try {
        source.start(0);
      } catch (err) {
        window.clearTimeout(watchdog);
        this.bufferSource = null;
        this.stopMeter();
        this.emitLevel(0);
        reject(err instanceof Error ? err : new Error('buffer start failed'));
      }
    });
  }

  private playBlobViaElement(blob: Blob, session: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (session !== this.session) {
        resolve();
        return;
      }
      if (this.objectUrl) {
        URL.revokeObjectURL(this.objectUrl);
        this.objectUrl = null;
      }
      const url = URL.createObjectURL(blob);
      this.objectUrl = url;
      const audio = this.ensurePlayer();
      audio.onended = null;
      audio.onerror = null;
      audio.src = url;
      audio.volume = 1;
      this.startMeter(audio);

      const watchdog = window.setTimeout(() => {
        this.stopMeter();
        this.emitLevel(0);
        resolve();
      }, 20_000);

      audio.onended = () => {
        window.clearTimeout(watchdog);
        this.stopMeter();
        this.emitLevel(0);
        if (this.objectUrl === url) {
          URL.revokeObjectURL(url);
          this.objectUrl = null;
        }
        resolve();
      };
      audio.onerror = () => {
        window.clearTimeout(watchdog);
        this.stopMeter();
        this.emitLevel(0);
        reject(new Error('audio playback failed'));
      };

      audio.load();
      void audio.play().catch((err) => {
        window.clearTimeout(watchdog);
        this.stopMeter();
        this.emitLevel(0);
        reject(err instanceof Error ? err : new Error('audio play rejected'));
      });
    });
  }

  private async playBlob(blob: Blob, session: number): Promise<void> {
    if (this.appleTouch) {
      try {
        await this.playBlobViaContext(blob, session);
        return;
      } catch {
        // fall through
      }
    }
    await this.playBlobViaElement(blob, session);
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

    const speakBrowser = (remainder: string) => {
      this.fakeMeter({ free: true });
      this.browserFallback.speak(remainder, {
        onStart: markStart,
        onEnd: () => {
          this.stopMeter();
          this.emitLevel(0);
          if (session !== this.session) return;
          opts.onEnd?.();
        },
      });
    };

    // iPad / iPhone: system voice only for auto-replies. Neural MP3 is often
    // silently swallowed by the hardware mute switch / WebKit media rules.
    if (this.appleTouch) {
      speakBrowser(chunks.join(' '));
      return;
    }

    let index = 0;
    try {
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
      speakBrowser(chunks.slice(index).join(' '));
    }
  }
}
