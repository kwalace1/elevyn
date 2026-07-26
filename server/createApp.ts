/**
 * Shared Elevyn Express app.
 *
 * Used by:
 *   - Local Mac brain (`server/index.ts` → listen)
 *   - Vercel serverless (`api/[[...path]].ts` → export handler)
 */

import cors from 'cors';
import express, { type Express } from 'express';
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
import { fetchCalendarEvents } from './services/calendar/ics.js';

const ALLOWED_ORIGINS = (process.env.ELEVYN_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const API_TOKEN = process.env.ELEVYN_API_TOKEN ?? '';

let cachedApp: Express | null = null;

export function createApp(): Express {
  if (cachedApp) return cachedApp;

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

  // Optional shared-secret gate. Leave unset on a same-origin Vercel deploy —
  // the UI and API share one domain, so browser secrets would leak anyway.
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
        neuralVoice: !isHosted,
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
          title: isHosted ? 'Elevyn cloud brain' : 'Elevyn online',
          body: isHosted
            ? 'Hosted on Vercel — Mac system control is offline.'
            : 'Local brain is listening.',
          time: 'Just now',
          unread: true,
        },
        {
          id: 'n2',
          title: 'AI Provider',
          body: activeProvider
            ? `${activeProvider.displayName} ready.`
            : 'Set OPENROUTER_API_KEY for full AI.',
          time: 'System',
          unread: true,
        },
      ],
    });
  });

  app.get('/api/calendar', async (_req, res) => {
    const icsUrl = process.env.ELEVYN_CALENDAR_ICS?.trim();
    if (!icsUrl) {
      res.json({ configured: false, events: [] });
      return;
    }
    try {
      const events = await fetchCalendarEvents(icsUrl);
      res.json({ configured: true, events });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Calendar unavailable';
      res.status(502).json({ configured: true, error: message, events: [] });
    }
  });

  app.use('/api/ai', createAiRouter(brain, ai, commands));
  app.use('/api/commands', createCommandsRouter(commands));
  app.use('/api/memory', createMemoryRouter(memory));
  app.use('/api/voice', createVoiceRouter());

  // Flat aliases — Vercel's catch-all serves /api/:segment but 404s on
  // /api/:a/:b (e.g. /api/ai/interpret). Same-origin UI uses these.
  app.use('/api', createAiRouter(brain, ai, commands));
  app.use('/api', createVoiceRouter());

  cachedApp = app;
  return app;
}
