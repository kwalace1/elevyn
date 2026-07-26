import { useEffect, useState } from 'react';
import {
  elevynApi,
  type DashboardPayload,
} from '../services/api/client';

export function useDashboard(pollMs = 5000) {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const payload = await elevynApi.dashboard();
        if (!cancelled) {
          setData(payload);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Dashboard offline');
        }
      }
    };

    void load();
    const id = window.setInterval(load, pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [pollMs]);

  return { data, error };
}
