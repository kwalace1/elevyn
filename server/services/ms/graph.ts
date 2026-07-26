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
  title: string;
  preview: string;
  at?: string;
};

async function graphGet<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      Prefer: `outlook.timezone="${process.env.ELEVYN_TZ ?? 'America/New_York'}"`,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Graph ${res.status}: ${body.slice(0, 200) || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

function graphDate(dt?: { dateTime?: string; timeZone?: string }): string | null {
  if (!dt?.dateTime) return null;
  const raw = dt.dateTime.trim();
  // Already has offset / Z.
  if (/Z$/i.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw)) {
    const t = new Date(raw).getTime();
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  // Prefer header returns local wall time without offset — interpret in Elevyn TZ
  // by appending a pseudo parse via Date with explicit parts is hard; treat as UTC
  // label then format with Eastern in UI. Better: append offset-less as local ISO.
  const cleaned = raw.replace(/\.\d+$/, '');
  const asLocal = new Date(cleaned);
  if (Number.isFinite(asLocal.getTime())) return asLocal.toISOString();
  const asUtc = new Date(`${cleaned}Z`);
  return Number.isFinite(asUtc.getTime()) ? asUtc.toISOString() : null;
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
          title,
          preview,
          at: c.lastMessagePreview?.createdDateTime,
        };
      })
      .filter((c) => c.preview || c.title);
  } catch {
    // Chat.Read often needs admin consent — fail soft.
    return [];
  }
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
    lines.push('Teams chats: unavailable or empty (Chat.Read may need admin consent).');
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

export function speakTeamsBrief(chats: GraphChatItem[]): string {
  if (!chats.length) {
    return 'No recent Teams chats available. Your tenant may still need Chat.Read consent.';
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
