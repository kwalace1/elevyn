import { motion } from 'framer-motion';
import type { ElevynState } from '../../types';

const STATE_LABEL: Record<ElevynState, string> = {
  idle: 'Standing by',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  offline: 'Offline',
};

interface AiCoreProps {
  state: ElevynState;
  /** 0–1 speech amplitude while Elevyn is talking. */
  level?: number;
}

/**
 * Elevyn AI Core — the presence in the room.
 * Status is communicated through motion, not chrome.
 */
export function AiCore({ state, level = 0 }: AiCoreProps) {
  const isAlive = state !== 'offline';
  const isIdle = state === 'idle';
  const isThinking = state === 'thinking';
  const isSpeaking = state === 'speaking';
  const isListening = state === 'listening';
  const amp = isSpeaking ? Math.max(0.08, level) : 0;

  const pulse =
    isListening
      ? 1.12
      : isThinking
        ? 1.08
        : isSpeaking
          ? 1 + amp * 0.22
          : 1;

  return (
    <div className="ai-core" data-state={state} aria-label={`Elevyn ${STATE_LABEL[state]}`}>
      <div className="ai-core__reticle" aria-hidden>
        <span className="ai-core__tick ai-core__tick--north" />
        <span className="ai-core__tick ai-core__tick--east" />
        <span className="ai-core__tick ai-core__tick--south" />
        <span className="ai-core__tick ai-core__tick--west" />
      </div>

      {/* Thinking data bloom — expands behind the core. */}
      {isThinking ? (
        <motion.div
          className="ai-core__bloom"
          aria-hidden
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{
            opacity: [0.25, 0.55, 0.25],
            scale: [0.85, 1.25, 0.95],
            rotate: 360,
          }}
          transition={{
            opacity: { duration: 1.6, repeat: Infinity, ease: 'easeInOut' },
            scale: { duration: 2.2, repeat: Infinity, ease: 'easeInOut' },
            rotate: { duration: 12, repeat: Infinity, ease: 'linear' },
          }}
        />
      ) : null}

      <motion.div
        className="ai-core__halo"
        animate={{
          scale: isSpeaking
            ? 1 + amp * 0.35
            : isAlive
              ? isIdle
                ? [1, 1.045, 1]
                : isThinking
                  ? [1, 1.18, 1.05]
                  : [1, 1.08, 1]
              : 1,
          opacity: isSpeaking
            ? 0.35 + amp * 0.45
            : isAlive
              ? isIdle
                ? [0.28, 0.48, 0.28]
                : isThinking
                  ? [0.4, 0.7, 0.4]
                  : [0.35, 0.55, 0.35]
              : 0.15,
        }}
        transition={
          isSpeaking
            ? { duration: 0.08, ease: 'linear' }
            : {
                duration: isListening ? 1.4 : isThinking ? 1.5 : isIdle ? 5.5 : 4,
                repeat: Infinity,
                ease: 'easeInOut',
              }
        }
      />

      {/* Particulate ember ring — the burning-debris halo. */}
      <motion.div
        className="ai-core__ember"
        aria-hidden
        animate={{
          rotate: isAlive ? 360 : 0,
          opacity: isAlive
            ? isSpeaking
              ? 0.75 + amp * 0.25
              : isIdle
                ? [0.72, 0.95, 0.72]
                : 1
            : 0.25,
          scale: isSpeaking ? 1 + amp * 0.08 : 1,
        }}
        transition={{
          rotate: {
            duration: isThinking ? 28 : isIdle ? 110 : 90,
            repeat: Infinity,
            ease: 'linear',
          },
          opacity: isSpeaking
            ? { duration: 0.08 }
            : {
                duration: isIdle ? 4.5 : 1,
                repeat: isIdle ? Infinity : 0,
                ease: 'easeInOut',
              },
          scale: { duration: 0.08 },
        }}
      />
      <motion.div
        className="ai-core__ember ai-core__ember--inner"
        aria-hidden
        animate={{ rotate: isAlive ? -360 : 0 }}
        transition={{
          duration: isThinking ? 10 : isIdle ? 75 : 60,
          repeat: Infinity,
          ease: 'linear',
        }}
      />

      {/* Ambient sweep — only while standing by. */}
      {isIdle ? (
        <motion.div
          className="ai-core__ambient-sweep"
          aria-hidden
          animate={{ rotate: 360 }}
          transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
        />
      ) : null}

      <motion.div
        className="ai-core__orbit ai-core__orbit--outer"
        animate={{ rotate: isAlive ? 360 : 0 }}
        transition={{
          duration: isThinking ? 14 : isIdle ? 48 : 36,
          repeat: Infinity,
          ease: 'linear',
        }}
      >
        <span />
        <span />
        <span />
      </motion.div>

      <motion.div
        className="ai-core__ring ai-core__ring--primary"
        animate={{
          rotate: isThinking ? 360 : isIdle ? [0, 12, 0] : [0, 8, 0],
        }}
        transition={{
          duration: isThinking ? 1.8 : isIdle ? 14 : 10,
          repeat: Infinity,
          ease: isThinking ? 'linear' : 'easeInOut',
        }}
      />
      <motion.div
        className="ai-core__ring ai-core__ring--secondary"
        animate={{
          rotate: isThinking ? -360 : isIdle ? [0, -16, 0] : [0, -12, 0],
        }}
        transition={{
          duration: isThinking ? 2.6 : isIdle ? 18 : 14,
          repeat: Infinity,
          ease: isThinking ? 'linear' : 'easeInOut',
        }}
      />

      <motion.div
        className="ai-core__orb"
        animate={{
          scale: isIdle ? [1, 1.025, 1] : pulse,
          boxShadow: isSpeaking
            ? `0 0 ${40 + amp * 50}px rgba(255, 166, 42, ${0.35 + amp * 0.4}), 0 0 ${80 + amp * 80}px rgba(255, 140, 20, ${0.15 + amp * 0.25})`
            : isListening
              ? '0 0 60px rgba(255, 166, 42, 0.55), 0 0 120px rgba(255, 140, 20, 0.25)'
              : isThinking
                ? '0 0 55px rgba(255, 166, 42, 0.5), inset 0 0 50px rgba(255, 166, 42, 0.22)'
                : state === 'offline'
                  ? '0 0 20px rgba(120, 120, 120, 0.2)'
                  : '0 0 36px rgba(255, 166, 42, 0.22), 0 0 90px rgba(255, 140, 20, 0.14)',
        }}
        transition={
          isSpeaking
            ? { duration: 0.08, ease: 'linear' }
            : {
                scale: isIdle
                  ? { duration: 5.5, repeat: Infinity, ease: 'easeInOut' }
                  : { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
                boxShadow: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
              }
        }
      >
        <motion.div
          className="ai-core__core"
          animate={
            isSpeaking
              ? { scale: 1 + amp * 0.28 }
              : isListening
                ? { scale: [1, 1.05, 1] }
                : isThinking
                  ? { scale: [1, 1.12, 0.98, 1.06, 1] }
                  : { scale: 1 }
          }
          transition={
            isSpeaking
              ? { duration: 0.08, ease: 'linear' }
              : {
                  duration: isThinking ? 1.1 : 1.6,
                  repeat: isListening || isThinking ? Infinity : 0,
                  ease: 'easeInOut',
                }
          }
        />
        <div className="ai-core__scan" aria-hidden />
      </motion.div>

      <div className="ai-core__node ai-core__node--left" aria-hidden>
        <span>SYS</span>
        <i />
      </div>
      <div className="ai-core__node ai-core__node--right" aria-hidden>
        <i />
        <span>AI</span>
      </div>

      <div className="ai-core__label">
        <span className="ai-core__brand">Elevyn</span>
        <span className="ai-core__status">
          <i aria-hidden />
          {STATE_LABEL[state]}
        </span>
      </div>
    </div>
  );
}
