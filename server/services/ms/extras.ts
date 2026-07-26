/**
 * Extended Microsoft Graph helpers — To Do, OneDrive, contacts,
 * presence, Teams channels, and rooms.
 */

async function graphGet<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
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
  method: 'POST' | 'PATCH',
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

// ── To Do ────────────────────────────────────────────────────────────

export type TodoTask = { id: string; title: string; status: string };

async function defaultTodoListId(accessToken: string): Promise<string> {
  const data = await graphGet<{ value?: Array<{ id?: string; wellknownListName?: string }> }>(
    accessToken,
    '/me/todo/lists?$top=20',
  );
  const lists = data.value ?? [];
  const def =
    lists.find((l) => l.wellknownListName === 'defaultList') ?? lists[0];
  if (!def?.id) throw new Error('No To Do list available');
  return def.id;
}

export async function listTodoTasks(
  accessToken: string,
  limit = 8,
): Promise<TodoTask[]> {
  const listId = await defaultTodoListId(accessToken);
  const data = await graphGet<{
    value?: Array<{ id?: string; title?: string; status?: string }>;
  }>(
    accessToken,
    `/me/todo/lists/${encodeURIComponent(listId)}/tasks?$top=${limit}&$filter=status ne 'completed'&$orderby=createdDateTime desc`,
  );
  return (data.value ?? [])
    .filter((t) => t.id && t.title)
    .map((t) => ({
      id: t.id!,
      title: t.title!.trim(),
      status: t.status ?? 'notStarted',
    }));
}

export async function createTodoTask(
  accessToken: string,
  title: string,
): Promise<TodoTask> {
  const listId = await defaultTodoListId(accessToken);
  const res = await graphSend(
    accessToken,
    'POST',
    `/me/todo/lists/${encodeURIComponent(listId)}/tasks`,
    { title: title.trim(), status: 'notStarted' },
  );
  const created = (await res.json()) as {
    id?: string;
    title?: string;
    status?: string;
  };
  return {
    id: created.id ?? 'task',
    title: created.title ?? title,
    status: created.status ?? 'notStarted',
  };
}

export function speakTodoBrief(tasks: TodoTask[]): string {
  if (!tasks.length) return 'Your Microsoft To Do list is clear.';
  if (tasks.length === 1) return `One open task: ${tasks[0].title}.`;
  const top = tasks
    .slice(0, 4)
    .map((t) => t.title)
    .join('; ');
  return `${tasks.length} open tasks. ${top}.`;
}

// ── OneDrive / files ─────────────────────────────────────────────────

export type DriveHit = { name: string; webUrl?: string; modified?: string };

export async function searchFiles(
  accessToken: string,
  query: string,
  limit = 5,
): Promise<DriveHit[]> {
  const q = query.trim();
  if (!q) return [];
  const safe = q.replace(/'/g, "''");
  const data = await graphGet<{
    value?: Array<{
      name?: string;
      webUrl?: string;
      lastModifiedDateTime?: string;
    }>;
  }>(
    accessToken,
    `/me/drive/root/search(q='${safe}')?$top=${limit}&$select=name,webUrl,lastModifiedDateTime`,
  );
  return (data.value ?? [])
    .filter((f) => f.name)
    .map((f) => ({
      name: f.name!,
      webUrl: f.webUrl,
      modified: f.lastModifiedDateTime,
    }));
}

export function speakFileHits(hits: DriveHit[], query: string): string {
  if (!hits.length) return `Nothing in OneDrive matched “${query}”.`;
  if (hits.length === 1) return `Found ${hits[0].name}.`;
  return `Found ${hits.length} files. ${hits
    .slice(0, 3)
    .map((h) => h.name)
    .join('; ')}.`;
}

// ── Contacts ─────────────────────────────────────────────────────────

export type ContactHit = { name: string; email?: string; mobile?: string };

export async function searchContacts(
  accessToken: string,
  who: string,
): Promise<ContactHit[]> {
  const needle = who.trim();
  if (!needle) return [];
  const safe = needle.replace(/'/g, "''");
  const data = await graphGet<{
    value?: Array<{
      displayName?: string;
      emailAddresses?: Array<{ address?: string }>;
      mobilePhone?: string;
    }>;
  }>(
    accessToken,
    `/me/contacts?$filter=${encodeURIComponent(
      `startswith(displayName,'${safe}') or startswith(givenName,'${safe}') or startswith(surname,'${safe}')`,
    )}&$top=5&$select=displayName,emailAddresses,mobilePhone`,
  );
  return (data.value ?? []).map((c) => ({
    name: c.displayName?.trim() || needle,
    email: c.emailAddresses?.[0]?.address?.trim(),
    mobile: c.mobilePhone?.trim(),
  }));
}

export function speakContact(c: ContactHit): string {
  const bits = [c.name];
  if (c.email) bits.push(c.email);
  if (c.mobile) bits.push(c.mobile);
  return bits.join(', ');
}

// ── Presence ─────────────────────────────────────────────────────────

const PRESENCE_LABEL: Record<string, string> = {
  Available: 'available',
  AvailableIdle: 'available',
  Away: 'away',
  BeRightBack: 'be right back',
  Busy: 'busy',
  BusyIdle: 'busy',
  DoNotDisturb: 'do not disturb',
  Offline: 'offline',
  PresenceUnknown: 'unknown',
};

export async function getPresenceForUser(
  accessToken: string,
  userIdOrUpn: string,
): Promise<string> {
  const data = await graphGet<{ availability?: string; activity?: string }>(
    accessToken,
    `/users/${encodeURIComponent(userIdOrUpn)}/presence`,
  );
  const key = data.availability ?? 'PresenceUnknown';
  return PRESENCE_LABEL[key] ?? key.toLowerCase();
}

// ── Teams channels ───────────────────────────────────────────────────

export type TeamChannel = {
  teamId: string;
  teamName: string;
  channelId: string;
  channelName: string;
};

export async function findTeamChannel(
  accessToken: string,
  teamHint: string,
  channelHint?: string,
): Promise<TeamChannel | null> {
  const teamNeedle = teamHint.trim().toLowerCase();
  const channelNeedle = (channelHint ?? 'general').trim().toLowerCase();
  if (!teamNeedle) return null;

  const teams = await graphGet<{
    value?: Array<{ id?: string; displayName?: string }>;
  }>(accessToken, '/me/joinedTeams?$select=id,displayName&$top=50');

  const team =
    (teams.value ?? []).find((t) =>
      (t.displayName ?? '').toLowerCase().includes(teamNeedle),
    ) ?? null;
  if (!team?.id) return null;

  const channels = await graphGet<{
    value?: Array<{ id?: string; displayName?: string }>;
  }>(
    accessToken,
    `/teams/${encodeURIComponent(team.id)}/channels?$select=id,displayName&$top=50`,
  );

  const channel =
    (channels.value ?? []).find((c) =>
      (c.displayName ?? '').toLowerCase().includes(channelNeedle),
    ) ??
    (channels.value ?? []).find(
      (c) => (c.displayName ?? '').toLowerCase() === 'general',
    ) ??
    channels.value?.[0];

  if (!channel?.id) return null;
  return {
    teamId: team.id,
    teamName: team.displayName?.trim() || teamHint,
    channelId: channel.id,
    channelName: channel.displayName?.trim() || 'General',
  };
}

export async function readChannelMessages(
  accessToken: string,
  teamId: string,
  channelId: string,
  limit = 5,
): Promise<string[]> {
  const data = await graphGet<{
    value?: Array<{
      body?: { content?: string };
      from?: { user?: { displayName?: string } };
    }>;
  }>(
    accessToken,
    `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages?$top=${limit}`,
  );
  return (data.value ?? [])
    .map((m) => {
      const who = m.from?.user?.displayName?.trim() || 'Someone';
      const body = (m.body?.content ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
      return body ? `${who}: ${body}` : '';
    })
    .filter(Boolean);
}

export async function postChannelMessage(
  accessToken: string,
  teamId: string,
  channelId: string,
  text: string,
): Promise<void> {
  await graphSend(
    accessToken,
    'POST',
    `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`,
    { body: { contentType: 'text', content: text } },
  );
}

// ── Rooms ────────────────────────────────────────────────────────────

export type RoomHit = { name: string; email?: string; capacity?: number };

export async function findRooms(
  accessToken: string,
  hint?: string,
): Promise<RoomHit[]> {
  const data = await graphGet<{
    value?: Array<{
      displayName?: string;
      emailAddress?: string;
      capacity?: number;
    }>;
  }>(accessToken, '/places/microsoft.graph.room?$top=25');
  let rooms = (data.value ?? []).map((r) => ({
    name: r.displayName?.trim() || 'Room',
    email: r.emailAddress?.trim(),
    capacity: r.capacity,
  }));
  const needle = hint?.trim().toLowerCase();
  if (needle) {
    rooms = rooms.filter((r) => r.name.toLowerCase().includes(needle));
  }
  return rooms.slice(0, 5);
}

export function speakRooms(rooms: RoomHit[]): string {
  if (!rooms.length) return 'I could not find any meeting rooms.';
  return rooms
    .map((r) =>
      r.capacity ? `${r.name} (fits ${r.capacity})` : r.name,
    )
    .join('; ');
}
