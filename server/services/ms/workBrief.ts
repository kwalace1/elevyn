/**
 * Deterministic work / morning brief — Jarvis-short spoken summary + Day board
 * text for the glass. Prefers live Graph data; falls back to client context.
 */

import type { CalendarEventPayload } from '../calendar/ics.js';
import type { GraphChatItem, GraphMailItem } from './graph.js';

const TIME_ZONE = process.env.ELEVYN_TZ ?? 'America/New_York';

export function wantsWorkDayBrief(utterance: string): boolean {
  const lower = utterance.toLowerCase().trim();

  // Teams-only stays on the dedicated Teams path.
  if (/\bcatch me up on teams\b/.test(lower)) return false;
  if (/\b(any (teams )?messages|teams updates?|what'?s on teams)\b/.test(lower)) {
    return false;
  }

  // Session-only catch-up — leave for the brain.
  if (
    /\b(where were we|recap (the )?session|what (have|did) we (been )?(doing|discussing|talking about)|what'?s (going )?on with (this|the) session)\b/.test(
      lower,
    )
  ) {
    return false;
  }

  if (
    /\b(morning brief|daily brief|work brief|day brief|day board)\b/.test(lower)
  ) {
    return true;
  }
  if (
    /\b(catch me up|brief me)\b.+\b(for (the )?day|for work|on (the )?day|on work)\b/.test(
      lower,
    )
  ) {
    return true;
  }
  if (
    /\b(what'?s|what is) on\b.+\b(for work|for (the )?day)\b/.test(lower)
  ) {
    return true;
  }
  if (
    /\b(start|beginning|top) of (the )?day\b/.test(lower) ||
    /\bgive me (the |my )?(day|morning)\b/.test(lower)
  ) {
    return true;
  }

  // Plain catch-me-up / brief me → work brief (MS + board), not a chat essay.
  if (/^(please\s+)?(catch me up|brief me|status report)\.?$/i.test(lower)) {
    return true;
  }
  if (/^(please\s+)?(catch me up|brief me)\b/.test(lower)) {
    return true;
  }

  return false;
}

export function parseOpenTasksFromContext(context?: string): string[] {
  if (!context) return [];
  const tasks: string[] = [];

  const openBlock = context.match(
    /=== OPEN TASKS ===\n([\s\S]*?)(?=\n===|\s*$)/,
  );
  if (openBlock?.[1]) {
    for (const line of openBlock[1].split('\n')) {
      const m = line.match(/^\s*[-•*]\s+(.+)/);
      if (m?.[1]?.trim()) tasks.push(m[1].trim().slice(0, 120));
    }
  }

  // Fallback: TASK panel lines with unchecked boxes.
  const taskPanel = context.match(
    /TASK — [^\n]+:\n([\s\S]*?)(?=\n(?:NOTE|LIST|CAPTURE|TASK) — |\n===|\s*$)/i,
  );
  if (taskPanel?.[1]) {
    for (const line of taskPanel[1].split('\n')) {
      const m = line.match(/^\s*\[\s*\]\s+(.+)/);
      if (m?.[1]?.trim()) tasks.push(m[1].trim().slice(0, 120));
    }
  }

  return [...new Set(tasks)].slice(0, 8);
}

export function parseAgendaFromContext(context?: string): string[] {
  if (!context) return [];
  const block = context.match(
    /=== TODAY'S AGENDA ===\n([\s\S]*?)(?=\n===|\s*$)/,
  );
  if (!block?.[1]) return [];
  const lines: string[] = [];
  for (const line of block[1].split('\n')) {
    const m = line.match(/^\s*[-•*]\s+(.+)/);
    if (m?.[1]?.trim()) lines.push(m[1].trim().slice(0, 140));
  }
  return lines.slice(0, 6);
}

function dayPart(): 'morning' | 'afternoon' | 'evening' {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: TIME_ZONE,
    }).format(new Date()),
  );
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TIME_ZONE,
  });
}

function boardDateLabel(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: TIME_ZONE,
  });
}

export type WorkDayBriefInput = {
  calendar: CalendarEventPayload[];
  mail: GraphMailItem[];
  chats: GraphChatItem[];
  openTasks: string[];
  /** Agenda lines from durable memory when Graph calendar is empty. */
  agendaFallback?: string[];
};

export type WorkDayBrief = {
  spoken: string;
  board: string;
};

export function buildWorkDayBrief(input: WorkDayBriefInput): WorkDayBrief {
  const calendar = input.calendar.slice(0, 5);
  const unread = input.mail.filter((m) => m.unread);
  const chats = input.chats.slice(0, 3);
  const tasks = input.openTasks.slice(0, 5);
  const agendaLines =
    calendar.length === 0 ? (input.agendaFallback ?? []).slice(0, 5) : [];

  const part = dayPart();
  const opener =
    part === 'morning'
      ? 'Good morning'
      : part === 'afternoon'
        ? 'Good afternoon'
        : 'Good evening';

  const spokenBits: string[] = [];

  if (calendar.length === 1) {
    spokenBits.push(
      `Next up: ${calendar[0].title} at ${formatWhen(calendar[0].start)}.`,
    );
  } else if (calendar.length > 1) {
    spokenBits.push(
      `${calendar.length} on the calendar — next is ${calendar[0].title} at ${formatWhen(calendar[0].start)}.`,
    );
  } else if (agendaLines.length === 1) {
    spokenBits.push(`On your agenda: ${agendaLines[0]}.`);
  } else if (agendaLines.length > 1) {
    spokenBits.push(
      `${agendaLines.length} on your agenda — starting with ${agendaLines[0]}.`,
    );
  } else {
    spokenBits.push('Calendar looks clear from here.');
  }

  if (unread.length === 1) {
    spokenBits.push(
      `One unread from ${unread[0].from}: ${unread[0].subject}.`,
    );
  } else if (unread.length > 1) {
    const sample = unread
      .slice(0, 2)
      .map((m) => `${m.from} — ${m.subject}`)
      .join('; ');
    spokenBits.push(`${unread.length} unread. ${sample}.`);
  } else if (input.mail.length) {
    spokenBits.push('Inbox is caught up.');
  }

  if (chats.length && unread.length < 2) {
    const top = chats[0];
    const preview = top.preview.slice(0, 70).trim();
    spokenBits.push(
      preview
        ? `Teams: ${top.title} — ${preview}.`
        : `Recent Teams activity in ${top.title}.`,
    );
  }

  if (tasks.length === 1) {
    spokenBits.push(`One open task: ${tasks[0]}.`);
  } else if (tasks.length > 1) {
    spokenBits.push(`${tasks.length} open tasks on the board.`);
  }

  // Cap spoken length — opener + up to 2 cues.
  const cues = spokenBits.slice(0, 2);
  const spoken = `${opener}. ${cues.join(' ')} I've pinned a day board.`.replace(
    /\s+/g,
    ' ',
  );

  const boardLines: string[] = [`Day board — ${boardDateLabel()}`, ''];

  boardLines.push('Calendar');
  if (calendar.length) {
    for (const e of calendar) {
      boardLines.push(`• ${formatWhen(e.start)} — ${e.title}`);
    }
  } else if (agendaLines.length) {
    for (const line of agendaLines) {
      boardLines.push(`• ${line}`);
    }
  } else {
    boardLines.push('• Clear');
  }

  boardLines.push('', 'Mail');
  if (unread.length) {
    for (const m of unread.slice(0, 4)) {
      boardLines.push(`• Unread — ${m.from}: ${m.subject}`);
    }
  } else if (input.mail.length) {
    boardLines.push(`• Caught up (latest: ${input.mail[0].from})`);
  } else {
    boardLines.push('• None loaded');
  }

  boardLines.push('', 'Teams');
  if (chats.length) {
    for (const c of chats) {
      const preview = c.preview.slice(0, 90).trim() || 'recent activity';
      boardLines.push(`• ${c.title}: ${preview}`);
    }
  } else {
    boardLines.push('• Quiet');
  }

  boardLines.push('', 'Tasks');
  if (tasks.length) {
    for (const t of tasks) {
      boardLines.push(`• ${t}`);
    }
  } else {
    boardLines.push('• None on the board');
  }

  return {
    spoken: spoken.slice(0, 400),
    board: boardLines.join('\n').slice(0, 2200),
  };
}
