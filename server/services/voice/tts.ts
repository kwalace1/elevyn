import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { isMac } from '../platform.js';

const execFileAsync = promisify(execFile);

/**
 * Elevyn TTS — prefer Microsoft Edge neural voices via edge-tts (free).
 *
 * Co-founder decision: macOS `say` on this Intel Air takes ~15s for a short
 * line and sounds robotic. Edge neural British voices (Sonia / Ryan) are
 * far more human and synthesize in ~1–2s. Fall back to `say` only if edge-tts
 * is unavailable.
 */

const EDGE_VOICE = process.env.ELEVYN_TTS_VOICE ?? 'en-GB-SoniaNeural';
/** Match Vercel api/speak.py so local and hosted Sonia sound the same. */
const EDGE_RATE = process.env.ELEVYN_TTS_RATE ?? '-4%';
const EDGE_PITCH = process.env.ELEVYN_TTS_PITCH ?? '-2Hz';
const SAY_FALLBACK = process.env.ELEVYN_SAY_VOICE ?? 'Daniel';
const PYTHON = process.env.ELEVYN_PYTHON ?? 'python3';

const PREWARM_PHRASES = [
  'Yes?',
  'Go ahead.',
  "I'm here.",
  'Listening.',
  'Certainly.',
  'Of course.',
  'Noted.',
  'On it.',
  "I'll track that.",
  'List created.',
  'Screen cleared.',
  'Back to your dashboard.',
  'Work mode. Ready when you are.',
  'Listening in.',
  'Capture stopped.',
  'Added.',
  'Removed.',
  'Time.',
  "Certainly. I'll remember that.",
  'Understood.',
  'Right away.',
  'Pinned.',
  'Session cleared. Fresh slate.',
  'Pardon me — I did not catch that.',
];

type AudioPayload = {
  audio: Buffer;
  voice: string;
  contentType: 'audio/mpeg' | 'audio/wav';
  cached: boolean;
};

const cache = new Map<string, AudioPayload>();

function cacheKey(text: string, voice: string): string {
  return createHash('sha1').update(`${voice}\n${text}`).digest('hex');
}

function normalizeSpoken(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 400);
}

async function synthesizeEdge(text: string, voice: string): Promise<Buffer> {
  const dir = path.join(os.tmpdir(), 'elevyn-tts');
  await mkdir(dir, { recursive: true });
  const out = path.join(dir, `${randomUUID()}.mp3`);

  // edge-tts is a free Microsoft neural TTS client (no API key).
  // rate/pitch match Vercel so Sonia sounds identical everywhere.
  const script = `
import asyncio, edge_tts, sys
async def main():
    communicate = edge_tts.Communicate(
        sys.argv[1],
        sys.argv[2],
        rate=sys.argv[4],
        pitch=sys.argv[5],
    )
    await communicate.save(sys.argv[3])
asyncio.run(main())
`;

  try {
    await execFileAsync(
      PYTHON,
      ['-c', script, text, voice, out, EDGE_RATE, EDGE_PITCH],
      {
        timeout: 20_000,
        env: {
          ...process.env,
          PATH: `${process.env.HOME}/Library/Python/3.9/bin:${process.env.PATH ?? ''}`,
        },
      },
    );
    return await readFile(out);
  } finally {
    await rm(out, { force: true }).catch(() => undefined);
  }
}

async function synthesizeSay(text: string, voice: string): Promise<Buffer> {
  const dir = path.join(os.tmpdir(), 'elevyn-tts');
  await mkdir(dir, { recursive: true });
  const id = randomUUID();
  const aiffPath = path.join(dir, `${id}.aiff`);
  const wavPath = path.join(dir, `${id}.wav`);

  try {
    await execFileAsync('say', ['-v', voice, '-r', '175', '-o', aiffPath, text], {
      timeout: 30_000,
    });
    await execFileAsync(
      'afconvert',
      ['-f', 'WAVE', '-d', 'LEI16@22050', aiffPath, wavPath],
      { timeout: 15_000 },
    );
    return await readFile(wavPath);
  } finally {
    await Promise.allSettled([rm(aiffPath, { force: true }), rm(wavPath, { force: true })]);
  }
}

export async function synthesizeSpeech(text: string): Promise<AudioPayload> {
  const spoken = normalizeSpoken(text);
  if (!spoken) throw new Error('Nothing to speak.');

  const key = cacheKey(spoken, `${EDGE_VOICE}|${EDGE_RATE}|${EDGE_PITCH}`);
  const hit = cache.get(key);
  if (hit) return { ...hit, cached: true };

  try {
    const audio = await synthesizeEdge(spoken, EDGE_VOICE);
    const payload: AudioPayload = {
      audio,
      voice: EDGE_VOICE,
      contentType: 'audio/mpeg',
      cached: false,
    };
    cache.set(key, payload);
    return payload;
  } catch (err) {
    // `say`/`afconvert` are macOS-only. On a hosted brain, surface the failure
    // so the browser falls back to its own speech synthesis.
    if (!isMac) {
      throw new Error(
        `Neural TTS unavailable on this host (${(err as Error)?.message ?? 'edge-tts failed'})`,
      );
    }
    console.warn('[tts] edge-tts failed, falling back to say:', err);
    const audio = await synthesizeSay(spoken, SAY_FALLBACK);
    return {
      audio,
      voice: SAY_FALLBACK,
      contentType: 'audio/wav',
      cached: false,
    };
  }
}

export async function listSpeechVoices(): Promise<{
  voice: string;
  engine: 'edge-tts' | 'say';
  candidates: string[];
  cacheSize: number;
}> {
  return {
    voice: EDGE_VOICE,
    engine: 'edge-tts',
    candidates: [
      'en-GB-SoniaNeural',
      'en-GB-RyanNeural',
      'en-GB-LibbyNeural',
      'en-GB-MaisieNeural',
    ],
    cacheSize: cache.size,
  };
}

/**
 * Warm common phrases so wake/acks feel instant.
 * Set ELEVYN_TTS_PREWARM=0 on low-memory machines — it spawns Python per phrase.
 */
export async function prewarmSpeechCache(): Promise<void> {
  if (
    process.env.ELEVYN_TTS_PREWARM === '0' ||
    process.env.VERCEL === '1' ||
    process.env.ELEVYN_HOSTED === '1'
  ) {
    console.log('[tts] prewarm disabled');
    return;
  }

  for (const phrase of PREWARM_PHRASES) {
    try {
      await synthesizeSpeech(phrase);
    } catch (err) {
      console.warn('[tts] prewarm failed for:', phrase, err);
    }
  }
  console.log(`[tts] cache warmed (${cache.size} phrases · ${EDGE_VOICE})`);
}

/** Optional debug write — unused in hot path. */
void writeFile;
