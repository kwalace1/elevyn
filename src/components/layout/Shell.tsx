import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AiCore } from '../orb/AiCore';
import { MicButton } from '../voice/MicButton';
import { LeftRail, RightRail } from '../dashboard/Rails';
import { FocusOverlay } from '../surface/FocusOverlay';
import { useClock } from '../../hooks/useClock';
import { useDashboard } from '../../hooks/useDashboard';
import { useElevyn } from '../../hooks/useElevyn';
import { useSurface } from '../../hooks/useSurface';
import { elevynApi } from '../../services/api/client';
import { API_BASE } from '../../services/api/config';
import {
  buildPresenceSnapshot,
  buildPresenceStatus,
  buildTimerNudge,
} from '../../services/presence/brief';
import { buildTimerDoneNudge } from '../../services/presence/nudges';
import { useProactiveNudges } from '../../hooks/useProactiveNudges';

export function Shell() {
  const { time, date, greeting } = useClock();
  const { data } = useDashboard();
  const surface = useSurface();
  const [microsoft, setMicrosoft] = useState<{
    configured: boolean;
    connected: boolean;
    account: string | null;
  } | null>(null);

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

  useProactiveNudges({
    announce: elevyn.announce,
    getUpcomingAgenda: elevyn.getUpcomingAgenda,
    microsoftConnected: Boolean(microsoft?.connected),
    enabled: elevyn.armed && elevyn.brainOnline,
  });

  const refreshMicrosoft = useCallback(async () => {
    try {
      setMicrosoft(await elevynApi.microsoft.status());
    } catch {
      setMicrosoft(null);
    }
  }, []);

  useEffect(() => {
    void refreshMicrosoft();
    const id = window.setInterval(() => void refreshMicrosoft(), 60_000);
    return () => window.clearInterval(id);
  }, [refreshMicrosoft, elevyn.brainOnline, elevyn.memoryEpoch]);

  // After Microsoft OAuth the page fully reloads — mic stays blocked until a tap.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('ms') !== 'connected') return;
    elevyn.noteMicrosoftConnected();
    void refreshMicrosoft();
    window.history.replaceState({}, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Always boot into ambient presence — never leave users on the systems dashboard.
  useEffect(() => {
    if (surface.view === 'dashboard') surface.enterFocus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      buildPresenceSnapshot(surface.panels, session, nextAgenda, {
        upcoming: elevyn.getUpcomingAgenda(),
        openThread: elevyn.getPrimaryThread(),
      }),
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
          // Allow Space to barge in while speaking — human cut-off.
          if (elevyn.state === 'thinking') return;
          elevyn.toggleListening();
        }

      if (e.code === 'Escape' && surface.view === 'work') {
        e.preventDefault();
        surface.enterFocus();
        elevyn.stopListening();
      } else if (e.code === 'Escape' && surface.view === 'dashboard') {
        e.preventDefault();
        surface.enterFocus();
        elevyn.stopListening();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [elevyn, surface]);

  const showSystems = surface.view === 'dashboard';
  const inPresence = surface.view !== 'dashboard';

  return (
    <div className="shell" data-state={elevyn.state} data-surface={surface.view}>
      <div className="shell__atmosphere" aria-hidden />
      <div className="shell__grain" aria-hidden />
      {showSystems ? (
        <>
          <div className="shell__grid" aria-hidden />
          <div className="shell__horizon" aria-hidden />
        </>
      ) : null}

      {showSystems ? (
        <>
          <header className="shell__top">
            <motion.div
              className="shell__identity"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="shell__identity-line">
                <span className="shell__sigil" aria-hidden>
                  XI
                </span>
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
                microsoft={microsoft}
                onConnectMicrosoft={() => {
                  window.location.assign(`${API_BASE}/api/mslogin`);
                }}
                onDisconnectMicrosoft={() => {
                  void elevynApi.microsoft.logout().then(() => refreshMicrosoft());
                }}
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
                onUnlockAudio={elevyn.unlockAudio}
                onHearReply={elevyn.hearReply}
                hearAvailable={elevyn.hearAvailable || (elevyn.isAppleTouch && Boolean(elevyn.response))}
                disabled={elevyn.state === 'thinking'}
              />
              <p className="shell__hint">
                {elevyn.micNeedsGesture
                  ? 'Outlook connected — tap the mic once to resume wake word'
                  : elevyn.speechSupported
                    ? elevyn.isAppleTouch
                      ? elevyn.hearAvailable || elevyn.response
                        ? 'If it’s silent, tap Hear reply — check the side mute switch too'
                        : elevyn.armed
                          ? 'Say “Hey Elevyn” or tap the mic'
                          : 'Tap mic to talk · enable wake if you want hands-free'
                      : elevyn.armed
                        ? 'Say “Hey Elevyn”, “Eleven”, or “11”…'
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
        </>
      ) : null}

      <AnimatePresence>
        {inPresence ? (
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
            hearAvailable={
              elevyn.hearAvailable || (elevyn.isAppleTouch && Boolean(elevyn.response))
            }
            onHearReply={elevyn.hearReply}
            micNeedsGesture={elevyn.micNeedsGesture}
            onResumeMic={elevyn.toggleListening}
            onExit={() => {
              surface.enterFocus();
              elevyn.stopListening();
            }}
            onDismissPanel={surface.removePanel}
            onToggleItem={surface.toggleItem}
            onTimerComplete={() => {
              elevyn.announce(buildTimerDoneNudge(
                surface.panels.find((p) => p.kind === 'timer')?.title,
              ));
              window.setTimeout(surface.cancelTimer, 4000);
            }}
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
