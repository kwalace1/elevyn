/**
 * Elevyn brain orchestration.
 *
 * Separates "understanding intent" from "executing commands" and from "chatting".
 * When Ollama is offline we still run a deterministic local interpreter so the
 * MVP demo never dies — open Cursor should work even without a model loaded.
 */

import type {
  AgentPlan,
  AgentStep,
  CommandDefinition,
  InterpretedIntent,
} from '../../../src/types/index.js';
import type { AIProviderRegistry } from './registry.js';
import type { CommandRegistry } from '../commands/registry.js';
import type { MemoryService } from '../memory/store.js';
import { matchAgentPlan } from '../../../src/services/agent/plans.js';
import {
  looksTechnical,
  sanitizeSpokenReply,
  UNSURE_REPLY,
} from '../../../src/utils/spokenReply.js';

/** Kevin's timezone — Vercel functions run in UTC, so never trust server local time. */
const TIME_ZONE = process.env.ELEVYN_TZ ?? 'America/New_York';

function easternHour(): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: TIME_ZONE,
    }).format(new Date()),
  );
}

const SYSTEM_PROMPT = `You are Elevyn, Kevin's personal AI aide — soft-spoken, precise, faintly like Jarvis: capable, calm, lightly wry when it fits, never stiff or chatty.
Speak short British English suitable for text-to-speech (1-2 sentences max).
Confirmations may vary: "Certainly.", "Of course.", "Right away.", "Noted.", "Understood.", "Done.", "On it.", "Consider it handled."
You may use "sir" sparingly for flavour — not every reply, never stacked.
Never sound like a chatbot: no "Happy to help!", "Great question!", "Absolutely!", "Let me know if you need anything else."
Prefer warm brevity over corporate cheer. Avoid slang, markdown, bullet lists, and emoji.
Use SESSION FACTS, DURABLE MEMORY, TODAY'S AGENDA, and MICROSOFT 365 blocks when present (Outlook mail, Teams chats, calendar). Prefer on-screen panels when he refers to "that", "this", or the meeting.
Answer "what's next" / "am I free" / calendar questions from the agenda or Microsoft calendar context. Treat durable memory as long-term knowledge about Kevin's work and people.
When MICROSOFT 365 context is present, weave unread mail and Teams into catch-me-up briefly — do not invent messages.
Kevin may ask you to email, Teams-message, or schedule on Outlook — the server handles those write actions; prefer confirming facts you know.

CRITICAL — spoken replies must stay human:
- Never invent tool calls, function calls, XML, APIs, command names, permission names, or endpoint paths.
- Never mention commandId, Graph, OAuth, JSON, schemas, or internal systems.
- Only use a commandId from the Commands list below. If none fit, answer as chat.
- If you are unsure what Kevin wants, reply as chat asking a short clarifying question — conversational, not technical.

Respond with ONLY one JSON object on a single line, matching one of these shapes:

Control the computer (commandId MUST be from the Commands list):
{"type":"command","commandId":"<id>","args":{...},"reply":"<spoken confirmation>"}

Change the on-screen surface or create content on screen:
{"type":"surface","surface":{"op":"<op>","title":"<optional>","text":"<optional>","items":["..."]},"reply":"<spoken confirmation>"}
Valid surface ops:
- "focus": ambient orb presence ("go home", "leave work mode", "standby", "just the orb")
- "work": minimal work canvas ("let's work", "work mode", "enter work mode")
- "dashboard": systems / operator view ("show systems", "show dashboard")
- "clear": remove panels ("clear the screen", "clean up")
- "createNote": note in "text", optional "title". Use for pinning useful answers.
- "createTask": task/reminder in "text"
- "createList": list in "items", optional "title"
- "addItem": add one entry to current list/tasks in "text"
- "removeLast": undo last panel
- "startCapture" / "stopCapture" / "appendCapture": meeting capture
- "timer" / "cancelTimer": countdown; "timer" needs "seconds"

Just chatting or answering a question:
{"type":"chat","reply":"<spoken answer>"}

Multi-step plan when Kevin chains actions ("and then"), wraps a meeting and drafts a follow-up, or asks to plan his afternoon:
{"type":"agent","reply":"<short spoken ack>","plan":{"title":"<name>","steps":[{"label":"<label>","utterance":"<optional>","surface":{"op":"<optional>"},"remember":"<optional>","copy":false}]}}
Max 4 steps. Use utterance for wrap/summarize/draft/pin. Use surface for work/clear/timer/stopCapture.

Prefer surface or agent actions when he clearly wants something done. Keep replies brief and useful.`

export class ElevynBrain {
  constructor(
    private readonly ai: AIProviderRegistry,
    private readonly commands: CommandRegistry,
    private readonly memory?: MemoryService,
  ) {}

  async interpret(
    utterance: string,
    context?: string,
  ): Promise<InterpretedIntent> {
    const trimmed = utterance.trim();
    if (!trimmed) {
      return { type: 'chat', reply: 'Pardon me — I did not catch that.' };
    }

    const local = this.matchLocalIntent(trimmed);
    if (local) return local;

    // Multi-step agency before single async intents so "wrap and draft" chains.
    const agent = matchAgentPlan(trimmed);
    if (agent) {
      return {
        type: 'agent',
        reply: agent.reply,
        plan: agent.plan,
      };
    }

    // Memory + summarize need async work / context, so they run after the
    // fast synchronous matchers but before the model.
    const async = await this.matchAsyncIntent(trimmed, context);
    if (async) return async;

    const provider = await this.ai.resolve();
    if (!provider) {
      return {
        type: 'chat',
        reply:
          "I'm with you, but I can't think clearly just yet. Give me a moment and try again.",
      };
    }

    const catalog = this.commands
      .list()
      .map(
        (c: CommandDefinition) =>
          `- ${c.id}: ${c.description}. Examples: ${c.examples.join('; ')}`,
      )
      .join('\n');

    try {
      const contextBlock = (context ?? '').trim();
      const userContent = contextBlock
        ? `${contextBlock}\n\n=== REQUEST ===\n${trimmed}`
        : trimmed;

      const completion = await this.ai.complete({
        messages: [
          { role: 'system', content: `${SYSTEM_PROMPT}\n\nCommands:\n${catalog}` },
          { role: 'user', content: userContent },
        ],
        temperature: 0.2,
        // Enough headroom that a JSON chat reply is never cut mid-string —
        // truncated JSON used to leak raw {"type":"chat"... to the user.
        maxTokens: 320,
      });

      return this.parseModelIntent(completion.content, trimmed);
    } catch {
      return {
        type: 'chat',
        reply: 'Pardon me — I had trouble with that. Could you try again?',
      };
    }
  }

  /** Deterministic parser for tonight's demo reliability. */
  private matchLocalIntent(utterance: string): InterpretedIntent | null {
    const lower = utterance.toLowerCase();

    // Surface intents first so phrases like "start capture" / "start a timer"
    // are not mistaken for "start <app>".
    const surface = this.matchSurfaceIntent(utterance, lower);
    if (surface) return surface;

    const openMatch =
      lower.match(/^(?:please\s+)?(?:open|launch|start|run)\s+(.+)$/i) ??
      lower.match(/^(?:can you |could you )?(?:open|launch|start)\s+(.+)$/i);

    if (openMatch) {
      const raw = openMatch[1].replace(/[.!?]+$/, '').trim();
      const app = this.normalizeAppName(raw);
      if (!app) {
        return {
          type: 'chat',
          reply: `I am not sure which app you mean by ${raw}.`,
        };
      }
      return {
        type: 'command',
        commandId: 'open.app',
        args: { app },
        reply: `Opening ${app}.`,
      };
    }

    const closeMatch = lower.match(
      /^(?:please\s+)?(?:can you |could you )?(?:close|quit|exit)\s+(.+)$/i,
    );
    if (closeMatch) {
      const raw = closeMatch[1].replace(/[.!?]+$/, '').trim();
      // "close the screen / notes / everything" is a surface clear, not an app.
      if (!/^(the\s+)?(screen|board|canvas|notes?|everything|panels?)$/i.test(raw)) {
        const app = this.normalizeAppName(raw);
        if (app) {
          return {
            type: 'command',
            commandId: 'close.app',
            args: { app },
            reply: `Closing ${app}.`,
          };
        }
      }
    }

    if (/\b(what time|current time|what's the time)\b/i.test(lower)) {
      const time = new Date().toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: TIME_ZONE,
      });
      return { type: 'chat', reply: `It is ${time}.` };
    }

    if (/\b(what('?s| is) (the |today'?s )?date|what day is (it|today))\b/i.test(lower)) {
      const date = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        timeZone: TIME_ZONE,
      });
      return { type: 'chat', reply: `It is ${date}.` };
    }

    if (/\b(who are you|what are you|introduce yourself)\b/i.test(lower)) {
      return {
        type: 'chat',
        reply: 'I am Elevyn — your workspace operating system. I am here when you need me.',
      };
    }

    // Capabilities — answer locally so this never depends on the model.
    if (
      /\b(what can you do|what do you do|what are you capable of|list (?:your )?(?:commands|abilities|capabilities)|what commands|how can you help)\b/i.test(
        lower,
      )
    ) {
      return {
        type: 'chat',
        reply:
          'I am your sidekick. Ask me anything, remember facts across days, take notes and tasks, run timers, and capture meetings. Say “catch me up” or “morning brief” for the day board. Chain requests with "and then", or say "wrap up the meeting and draft a follow-up", or "plan my afternoon".',
      };
    }

    if (/^(hi|hello|hey|good morning|good afternoon|good evening)\b/i.test(lower)) {
      const hour = easternHour();
      const greeting =
        hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
      return { type: 'chat', reply: `${greeting}. How may I help?` };
    }

    if (/\b(lock (the )?(mac|computer|screen)|lock screen)\b/i.test(lower)) {
      return {
        type: 'command',
        commandId: 'system.lock',
        args: {},
        reply: 'Locking your Mac.',
      };
    }

    if (/\b(sleep (the )?(mac|computer)|put (it|the mac|computer) to sleep)\b/i.test(lower)) {
      return {
        type: 'command',
        commandId: 'system.sleep',
        args: {},
        reply: 'Putting the Mac to sleep.',
      };
    }

    return null;
  }

  /**
   * Surface intents drive the Jarvis view on the client (create notes, focus,
   * clear, etc). Matched deterministically first so the demo is reliable.
   */
  private matchSurfaceIntent(
    original: string,
    lower: string,
  ): InterpretedIntent | null {
    // Enter minimal work canvas.
    if (
      /\b(let'?s (get to )?work|enter work( mode)?|work mode|deep work|let'?s get started|clear the desk)\b/i.test(
        lower,
      ) &&
      !/\b(leave|exit|end|close|quit|stop)\b.{0,12}\bwork\b/i.test(lower)
    ) {
      return {
        type: 'surface',
        surface: { op: 'work' },
        reply: 'Work mode.',
      };
    }

    // Leave work / return to ambient orb.
    if (
      /\b((leave|exit|end|close|quit)\s+work( mode)?|stop working|leave work mode|exit work mode|go home|home screen|standby|just the orb|back to (the )?orb|show home|back to presence)\b/i.test(
        lower,
      )
    ) {
      return {
        type: 'surface',
        surface: { op: 'focus' },
        reply: 'Standing by.',
      };
    }

    // Operator / systems dashboard.
    if (
      /\b(show (the )?(dashboard|systems)|open (the )?dashboard|back to dashboard|systems view)\b/i.test(
        lower,
      )
    ) {
      return {
        type: 'surface',
        surface: { op: 'dashboard' },
        reply: 'Systems view.',
      };
    }

    // Clear panels.
    if (
      /\b(clear (the )?(screen|board|canvas|notes|everything)|clean (it |this )?up|reset (the )?(screen|board)|wipe (the )?(screen|board))\b/i.test(
        lower,
      )
    ) {
      return {
        type: 'surface',
        surface: { op: 'clear' },
        reply: 'Screen cleared.',
      };
    }

    // Make a note.
    const noteMatch = original.match(
      /^(?:can you |could you |please )?(?:make|take|create|write|jot|add|new)\s+(?:a |an )?note(?:\s+(?:that|about|saying|to))?\s*[:,-]?\s*(.*)$/i,
    );
    if (noteMatch) {
      const text = noteMatch[1].replace(/[.!?]+$/, '').trim();
      return {
        type: 'surface',
        surface: { op: 'createNote', text: text || undefined },
        reply: text ? 'Noted.' : 'What should the note say?',
        awaiting: text ? undefined : 'note',
      };
    }

    // Add a task / reminder.
    const taskMatch = original.match(
      /^(?:can you |could you |please )?(?:make|create|add|new)\s+(?:a |an )?task(?:\s+(?:to|that))?\s*[:,-]?\s*(.*)$/i,
    );
    const remindMatch = original.match(
      /^(?:can you |could you |please )?remind me(?:\s+to)?\s*[:,-]?\s*(.*)$/i,
    );
    const taskText = (taskMatch?.[1] ?? remindMatch?.[1] ?? '')
      .replace(/[.!?]+$/, '')
      .trim();
    if (taskMatch || remindMatch) {
      return {
        type: 'surface',
        surface: { op: 'createTask', text: taskText || undefined },
        reply: taskText ? "I'll track that." : 'What is the task?',
        awaiting: taskText ? undefined : 'task',
      };
    }

    // Meeting capture: start / stop.
    if (
      /\b(start|begin|open)\s+(?:a\s+)?(capture|meeting|recording|minutes)\b/i.test(
        lower,
      ) ||
      /\bcapture (this )?meeting\b/i.test(lower) ||
      /\btake minutes\b/i.test(lower)
    ) {
      return {
        type: 'surface',
        surface: { op: 'startCapture' },
        reply: 'Listening in.',
      };
    }
    if (
      /\b(stop|end|finish|pause)\s+(?:the\s+)?(capture|meeting|recording|minutes)\b/i.test(
        lower,
      )
    ) {
      return {
        type: 'surface',
        surface: { op: 'stopCapture' },
        reply: 'Capture stopped.',
      };
    }

    // Append a line to the meeting capture.
    const captureLine = original.match(
      /^(?:note that|capture that|capture this|for the record|minute that|log that|jot that)\s+(.+)$/i,
    );
    if (captureLine) {
      const text = captureLine[1].replace(/[.!?]+$/, '').trim();
      return {
        type: 'surface',
        surface: { op: 'appendCapture', text },
        // Empty reply → client stays silent (visual "Captured." only).
        reply: '',
      };
    }

    // Timers.
    if (/\b(cancel|stop|clear)\s+(the\s+)?timer\b/i.test(lower)) {
      return {
        type: 'surface',
        surface: { op: 'cancelTimer' },
        reply: 'Timer cancelled.',
      };
    }
    const timerMatch = lower.match(
      /\b(?:set|start)\s+(?:a\s+)?timer\s+(?:for\s+)?(.+)$/i,
    );
    if (timerMatch) {
      const seconds = parseDuration(timerMatch[1]);
      if (seconds > 0) {
        return {
          type: 'surface',
          surface: { op: 'timer', seconds, title: formatDuration(seconds) },
          reply: `Timer set for ${formatDuration(seconds)}.`,
        };
      }
      return {
        type: 'chat',
        reply: 'For how long?',
        awaiting: 'timer',
      };
    }

    // Make a list (optionally with inline items separated by commas / "and").
    const listMatch = original.match(
      /^(?:can you |could you |please )?(?:make|create|start|new)\s+(?:a |an )?list(?:\s+(?:of|for|called|titled))?\s*[:,-]?\s*(.*)$/i,
    );
    if (listMatch) {
      const rest = listMatch[1].trim();
      const items = rest
        ? rest
            .split(/,|\band\b/i)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      return {
        type: 'surface',
        surface: {
          op: 'createList',
          title: items.length > 1 ? undefined : rest || undefined,
          items: items.length > 1 ? items : undefined,
        },
        reply: 'List created.',
      };
    }

    // Undo / remove the last panel.
    if (
      /^(?:undo(?:\s+that)?|scratch that|remove (?:the )?last|delete (?:the )?last|take that back)\.?$/i.test(
        lower,
      )
    ) {
      return {
        type: 'surface',
        surface: { op: 'removeLast' },
        reply: 'Removed.',
      };
    }

    // Add one item to the current list/tasks ("add milk", "also add eggs").
    const addMatch = original.match(
      /^(?:also\s+|and\s+)?add\s+(.+?)(?:\s+to\s+(?:the\s+)?(?:list|tasks?))?\.?$/i,
    );
    if (addMatch) {
      const text = addMatch[1].replace(/[.!?]+$/, '').trim();
      // Don't swallow "add a note/task/list" — those are handled above.
      if (text && !/^(a |an )?(note|task|list|reminder)\b/i.test(text)) {
        return {
          type: 'surface',
          surface: { op: 'addItem', text },
          reply: 'Added.',
        };
      }
    }

    return null;
  }

  /**
   * Intents that need durable memory or the AI model with on-screen context.
   * Run after the synchronous matchers, before the general model fallback.
   */
  private async matchAsyncIntent(
    original: string,
    context?: string,
  ): Promise<InterpretedIntent | null> {
    const lower = original.toLowerCase();
    const ctx = (context ?? '').trim();

    // Clear this browser session's short-term memory.
    if (
      /\b(clear (the )?session|forget (this|the) session|start (a )?fresh( session)?|wipe (this )?session)\b/i.test(
        lower,
      )
    ) {
      return {
        type: 'chat',
        reply: 'Session cleared. Fresh slate.',
        args: { clearSession: true },
      };
    }

    // Catch-me-up from session + durable memory + agenda + on-screen context.
    // Work / morning briefs ("catch me up for the day") are handled in the route.
    if (
      /\b(where were we|catch me up|brief me|status (update|report)|what (have|did) we (been )?(doing|discussing|talking about)|what'?s (going )?on( with (this|the) session)?|recap (the )?session)\b/i.test(
        lower,
      ) &&
      !/\b(for (the )?day|for work|morning brief|daily brief|day board|start of (the )?day)\b/i.test(
        lower,
      )
    ) {
      if (!ctx) {
        return {
          type: 'chat',
          reply: 'Nothing on the board yet this session. Say the word when you are ready.',
        };
      }
      const brief = await this.briefSession(ctx);
      return { type: 'chat', reply: brief };
    }

    // Day agenda — what's next / am I free / what's on today / meetings coming up.
    if (
      /\b(what'?s next|what is next|what'?s coming up|what'?s come up|what do i have (today|next)|am i free|am i busy|what'?s on (my |the )?(team'?s? |teams )?(calendar|agenda|schedule)( today)?|what('?s| is) (on )?today|what meetings|check (my |the )?(team'?s? |teams )?(calendar|agenda|schedule)|meetings? (i have )?(coming up|come up|upcoming))\b/i.test(
        lower,
      )
    ) {
      return {
        type: 'chat',
        reply: agendaReply(ctx, lower.includes('free')),
      };
    }

    // Schedule something by voice — client persists into durable agenda.
    const scheduleMatch = original.match(
      /^(?:please\s+)?(?:(?:can you |could you )?(?:schedule|add|put|book)|i(?:'?ve| have) got|i have)\b.+$/i,
    );
    if (
      scheduleMatch &&
      /\b(meeting|call|appointment|interview|standup|sync|lunch|dinner|coffee|demo|session|calendar|agenda)\b/i.test(
        lower,
      ) &&
      /\b(?:at|for)\s+(\d{1,2}|noon|midnight)/i.test(lower)
    ) {
      return {
        type: 'chat',
        reply: 'I will put that on your agenda.',
        args: { scheduleUtterance: original },
      };
    }

    // Wrap up a meeting: summary note + action-item tasks + stop capture.
    if (
      /\b(wrap up (the )?meeting|end (the )?meeting|finish (the )?meeting|action items|extract (the )?tasks|summarize (the )?meeting|meeting (summary|recap)|pull (out )?action items)\b/i.test(
        lower,
      )
    ) {
      const source = extractOnScreen(ctx) || ctx;
      if (!source) {
        return {
          type: 'chat',
          reply: 'There is no meeting capture to wrap up yet.',
        };
      }
      const { summary, actions } = await this.wrapMeeting(source);
      const actionLine =
        actions.length > 0
          ? ` I pulled ${actions.length} action item${actions.length === 1 ? '' : 's'}.`
          : '';
      return {
        type: 'surface',
        surface: { op: 'createNote', title: 'Meeting summary', text: summary },
        reply: `Meeting wrapped.${actionLine} ${summary}`.trim(),
        args: {
          stopCapture: true,
          actionItems: actions,
        },
      };
    }

    // Pin the last Elevyn reply (or a spoken snippet) onto the glass.
    if (
      /^(?:pin (?:that|it|this)|keep (?:that|it|this) on (?:screen|the board)|put (?:that|it) on (?:screen|the board))\b/i.test(
        lower,
      )
    ) {
      const last = extractLastElevynLine(ctx);
      if (!last) {
        return {
          type: 'chat',
          reply: 'Nothing recent to pin. Ask me something first.',
        };
      }
      return {
        type: 'surface',
        surface: { op: 'createNote', title: 'Pinned', text: last },
        reply: 'Pinned.',
      };
    }

    // Remember something for this session (+ durable store when available).
    const rememberMatch = original.match(
      /^(?:please\s+)?(?:remember|note to self|keep in mind|don'?t forget)(?:\s+that|\s+this)?\s*[:,-]?\s*(.+)$/i,
    );
    if (rememberMatch) {
      const content = rememberMatch[1].replace(/[.!?]+$/, '').trim();
      if (!content) {
        return { type: 'chat', reply: 'What should I remember?' };
      }
      if (this.memory) {
        try {
          await this.memory.create({
            category: 'notes',
            title: content.split(/\s+/).slice(0, 6).join(' '),
            content,
            tags: ['voice', 'session'],
          });
        } catch {
          // Best-effort durable write.
        }
      }
      return {
        type: 'chat',
        reply: "Certainly. I'll remember that.",
        args: { sessionFact: content, durableFact: content },
      };
    }

    // Recall from durable memory (in context), then server memory, then session.
    const recallMatch = original.match(
      /^(?:what do you know about|what do you remember about|what did i say about|do you remember|recall|remind me (?:about|of)|tell me about)\s+(.+)$/i,
    );
    if (recallMatch) {
      const query = recallMatch[1].replace(/[.!?]+$/, '').trim();
      const fromDurable = findDurableFact(ctx, query);
      if (fromDurable) {
        return {
          type: 'chat',
          reply: `Here is what I have: ${fromDurable}`,
        };
      }
      if (this.memory) {
        try {
          const hits = await this.memory.search(query);
          if (hits.length) {
            return {
              type: 'chat',
              reply: `Here is what I have: ${hits[0].content}`,
            };
          }
        } catch {
          // fall through
        }
      }
      const fromSession = findSessionFact(ctx, query);
      if (fromSession) {
        return {
          type: 'chat',
          reply: `From this session: ${fromSession}`,
        };
      }
      return {
        type: 'chat',
        reply: `I have nothing on ${query} yet.`,
      };
    }

    // Summarize the on-screen notes / capture.
    if (
      /^(?:summar(?:ize|ise)|give me a summary|sum (?:this|it) up|recap)\b/i.test(
        lower,
      )
    ) {
      const source = extractOnScreen(ctx) || ctx;
      if (!source) {
        return {
          type: 'chat',
          reply: 'There is nothing to summarize yet.',
        };
      }
      const summary = await this.summarize(source);
      return {
        type: 'surface',
        surface: { op: 'createNote', title: 'Summary', text: summary },
        reply: `Here is your summary. ${summary}`,
      };
    }

    // Read back on-screen notes / capture aloud.
    if (
      /^(?:read (?:that|it|them|my notes|the notes|the capture|that back)|what (?:did i|have i) (?:capture|note|write)|play (?:that|it) back)\b/i.test(
        lower,
      )
    ) {
      const source = extractOnScreen(ctx) || ctx;
      if (!source) {
        return { type: 'chat', reply: 'Nothing on screen yet.' };
      }
      const spoken = source.replace(/\n+/g, '. ').slice(0, 500);
      return { type: 'chat', reply: spoken };
    }

    // Copy notes / capture to the clipboard (client handles the actual write).
    if (
      /^(?:copy (?:that|it|them|my notes|the notes|the capture)|copy to clipboard)\b/i.test(
        lower,
      )
    ) {
      const source = extractOnScreen(ctx) || ctx;
      if (!source) {
        return { type: 'chat', reply: 'Nothing to copy yet.' };
      }
      return {
        type: 'chat',
        reply: 'Copied to your clipboard.',
        args: { clipboard: source },
      };
    }

    return null;
  }

  private async briefSession(context: string): Promise<string> {
    const provider = await this.ai.resolve();
    if (provider) {
      try {
        const completion = await this.ai.complete({
          messages: [
            {
              role: 'system',
              content:
                'You are Elevyn. Give Kevin a crisp 2-sentence spoken brief of where things stand. Use durable memory, today\'s agenda, Microsoft 365 mail/Teams when present, recent conversation, and on-screen panels. British English, no markdown, no lists. Start naturally — no filler. Do not invent mail or chats.',
            },
            { role: 'user', content: context },
          ],
          temperature: 0.3,
          maxTokens: 200,
        });
        const text = completion.content.trim().replace(/\s+/g, ' ');
        if (text) return text.slice(0, 420);
      } catch {
        // fall through
      }
    }
    return extractiveBrief(context);
  }

  private async wrapMeeting(
    source: string,
  ): Promise<{ summary: string; actions: string[] }> {
    const provider = await this.ai.resolve();
    if (provider) {
      try {
        const completion = await this.ai.complete({
          messages: [
            {
              role: 'system',
              content:
                'You are Elevyn. From these meeting notes return ONLY JSON: {"summary":"<2 sentences>","actions":["task1","task2"]}. Max 5 actions. Plain text inside strings. No markdown.',
            },
            { role: 'user', content: source },
          ],
          temperature: 0.2,
          maxTokens: 320,
        });
        const match = completion.content.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]) as {
            summary?: string;
            actions?: unknown;
          };
          const summary = String(parsed.summary ?? '')
            .replace(/\s+/g, ' ')
            .trim();
          const actions = Array.isArray(parsed.actions)
            ? parsed.actions
                .map((a) => String(a).replace(/\s+/g, ' ').trim())
                .filter(Boolean)
                .slice(0, 5)
            : [];
          if (summary) return { summary, actions };
        }
      } catch {
        // fall through
      }
    }
    const summary = await this.summarize(source);
    return { summary, actions: [] };
  }

  private async summarize(source: string): Promise<string> {
    const provider = await this.ai.resolve();
    if (provider) {
      try {
        const completion = await this.ai.complete({
          messages: [
            {
              role: 'system',
              content:
                'You are Elevyn. Summarize the following notes into 2-3 concise sentences of plain British English. No markdown, no lists.',
            },
            { role: 'user', content: source },
          ],
          temperature: 0.3,
          maxTokens: 240,
        });
        const text = completion.content.trim();
        if (text) return text.replace(/\s+/g, ' ');
      } catch {
        // fall through to extractive fallback
      }
    }
    // Fallback: first couple of sentences.
    const sentences = source
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .filter(Boolean);
    return sentences.slice(0, 2).join(' ') || source.slice(0, 200);
  }

  private normalizeAppName(raw: string): string | null {
    const cleaned = raw.replace(/^(the|my|an?)\s+/i, '').trim();
    const aliases: Record<string, string> = {
      cursor: 'Cursor',
      finder: 'Finder',
      spotify: 'Spotify',
      chrome: 'Google Chrome',
      'google chrome': 'Google Chrome',
      terminal: 'Terminal',
      safari: 'Safari',
      notes: 'Notes',
      mail: 'Mail',
      calendar: 'Calendar',
      messages: 'Messages',
      'vs code': 'Visual Studio Code',
      vscode: 'Visual Studio Code',
      code: 'Visual Studio Code',
      slack: 'Slack',
      discord: 'Discord',
      notion: 'Notion',
      figma: 'Figma',
      music: 'Music',
      'system settings': 'System Settings',
      settings: 'System Settings',
    };

    const key = cleaned.toLowerCase();
    if (aliases[key]) return aliases[key];

    // Title-case unknown apps — `open -a` often still works on macOS.
    if (cleaned.length < 2) return null;
    return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private parseModelIntent(raw: string, fallbackUtterance: string): InterpretedIntent {
    // Hard reject tool/XML leakage before any JSON salvage.
    if (looksTechnical(raw) && !/^\s*\{/.test(raw.trim())) {
      const localEarly = this.matchLocalIntent(fallbackUtterance);
      if (localEarly) return localEarly;
      return { type: 'chat', reply: UNSURE_REPLY };
    }

    const knownCommands = new Set(this.commands.list().map((c) => c.id));
    const validSurfaceOps = new Set([
      'focus',
      'work',
      'dashboard',
      'clear',
      'createNote',
      'createTask',
      'createList',
      'addItem',
      'removeLast',
      'startCapture',
      'stopCapture',
      'appendCapture',
      'timer',
      'cancelTimer',
      'upsertAgent',
      'clearAgent',
    ]);

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as InterpretedIntent;
        const safeReply =
          sanitizeSpokenReply(parsed.reply) ?? UNSURE_REPLY;

        if (parsed.type === 'command' && parsed.commandId) {
          if (!knownCommands.has(parsed.commandId)) {
            return { type: 'chat', reply: UNSURE_REPLY };
          }
          return {
            type: 'command',
            commandId: parsed.commandId,
            args: parsed.args ?? {},
            reply: safeReply,
          };
        }
        if (
          parsed.type === 'surface' &&
          parsed.surface?.op &&
          validSurfaceOps.has(parsed.surface.op)
        ) {
          return {
            type: 'surface',
            surface: parsed.surface,
            reply: safeReply === UNSURE_REPLY ? 'Certainly.' : safeReply,
          };
        }
        if (parsed.type === 'agent' && parsed.plan?.steps?.length) {
          const plan = normalizeAgentPlan(parsed.plan);
          if (plan) {
            return {
              type: 'agent',
              plan,
              reply: safeReply === UNSURE_REPLY ? 'On it.' : safeReply,
            };
          }
        }
        if (parsed.type === 'chat') {
          return {
            type: 'chat',
            reply: sanitizeSpokenReply(parsed.reply) ?? UNSURE_REPLY,
          };
        }
      } catch {
        // fall through
      }
    }

    // Salvage a truncated JSON reply (hit the token cap mid-string) so the
    // user hears the sentence, never the raw JSON wrapper.
    const replyMatch = raw.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/);
    if (replyMatch?.[1]) {
      let reply = replyMatch[1]
        .replace(/\\"/g, '"')
        .replace(/\\n/g, ' ')
        .trim();
      // Drop a trailing half-word left by the cutoff.
      if (!/[.!?…"]$/.test(reply)) {
        reply = reply.replace(/\s+\S*$/, '').trim();
        if (reply) reply += '.';
      }
      const safe = sanitizeSpokenReply(reply);
      if (safe) return { type: 'chat', reply: safe };
    }

    // Retry local match if the model returned prose.
    const local = this.matchLocalIntent(fallbackUtterance);
    if (local) return local;

    // Never surface raw JSON scaffolding or tool markup to the user.
    const cleaned = sanitizeSpokenReply(
      raw
        .replace(/```[\s\S]*?```/g, '')
        .replace(/\{[\s\S]*\}?/g, '')
        .trim(),
    );
    return {
      type: 'chat',
      reply: cleaned || UNSURE_REPLY,
    };
  }
}

function normalizeAgentPlan(raw: AgentPlan): AgentPlan | null {
  if (!raw || !Array.isArray(raw.steps) || !raw.steps.length) return null;
  const steps: AgentStep[] = raw.steps
    .slice(0, 4)
    .map((s, i) => {
      const label = String(s?.label ?? `Step ${i + 1}`).slice(0, 60);
      const step: AgentStep = { label };
      if (s.surface?.op) step.surface = s.surface;
      if (typeof s.utterance === 'string' && s.utterance.trim()) {
        step.utterance = s.utterance.trim().slice(0, 280);
      }
      if (typeof s.remember === 'string' && s.remember.trim()) {
        step.remember = s.remember.trim().slice(0, 280);
      }
      if (s.copy === true) step.copy = true;
      return step;
    })
    .filter((s) => s.surface || s.utterance || s.remember || s.copy);
  if (!steps.length) return null;
  return {
    title: String(raw.title || 'Plan').slice(0, 60),
    steps,
  };
}

function extractOnScreen(context: string): string {
  const marker = '=== ON SCREEN ===';
  const idx = context.indexOf(marker);
  if (idx === -1) {
    // Legacy plain context (panels only).
    if (
      context.includes('=== SESSION FACTS ===') ||
      context.includes('=== RECENT CONVERSATION ===') ||
      context.includes('=== DURABLE MEMORY ===') ||
      context.includes("=== TODAY'S AGENDA ===")
    ) {
      return '';
    }
    return context.trim();
  }
  return context.slice(idx + marker.length).trim();
}

function extractSection(context: string, marker: string): string {
  const idx = context.indexOf(marker);
  if (idx === -1) return '';
  const rest = context.slice(idx + marker.length);
  const next = rest.search(/\n=== /);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

function agendaReply(context: string, askingIfFree: boolean): string {
  const block = extractSection(context, "=== TODAY'S AGENDA ===");
  if (!block) {
    return askingIfFree
      ? 'I do not have anything on your agenda yet. Tell me what is coming up and I will track it.'
      : 'Your agenda is clear from here. Tell me about a meeting and I will remember it.';
  }
  const lines = block
    .split('\n')
    .map((l) => l.replace(/^-\s*/, '').trim())
    .filter(Boolean);
  if (!lines.length) {
    return 'Your agenda is clear from here.';
  }
  if (askingIfFree) {
    return `You have ${lines.length} upcoming item${lines.length === 1 ? '' : 's'}. Next: ${lines[0]}.`;
  }
  if (lines.length === 1) return `Next up: ${lines[0]}.`;
  return `Next up: ${lines[0]}. After that: ${lines[1]}.`;
}

function findDurableFact(context: string, query: string): string | null {
  const block = extractSection(context, '=== DURABLE MEMORY ===');
  if (!block) return null;
  const needle = query.toLowerCase();
  const facts = block
    .split('\n')
    .map((l) => l.replace(/^-+\s*(?:\[[^\]]+\]\s*)?/, '').trim())
    .filter(Boolean);
  const hit = facts.find((f) => f.toLowerCase().includes(needle));
  return hit ?? null;
}

function extractLastElevynLine(context: string): string | null {
  const block = context.match(
    /=== RECENT CONVERSATION ===\n([\s\S]*?)(?=\n=== |\n*$)/,
  );
  if (!block?.[1]) return null;
  const lines = block[1]
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^Elevyn:\s*(.+)$/i);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function findSessionFact(context: string, query: string): string | null {
  const block = context.match(/=== SESSION FACTS ===\n([\s\S]*?)(?=\n=== |\n*$)/);
  if (!block?.[1]) return null;
  const needle = query.toLowerCase();
  const facts = block[1]
    .split('\n')
    .map((l) => l.replace(/^-+\s*/, '').trim())
    .filter(Boolean);
  const hit = facts.find((f) => f.toLowerCase().includes(needle));
  return hit ?? null;
}

function extractiveBrief(context: string): string {
  const bits: string[] = [];
  const agenda = extractSection(context, "=== TODAY'S AGENDA ===")
    .split('\n')
    .map((l) => l.replace(/^-\s*/, '').trim())
    .filter(Boolean);
  if (agenda[0]) bits.push(`Next on your agenda: ${agenda[0]}.`);

  const durable = extractSection(context, '=== DURABLE MEMORY ===')
    .split('\n')
    .map((l) => l.replace(/^-+\s*(?:\[[^\]]+\]\s*)?/, '').trim())
    .filter(Boolean);
  const facts = findAllSessionFacts(context);
  const remembered = [...facts, ...durable].slice(0, 2);
  if (remembered.length) {
    bits.push(`You asked me to remember: ${remembered.join('; ')}.`);
  }

  const screen = extractOnScreen(context);
  if (screen) {
    const snippet = screen.replace(/\s+/g, ' ').slice(0, 160);
    bits.push(`On screen: ${snippet}${screen.length > 160 ? '…' : ''}`);
  }

  if (!bits.length) {
    const convo = context.match(/=== RECENT CONVERSATION ===\n([\s\S]+)/);
    if (convo?.[1]) {
      const last = convo[1].trim().split('\n').slice(-2).join(' ');
      return `We left off here: ${last.slice(0, 280)}`;
    }
    return 'Quiet session so far. I am standing by.';
  }
  return bits.join(' ').slice(0, 420);
}

function findAllSessionFacts(context: string): string[] {
  const block = context.match(/=== SESSION FACTS ===\n([\s\S]*?)(?=\n=== |\n*$)/);
  if (!block?.[1]) return [];
  return block[1]
    .split('\n')
    .map((l) => l.replace(/^-+\s*/, '').trim())
    .filter(Boolean);
}

/** Parse a spoken duration ("5 minutes", "1 minute 30 seconds", "an hour"). */
function parseDuration(input: string): number {
  const text = input.toLowerCase().trim();
  if (!text) return 0;

  const words: Record<string, number> = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20,
    thirty: 30, forty: 40, fifty: 50, sixty: 60, half: 0.5,
  };

  let total = 0;
  let matched = false;
  const unitRe = /(\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty|sixty|half)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g;

  let m: RegExpExecArray | null;
  while ((m = unitRe.exec(text)) !== null) {
    const value = /^\d/.test(m[1]) ? parseFloat(m[1]) : words[m[1]] ?? 0;
    const unit = m[2];
    if (/^h/.test(unit)) total += value * 3600;
    else if (/^m/.test(unit)) total += value * 60;
    else total += value;
    matched = true;
  }

  // Bare number with no unit → assume minutes ("timer for 5").
  if (!matched) {
    const bare = text.match(/^(\d+(?:\.\d+)?)$/);
    if (bare) total = parseFloat(bare[1]) * 60;
  }

  return Math.round(total);
}

/** Human-readable duration for spoken confirmations + panel titles. */
function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} hour${h > 1 ? 's' : ''}`);
  if (m) parts.push(`${m} minute${m > 1 ? 's' : ''}`);
  if (s) parts.push(`${s} second${s > 1 ? 's' : ''}`);
  return parts.join(' ') || '0 seconds';
}
