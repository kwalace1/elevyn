import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { SurfacePanel } from '../../types';

interface PanelCardProps {
  panel: SurfacePanel;
  onDismiss: (id: string) => void;
  onToggleItem: (panelId: string, itemId: string) => void;
  onTimerComplete?: (panel: SurfacePanel) => void;
}

function remainingSeconds(endsAt?: string): number {
  if (!endsAt) return 0;
  return Math.max(0, Math.round((new Date(endsAt).getTime() - Date.now()) / 1000));
}

function formatClock(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(h > 0 ? m : m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

function TimerBody({
  panel,
  onTimerComplete,
}: {
  panel: SurfacePanel;
  onTimerComplete?: (panel: SurfacePanel) => void;
}) {
  const [left, setLeft] = useState(() => remainingSeconds(panel.endsAt));
  const firedRef = useRef(false);

  useEffect(() => {
    const id = window.setInterval(() => {
      const next = remainingSeconds(panel.endsAt);
      setLeft(next);
      if (next <= 0 && !firedRef.current) {
        firedRef.current = true;
        onTimerComplete?.(panel);
        window.clearInterval(id);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [panel, onTimerComplete]);

  const done = left <= 0;
  return (
    <div className={`timer ${done ? 'timer--done' : ''}`}>
      <span className="timer__digits">{done ? 'Time' : formatClock(left)}</span>
      {!done && panel.seconds ? (
        <span className="timer__of">of {formatClock(panel.seconds)}</span>
      ) : null}
    </div>
  );
}

export function PanelCard({
  panel,
  onDismiss,
  onToggleItem,
  onTimerComplete,
}: PanelCardProps) {
  const isCapture = panel.kind === 'capture';
  const isTimer = panel.kind === 'timer';
  const isAgent = panel.kind === 'agent';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 28, scale: 0.92, filter: 'blur(10px)' }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, y: -14, scale: 0.94, filter: 'blur(6px)' }}
      transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      className={`panel-card panel-card--${panel.kind} panel-card--materialize`}
    >
      <div className="panel-card__head">
        <span className="panel-card__kind">
          {isCapture && panel.armed ? (
            <span className="rec-pip" aria-hidden />
          ) : null}
          {isCapture
            ? panel.armed
              ? 'recording'
              : 'capture'
            : isAgent
              ? 'plan'
              : panel.kind}
        </span>
        <button
          type="button"
          className="panel-card__close"
          onClick={() => onDismiss(panel.id)}
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>

      <h3 className="panel-card__title">{panel.title}</h3>

      {isTimer ? (
        <TimerBody panel={panel} onTimerComplete={onTimerComplete} />
      ) : null}

      {panel.text ? <p className="panel-card__text">{panel.text}</p> : null}

      {isAgent && panel.agentSteps?.length ? (
        <ol className="agent-steps">
          {panel.agentSteps.map((step, i) => (
            <li
              key={`${step.label}-${i}`}
              className={`agent-step agent-step--${step.status}`}
            >
              <span className="agent-step__mark" aria-hidden>
                {step.status === 'done'
                  ? '✓'
                  : step.status === 'running'
                    ? '●'
                    : step.status === 'failed'
                      ? '!'
                      : String(i + 1)}
              </span>
              <span className="agent-step__label">{step.label}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {isCapture ? (
        panel.items?.length ? (
          <ul className="panel-card__lines">
            {panel.items.map((line) => (
              <li key={line.id} className="capture-line">
                {line.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="panel-card__text muted">
            Say “note that…” — no need to address me.
          </p>
        )
      ) : null}

      {!isCapture && !isTimer && !isAgent && panel.items?.length ? (
        <ul className="panel-card__items">
          {panel.items.map((item) => (
            <li
              key={item.id}
              className={`panel-item ${item.done ? 'is-done' : ''}`}
              onClick={() => onToggleItem(panel.id, item.id)}
            >
              <span className="panel-item__box" aria-hidden>
                {item.done ? '✓' : ''}
              </span>
              <span className="panel-item__text">{item.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </motion.div>
  );
}
