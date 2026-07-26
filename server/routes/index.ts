import { Router } from 'express';
import type { ElevynBrain } from '../services/ai/brain.js';
import type { AIProviderRegistry } from '../services/ai/registry.js';
import type { CommandRegistry } from '../services/commands/registry.js';
import type { MemoryService } from '../services/memory/store.js';
import { listSpeechVoices, synthesizeSpeech } from '../services/voice/tts.js';

export function createAiRouter(
  brain: ElevynBrain,
  ai: AIProviderRegistry,
  commands: CommandRegistry,
): Router {
  const router = Router();

  router.get('/providers', async (_req, res) => {
    const providers = await Promise.all(
      ai.list().map(async (p) => ({
        id: p.id,
        displayName: p.displayName,
        available: await p.isAvailable(),
      })),
    );
    res.json({ providers });
  });

  router.post('/interpret', async (req, res) => {
    const utterance = String(req.body?.utterance ?? '').trim();
    if (!utterance) {
      res.status(400).json({ error: 'utterance required' });
      return;
    }
    const context = req.body?.context
      ? String(req.body.context).slice(0, 8000)
      : undefined;

    const intent = await brain.interpret(utterance, context);
    let execution = null;

    if (intent.type === 'command' && intent.commandId) {
      execution = await commands.execute(intent.commandId, intent.args ?? {});
      if (!execution.success) {
        intent.reply = execution.message;
      }
    }

    res.json({ intent, execution });
  });

  return router;
}

export function createCommandsRouter(commands: CommandRegistry): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json({ commands: commands.list() });
  });

  router.post('/execute', async (req, res) => {
    const commandId = String(req.body?.commandId ?? '');
    const args = (req.body?.args ?? {}) as Record<string, unknown>;
    if (!commandId) {
      res.status(400).json({ error: 'commandId required' });
      return;
    }
    const result = await commands.execute(commandId, args);
    res.json(result);
  });

  return router;
}

export function createMemoryRouter(memory: MemoryService): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const category = req.query.category
      ? String(req.query.category)
      : undefined;
    const q = req.query.q ? String(req.query.q) : undefined;

    if (q) {
      res.json({ entries: await memory.search(q) });
      return;
    }

    res.json({
      entries: await memory.list(
        category as
          | 'personal'
          | 'projects'
          | 'devices'
          | 'preferences'
          | 'notes'
          | 'conversations'
          | 'tasks'
          | undefined,
      ),
    });
  });

  router.post('/', async (req, res) => {
    const { category, title, content, tags } = req.body ?? {};
    if (!category || !title || !content) {
      res.status(400).json({ error: 'category, title, content required' });
      return;
    }
    const entry = await memory.create({
      category,
      title,
      content,
      tags: Array.isArray(tags) ? tags : [],
    });
    res.status(201).json(entry);
  });

  return router;
}

export function createVoiceRouter(): Router {
  const router = Router();

  router.get('/voices', async (_req, res) => {
    res.json(await listSpeechVoices());
  });

  router.post('/speak', async (req, res) => {
    const text = String(req.body?.text ?? '').trim();
    if (!text) {
      res.status(400).json({ error: 'text required' });
      return;
    }

    try {
      const { audio, voice, contentType, cached } = await synthesizeSpeech(text);
      res.setHeader('Content-Type', contentType);
      res.setHeader('X-Elevyn-Voice', voice);
      res.setHeader('X-Elevyn-Cached', cached ? '1' : '0');
      res.setHeader('Cache-Control', 'no-store');
      res.send(audio);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Speech synthesis failed';
      res.status(500).json({ error: message });
    }
  });

  return router;
}
