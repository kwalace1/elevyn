/**
 * Elevyn Brain — local HTTP control plane.
 *
 * Architecture decision:
 * The projector UI runs in a browser (fullscreen on the wall display).
 * Browsers cannot open apps or run AppleScript. This Node process is the
 * MacBook "brain" — commands, memory, system status, and AI providers live here.
 *
 * Future: this becomes a Tauri/Electron sidecar or launchd daemon. The HTTP
 * contract stays the same so the UI does not care.
 */

import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { ElevynBrain } from './services/ai/brain.js';
import { createDefaultAIRegistry } from './services/ai/registry.js';
import { createCommandRegistry } from './services/commands/index.js';
import { MemoryService } from './services/memory/store.js';
import { getSystemSnapshot } from './services/system/status.js';
import {
  createAiRouter,
  createCommandsRouter,
  createMemoryRouter,
  createVoiceRouter,
} from './routes/index.js';
import { isHosted, isMac } from './services/platform.js';
import { prewarmSpeechCache } from './services/voice/tts.js';

// Hosts (Railway/Render/Fly) inject PORT. ELEVYN_PORT stays for local runs.
const PORT = Number(process.env.PORT ?? process.env.ELEVYN_PORT ?? 8787);

/** Comma-separated origins, e.g. "https://elevyn.vercel.app". Empty = allow all (local dev). */
const ALLOWED_ORIGINS = (process.env.ELEVYN_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/** When set, every /api call must present this token. Required for public brains. */
const API_TOKEN = process.env.ELEVYN_API_TOKEN ?? '';

async function main() {
  const ai = createDefaultAIRegistry();
  const commands = createCommandRegistry();
  const memory = new MemoryService();
  const brain = new ElevynBrain(ai, commands, memory);

  const app = express();
  app.use(
    cors({
      origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Elevyn-Token'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  // Shared-secret gate. A brain reachable from the internet must not be open.
  if (API_TOKEN) {
    app.use('/api', (req, res, next) => {
      if (req.method === 'OPTIONS') return next();
      if (req.path === '/health') return next();

      const header = req.get('authorization') ?? '';
      const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
      const token = bearer || req.get('x-elevyn-token') || '';

      if (token !== API_TOKEN) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      next();
    });
  }

  app.get('/api/health', async (_req, res) => {
    const provider = await ai.resolve();
    res.json({
      ok: true,
      name: 'Elevyn',
      version: '0.1.0',
      aiProvider: provider?.id ?? null,
      preferredProvider: process.env.ELEVYN_AI_PROVIDER ?? null,
      hosted: isHosted,
      capabilities: {
        systemControl: isMac,
        neuralVoice: true,
        memory: true,
      },
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/system', async (_req, res) => {
    res.json(await getSystemSnapshot());
  });

  app.get('/api/dashboard', async (_req, res) => {
    const snapshot = await getSystemSnapshot();
    const activeProvider = await ai.resolve();
    res.json({
      system: snapshot,
      weather: {
        location: 'Your Room',
        condition: 'Clear',
        temperatureF: 72,
        highF: 78,
        lowF: 64,
      },
      calendar: [
        {
          id: '1',
          title: 'Elevyn MVP demo',
          start: new Date().toISOString(),
          end: new Date(Date.now() + 90 * 60_000).toISOString(),
          location: 'Desk',
        },
        {
          id: '2',
          title: 'Deep work — architecture',
          start: new Date(Date.now() + 3 * 3600_000).toISOString(),
          end: new Date(Date.now() + 5 * 3600_000).toISOString(),
        },
      ],
      notifications: [
        {
          id: 'n1',
          title: 'Elevyn online',
          body: 'Local brain is listening.',
          time: 'Just now',
          unread: true,
        },
        {
          id: 'n2',
          title: 'AI Provider',
          body: activeProvider
            ? `${activeProvider.displayName} ready.`
            : 'Set OPENROUTER_API_KEY or start Ollama for full AI.',
          time: 'System',
          unread: true,
        },
      ],
    });
  });

  app.use('/api/ai', createAiRouter(brain, ai, commands));
  app.use('/api/commands', createCommandsRouter(commands));
  app.use('/api/memory', createMemoryRouter(memory));
  app.use('/api/voice', createVoiceRouter());

  // Hosted brains must bind 0.0.0.0; local stays on loopback.
  const host = isHosted ? '0.0.0.0' : '127.0.0.1';
  app.listen(PORT, host, () => {
    console.log(`\n  ✦ Elevyn brain listening on http://${host}:${PORT}`);
    console.log(
      `    mode: ${isHosted ? 'hosted' : 'local'} · system control: ${isMac ? 'on' : 'off'} · auth: ${API_TOKEN ? 'token' : 'open'}\n`,
    );
    // Warm common voice phrases in the background so wake/acks feel instant.
    void prewarmSpeechCache();
  });
}

main().catch((err) => {
  console.error('Elevyn brain failed to start:', err);
  process.exit(1);
});
