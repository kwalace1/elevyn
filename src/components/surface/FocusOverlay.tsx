import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
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
  hearAvailable?: boolean;
  onHearReply?: () => void;
  micNeedsGesture?: boolean;
  onResumeMic?: () => void;
  onExit: () => void;
  onDismissPanel: (id: string) => void;
  onToggleItem: (panelId: string, itemId: string) => void;
  onTimerComplete?: (panel: SurfacePanel) => void;
}

const STATE_HINT: Record<ElevynState, string> = {
  idle: 'Say “Hey Elevyn”',
  listening: 'Listening…',
  thinking: 'Working on it…',
  speaking: 'Talk over me anytime',
  offline: 'Offline',
};

const WORK_HINT: Record<ElevynState, string> = {
  idle: 'Say “Elevyn” anytime',
  listening: 'Listening…',
  thinking: 'Working on it…',
  speaking: 'Talk over me anytime',
  offline: 'Offline',
};

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
  hearAvailable,
  onHearReply,
  micNeedsGesture,
  onResumeMic,
  onExit: _onExit,
  onDismissPanel,
  onToggleItem,
  onTimerComplete,
}: FocusOverlayProps) {
  const work = view === 'work';
  const emptyWork = work && panels.length === 0;
  const hint = work ? WORK_HINT[state] : STATE_HINT[state];
  const capturing = panels.some((p) => p.kind === 'capture' && p.armed);

  // After a reply finishes, fade speech chrome back to the floating orb.
  const [speechSettled, setSpeechSettled] = useState(false);
  useEffect(() => {
    if (work || state !== 'idle' || !response || panels.length > 0) {
      setSpeechSettled(false);
      return;
    }
    const id = window.setTimeout(() => setSpeechSettled(true), 4500);
    return () => window.clearTimeout(id);
  }, [work, state, response, panels.length]);

  const ambient =
    !work &&
    state === 'idle' &&
    !transcript &&
    panels.length === 0 &&
    (!response || speechSettled);
  const active = !work && !ambient && (state !== 'idle' || Boolean(transcript || response));
  const showGreeting =
    !work && !ambient && (state === 'listening' || state === 'thinking');
  const showResponse = Boolean(response) && !speechSettled;

  if (work) {
    return (
      <motion.div
        className={`focus focus--work${emptyWork ? ' focus--work-empty' : ''}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="focus__atmosphere focus__atmosphere--work" aria-hidden />

        <div className="work-presence">
          <div className="work-presence__orb">
            <FocusOrb state={state} variant="work" level={voiceLevel} />
          </div>

          <div className="work-presence__meta">
            <span className="work-presence__brand">Elevyn</span>
            {capturing ? (
              <span className="work-presence__rec">
                <span className="rec-pip" aria-hidden />
                Capturing
              </span>
            ) : (
              <span className={`work-presence__state is-${state}`}>
                {STATE_LABEL[state]}
              </span>
            )}
            {clock ? <span className="work-presence__clock">{clock}</span> : null}
          </div>

          <div className="work-presence__stream">
            <AnimatePresence mode="wait">
              {transcript ? (
                <motion.p
                  key="transcript"
                  className="focus__transcript"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  “{transcript}”
                </motion.p>
              ) : response ? null : (
                <motion.p
                  key="hint"
                  className="focus__whisper"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.55 }}
                  exit={{ opacity: 0 }}
                >
                  {hint}
                </motion.p>
              )}
            </AnimatePresence>
            {response ? (
              <motion.p
                className="focus__response"
                key={response.slice(0, 24)}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {response}
              </motion.p>
            ) : null}
            {hearAvailable && onHearReply && response ? (
              <button type="button" className="mic-hear focus__hear" onClick={onHearReply}>
                Hear reply
              </button>
            ) : null}
            {micNeedsGesture && onResumeMic ? (
              <button type="button" className="mic-hear focus__resume" onClick={onResumeMic}>
                Tap to resume listening
              </button>
            ) : null}
          </div>
        </div>

        <div className="work-presence__canvas">
          {emptyWork ? (
            <motion.p
              className="work-presence__empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.45 }}
            >
              Speak a note, task, or capture — it appears here.
            </motion.p>
          ) : (
            <div className="work-presence__panels">
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
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className={`focus focus--focus${ambient ? ' focus--ambient' : ''}${active ? ' focus--active' : ''}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="focus__atmosphere" aria-hidden />

      {!ambient ? (
        <div className="focus__chrome">
          <span className="focus__chrome-left">
            <span className="focus__brand-whisper">Elevyn</span>
          </span>
          {clock ? (
            <span className="focus__chrome-right">
              <span className="focus__clock">{clock}</span>
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="focus__stage">
        <FocusOrb state={state} level={voiceLevel} />

        <AnimatePresence mode="wait">
          {showGreeting ? (
            <motion.h1
              className="focus__greeting"
              key={greeting}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.55 }}
            >
              {greeting}
            </motion.h1>
          ) : null}
        </AnimatePresence>

        <div className="focus__stream">
          <AnimatePresence mode="wait">
            {transcript ? (
              <motion.p
                key="transcript"
                className="focus__transcript"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                “{transcript}”
              </motion.p>
            ) : response && showResponse ? null : ambient ? (
              <motion.p
                key="whisper"
                className="focus__whisper"
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.55 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.2 }}
              >
                Say “Hey Elevyn”
              </motion.p>
            ) : hint ? (
              <motion.p
                key="hint"
                className="focus__hint"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                {hint}
              </motion.p>
            ) : null}
          </AnimatePresence>
          {showResponse ? (
            <motion.p
              className="focus__response"
              key={response.slice(0, 24)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              {response}
            </motion.p>
          ) : null}
          {hearAvailable && onHearReply && response ? (
            <button type="button" className="mic-hear focus__hear" onClick={onHearReply}>
              Hear reply
            </button>
          ) : null}
          {micNeedsGesture && onResumeMic ? (
            <button type="button" className="mic-hear focus__resume" onClick={onResumeMic}>
              Tap to resume listening
            </button>
          ) : null}
        </div>
      </div>

      {panels.length ? (
        <div className="focus__panel-zone">
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
