import { Router } from 'express';
import type { ElevynBrain } from '../services/ai/brain.js';
import type { AIProviderRegistry } from '../services/ai/registry.js';
import type { CommandRegistry } from '../services/commands/registry.js';
import type { MemoryService } from '../services/memory/store.js';
import { listSpeechVoices, synthesizeSpeech } from '../services/voice/tts.js';
import {
  getValidAccessToken,
  isMicrosoftConfigured,
} from '../services/ms/oauth.js';
import {
  buildMicrosoftBrief,
  fetchGraphCalendar,
  fetchRecentMail,
  fetchRecentTeamsChats,
  mailFromSender,
  speakCalendarBrief,
  speakMailBrief,
  speakTeamsBrief,
} from '../services/ms/graph.js';
import {
  tryMicrosoftWriteIntent,
  utteranceNeedsMsToken,
} from '../services/ms/actions.js';
import {
  buildWorkDayBrief,
  parseAgendaFromContext,
  parseOpenTasksFromContext,
  wantsWorkDayBrief,
} from '../services/ms/workBrief.js';
import {
  formatAgendaWhen,
  parseSpokenAgenda,
} from '../../src/utils/agendaParse.js';

function wantsMicrosoftContext(utterance: string): boolean {
  const lower = utterance.toLowerCase();
  return (
    wantsWorkDayBrief(utterance) ||
    /\b(catch me up|brief me|where were we|status (update|report)|recap)\b/i.test(
      lower,
    ) ||
    /\b(email|inbox|outlook|mail)\b/i.test(lower) ||
    /\b(teams|microsoft)\b/i.test(lower) ||
    /\b(calendar|meetings?|agenda|schedule)\b/i.test(lower) ||
    utteranceNeedsMsToken(utterance)
  );
}

function wantsCalendarBrief(utterance: string): boolean {
  const lower = utterance.toLowerCase();
  return (
    /\b(what'?s|what is|what do i have|what meetings|check|show|see|look(?:\s+at)?)\b.+\b(calendar|agenda|schedule|meetings?)\b/i.test(
      lower,
    ) ||
    /\b(calendar|agenda|schedule)\b.+\b(coming up|come up|upcoming|next|today|tomorrow)\b/i.test(
      lower,
    ) ||
    /\b(meetings?|what'?s)\b.+\b(coming up|come up|upcoming)\b/i.test(lower) ||
    /\b(what'?s next|am i free|am i busy)\b/i.test(lower)
  );
}

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
    let context = req.body?.context
      ? String(req.body.context).slice(0, 8000)
      : undefined;

    const lower = utterance.toLowerCase();

    // Connect Microsoft — client opens the OAuth URL.
    if (
      /\b(connect|link|sign ?in|log ?in|authenticate)\b.+\b(microsoft|outlook|teams|office|365|graph)\b/i.test(
        lower,
      ) ||
      /\b(microsoft|outlook|teams)\b.+\b(connect|link|sign ?in|log ?in)\b/i.test(
        lower,
      )
    ) {
      if (!isMicrosoftConfigured()) {
        res.json({
          intent: {
            type: 'chat',
            reply:
              'Microsoft 365 is not configured on this brain yet. Add MS_CLIENT_ID, MS_CLIENT_SECRET, MS_TENANT_ID, MS_REDIRECT_URI, and ELEVYN_TOKEN_SECRET.',
          },
          execution: null,
        });
        return;
      }
      res.json({
        intent: {
          type: 'chat',
          reply:
            'Opening Microsoft sign-in. Approve the new permissions on the consent screen so Elevyn can use To Do, OneDrive, contacts, presence, and Teams channels.',
          args: { openUrl: '/api/mslogin' },
        },
        execution: null,
      });
      return;
    }

    // Disconnect.
    if (
      /\b(disconnect|unlink|sign ?out|log ?out)\b.+\b(microsoft|outlook|teams)\b/i.test(
        lower,
      )
    ) {
      const { clearSession } = await import('../services/ms/oauth.js');
      clearSession(req, res);
      res.json({
        intent: {
          type: 'chat',
          reply: 'Disconnected from Microsoft 365.',
        },
        execution: null,
      });
      return;
    }

    const needsMs =
      wantsMicrosoftContext(utterance) ||
      wantsWorkDayBrief(utterance) ||
      wantsCalendarBrief(utterance) ||
      /\b(check|any|read)\b.+\b(mail|email|inbox|outlook)\b/i.test(lower) ||
      /\b(teams|chat)\b/i.test(lower) ||
      utteranceNeedsMsToken(utterance) ||
      Boolean(parseSpokenAgenda(utterance));

    const msBundle = needsMs ? await getValidAccessToken(req, res) : null;

    // Work / morning brief — deterministic spoken summary + Day board on glass.
    if (wantsWorkDayBrief(utterance)) {
      if (
        !msBundle &&
        isMicrosoftConfigured() &&
        /\b(mail|outlook|teams|microsoft|inbox)\b/i.test(lower)
      ) {
        res.json({
          intent: {
            type: 'chat',
            reply:
              'Microsoft 365 is not connected yet. Say “connect Microsoft” and I will open sign-in.',
            args: { openUrl: '/api/mslogin' },
          },
          execution: null,
        });
        return;
      }

      try {
        const openTasks = parseOpenTasksFromContext(context);
        const agendaFallback = parseAgendaFromContext(context);
        const [calendar, mail, chats] = msBundle
          ? await Promise.all([
              fetchGraphCalendar(msBundle.accessToken).catch(() => []),
              fetchRecentMail(msBundle.accessToken, 5).catch(() => []),
              fetchRecentTeamsChats(msBundle.accessToken, 5).catch(() => []),
            ])
          : [[], [], []];

        const { spoken, board } = buildWorkDayBrief({
          calendar,
          mail,
          chats,
          openTasks,
          agendaFallback,
        });

        res.json({
          intent: {
            type: 'surface',
            surface: { op: 'createNote', title: 'Day board', text: board },
            reply: spoken,
          },
          execution: null,
        });
        return;
      } catch {
        res.json({
          intent: {
            type: 'chat',
            reply:
              "I couldn't assemble your day brief just now. Want to try again in a moment?",
          },
          execution: null,
        });
        return;
      }
    }

    // Live Outlook calendar — never let the model invent fake calendar tools.
    if (msBundle && wantsCalendarBrief(utterance)) {
      try {
        const events = await fetchGraphCalendar(msBundle.accessToken);
        res.json({
          intent: { type: 'chat', reply: speakCalendarBrief(events) },
          execution: null,
        });
        return;
      } catch {
        res.json({
          intent: {
            type: 'chat',
            reply:
              "I couldn't reach your calendar just now. Want to try again in a moment?",
          },
          execution: null,
        });
        return;
      }
    }

    // Write actions: email / Teams message / Outlook calendar (+ confirm/cancel).
    if (msBundle) {
      const parsedSchedule = parseSpokenAgenda(utterance);
      try {
        const writeIntent = await tryMicrosoftWriteIntent(
          utterance,
          msBundle.accessToken,
          msBundle.account,
          parsedSchedule
            ? {
                title: parsedSchedule.title,
                startIso: parsedSchedule.startIso,
                endIso: parsedSchedule.endIso,
              }
            : null,
        );
        if (writeIntent) {
          res.json({ intent: writeIntent, execution: null });
          return;
        }
      } catch {
        res.json({
          intent: {
            type: 'chat',
            reply:
              "I couldn't finish that Microsoft action just now. Want to try again?",
          },
          execution: null,
        });
        return;
      }
    } else if (
      isMicrosoftConfigured() &&
      utteranceNeedsMsToken(utterance) &&
      !/^(yes|yeah|yep|no|cancel)/i.test(lower)
    ) {
      res.json({
        intent: {
          type: 'chat',
          reply:
            'Microsoft 365 is not connected yet. Say “connect Microsoft” so I can send mail, Teams messages, and create calendar events.',
          args: { openUrl: '/api/mslogin' },
        },
        execution: null,
      });
      return;
    }

    // Direct mail brief (skip model when we can answer from Graph).
    if (
      msBundle &&
      /\b(check|any|read|what'?s in)\b.+\b(mail|email|inbox|outlook)\b/i.test(
        lower,
      )
    ) {
      try {
        const mail = await fetchRecentMail(msBundle.accessToken);
        const fromMatch = lower.match(
          /\b(?:from|by)\s+([a-z0-9.'\-\s]{2,40})$/i,
        ) || lower.match(/\bmail from\s+([a-z0-9.'\-\s]{2,40})/i);
        const spoken = fromMatch
          ? mailFromSender(mail, fromMatch[1].trim())
          : speakMailBrief(mail);
        res.json({
          intent: { type: 'chat', reply: spoken },
          execution: null,
        });
        return;
      } catch {
        res.json({
          intent: {
            type: 'chat',
            reply:
              "I couldn't reach Outlook just now. Want to try again in a moment?",
          },
          execution: null,
        });
        return;
      }
    }

    // Teams updates (including “catch me up on Teams”).
    if (
      msBundle &&
      (/\bcatch me up on teams\b/i.test(lower) ||
        /\b(any (teams )?messages|teams updates?|what'?s on teams)\b/i.test(
          lower,
        ))
    ) {
      try {
        const chats = await fetchRecentTeamsChats(msBundle.accessToken);
        res.json({
          intent: { type: 'chat', reply: speakTeamsBrief(chats) },
          execution: null,
        });
        return;
      } catch {
        res.json({
          intent: {
            type: 'chat',
            reply:
              "I couldn't reach Teams just now. Want to try again in a moment?",
          },
          execution: null,
        });
        return;
      }
    }

    // Enrich catch-me-up / microsoft mentions with a live Graph brief.
    if (msBundle && wantsMicrosoftContext(utterance)) {
      try {
        const brief = await buildMicrosoftBrief(msBundle.accessToken);
        context = context
          ? `${context}\n\n${brief}`.slice(0, 10_000)
          : brief;
      } catch {
        // Session + agenda brief still works without Graph.
      }
    } else if (
      !msBundle &&
      isMicrosoftConfigured() &&
      wantsMicrosoftContext(utterance) &&
      /\b(email|inbox|outlook|teams|microsoft)\b/i.test(lower)
    ) {
      res.json({
        intent: {
          type: 'chat',
          reply:
            'Microsoft 365 is not connected yet. Say “connect Microsoft” and I will open sign-in.',
          args: { openUrl: '/api/mslogin' },
        },
        execution: null,
      });
      return;
    }

    const intent = await brain.interpret(utterance, context);

    // If the brain scheduled locally and MS is connected, also push to Outlook
    // when the write handler didn't already (e.g. model path).
    if (
      msBundle &&
      intent.args?.scheduleUtterance &&
      typeof intent.args.scheduleUtterance === 'string'
    ) {
      const parsed = parseSpokenAgenda(String(intent.args.scheduleUtterance));
      if (parsed) {
        const mirrored = await tryMicrosoftWriteIntent(
          `schedule ${parsed.title} on outlook at ${formatAgendaWhen(parsed.startIso)}`,
          msBundle.accessToken,
          msBundle.account,
          {
            title: parsed.title,
            startIso: parsed.startIso,
            endIso: parsed.endIso,
          },
        );
        if (mirrored?.reply) {
          intent.reply = mirrored.reply;
        }
      }
    }

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
