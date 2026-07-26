/**
 * Microsoft write actions from voice — pending confirm for mail/Teams,
 * immediate create for calendar events.
 */

import type { InterpretedIntent } from '../../../src/types/index.js';
import {
  createCalendarEvent,
  findPerson,
  findTeamsChat,
  sendMail,
  sendTeamsMessage,
} from './graph.js';

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
    };

type PendingEntry = { action: PendingMsAction; expires: number };

const pendingByKey = new Map<string, PendingEntry>();
const PENDING_TTL_MS = 120_000;

function pendingKey(account?: string | null): string {
  return (account ?? 'default').toLowerCase();
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
    /^(yes|yeah|yep|confirm|send it|do it|go ahead|please send|cancel|never ?mind|don'?t send)\b/i.test(
      lower,
    )
  );
}

export function utteranceNeedsMsToken(utterance: string): boolean {
  return wantsWriteMs(utterance.toLowerCase());
}

/**
 * Try to handle a Microsoft write / confirm utterance.
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
): Promise<InterpretedIntent | null> {
  const original = utterance.trim();
  const lower = original.toLowerCase();

  // Confirm / cancel pending send.
  if (
    /^(yes|yeah|yep|yup|confirm|send it|do it|go ahead|please send|send)\.?$/i.test(
      lower,
    ) ||
    /^(yes|yeah|yep),?\s+(send|do)\s+it\.?$/i.test(lower)
  ) {
    const pending = getPendingMsAction(account);
    if (!pending) return null;
    try {
      const reply = await executePendingMsAction(accessToken, account);
      return { type: 'chat', reply };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Send failed';
      return {
        type: 'chat',
        reply: `I could not send that. ${message}`,
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

  // Create Outlook / Teams calendar event when we have a parsed schedule
  // (and this is not an email / Teams-send request).
  const looksLikeSend =
    /^(?:please\s+)?(?:(?:can you |could you )?)?(?:send|email|mail|e-mail|message|ping|text|tell)\b/i.test(
      original,
    );
  if (schedule && !looksLikeSend) {
    const withPerson =
      lower.match(
        /\b(?:with|and)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?|[a-z]{2,20})\b/,
      ) ||
      lower.match(/\bmeeting with\s+([a-z][a-z\s.'-]{1,40}?)(?:\s+at|\s+for|$)/i);
    let attendeeEmails: string[] = [];
    let whoLabel = '';
    if (withPerson?.[1]) {
      const person = await findPerson(accessToken, withPerson[1].trim());
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
          // Still mirror into Elevyn's local agenda.
          scheduleUtterance: original,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Calendar write failed';
      return {
        type: 'chat',
        reply: `I could not create that Outlook event. ${message}`,
        args: { scheduleUtterance: original },
      };
    }
  }

  // Email: "email Sarah that I'll be late" / "send an email to Alex saying…"
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
    const person = await findPerson(accessToken, who);
    if (!person) {
      return {
        type: 'chat',
        reply: `I could not find ${who} in your Microsoft directory. Try a full name or email address.`,
      };
    }
    const subject =
      body.length > 60 ? `${body.slice(0, 57)}…` : body.charAt(0).toUpperCase() + body.slice(1);
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
    };
  }

  // Teams message: "message Alex on Teams that I'm running late"
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
    let chat = await findTeamsChat(accessToken, who);
    if (!chat) {
      // Try resolving person then matching chat by their name
      const person = await findPerson(accessToken, who);
      if (person) chat = await findTeamsChat(accessToken, person.name);
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
    };
  }

  return null;
}
