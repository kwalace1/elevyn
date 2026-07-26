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
    await new Promise((resolve) => window.setTimeout(resolve, 450));
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

  interpret: (utterance: string, context?: string) =>
    request<{
      intent: InterpretedIntent;
      execution: CommandExecutionResult | null;
    }>('/api/ai/interpret', {
      method: 'POST',
      body: JSON.stringify({ utterance, context }),
    }),

  providers: () =>
    request<{
      providers: Array<{ id: string; displayName: string; available: boolean }>;
    }>('/api/ai/providers'),

  memory: {
    list: (q?: string) =>
      request<{ entries: MemoryEntry[] }>(
        q ? `/api/memory?q=${encodeURIComponent(q)}` : '/api/memory',
      ),
  },
};
