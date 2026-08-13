/**
 * Microsoft write actions from voice — pending confirm for mail/Teams/channels,
 * immediate create for calendar + To Do, plus files / presence / rooms.
 */

import type { InterpretedIntent } from '../../../src/types/index.js';
import {
  createCalendarEvent,
  findPerson,
  findTeamsChat,
  sendMail,
  sendTeamsMessage,
  type GraphPerson,
} from './graph.js';
import {
  createTodoTask,
  findRooms,
  findTeamChannel,
  getPresenceForUser,
  listTodoTasks,
  postChannelMessage,
  readChannelMessages,
  searchContacts,
  searchFiles,
  speakContact,
  speakFileHits,
  speakRooms,
  speakTodoBrief,
} from './extras.js';
import {
  findPersonInMemory,
  parsePeopleFromContext,
} from '../../../src/utils/peopleMemory.js';

export type PendingMsAction =
  | {
      kind: 'mail';
      to: string;
      toName: string;
      subject: string;
      body: string;
    }
  | {
      kind: 'teams';
      chatId: string;
      chatTitle: string;
      message: string;
    }
  | {
      kind: 'channel';
      teamId: string;
      channelId: string;
      label: string;
      message: string;
    };

type PendingEntry = { action: PendingMsAction; expires: number };

const pendingByKey = new Map<string, PendingEntry>();
const PENDING_TTL_MS = 120_000;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function pendingKey(account?: string | null): string {
  return (account ?? 'default').toLowerCase();
}

function learnPersonArgs(person: GraphPerson): Record<string, unknown> {
  return {
    learnPerson: { name: person.name, email: person.email },
  };
}

/** Prefer durable people memory, then Graph directory. */
async function resolvePerson(
  accessToken: string,
  who: string,
  context?: string,
): Promise<GraphPerson | null> {
  const trimmed = who.trim();
  if (!trimmed) return null;

  if (EMAIL_RE.test(trimmed)) {
    return { name: trimmed.split('@')[0] ?? trimmed, email: trimmed.toLowerCase() };
  }

  const remembered = findPersonInMemory(
    parsePeopleFromContext(context),
    trimmed,
  );
  if (remembered?.email) {
    return { name: remembered.name, email: remembered.email };
  }

  const graphName = remembered?.name ?? trimmed;
  return findPerson(accessToken, graphName);
}

export function setPendingMsAction(
  account: string | null | undefined,
  action: PendingMsAction,
): void {
  pendingByKey.set(pendingKey(account), {
    action,
    expires: Date.now() + PENDING_TTL_MS,
  });
}

export function getPendingMsAction(
  account: string | null | undefined,
): PendingMsAction | null {
  const key = pendingKey(account);
  const entry = pendingByKey.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    pendingByKey.delete(key);
    return null;
  }
  return entry.action;
}

export function clearPendingMsAction(account: string | null | undefined): void {
  pendingByKey.delete(pendingKey(account));
}

export async function executePendingMsAction(
  accessToken: string,
  account: string | null | undefined,
): Promise<string> {
  const action = getPendingMsAction(account);
  if (!action) return 'Nothing pending to send.';
  clearPendingMsAction(account);

  if (action.kind === 'mail') {
    await sendMail(accessToken, {
      to: action.to,
      subject: action.subject,
      body: action.body,
    });
    return `Sent to ${action.toName}.`;
  }

  if (action.kind === 'channel') {
    await postChannelMessage(
      accessToken,
      action.teamId,
      action.channelId,
      action.message,
    );
    return `Posted in ${action.label}.`;
  }

  await sendTeamsMessage(accessToken, action.chatId, action.message);
  return `Sent on Teams to ${action.chatTitle}.`;
}

function wantsWriteMs(lower: string): boolean {
  return (
    /\b(email|e-mail|mail|send|message|ping|text|tell)\b/i.test(lower) ||
    /\b(schedule|book|put|add)\b.+\b(outlook|calendar|teams meeting)\b/i.test(
      lower,
    ) ||
    /\b(teams meeting|on (my )?outlook|on (my )?calendar)\b/i.test(lower) ||
    /\b(to ?do|task list|my tasks|onedrive|one drive|find (the )?file|search (my )?files|contact|available|free|busy|presence|meeting room|conference room|channel)\b/i.test(
      lower,
    ) ||
    /^(yes|yeah|yep|confirm|send it|do it|go ahead|please send|cancel|never ?mind|don'?t send)\b/i.test(
      lower,
    )
  );
}

export function utteranceNeedsMsToken(utterance: string): boolean {
  return wantsWriteMs(utterance.toLowerCase());
}

/**
 * Try to handle a Microsoft write / confirm / extras utterance.
 * Returns an intent when handled, otherwise null.
 */
export async function tryMicrosoftWriteIntent(
  utterance: string,
  accessToken: string,
  account: string | null | undefined,
  schedule?: {
    title: string;
    startIso: string;
    endIso: string;
  } | null,
  context?: string,
): Promise<InterpretedIntent | null> {
  const original = utterance.trim();
  const lower = original.toLowerCase();

  // Confirm / cancel pending send.
  if (
    /^(yes|yeah|yep|yup|confirm|send it|do it|go ahead|please send|send|post it)\.?$/i.test(
      lower,
    ) ||
    /^(yes|yeah|yep),?\s+(send|do|post)\s+it\.?$/i.test(lower)
  ) {
    const pending = getPendingMsAction(account);
    if (!pending) return null;
    try {
      const reply = await executePendingMsAction(accessToken, account);
      return { type: 'chat', reply };
    } catch {
      return {
        type: 'chat',
        reply: "I couldn't send that just now. Want to try again?",
      };
    }
  }

  if (
    /^(no|cancel|never ?mind|don'?t send|stop|scratch that)\.?$/i.test(lower)
  ) {
    if (!getPendingMsAction(account)) return null;
    clearPendingMsAction(account);
    return { type: 'chat', reply: 'Cancelled. Nothing sent.' };
  }

  // To Do — list
  if (
    /\b(what'?s on (my )?(to ?do|task list|tasks)|my (to ?do|tasks)|list (my )?tasks|any (open )?tasks)\b/i.test(
      lower,
    )
  ) {
    try {
      const tasks = await listTodoTasks(accessToken);
      return { type: 'chat', reply: speakTodoBrief(tasks) };
    } catch {
      return {
        type: 'chat',
        reply: "I couldn't reach To Do just now. Want to try again?",
      };
    }
  }

  // To Do — create
  const todoAdd = original.match(
    /^(?:please\s+)?(?:(?:can you |could you )?)?(?:add|create|put)\s+(?:a\s+)?(?:to ?do|task)\s+(?:to\s+(?:my\s+)?(?:list|to ?do)\s+)?(?:to\s+|for\s+|called\s+|saying\s+)?(.+)$/i,
  );
  if (
    todoAdd?.[1] ||
    /\badd (?:that )?to (?:my )?(?:to ?do|tasks)\b/i.test(lower)
  ) {
    const title = (todoAdd?.[1] ?? '')
      .replace(/\b(?:to my (?:to ?do|list|tasks)|on my (?:to ?do|list))\b/gi, '')
      .replace(/[.!?]+$/, '')
      .trim();
    if (!title || title.length < 2) {
      return { type: 'chat', reply: 'What should the To Do say?' };
    }
    try {
      const task = await createTodoTask(accessToken, title);
      return { type: 'chat', reply: `Added to To Do: ${task.title}.` };
    } catch {
      return {
        type: 'chat',
        reply: "I couldn't add that task just now. Want to try again?",
      };
    }
  }

  // OneDrive search
  const fileMatch = original.match(
    /^(?:please\s+)?(?:(?:can you |could you )?)?(?:find|search(?:\s+for)?|look(?:\s+up)?)\s+(?:the\s+)?(?:file|document|doc|folder)?\s*(.+?)(?:\s+on\s+(?:onedrive|one drive|sharepoint))?$/i,
  );
  if (
    fileMatch?.[1] &&
    /\b(file|document|doc|folder|onedrive|one drive)\b/i.test(lower)
  ) {
    const query = fileMatch[1]
      .replace(/\b(on (?:onedrive|one drive|sharepoint)|for me)\b/gi, '')
      .trim();
    if (query.length >= 2) {
      try {
        const hits = await searchFiles(accessToken, query);
        return { type: 'chat', reply: speakFileHits(hits, query) };
      } catch {
        return {
          type: 'chat',
          reply: "I couldn't search OneDrive just now. Want to try again?",
        };
      }
    }
  }

  // Contacts
  const contactMatch = original.match(
    /^(?:please\s+)?(?:(?:can you |could you )?)?(?:look(?:\s+up)?|find|get)\s+(?:the\s+)?(?:contact\s+(?:for\s+)?|info(?:rmation)?\s+(?:for|on)\s+|details\s+(?:for|on)\s+)(.+)$/i,
  );
  if (contactMatch?.[1] || /\bcontact (?:for|info)\b/i.test(lower)) {
    const who = (contactMatch?.[1] ?? lower.replace(/^.*\b(?:for|on)\s+/, ''))
      .replace(/[.!?]+$/, '')
      .trim();
    if (who.length >= 2) {
      try {
        const remembered = findPersonInMemory(
          parsePeopleFromContext(context),
          who,
        );
        if (remembered) {
          return {
            type: 'chat',
            reply: speakContact({
              name: remembered.name,
              email: remembered.email,
            }),
            args: remembered.email
              ? learnPersonArgs({
                  name: remembered.name,
                  email: remembered.email,
                })
              : undefined,
          };
        }
        const hits = await searchContacts(accessToken, who);
        if (!hits.length) {
          const graphPerson = await resolvePerson(accessToken, who, context);
          if (graphPerson) {
            return {
              type: 'chat',
              reply: speakContact({
                name: graphPerson.name,
                email: graphPerson.email,
              }),
              args: learnPersonArgs(graphPerson),
            };
          }
          return {
            type: 'chat',
            reply: `No contact matched ${who}. Say “remember ${who}'s email is …” and I will keep it.`,
          };
        }
        const hit = hits[0];
        return {
          type: 'chat',
          reply: speakContact(hit),
          args:
            hit.email
              ? learnPersonArgs({ name: hit.name, email: hit.email })
              : undefined,
        };
      } catch {
        return {
          type: 'chat',
          reply: "I couldn't read contacts just now. Want to try again?",
        };
      }
    }
  }

  // Presence
  const presenceMatch =
    original.match(
      /^(?:please\s+)?(?:(?:can you |could you )?)?(?:is|check if)\s+(.+?)\s+(?:available|free|busy|online|around)\??$/i,
    ) ||
    original.match(
      /^(?:please\s+)?(?:(?:can you |could you )?)?(?:check|what(?:'?s| is))\s+(.+?)(?:'?s)?\s+(?:availability|presence|status)\??$/i,
    );
  if (presenceMatch?.[1]) {
    const who = presenceMatch[1].replace(/\b(?:the|a)\s+/gi, '').trim();
    try {
      const person = await resolvePerson(accessToken, who, context);
      if (!person) {
        return {
          type: 'chat',
          reply: `I could not find ${who} to check presence. Say “remember ${who}'s email is …” if you know it.`,
        };
      }
      const status = await getPresenceForUser(accessToken, person.email);
      return {
        type: 'chat',
        reply: `${person.name} looks ${status}.`,
        args: learnPersonArgs(person),
      };
    } catch {
      return {
        type: 'chat',
        reply: "I couldn't check presence just now. Want to try again?",
      };
    }
  }

  // Meeting rooms
  if (
    /\b(meeting rooms?|conference rooms?|find (a )?room|any rooms?)\b/i.test(
      lower,
    )
  ) {
    const hintMatch = lower.match(
      /\b(?:called|named|near|in)\s+([a-z0-9\s-]{2,30})$/i,
    );
    try {
      const rooms = await findRooms(accessToken, hintMatch?.[1]);
      return { type: 'chat', reply: speakRooms(rooms) };
    } catch {
      return {
        type: 'chat',
        reply: "I couldn't list rooms just now. Want to try again?",
      };
    }
  }

  // Channel read
  const channelRead = original.match(
    /^(?:please\s+)?(?:(?:can you |could you )?)?(?:what'?s(?:\s+new)?(?:\s+in)?|catch me up on|read|check)\s+(?:the\s+)?(.+?)\s+channel(?:\s+(?:in|on|for)\s+(.+))?$/i,
  );
  if (channelRead) {
    const channelHint = channelRead[1].trim();
    const teamHint = (channelRead[2] ?? channelHint).trim();
    try {
      const ch = await findTeamChannel(accessToken, teamHint, channelHint);
      if (!ch) {
        return {
          type: 'chat',
          reply: `I could not find a channel matching ${channelHint}.`,
        };
      }
      const lines = await readChannelMessages(
        accessToken,
        ch.teamId,
        ch.channelId,
      );
      if (!lines.length) {
        return {
          type: 'chat',
          reply: `${ch.teamName} / ${ch.channelName} looks quiet.`,
        };
      }
      return {
        type: 'chat',
        reply: `${ch.teamName} · ${ch.channelName}. ${lines.slice(0, 3).join(' ')}`,
      };
    } catch {
      return {
        type: 'chat',
        reply: "I couldn't read that channel just now. Want to try again?",
      };
    }
  }

  // Channel post — flexible spoken forms:
  // "post in the marketing channel that …"
  // "send a teams message in dw growth and capital channel that says …"
  // "message the elevyn channel saying …"
  const channelPost =
    original.match(
      /^(?:please\s+)?(?:(?:can you |could you )?)?(?:send\s+(?:a\s+)?(?:team'?s?|teams)\s+message|post|send|message)\s+(?:in|to|on)\s+(?:the\s+)?(.+?)\s+channel(?:\s+(?:in|on|for|to)\s+(?:the\s+)?(.+?))?\s+(?:that\s+says|that|saying|to\s+say)\s+(.+)$/i,
    ) ||
    original.match(
      /^(?:please\s+)?(?:(?:can you |could you )?)?(?:post|send|message)\s+(?:in|to)\s+(?:the\s+)?(.+?)\s+channel(?:\s+(?:in|on|for)\s+(.+?))?\s+(?:that|saying)\s+(.+)$/i,
    );
  if (channelPost) {
    let channelHint = channelPost[1].trim();
    // Strip trailing "to the team" style filler from the channel name capture.
    channelHint = channelHint
      .replace(/\s+(?:to|for)\s+(?:the\s+)?(?:team|group|everyone)$/i, '')
      .trim();
    const teamHint = (channelPost[2] ?? channelHint)
      .replace(/\b(?:the\s+)?(?:team|group|everyone)\b/gi, '')
      .trim() || channelHint;
    const message = channelPost[3].replace(/[.!?]+$/, '').trim();
    if (!message) {
      return {
        type: 'chat',
        reply: 'What should I post in that channel?',
      };
    }
    try {
      const ch = await findTeamChannel(accessToken, teamHint, channelHint);
      if (!ch) {
        return {
          type: 'chat',
          reply: `I could not find a channel matching ${channelHint}.`,
        };
      }
      const label = `${ch.teamName} / ${ch.channelName}`;
      setPendingMsAction(account, {
        kind: 'channel',
        teamId: ch.teamId,
        channelId: ch.channelId,
        label,
        message,
      });
      return {
        type: 'chat',
        reply: `I'll post in ${label}: ${message}. Say “send it” to confirm, or “cancel”.`,
      };
    } catch {
      return {
        type: 'chat',
        reply: "I couldn't prepare that post just now. Want to try again?",
      };
    }
  }

  // Outlook calendar create from parsed schedule
  const looksLikeSend =
    /^(?:please\s+)?(?:(?:can you |could you )?)?(?:send|email|mail|e-mail|message|ping|text|tell|post)\b/i.test(
      original,
    );
  if (schedule && !looksLikeSend) {
    const withPerson =
      lower.match(
        /\b(?:with|and)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?|[a-z]{2,20})\b/,
      ) ||
      lower.match(
        /\bmeeting with\s+([a-z][a-z\s.'-]{1,40}?)(?:\s+at|\s+for|$)/i,
      );
    let attendeeEmails: string[] = [];
    let whoLabel = '';
    if (withPerson?.[1]) {
      const person = await resolvePerson(
        accessToken,
        withPerson[1].trim(),
        context,
      );
      if (person) {
        attendeeEmails = [person.email];
        whoLabel = person.name;
      }
    }
    const teamsMeeting = /\bteams\b/i.test(lower);
    try {
      await createCalendarEvent(accessToken, {
        subject: schedule.title,
        startIso: schedule.startIso,
        endIso: schedule.endIso,
        attendeeEmails,
        teamsMeeting,
      });
      const when = new Date(schedule.startIso).toLocaleString('en-US', {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: process.env.ELEVYN_TZ ?? 'America/New_York',
      });
      const invite = whoLabel ? ` Invited ${whoLabel}.` : '';
      const teams = teamsMeeting ? ' Teams link included.' : '';
      return {
        type: 'chat',
        reply: `On your Outlook calendar: ${schedule.title} at ${when}.${invite}${teams}`,
        args: {
          scheduleUtterance: original,
          ...(whoLabel && attendeeEmails[0]
            ? learnPersonArgs({ name: whoLabel, email: attendeeEmails[0] })
            : {}),
        },
      };
    } catch {
      return {
        type: 'chat',
        reply: "I couldn't create that Outlook event just now. Want to try again?",
        args: { scheduleUtterance: original },
      };
    }
  }

  // Email
  const mailMatch =
    original.match(
      /^(?:please\s+)?(?:(?:can you |could you )?)?(?:send\s+(?:an?\s+)?(?:email|mail|e-mail)|email|mail|e-mail)\s+(?:to\s+)?(.+?)\s+(?:saying|that|about|re:?)\s+(.+)$/i,
    ) ||
    original.match(
      /^(?:please\s+)?(?:(?:can you |could you )?)?(?:tell|message)\s+(.+?)\s+(?:by|via|over)\s+(?:email|mail|outlook)\s+(?:that|saying)?\s*(.+)$/i,
    );

  if (mailMatch) {
    const who = mailMatch[1].replace(/\b(?:an?|the)\s+/gi, '').trim();
    const body = mailMatch[2].replace(/[.!?]+$/, '').trim();
    if (!who || !body) {
      return {
        type: 'chat',
        reply: 'Who should I email, and what should it say?',
      };
    }
    const person = await resolvePerson(accessToken, who, context);
    if (!person) {
      return {
        type: 'chat',
        reply: `I couldn't find ${who}. Say “remember ${who}'s email is …” or try a full name.`,
      };
    }
    const subject =
      body.length > 60
        ? `${body.slice(0, 57)}…`
        : body.charAt(0).toUpperCase() + body.slice(1);
    setPendingMsAction(account, {
      kind: 'mail',
      to: person.email,
      toName: person.name,
      subject,
      body,
    });
    return {
      type: 'chat',
      reply: `I'll email ${person.name}: ${body}. Say “send it” to confirm, or “cancel”.`,
      args: learnPersonArgs(person),
    };
  }

  // Teams chat message
  const teamsMatch =
    original.match(
      /^(?:please\s+)?(?:(?:can you |could you )?)?(?:send\s+(?:a\s+)?(?:teams\s+)?message|message|ping|text|tell)\s+(.+?)\s+(?:on|in|via|over)\s+teams\s+(?:that|saying)?\s*(.+)$/i,
    ) ||
    original.match(
      /^(?:please\s+)?(?:(?:can you |could you )?)?(?:teams\s+(?:message|ping|text))\s+(.+?)\s+(?:that|saying)\s+(.+)$/i,
    );

  if (teamsMatch) {
    const who = teamsMatch[1].replace(/\b(?:an?|the)\s+/gi, '').trim();
    const message = teamsMatch[2].replace(/[.!?]+$/, '').trim();
    if (!who || !message) {
      return {
        type: 'chat',
        reply: 'Who on Teams, and what should I say?',
      };
    }
    const remembered = findPersonInMemory(
      parsePeopleFromContext(context),
      who,
    );
    let chat = await findTeamsChat(
      accessToken,
      remembered?.name ?? who,
    );
    let learned: GraphPerson | null = null;
    if (!chat) {
      const person = await resolvePerson(accessToken, who, context);
      if (person) {
        learned = person;
        chat = await findTeamsChat(accessToken, person.name);
      }
    }
    if (!chat) {
      return {
        type: 'chat',
        reply: `I could not find a Teams chat with ${who}. Open that chat once in Teams, then try again.`,
      };
    }
    setPendingMsAction(account, {
      kind: 'teams',
      chatId: chat.id,
      chatTitle: chat.title,
      message,
    });
    return {
      type: 'chat',
      reply: `I'll message ${chat.title} on Teams: ${message}. Say “send it” to confirm, or “cancel”.`,
      args: learned ? learnPersonArgs(learned) : undefined,
    };
  }

  return null;
}
