import type {
  CalendarEvent,
  CommandExecutionResult,
  InterpretedIntent,
  MemoryEntry,
  NotificationItem,
  SystemSnapshot,
  WeatherPlaceholder,
} from '../../types';

import { API_BASE, authHeaders } from './config';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const fetchOnce = () =>
    fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...(init?.headers ?? {}),
      },
    });

  let res: Response;
  try {
    res = await fetchOnce();
  } catch {
    // Local hot reloads and Vercel cold starts can briefly drop the first
    // connection. Retry once instead of telling Kevin the brain is unreachable.
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    res = await fetchOnce();
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export interface DashboardPayload {
  system: SystemSnapshot;
  weather: WeatherPlaceholder;
  calendar: CalendarEvent[];
  notifications: NotificationItem[];
}

export const elevynApi = {
  health: () =>
    request<{ ok: boolean; aiProvider: string | null }>('/api/health'),

  dashboard: () => request<DashboardPayload>('/api/dashboard'),

  system: () => request<SystemSnapshot>('/api/system'),

  interpret: (
    utterance: string,
    context?: string,
    awaiting?: string | null,
  ) =>
    request<{
      intent: InterpretedIntent;
      execution: CommandExecutionResult | null;
    }>('/api/interpret', {
      method: 'POST',
      body: JSON.stringify({ utterance, context, awaiting }),
    }),

  providers: () =>
    request<{
      providers: Array<{ id: string; displayName: string; available: boolean }>;
    }>('/api/providers'),

  memory: {
    list: (q?: string) =>
      request<{ entries: MemoryEntry[] }>(
        q ? `/api/memory?q=${encodeURIComponent(q)}` : '/api/memory',
      ),
  },

  calendar: () =>
    request<{
      configured: boolean;
      source?: string | null;
      events: Array<{ title: string; start: string; end?: string }>;
      error?: string;
    }>('/api/calendar'),

  microsoft: {
    status: () =>
      request<{
        configured: boolean;
        connected: boolean;
        account: string | null;
      }>('/api/msstatus'),
    logout: () =>
      request<{ ok: boolean }>('/api/mslogout', { method: 'POST' }),
    pulse: () =>
      request<{
        connected: boolean;
        configured: boolean;
        account?: string | null;
        unread: number;
        nextMeeting: { title: string; start: string; end?: string | null } | null;
        error?: string;
      }>('/api/mspulse'),
  },
};
