/**
 * Microsoft Graph helpers — calendar, mail, Teams chats.
 */

import type { CalendarEventPayload } from '../calendar/ics.js';

export type GraphMailItem = {
  subject: string;
  from: string;
  received: string;
  preview: string;
  unread: boolean;
};

export type GraphChatItem = {
  id?: string;
  title: string;
  preview: string;
  at?: string;
};

async function graphGet<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      // UTC so dateTime includes Z / offset — avoids wall-clock-as-UTC bugs on the server.
      Prefer: 'outlook.timezone="UTC"',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Graph ${res.status}: ${body.slice(0, 200) || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function graphSend(
  accessToken: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<Response> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Graph ${res.status}: ${text.slice(0, 240) || res.statusText}`);
  }
  return res;
}

const ELEVYN_TZ = () => process.env.ELEVYN_TZ ?? 'America/New_York';

/** Wall-clock parts in Elevyn TZ for a UTC ISO instant. */
function wallPartsInTz(iso: string, timeZone = ELEVYN_TZ()): {
  dateTime: string;
  timeZone: string;
} {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const bits = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value]),
  );
  const hour = Number(bits.hour) % 24;
  const dateTime = `${bits.year}-${bits.month}-${bits.day}T${String(hour).padStart(2, '0')}:${bits.minute}:${bits.second}`;
  return { dateTime, timeZone };
}

/** Convert a wall-clock time in `timeZone` to a real UTC ISO instant. */
function zonedWallToIso(
  y: number,
  m: number,
  d: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): string {
  let guess = Date.UTC(y, m - 1, d, hour + 4, minute, second);
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
        .formatToParts(new Date(guess))
        .map((p) => [p.type, p.value]),
    );
    const want = Date.UTC(y, m - 1, d, hour, minute, second);
    const got = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second),
    );
    guess += want - got;
  }
  return new Date(guess).toISOString();
}

function graphDate(dt?: { dateTime?: string; timeZone?: string }): string | null {
  if (!dt?.dateTime) return null;
  const raw = dt.dateTime.trim();
  // Already has offset / Z.
  if (/Z$/i.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw)) {
    const t = new Date(raw).getTime();
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  // Offset-less wall clock (legacy Prefer, or some tenants) — honor timeZone.
  const cleaned = raw.replace(/\.\d+$/, '');
  const m = cleaned.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!m) return null;
  const tz =
    dt.timeZone || process.env.ELEVYN_TZ || 'America/New_York';
  return zonedWallToIso(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? 0),
    tz,
  );
}

export async function fetchGraphCalendar(
  accessToken: string,
): Promise<CalendarEventPayload[]> {
  const now = new Date();
  const end = new Date(now.getTime() + 48 * 3600_000);
  const startIso = now.toISOString();
  const endIso = end.toISOString();
  const query =
    `/me/calendarView?startDateTime=${encodeURIComponent(startIso)}` +
    `&endDateTime=${encodeURIComponent(endIso)}` +
    `&$select=subject,start,end,location,onlineMeeting,isOnlineMeeting,bodyPreview` +
    `&$orderby=start/dateTime` +
    `&$top=25`;

  const data = await graphGet<{
    value?: Array<{
      subject?: string;
      start?: { dateTime?: string; timeZone?: string };
      end?: { dateTime?: string; timeZone?: string };
      location?: { displayName?: string };
      isOnlineMeeting?: boolean;
      onlineMeeting?: { joinUrl?: string };
    }>;
  }>(accessToken, query);

  const events: CalendarEventPayload[] = [];
  for (const item of data.value ?? []) {
    const start = graphDate(item.start);
    if (!start || !item.subject) continue;
    const endAt = graphDate(item.end) ?? undefined;
    const joinUrl = item.onlineMeeting?.joinUrl;
    const location = item.location?.displayName?.trim();
    let title = item.subject.trim();
    if (joinUrl && !/teams/i.test(title)) {
      title = `${title} (Teams)`;
    } else if (location && location.toLowerCase() !== 'microsoft teams meeting') {
      title = `${title} · ${location}`;
    }
    events.push({ title, start, end: endAt });
  }
  return events;
}

export async function fetchRecentMail(
  accessToken: string,
  limit = 6,
): Promise<GraphMailItem[]> {
  const path =
    `/me/messages?$top=${limit}` +
    `&$select=subject,from,receivedDateTime,bodyPreview,isRead` +
    `&$orderby=receivedDateTime desc`;
  const data = await graphGet<{
    value?: Array<{
      subject?: string;
      from?: { emailAddress?: { name?: string; address?: string } };
      receivedDateTime?: string;
      bodyPreview?: string;
      isRead?: boolean;
    }>;
  }>(accessToken, path);

  return (data.value ?? []).map((m) => ({
    subject: (m.subject ?? '(no subject)').trim(),
    from:
      m.from?.emailAddress?.name?.trim() ||
      m.from?.emailAddress?.address?.trim() ||
      'Unknown',
    received: m.receivedDateTime ?? '',
    preview: (m.bodyPreview ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
    unread: m.isRead === false,
  }));
}

export async function fetchRecentTeamsChats(
  accessToken: string,
  limit = 6,
): Promise<GraphChatItem[]> {
  try {
    const data = await graphGet<{
      value?: Array<{
        id?: string;
        topic?: string;
        chatType?: string;
        lastMessagePreview?: {
          body?: { content?: string };
          createdDateTime?: string;
          from?: { user?: { displayName?: string } };
        };
      }>;
    }>(
      accessToken,
      `/me/chats?$expand=lastMessagePreview&$top=${limit}`,
    );

    return (data.value ?? [])
      .map((c) => {
        const who = c.lastMessagePreview?.from?.user?.displayName?.trim();
        const body = (c.lastMessagePreview?.body?.content ?? '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 140);
        const title =
          c.topic?.trim() ||
          (c.chatType === 'oneOnOne' ? who || 'Chat' : 'Teams chat');
        const preview = who && body ? `${who}: ${body}` : body || who || '';
        return {
          id: c.id,
          title,
          preview,
          at: c.lastMessagePreview?.createdDateTime,
        };
      })
      .filter((c) => c.preview || c.title);
  } catch {
    // Chat.Read / Chat.ReadWrite often needs admin consent — fail soft.
    return [];
  }
}

export type GraphPerson = {
  name: string;
  email: string;
};

/** Resolve a person by spoken name (People API → directory → recent mail). */
export async function findPerson(
  accessToken: string,
  who: string,
): Promise<GraphPerson | null> {
  const needle = who.trim();
  if (!needle) return null;

  // 1) People suggestions
  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/me/people?$search=${encodeURIComponent(`"${needle}"`)}&$top=5`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          ConsistencyLevel: 'eventual',
        },
      },
    );
    if (res.ok) {
      const data = (await res.json()) as {
        value?: Array<{
          displayName?: string;
          scoredEmailAddresses?: Array<{ address?: string }>;
        }>;
      };
      for (const p of data.value ?? []) {
        const email = p.scoredEmailAddresses?.[0]?.address?.trim();
        const name = p.displayName?.trim() || needle;
        if (email) return { name, email };
      }
    }
  } catch {
    // People.Read may be missing — continue.
  }

  // 2) Directory users
  try {
    const safe = needle.replace(/'/g, "''");
    const data = await graphGet<{
      value?: Array<{ displayName?: string; mail?: string; userPrincipalName?: string }>;
    }>(
      accessToken,
      `/users?$filter=${encodeURIComponent(
        `startswith(displayName,'${safe}') or startswith(givenName,'${safe}') or startswith(surname,'${safe}')`,
      )}&$select=displayName,mail,userPrincipalName&$top=5`,
    );
    for (const u of data.value ?? []) {
      const email = (u.mail || u.userPrincipalName || '').trim();
      const name = u.displayName?.trim() || needle;
      if (email.includes('@')) return { name, email };
    }
  } catch {
    // User.Read.All may be missing — continue.
  }

  // 3) Recent mail from/to
  try {
    const mail = await fetchRecentMail(accessToken, 20);
    const lower = needle.toLowerCase();
    const hit = mail.find((m) => m.from.toLowerCase().includes(lower));
    if (hit) {
      // from is display name — try to pull address from Graph message list again
      const data = await graphGet<{
        value?: Array<{
          from?: { emailAddress?: { name?: string; address?: string } };
        }>;
      }>(
        accessToken,
        `/me/messages?$top=25&$select=from&$orderby=receivedDateTime desc`,
      );
      for (const m of data.value ?? []) {
        const name = m.from?.emailAddress?.name?.trim() ?? '';
        const address = m.from?.emailAddress?.address?.trim() ?? '';
        if (
          address &&
          (name.toLowerCase().includes(lower) ||
            address.toLowerCase().includes(lower))
        ) {
          return { name: name || needle, email: address };
        }
      }
    }
  } catch {
    // ignore
  }

  // Bare email spoken/typed
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(needle)) {
    return { name: needle, email: needle };
  }

  return null;
}

export type GraphChatRef = {
  id: string;
  title: string;
};

/** Find a Teams chat by topic / member name. */
export async function findTeamsChat(
  accessToken: string,
  who: string,
): Promise<GraphChatRef | null> {
  const needle = who.trim().toLowerCase();
  if (!needle) return null;

  const data = await graphGet<{
    value?: Array<{
      id?: string;
      topic?: string;
      chatType?: string;
      members?: Array<{ displayName?: string }>;
    }>;
  }>(
    accessToken,
    `/me/chats?$expand=members&$top=40`,
  );

  for (const c of data.value ?? []) {
    if (!c.id) continue;
    const topic = (c.topic ?? '').toLowerCase();
    if (topic && topic.includes(needle)) {
      return { id: c.id, title: c.topic!.trim() };
    }
    const member = (c.members ?? []).find((m) =>
      (m.displayName ?? '').toLowerCase().includes(needle),
    );
    if (member?.displayName) {
      return { id: c.id, title: member.displayName.trim() };
    }
  }

  // Fallback: recent chat titles from brief helper
  const recent = await fetchRecentTeamsChats(accessToken, 20);
  const hit = recent.find(
    (c) => c.id && c.title.toLowerCase().includes(needle),
  );
  if (hit?.id) return { id: hit.id, title: hit.title };
  return null;
}

export async function createCalendarEvent(
  accessToken: string,
  opts: {
    subject: string;
    startIso: string;
    endIso: string;
    body?: string;
    attendeeEmails?: string[];
    teamsMeeting?: boolean;
  },
): Promise<{ id: string; subject: string; webLink?: string }> {
  const start = wallPartsInTz(opts.startIso);
  const end = wallPartsInTz(opts.endIso);
  const payload: Record<string, unknown> = {
    subject: opts.subject,
    body: {
      contentType: 'Text',
      content: opts.body?.trim() || opts.subject,
    },
    start,
    end,
    attendees: (opts.attendeeEmails ?? []).map((address) => ({
      emailAddress: { address },
      type: 'required',
    })),
  };
  if (opts.teamsMeeting) {
    payload.isOnlineMeeting = true;
    payload.onlineMeetingProvider = 'teamsForBusiness';
  }

  const res = await graphSend(accessToken, 'POST', '/me/events', payload);
  const created = (await res.json()) as {
    id?: string;
    subject?: string;
    webLink?: string;
  };
  return {
    id: created.id ?? 'event',
    subject: created.subject ?? opts.subject,
    webLink: created.webLink,
  };
}

export async function sendMail(
  accessToken: string,
  opts: { to: string; subject: string; body: string },
): Promise<void> {
  await graphSend(accessToken, 'POST', '/me/sendMail', {
    message: {
      subject: opts.subject,
      body: { contentType: 'Text', content: opts.body },
      toRecipients: [{ emailAddress: { address: opts.to } }],
    },
    saveToSentItems: true,
  });
}

export async function sendTeamsMessage(
  accessToken: string,
  chatId: string,
  text: string,
): Promise<void> {
  await graphSend(accessToken, 'POST', `/chats/${encodeURIComponent(chatId)}/messages`, {
    body: { contentType: 'text', content: text },
  });
}

/** Spoken / context block for catch-me-up and mail/Teams intents. */
export async function buildMicrosoftBrief(accessToken: string): Promise<string> {
  const [mail, chats, calendar] = await Promise.all([
    fetchRecentMail(accessToken, 5).catch(() => [] as GraphMailItem[]),
    fetchRecentTeamsChats(accessToken, 5).catch(() => [] as GraphChatItem[]),
    fetchGraphCalendar(accessToken).catch(() => [] as CalendarEventPayload[]),
  ]);

  const lines: string[] = ['=== MICROSOFT 365 ==='];

  if (calendar.length) {
    lines.push('Calendar (next 48h):');
    for (const e of calendar.slice(0, 5)) {
      const when = new Date(e.start).toLocaleString('en-US', {
        weekday: 'short',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: process.env.ELEVYN_TZ ?? 'America/New_York',
      });
      lines.push(`- ${when}: ${e.title}`);
    }
  } else {
    lines.push('Calendar: nothing in the next 48 hours.');
  }

  if (mail.length) {
    const unread = mail.filter((m) => m.unread).length;
    lines.push(
      unread
        ? `Outlook mail (${unread} unread in recent):`
        : 'Outlook mail (recent):',
    );
    for (const m of mail) {
      const flag = m.unread ? 'unread' : 'read';
      lines.push(`- [${flag}] From ${m.from}: ${m.subject} — ${m.preview}`);
    }
  } else {
    lines.push('Outlook mail: none loaded.');
  }

  if (chats.length) {
    lines.push('Teams chats (recent):');
    for (const c of chats) {
      lines.push(`- ${c.title}: ${c.preview}`);
    }
  } else {
    lines.push(
      'Teams chats: unavailable or empty (Chat.ReadWrite may need admin consent).',
    );
  }

  return lines.join('\n');
}

export function speakMailBrief(mail: GraphMailItem[]): string {
  if (!mail.length) return 'No recent Outlook mail to report.';
  const unread = mail.filter((m) => m.unread);
  if (!unread.length) {
    const top = mail[0];
    return `Inbox is caught up. Latest was from ${top.from}: ${top.subject}.`;
  }
  if (unread.length === 1) {
    const m = unread[0];
    return `One unread from ${m.from}: ${m.subject}.`;
  }
  const names = unread
    .slice(0, 3)
    .map((m) => `${m.from} — ${m.subject}`)
    .join('; ');
  return `${unread.length} unread. ${names}.`;
}

export function speakCalendarBrief(events: CalendarEventPayload[]): string {
  if (!events.length) {
    return 'Nothing on your Outlook calendar in the next couple of days.';
  }
  const tz = process.env.ELEVYN_TZ ?? 'America/New_York';
  const lines = events.slice(0, 5).map((e) => {
    const when = new Date(e.start).toLocaleString('en-US', {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: tz,
    });
    return `${when}: ${e.title}`;
  });
  if (lines.length === 1) return `Next up: ${lines[0]}.`;
  return `You have ${events.length} upcoming. ${lines.join('. ')}.`;
}

export function speakTeamsBrief(chats: GraphChatItem[]): string {
  if (!chats.length) {
    return 'No recent Teams chats available. Your tenant may still need Chat.ReadWrite consent.';
  }
  const top = chats.slice(0, 3);
  const bits = top.map((c) => `${c.title}: ${c.preview.slice(0, 80)}`);
  return `Recent Teams activity. ${bits.join(' ')}`;
}

export function mailFromSender(mail: GraphMailItem[], who: string): string {
  const needle = who.toLowerCase();
  const hits = mail.filter(
    (m) =>
      m.from.toLowerCase().includes(needle) ||
      m.subject.toLowerCase().includes(needle),
  );
  if (!hits.length) return `Nothing recent from ${who}.`;
  const m = hits[0];
  return `From ${m.from}: ${m.subject}. ${m.preview}`;
}
