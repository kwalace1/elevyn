/**
 * Optional calendar feed (ICS) for Elevyn's day agenda.
 * Set ELEVYN_CALENDAR_ICS to a private Google Calendar secret address
 * (or any ICS URL). Proxied server-side to avoid browser CORS.
 */

export type CalendarEventPayload = {
  title: string;
  start: string;
  end?: string;
};

function unfoldIcs(raw: string): string {
  return raw.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

function parseIcsDate(value: string): string | null {
  // YYYYMMDD or YYYYMMDDTHHMMSSZ / YYYYMMDDTHHMMSS
  const v = value.trim();
  const m = v.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/,
  );
  if (!m) return null;
  const [, y, mo, d, hh = '00', mm = '00', ss = '00', z] = m;
  if (z === 'Z' || v.endsWith('Z')) {
    return new Date(
      Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss),
    ).toISOString();
  }
  // Floating local — treat as Eastern wall clock approx via Date constructor.
  // Good enough for "what's next" without a full TZID parser.
  return new Date(+y, +mo - 1, +d, +hh, +mm, +ss).toISOString();
}

export function parseIcsEvents(raw: string): CalendarEventPayload[] {
  const text = unfoldIcs(raw);
  const blocks = text.split('BEGIN:VEVENT').slice(1);
  const events: CalendarEventPayload[] = [];

  for (const block of blocks) {
    const body = block.split('END:VEVENT')[0] ?? '';
    const summary = body.match(/^SUMMARY[^:]*:(.*)$/m)?.[1]?.trim();
    const dtStartRaw = body.match(/^DTSTART[^:]*:(.*)$/m)?.[1]?.trim();
    const dtEndRaw = body.match(/^DTEND[^:]*:(.*)$/m)?.[1]?.trim();
    if (!summary || !dtStartRaw) continue;
    const start = parseIcsDate(dtStartRaw);
    if (!start) continue;
    const end = dtEndRaw ? parseIcsDate(dtEndRaw) ?? undefined : undefined;
    events.push({
      title: summary.replace(/\\,/g, ',').replace(/\\n/g, ' '),
      start,
      end,
    });
  }

  return events.sort((a, b) => +new Date(a.start) - +new Date(b.start));
}

export async function fetchCalendarEvents(
  icsUrl: string,
): Promise<CalendarEventPayload[]> {
  const res = await fetch(icsUrl, {
    headers: { Accept: 'text/calendar, text/plain, */*' },
  });
  if (!res.ok) {
    throw new Error(`Calendar fetch failed: ${res.status}`);
  }
  const raw = await res.text();
  const now = Date.now();
  const horizon = now + 48 * 3600_000;
  return parseIcsEvents(raw).filter((e) => {
    const t = new Date(e.start).getTime();
    const end = new Date(e.end ?? e.start).getTime();
    return end >= now - 3600_000 && t <= horizon;
  });
}
