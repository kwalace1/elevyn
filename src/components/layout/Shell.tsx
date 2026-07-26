import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo } from 'react';
import { AiCore } from '../orb/AiCore';
import { MicButton } from '../voice/MicButton';
import { LeftRail, RightRail } from '../dashboard/Rails';
import { FocusOverlay } from '../surface/FocusOverlay';
import { useClock } from '../../hooks/useClock';
import { useDashboard } from '../../hooks/useDashboard';
import { useElevyn } from '../../hooks/useElevyn';
import { useSurface } from '../../hooks/useSurface';

export function Shell() {
  const { time, date, greeting } = useClock();
  const { data } = useDashboard();
  const surface = useSurface();

  const elevyn = useElevyn({
    onWake: surface.enterFocus,
    onSurface: surface.applySurface,
    getContext: surface.getContext,
    getSurfaceFlags: () => ({
      work: surface.view === 'work',
      capturing: surface.panels.some((p) => p.kind === 'capture' && Boolean(p.armed)),
    }),
  });

  const focusGreeting = useMemo(() => {
    if (elevyn.state === 'thinking') return 'One moment…';
    return `${greeting}. How can I help?`;
  }, [elevyn.state, greeting]);

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
    <div className="shell">
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
            {greeting}, Kevin <span className="shell__divider">/</span> All systems standing by
          </div>
        </motion.div>

        <motion.div
          className="shell__clock"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="shell__clock-label">Local time · EST</div>
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
          <span className="shell__rail-index">01 / ENVIRONMENT</span>
          <LeftRail data={data} aiProvider={elevyn.aiProvider} />
        </motion.div>

        <section className="shell__center">
          <div className="shell__core-kicker">
            <span>Neural interface</span>
            <i />
            <span>Core online</span>
          </div>
          <AiCore state={elevyn.state} />
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
            <span>LATENCY <b>12ms</b></span>
            <span>VOICE <b>ARMED</b></span>
            <span>LINK <b>SECURE</b></span>
          </div>
        </section>

        <motion.div
          className="shell__rail-wrap shell__rail-wrap--right"
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.75, delay: 0.24 }}
        >
          <span className="shell__rail-index">02 / INTELLIGENCE FEED</span>
          <RightRail
            data={data}
            transcript={elevyn.transcript}
            response={elevyn.response}
            state={elevyn.state}
            aiProvider={elevyn.aiProvider}
            error={elevyn.error}
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
