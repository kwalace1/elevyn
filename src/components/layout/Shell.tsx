import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useRef } from 'react';
import { AiCore } from '../orb/AiCore';
import { MicButton } from '../voice/MicButton';
import { LeftRail, RightRail } from '../dashboard/Rails';
import { FocusOverlay } from '../surface/FocusOverlay';
import { useClock } from '../../hooks/useClock';
import { useDashboard } from '../../hooks/useDashboard';
import { useElevyn } from '../../hooks/useElevyn';
import { useSurface } from '../../hooks/useSurface';
import {
  buildPresenceSnapshot,
  buildPresenceStatus,
  buildTimerNudge,
} from '../../services/presence/brief';

export function Shell() {
  const { time, date, greeting } = useClock();
  const { data } = useDashboard();
  const surface = useSurface();

  const elevyn = useElevyn({
    onWake: surface.enterFocus,
    onSurface: surface.applySurface,
    getContext: surface.getContext,
    getPanels: () => surface.panels,
    getSurfaceFlags: () => ({
      work: surface.view === 'work',
      capturing: surface.panels.some((p) => p.kind === 'capture' && Boolean(p.armed)),
    }),
  });

  const presenceStatus = useMemo(() => {
    const session = elevyn.getSessionSnapshot();
    const next = elevyn.getUpcomingAgenda()[0];
    const nextAgenda = next
      ? `${next.title} · ${new Date(next.start).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: 'America/New_York',
        })}`
      : null;
    return buildPresenceStatus(
      buildPresenceSnapshot(surface.panels, session, nextAgenda),
    );
    // Session/agenda snapshots are read live; panels + replies drive recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface.panels, elevyn.response, elevyn.transcript, elevyn.memoryEpoch]);

  const focusGreeting = useMemo(() => {
    if (elevyn.state === 'thinking') return 'One moment…';
    return `${greeting}. How may I help?`;
  }, [elevyn.state, greeting]);

  // Soft timer nudge at ~60s — once per timer, never while Elevyn is mid-exchange.
  const announceRef = useRef(elevyn.announce);
  announceRef.current = elevyn.announce;
  const nudgedTimersRef = useRef(new Set<string>());
  useEffect(() => {
    const id = window.setInterval(() => {
      for (const panel of surface.panels) {
        if (panel.kind !== 'timer' || !panel.endsAt) continue;
        const left = Math.round(
          (new Date(panel.endsAt).getTime() - Date.now()) / 1000,
        );
        if (left <= 0) {
          nudgedTimersRef.current.delete(panel.id);
          continue;
        }
        // Fire once as the countdown crosses the one-minute mark.
        if (left <= 60 && left > 45 && !nudgedTimersRef.current.has(panel.id)) {
          nudgedTimersRef.current.add(panel.id);
          announceRef.current(buildTimerNudge(left, panel.title));
        }
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [surface.panels]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (elevyn.state === 'thinking' || elevyn.state === 'speaking') return;
        elevyn.toggleListening();
      }

      if (e.code === 'Escape' && surface.view !== 'dashboard') {
        e.preventDefault();
        surface.goDashboard();
        elevyn.stopListening();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [elevyn, surface]);

  const inFocus = surface.view !== 'dashboard';

  return (
    <div className="shell" data-state={elevyn.state}>
      <div className="shell__atmosphere" aria-hidden />
      <div className="shell__grain" aria-hidden />
      <div className="shell__grid" aria-hidden />
      <div className="shell__horizon" aria-hidden />

      <header className="shell__top">
        <motion.div
          className="shell__identity"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="shell__identity-line">
            <span className="shell__sigil" aria-hidden>XI</span>
            <div>
              <div className="shell__eyebrow">Personal intelligence system</div>
              <div className="shell__brand">Elevyn</div>
            </div>
          </div>
          <div className="shell__greeting">
            <span className="shell__live-pip" aria-hidden />
            {greeting}, Kevin <span className="shell__divider">/</span>{' '}
            <span className="shell__presence-status">{presenceStatus}</span>
          </div>
        </motion.div>

        <motion.div
          className="shell__clock"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="shell__clock-label">Local time · Eastern</div>
          <div className="shell__time">{time}</div>
          <div className="shell__date">{date}</div>
        </motion.div>
      </header>

      <main className="shell__main">
        <motion.div
          className="shell__rail-wrap shell__rail-wrap--left"
          initial={{ opacity: 0, x: -18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.75, delay: 0.18 }}
        >
          <span className="shell__rail-index">01 / PRESENCE</span>
          <LeftRail
            data={data}
            aiProvider={elevyn.aiProvider}
            presenceStatus={presenceStatus}
            agenda={elevyn.getUpcomingAgenda()}
            memoryEpoch={elevyn.memoryEpoch}
          />
        </motion.div>

        <section className="shell__center">
          <div className="shell__core-kicker">
            <span>Neural interface</span>
            <i />
            <span>{elevyn.state === 'idle' ? 'Standing by' : 'Core online'}</span>
          </div>
          <AiCore state={elevyn.state} level={elevyn.voiceLevel} />
          <MicButton
            state={elevyn.state}
            armed={elevyn.armed}
            onClick={elevyn.toggleListening}
            onToggleArmed={elevyn.toggleArmed}
            disabled={elevyn.state === 'thinking' || elevyn.state === 'speaking'}
          />
          <p className="shell__hint">
            {elevyn.speechSupported
              ? elevyn.armed
                ? 'Say “Hey Elevyn” or just “Elevyn…”'
                : 'Wake word paused · click mic or press Space'
              : 'Use Chrome for voice · brain still accepts text API'}
          </p>
          <div className="shell__core-telemetry" aria-hidden>
            <span>
              PRESENCE{' '}
              <b>
                {elevyn.state === 'idle'
                  ? 'AMBIENT'
                  : elevyn.state === 'listening'
                    ? 'ATTENTIVE'
                    : elevyn.state === 'thinking'
                      ? 'PROCESSING'
                      : elevyn.state === 'speaking'
                        ? 'SPEAKING'
                        : 'OFFLINE'}
              </b>
            </span>
            <span>
              VOICE <b>{elevyn.armed ? 'ARMED' : 'PAUSED'}</b>
            </span>
            <span>
              LINK <b>{elevyn.brainOnline ? 'SECURE' : 'DOWN'}</b>
            </span>
          </div>
        </section>

        <motion.div
          className="shell__rail-wrap shell__rail-wrap--right"
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.75, delay: 0.24 }}
        >
          <span className="shell__rail-index">02 / CHANNEL</span>
          <RightRail
            data={data}
            transcript={elevyn.transcript}
            response={elevyn.response}
            state={elevyn.state}
            aiProvider={elevyn.aiProvider}
            error={elevyn.error}
            session={elevyn.getSessionSnapshot()}
            memoryEpoch={elevyn.memoryEpoch}
          />
        </motion.div>
      </main>

      <footer className="shell__footer" aria-hidden>
        <span>ELVYN.OS / BUILD 01</span>
        <span className="shell__footer-line" />
        <span>VOICE-FIRST COMMAND ENVIRONMENT</span>
        <span className="shell__footer-coord">40.7128° N / 74.0060° W</span>
      </footer>

      <AnimatePresence>
        {inFocus ? (
          <FocusOverlay
            key="focus"
            view={surface.view}
            state={elevyn.state}
            voiceLevel={elevyn.voiceLevel}
            transcript={elevyn.transcript}
            response={elevyn.response}
            panels={surface.panels}
            greeting={focusGreeting}
            clock={time}
            onExit={() => {
              surface.goDashboard();
              elevyn.stopListening();
            }}
            onDismissPanel={surface.removePanel}
            onToggleItem={surface.toggleItem}
            onTimerComplete={() => {
              elevyn.announce('Time.');
              window.setTimeout(surface.cancelTimer, 4000);
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
