/**
 * Parse spoken agenda phrases into a concrete Eastern-time event.
 * Examples:
 *   "meeting with Sarah at 3 about pricing"
 *   "I have a call at 3pm with Alex"
 *   "schedule lunch tomorrow at noon"
 */

const TIME_ZONE = 'America/New_York';

const HOUR_WORDS: Record<string, number> = {
  noon: 12,
  midday: 12,
  midnight: 0,
};

function easternParts(base = new Date()): {
  y: number;
  m: number;
  d: number;
  hour: number;
  minute: number;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const bits = Object.fromEntries(
    fmt.formatToParts(base).map((p) => [p.type, p.value]),
  );
  return {
    y: Number(bits.year),
    m: Number(bits.month),
    d: Number(bits.day),
    hour: Number(bits.hour) % 24,
    minute: Number(bits.minute),
  };
}

/** Build an ISO instant for a wall-clock time in America/New_York. */
function zonedLocalToIso(
  y: number,
  m: number,
  d: number,
  hour: number,
  minute: number,
): string {
  // Iterate a UTC guess until the Eastern wall clock matches.
  let guess = Date.UTC(y, m - 1, d, hour + 4, minute); // EDT-ish start
  for (let i = 0; i < 4; i++) {
    const parts = easternParts(new Date(guess));
    const want = Date.UTC(y, m - 1, d, hour, minute);
    const got = Date.UTC(parts.y, parts.m - 1, parts.d, parts.hour, parts.minute);
    guess += want - got;
  }
  return new Date(guess).toISOString();
}

function parseClock(raw: string): { hour: number; minute: number } | null {
  const text = raw.trim().toLowerCase();
  if (HOUR_WORDS[text] != null) {
    return { hour: HOUR_WORDS[text], minute: 0 };
  }

  const m = text.match(
    /^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i,
  );
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const mer = (m[3] ?? '').toLowerCase().replace(/\./g, '');
  if (mer.startsWith('p') && hour < 12) hour += 12;
  if (mer.startsWith('a') && hour === 12) hour = 0;
  // Bare 1–6 without am/pm → afternoon for business hours; 7–11 → morning.
  if (!mer) {
    if (hour >= 1 && hour <= 6) hour += 12;
  }
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function dayOffset(lower: string): number {
  if (/\btomorrow\b/.test(lower)) return 1;
  if (/\btoday\b/.test(lower)) return 0;
  return 0;
}

export interface ParsedAgenda {
  title: string;
  startIso: string;
  endIso: string;
}

/**
 * Try to parse a scheduling utterance. Returns null if it doesn't look like one.
 */
export function parseSpokenAgenda(utterance: string): ParsedAgenda | null {
  const cleaned = utterance.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();

  // Must look like scheduling, not a random sentence with a time.
  const isSchedule =
    /\b(meeting|call|appointment|interview|standup|sync|lunch|dinner|coffee|demo|session)\b/.test(
      lower,
    ) ||
    /\b(i have|i'?ve got|schedule|add|put|book)\b.+\b(at|for)\b/.test(lower) ||
    /\b(add|put|schedule)\b.+\b(calendar|agenda|schedule)\b/.test(lower);

  if (!isSchedule) return null;

  const timeMatch = lower.match(
    /\b(?:at|for)\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?|noon|midnight|midday)\b/i,
  );
  if (!timeMatch) return null;

  const clock = parseClock(timeMatch[1]);
  if (!clock) return null;

  const base = easternParts();
  const offset = dayOffset(lower);
  const date = new Date(Date.UTC(base.y, base.m - 1, base.d));
  date.setUTCDate(date.getUTCDate() + offset);
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();

  const startIso = zonedLocalToIso(y, m, d, clock.hour, clock.minute);
  const endIso = new Date(new Date(startIso).getTime() + 60 * 60_000).toISOString();

  // Build a clean title from the utterance.
  let title = cleaned
    .replace(/^(?:please\s+)?(?:can you |could you )?/i, '')
    .replace(
      /^(?:i(?:'?ve| have) got|i have|schedule|add|put|book)\s+/i,
      '',
    )
    .replace(/\b(?:on my )?(?:calendar|agenda|schedule)\b/gi, '')
    .replace(/\b(?:today|tomorrow)\b/gi, '')
    .replace(
      /\b(?:at|for)\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?|noon|midnight|midday)\b/gi,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();

  title = title.replace(/^a\s+/i, '').replace(/\.$/, '');
  if (!title || title.length < 3) title = 'Event';
  // Capitalize first letter.
  title = title.charAt(0).toUpperCase() + title.slice(1);

  return { title: title.slice(0, 120), startIso, endIso };
}

export function formatAgendaWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: TIME_ZONE,
  });
}
