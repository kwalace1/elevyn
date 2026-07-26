import { useCallback, useEffect, useState } from 'react';
import type {
  SurfaceCommand,
  SurfacePanel,
  SurfaceView,
} from '../types';

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function titleFrom(text: string, fallback: string): string {
  const clean = text.trim();
  if (!clean) return fallback;
  const firstLine = clean.split(/[.!?\n]/)[0].trim();
  const words = firstLine.split(/\s+/).slice(0, 6).join(' ');
  return words.length ? words : fallback;
}

const STORAGE_KEY = 'elevyn.surface.v2';

interface PersistedSurface {
  view: SurfaceView;
  panels: SurfacePanel[];
}

function loadPersisted(): PersistedSurface | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedSurface;
    if (!parsed || !Array.isArray(parsed.panels)) return null;
    // Timers that already expired shouldn't come back as live countdowns.
    const panels = parsed.panels.map((p) => {
      if (p.kind === 'timer' && p.endsAt && new Date(p.endsAt).getTime() <= Date.now()) {
        return { ...p, endsAt: new Date().toISOString(), seconds: p.seconds };
      }
      return p;
    });
    return {
      // Resting home is the ambient orb. Migrate old “dashboard home” saves.
      view: parsed.view === 'work' ? 'work' : 'focus',
      panels,
    };
  } catch {
    return null;
  }
}

/**
 * Surface store — the visual presence Elevyn projects.
 * Owns the current view (dashboard / focus / work) and the live panels
 * that voice populates. Kept separate from voice + AI so it can be reused
 * by future input sources (keyboard, gestures, remote).
 */
export function useSurface() {
  const persisted = loadPersisted();
  const [view, setView] = useState<SurfaceView>(persisted?.view ?? 'focus');
  const [panels, setPanels] = useState<SurfacePanel[]>(persisted?.panels ?? []);

  useEffect(() => {
    try {
      const payload: PersistedSurface = { view, panels };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Quota / private mode — ignore.
    }
  }, [view, panels]);

  const enterFocus = useCallback(() => {
    setView((v) => (v === 'work' ? 'work' : 'focus'));
  }, []);

  const enterWork = useCallback(() => setView('work'), []);

  const goDashboard = useCallback(() => setView('dashboard'), []);

  const clearPanels = useCallback(() => setPanels([]), []);

  const addNote = useCallback((text?: string, title?: string) => {
    const body = (text ?? '').trim();
    setPanels((prev) => [
      {
        id: uid(),
        kind: 'note',
        title: title?.trim() || titleFrom(body, 'Note'),
        text: body,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
  }, []);

  const addTask = useCallback((text?: string) => {
    const body = (text ?? '').trim();
    setPanels((prev) => {
      const existing = prev.find((p) => p.kind === 'task');
      const item = { id: uid(), text: body || 'New task', done: false };
      if (existing) {
        return prev.map((p) =>
          p.id === existing.id
            ? { ...p, items: [...(p.items ?? []), item] }
            : p,
        );
      }
      return [
        {
          id: uid(),
          kind: 'task',
          title: 'Tasks',
          items: [item],
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ];
    });
  }, []);

  const addList = useCallback((title?: string, items?: string[]) => {
    const entries = (items ?? []).map((t) => ({
      id: uid(),
      text: t,
      done: false,
    }));
    setPanels((prev) => [
      {
        id: uid(),
        kind: 'list',
        title: title?.trim() || 'List',
        items: entries,
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
  }, []);

  const addItemToLatest = useCallback((text?: string) => {
    const body = (text ?? '').trim();
    if (!body) return;
    setPanels((prev) => {
      const target = prev.find((p) => p.kind === 'list' || p.kind === 'task');
      if (!target) return prev;
      return prev.map((p) =>
        p.id === target.id
          ? { ...p, items: [...(p.items ?? []), { id: uid(), text: body, done: false }] }
          : p,
      );
    });
  }, []);

  const startCapture = useCallback(() => {
    setPanels((prev) => {
      const existing = prev.find((p) => p.kind === 'capture');
      if (existing) {
        return prev.map((p) =>
          p.id === existing.id ? { ...p, armed: true } : p,
        );
      }
      return [
        {
          id: uid(),
          kind: 'capture',
          title: 'Meeting capture',
          items: [],
          armed: true,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ];
    });
  }, []);

  const stopCapture = useCallback(() => {
    setPanels((prev) =>
      prev.map((p) => (p.kind === 'capture' ? { ...p, armed: false } : p)),
    );
  }, []);

  const appendCapture = useCallback((text?: string) => {
    const body = (text ?? '').trim();
    if (!body) return;
    const stamp = new Date().toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
    const line = { id: uid(), text: `${stamp} · ${body}`, done: false };
    setPanels((prev) => {
      const existing = prev.find((p) => p.kind === 'capture');
      if (existing) {
        return prev.map((p) =>
          p.id === existing.id
            ? { ...p, armed: true, items: [...(p.items ?? []), line] }
            : p,
        );
      }
      return [
        {
          id: uid(),
          kind: 'capture',
          title: 'Meeting capture',
          items: [line],
          armed: true,
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ];
    });
  }, []);

  const startTimer = useCallback((seconds?: number, label?: string) => {
    const secs = Math.max(1, Math.round(seconds ?? 300));
    setPanels((prev) => [
      {
        id: uid(),
        kind: 'timer',
        title: label?.trim() || 'Timer',
        seconds: secs,
        endsAt: new Date(Date.now() + secs * 1000).toISOString(),
        createdAt: new Date().toISOString(),
      },
      ...prev.filter((p) => p.kind !== 'timer'),
    ]);
  }, []);

  const cancelTimer = useCallback(() => {
    setPanels((prev) => prev.filter((p) => p.kind !== 'timer'));
  }, []);

  /** Text of on-screen panels for summarize / catch-up / model context. */
  const getContext = useCallback(() => {
    const parts = panels
      .filter((p) => p.kind !== 'timer' && p.kind !== 'agent')
      .map((p) => {
        const body = p.items?.length
          ? p.items
              .map((it) => `${it.done ? '[x]' : '[ ]'} ${it.text}`)
              .join('\n')
          : p.text ?? '';
        const armed = p.kind === 'capture' && p.armed ? ' (recording)' : '';
        return `${p.kind.toUpperCase()} — ${p.title}${armed}:\n${body}`.trim();
      })
      .filter((block) => block.split('\n').length > 1 || !block.endsWith(':'));
    return parts.length ? parts.join('\n\n') : undefined;
  }, [panels]);

  const removeLast = useCallback(() => {
    setPanels((prev) => prev.slice(1));
  }, []);

  const removePanel = useCallback((id: string) => {
    setPanels((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const toggleItem = useCallback((panelId: string, itemId: string) => {
    setPanels((prev) =>
      prev.map((p) =>
        p.id === panelId
          ? {
              ...p,
              items: p.items?.map((it) =>
                it.id === itemId ? { ...it, done: !it.done } : it,
              ),
            }
          : p,
      ),
    );
  }, []);

  /** Apply a surface command coming from the brain. */
  const applySurface = useCallback(
    (cmd: SurfaceCommand) => {
      switch (cmd.op) {
        case 'focus':
          enterFocus();
          break;
        case 'work':
          enterWork();
          break;
        case 'dashboard':
          goDashboard();
          break;
        case 'clear':
          clearPanels();
          break;
        case 'createNote':
          setView((v) => (v === 'dashboard' ? 'work' : v));
          addNote(cmd.text, cmd.title);
          break;
        case 'createTask':
          setView((v) => (v === 'dashboard' ? 'work' : v));
          addTask(cmd.text);
          break;
        case 'createList':
          setView((v) => (v === 'dashboard' ? 'work' : v));
          addList(cmd.title, cmd.items);
          break;
        case 'addItem':
          addItemToLatest(cmd.text);
          break;
        case 'removeLast':
          removeLast();
          break;
        case 'startCapture':
          setView((v) => (v === 'dashboard' ? 'work' : v));
          startCapture();
          break;
        case 'stopCapture':
          stopCapture();
          break;
        case 'appendCapture':
          setView((v) => (v === 'dashboard' ? 'work' : v));
          appendCapture(cmd.text);
          break;
        case 'timer':
          setView((v) => (v === 'dashboard' ? 'work' : v));
          startTimer(cmd.seconds, cmd.title);
          break;
        case 'cancelTimer':
          cancelTimer();
          break;
        case 'upsertAgent': {
          setView((v) => (v === 'dashboard' ? 'work' : v));
          const agentId = cmd.agentId || 'agent-active';
          const steps = cmd.agentSteps ?? [];
          setPanels((prev) => {
            const existing = prev.find((p) => p.id === agentId && p.kind === 'agent');
            const panel = {
              id: agentId,
              kind: 'agent' as const,
              title: cmd.title?.trim() || 'Plan',
              agentSteps: steps,
              items: steps.map((s, i) => ({
                id: `s${i}`,
                text: s.label,
                done: s.status === 'done',
              })),
              createdAt: existing?.createdAt ?? new Date().toISOString(),
            };
            if (existing) {
              return prev.map((p) => (p.id === agentId ? panel : p));
            }
            return [panel, ...prev.filter((p) => p.kind !== 'agent')];
          });
          break;
        }
        case 'clearAgent':
          setPanels((prev) => prev.filter((p) => p.kind !== 'agent'));
          break;
      }
    },
    [
      addItemToLatest,
      addList,
      addNote,
      addTask,
      appendCapture,
      cancelTimer,
      clearPanels,
      enterFocus,
      enterWork,
      goDashboard,
      removeLast,
      startCapture,
      startTimer,
      stopCapture,
    ],
  );

  return {
    view,
    panels,
    setView,
    enterFocus,
    enterWork,
    goDashboard,
    applySurface,
    removePanel,
    toggleItem,
    cancelTimer,
    getContext,
  };
}
