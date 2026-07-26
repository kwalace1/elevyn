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
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
  });

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
