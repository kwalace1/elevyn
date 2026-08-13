/**
 * Meeting prep pack — next (or named/timed) meeting with related mail + tasks.
 */

import type { GraphCalendarEvent, GraphMailItem } from './graph.js';
import { parseAgendaFromContext, parseOpenTasksFromContext } from './workBrief.js';

const TIME_ZONE = process.env.ELEVYN_TZ ?? 'America/New_York';

export function wantsMeetingPrep(utterance: string): boolean {
  const lower = utterance.toLowerCase().trim();
  if (/\b(catch me up|morning brief|daily brief|day board)\b/.test(lower)) {
    return false;
  }
  if (
    /\bprep(are)?(?:\s+me)?\s+(?:for|on)\b/.test(lower) ||
    /\bget me ready (?:for|on)\b/.test(lower) ||
    /\bmeeting prep\b/.test(lower) ||
    /\bbrief me (?:for|on) (?:the )?(?:next )?meeting\b/.test(lower) ||
    /\bprep (?:the )?(?:next )?meeting\b/.test(lower)
  ) {
    return true;
  }
  return false;
}

export type PrepTarget =
  | { kind: 'next' }
  | { kind: 'time'; hour: number; minute: number }
  | { kind: 'name'; query: string };

/** Pull next / timed / named meeting target from the utterance. */
export function parsePrepTarget(utterance: string): PrepTarget {
  const lower = utterance.toLowerCase();

  if (/\b(next|upcoming|following)\b/.test(lower)) {
    return { kind: 'next' };
  }

  const timeMatch = lower.match(
    /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/,
  );
  if (timeMatch) {
    let hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2] ?? '0');
    const meridiem = (timeMatch[3] ?? '').replace(/\./g, '');
    if (/p/i.test(meridiem) && hour < 12) hour += 12;
    if (/a/i.test(meridiem) && hour === 12) hour = 0;
    if (!meridiem && hour < 7) hour += 12; // bare "2" → 2pm for work hours
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { kind: 'time', hour, minute };
    }
  }

  const nameMatch = utterance.match(
    /\b(?:prep(?:are)?(?:\s+me)?|get me ready|brief me)\s+(?:for|on)\s+(?:the\s+)?(.+)$/i,
  );
  if (nameMatch?.[1]) {
    const query = nameMatch[1]
      .replace(/\b(meeting|call|sync|standup|next|upcoming)\b/gi, '')
      .replace(/[.!?]+$/, '')
      .trim();
    if (query.length >= 2) return { kind: 'name', query };
  }

  return { kind: 'next' };
}

function eventHourMinute(iso: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
    timeZone: TIME_ZONE,
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return { hour, minute };
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TIME_ZONE,
  });
}

function minutesUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
}

export function pickMeetingForPrep(
  events: GraphCalendarEvent[],
  target: PrepTarget,
): GraphCalendarEvent | null {
  const upcoming = events.filter(
    (e) => new Date(e.end ?? e.start).getTime() >= Date.now() - 5 * 60_000,
  );
  if (!upcoming.length) return null;

  if (target.kind === 'next') return upcoming[0];

  if (target.kind === 'time') {
    let best: GraphCalendarEvent | null = null;
    let bestDelta = Infinity;
    for (const e of upcoming) {
      const { hour, minute } = eventHourMinute(e.start);
      const delta = Math.abs(hour * 60 + minute - (target.hour * 60 + target.minute));
      if (delta < bestDelta) {
        bestDelta = delta;
        best = e;
      }
    }
    return bestDelta <= 90 ? best : upcoming[0];
  }

  const needle = target.query.toLowerCase();
  const named = upcoming.find(
    (e) =>
      e.title.toLowerCase().includes(needle) ||
      e.attendees?.some((a) => a.toLowerCase().includes(needle)),
  );
  return named ?? upcoming[0];
}

export function relatedMailForMeeting(
  event: GraphCalendarEvent,
  mail: GraphMailItem[],
): GraphMailItem[] {
  const tokens = event.title
    .toLowerCase()
    .replace(/\(teams\)/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !['teams', 'meeting', 'sync', 'call'].includes(t));
  const attendeeBits = (event.attendees ?? []).map((a) => a.toLowerCase());

  const scored = mail.map((m) => {
    const hay = `${m.from} ${m.subject} ${m.preview}`.toLowerCase();
    let score = 0;
    for (const t of tokens) if (hay.includes(t)) score += 2;
    for (const a of attendeeBits) {
      const first = a.split(/\s+/)[0];
      if (first && first.length >= 3 && hay.includes(first)) score += 3;
    }
    if (m.unread) score += 1;
    return { m, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((s) => s.m);
}

export type MeetingPrepResult = {
  spoken: string;
  board: string;
  title: string;
};

export function buildMeetingPrep(opts: {
  event: GraphCalendarEvent | null;
  relatedMail: GraphMailItem[];
  openTasks: string[];
  agendaFallback?: string[];
}): MeetingPrepResult {
  const { event, relatedMail, openTasks } = opts;

  if (!event) {
    const agenda = (opts.agendaFallback ?? []).slice(0, 3);
    if (agenda.length) {
      const board = [
        'Prep — next up',
        '',
        'From your agenda',
        ...agenda.map((l) => `• ${l}`),
        '',
        'Tasks',
        ...(openTasks.length
          ? openTasks.slice(0, 5).map((t) => `• ${t}`)
          : ['• None on the board']),
      ].join('\n');
      return {
        title: 'Prep: next up',
        spoken: `I do not have Outlook details, but your agenda starts with ${agenda[0]}. I've pinned a prep pack.`,
        board,
      };
    }
    return {
      title: 'Prep',
      spoken:
        'Nothing upcoming on the calendar to prep for. Say “catch me up” if you want the day board instead.',
      board: [
        'Prep',
        '',
        'No upcoming meeting found.',
        openTasks.length
          ? `Open tasks:\n${openTasks.slice(0, 5).map((t) => `• ${t}`).join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  const when = formatWhen(event.start);
  const mins = minutesUntil(event.start);
  const timing =
    mins <= 0
      ? 'happening now'
      : mins < 60
        ? `in about ${mins} minute${mins === 1 ? '' : 's'}`
        : `at ${when}`;

  const cleanTitle = event.title.replace(/\s*\(Teams\)\s*/g, ' ').trim();
  const attendees = (event.attendees ?? []).slice(0, 5);
  const tasks = openTasks.slice(0, 5);

  const spokenBits = [
    `Prep for ${cleanTitle} — ${timing}.`,
  ];
  if (attendees.length) {
    spokenBits.push(
      attendees.length === 1
        ? `With ${attendees[0]}.`
        : `With ${attendees.slice(0, 3).join(', ')}.`,
    );
  } else if (relatedMail.length) {
    spokenBits.push(
      relatedMail.length === 1
        ? `Related mail from ${relatedMail[0].from}.`
        : `${relatedMail.length} related messages.`,
    );
  }
  spokenBits.push("I've pinned a prep pack.");

  const boardLines: string[] = [
    `Prep: ${cleanTitle}`,
    `When: ${when}${event.isTeams ? ' · Teams' : ''}`,
  ];
  if (event.location && !/teams/i.test(event.location)) {
    boardLines.push(`Where: ${event.location}`);
  }
  boardLines.push('');

  boardLines.push('People');
  if (attendees.length) {
    for (const a of attendees) boardLines.push(`• ${a}`);
  } else {
    boardLines.push('• Not listed');
  }

  boardLines.push('', 'Context');
  if (event.preview) {
    boardLines.push(`• ${event.preview.slice(0, 180)}`);
  } else {
    boardLines.push('• No agenda text on the invite');
  }

  boardLines.push('', 'Related mail');
  if (relatedMail.length) {
    for (const m of relatedMail) {
      const flag = m.unread ? 'unread' : 'read';
      boardLines.push(`• [${flag}] ${m.from}: ${m.subject}`);
    }
  } else {
    boardLines.push('• None matched');
  }

  boardLines.push('', 'Open tasks');
  if (tasks.length) {
    for (const t of tasks) boardLines.push(`• ${t}`);
  } else {
    boardLines.push('• None on the board');
  }

  return {
    title: `Prep: ${cleanTitle}`.slice(0, 80),
    spoken: spokenBits.join(' ').replace(/\s+/g, ' ').slice(0, 400),
    board: boardLines.join('\n').slice(0, 2200),
  };
}

export function prepFromContext(context: string | undefined): {
  openTasks: string[];
  agendaFallback: string[];
} {
  return {
    openTasks: parseOpenTasksFromContext(context),
    agendaFallback: parseAgendaFromContext(context),
  };
}
