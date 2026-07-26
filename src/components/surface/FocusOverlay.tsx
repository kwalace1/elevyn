import { AnimatePresence, motion } from 'framer-motion';
import { useMemo } from 'react';
import type { ElevynState, SurfacePanel, SurfaceView } from '../../types';
import { FocusOrb } from './FocusOrb';
import { PanelCard } from './PanelCard';

interface FocusOverlayProps {
  view: SurfaceView;
  state: ElevynState;
  voiceLevel?: number;
  transcript: string;
  response: string;
  panels: SurfacePanel[];
  greeting: string;
  clock?: string;
  onExit: () => void;
  onDismissPanel: (id: string) => void;
  onToggleItem: (panelId: string, itemId: string) => void;
  onTimerComplete?: (panel: SurfacePanel) => void;
}

const STATE_HINT: Record<ElevynState, string> = {
  idle: 'Say “Hey Elevyn”',
  listening: 'Listening…',
  thinking: 'Working on it…',
  speaking: 'Speaking…',
  offline: 'Offline',
};

const WORK_HINT: Record<ElevynState, string> = {
  idle: 'Address Elevyn',
  listening: 'Listening…',
  thinking: 'Processing…',
  speaking: 'Speaking…',
  offline: 'Offline',
};

const WORK_COMMANDS = [
  { phrase: 'make a note…', label: 'Note' },
  { phrase: 'add a task…', label: 'Task' },
  { phrase: 'start capture', label: 'Capture' },
  { phrase: 'set a timer…', label: 'Timer' },
  { phrase: 'wrap up and draft', label: 'Agency' },
  { phrase: 'plan my afternoon', label: 'Plan' },
];

const STATE_LABEL: Record<ElevynState, string> = {
  idle: 'Standby',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  offline: 'Offline',
};

export function FocusOverlay({
  view,
  state,
  voiceLevel = 0,
  transcript,
  response,
  panels,
  greeting,
  clock,
  onExit,
  onDismissPanel,
  onToggleItem,
  onTimerComplete,
}: FocusOverlayProps) {
  const work = view === 'work';
  const emptyWork = work && panels.length === 0;
  const hint = work ? WORK_HINT[state] : STATE_HINT[state];
  const capturing = panels.some((p) => p.kind === 'capture' && p.armed);

  const stats = useMemo(() => {
    const notes = panels.filter((p) => p.kind === 'note').length;
    const tasks = panels.filter((p) => p.kind === 'task' || p.kind === 'list').length;
    const timers = panels.filter((p) => p.kind === 'timer').length;
    const captureLines = panels
      .filter((p) => p.kind === 'capture')
      .reduce((n, p) => n + (p.items?.length ?? 0), 0);
    return { notes, tasks, timers, captureLines, total: panels.length };
  }, [panels]);

  if (work) {
    return (
      <motion.div
        className="focus focus--work"
        initial={{ opacity: 0, scale: 0.985 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.99 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="work-surface__atmosphere" aria-hidden />
        <div className="work-surface__scanlines" aria-hidden />
        <div className="work-surface__frame" aria-hidden>
          <i />
          <i />
          <i />
          <i />
        </div>

        <header className="work-surface__chrome">
          <div className="work-surface__identity">
            <span className="work-surface__mark">WK</span>
            <div>
              <span className="work-surface__eyebrow">Operating surface</span>
              <span className="work-surface__title">
                Work mode
                {capturing ? (
                  <span className="work-surface__rec">
                    <span className="rec-pip" aria-hidden />
                    Live capture
                  </span>
                ) : null}
              </span>
            </div>
          </div>

          <div className="work-surface__stats" aria-label="Workspace stats">
            <Stat label="Objects" value={String(stats.total).padStart(2, '0')} />
            <Stat label="Notes" value={String(stats.notes).padStart(2, '0')} />
            <Stat label="Tasks" value={String(stats.tasks).padStart(2, '0')} />
            <Stat
              label="Capture"
              value={capturing ? String(stats.captureLines).padStart(2, '0') : '—'}
              live={capturing}
            />
          </div>

          <div className="work-surface__chrome-right">
            {clock ? <span className="work-surface__clock">{clock}</span> : null}
            <button type="button" className="work-surface__exit" onClick={onExit}>
              Exit to home
            </button>
          </div>
        </header>

        <div className="work-surface__body">
          <aside className="work-dock">
            <div className="work-dock__presence">
              <FocusOrb state={state} minimal variant="work" level={voiceLevel} />
              <div className="work-dock__status">
                <span className="work-dock__brand">Elevyn</span>
                <span className={`work-dock__state is-${state}`}>
                  <i aria-hidden />
                  {STATE_LABEL[state]}
                </span>
              </div>
            </div>

            <div className="work-dock__stream">
              <span className="work-dock__label">Voice channel</span>
              <p className="work-dock__you">
                {transcript || (state === 'listening' ? 'Listening for command…' : hint)}
              </p>
              {response ? <p className="work-dock__reply">{response}</p> : null}
            </div>

            <div className="work-dock__commands">
              <span className="work-dock__label">Quick commands</span>
              <ul>
                {WORK_COMMANDS.map((cmd) => (
                  <li key={cmd.phrase}>
                    <span>{cmd.label}</span>
                    <code>{cmd.phrase}</code>
                  </li>
                ))}
              </ul>
            </div>

            <div className="work-dock__hint">
              Say <b>Elevyn</b> anytime. While capturing, just say{' '}
              <b>“note that…”</b>
            </div>
          </aside>

          <main className="work-canvas">
            <div className="work-canvas__header">
              <span>Active workspace</span>
              <span>
                {emptyWork
                  ? 'Awaiting first object'
                  : `${String(stats.total).padStart(2, '0')} live objects`}
              </span>
            </div>

            {emptyWork ? (
              <div className="work-empty">
                <div className="work-empty__pulse" aria-hidden />
                <h2>Canvas clear</h2>
                <p>
                  Speak a command to populate this surface — notes, tasks,
                  capture, and timers land here as live objects.
                </p>
                <div className="work-empty__grid">
                  {WORK_COMMANDS.slice(0, 4).map((cmd) => (
                    <div key={cmd.phrase} className="work-empty__chip">
                      <span>{cmd.label}</span>
                      <code>{cmd.phrase}</code>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="work-canvas__panels">
                <AnimatePresence mode="popLayout">
                  {panels.map((panel) => (
                    <PanelCard
                      key={panel.id}
                      panel={panel}
                      onDismiss={onDismissPanel}
                      onToggleItem={onToggleItem}
                      onTimerComplete={onTimerComplete}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </main>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="focus focus--focus"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="focus__atmosphere" aria-hidden />
      <div className="focus__grid" aria-hidden />
      <div className="focus__frame" aria-hidden>
        <i />
        <i />
        <i />
        <i />
      </div>

      <div className="focus__chrome">
        <span className="focus__chrome-left">
          <span className="focus__mode-mark">XI</span>
          <span>
            <span className="focus__system-label">Elevyn neural interface</span>
            <span className="focus__mode">Focus channel / Active</span>
          </span>
        </span>
        <span className="focus__chrome-right">
          <button type="button" className="focus__exit" onClick={onExit}>
            Home
          </button>
        </span>
      </div>

      <div className="focus__stage">
        <span className="focus__stage-index" aria-hidden>
          DIRECT CHANNEL / ELEVEN
        </span>
        <FocusOrb state={state} level={voiceLevel} />

        <motion.h1
          className="focus__greeting"
          key={greeting}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          {greeting}
        </motion.h1>

        <div className="focus__stream">
          {transcript ? (
            <p className="focus__transcript">“{transcript}”</p>
          ) : hint ? (
            <p className="focus__hint">{hint}</p>
          ) : null}
          {response ? <p className="focus__response">{response}</p> : null}
        </div>
      </div>

      {panels.length ? (
        <div className="focus__panel-zone">
          <div className="focus__panel-header">
            <span>Active workspace</span>
            <span>{String(panels.length).padStart(2, '0')} objects</span>
          </div>
          <div className="focus__panels">
            <AnimatePresence mode="popLayout">
              {panels.map((panel) => (
                <PanelCard
                  key={panel.id}
                  panel={panel}
                  onDismiss={onDismissPanel}
                  onToggleItem={onToggleItem}
                  onTimerComplete={onTimerComplete}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      ) : null}
    </motion.div>
  );
}

function Stat({
  label,
  value,
  live,
}: {
  label: string;
  value: string;
  live?: boolean;
}) {
  return (
    <div className={`work-stat ${live ? 'is-live' : ''}`}>
      <span className="work-stat__label">{label}</span>
      <span className="work-stat__value">{value}</span>
    </div>
  );
}
