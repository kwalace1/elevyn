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
}

/**
 * Elevyn AI Core — the presence in the room.
 * Status is communicated through motion, not chrome.
 */
export function AiCore({ state }: AiCoreProps) {
  const isAlive = state !== 'offline';
  const isIdle = state === 'idle';
  const pulse =
    state === 'listening'
      ? 1.12
      : state === 'thinking'
        ? 1.06
        : state === 'speaking'
          ? 1.08
          : isIdle
            ? 1
            : 1;

  return (
    <div className="ai-core" data-state={state} aria-label={`Elevyn ${STATE_LABEL[state]}`}>
      <div className="ai-core__reticle" aria-hidden>
        <span className="ai-core__tick ai-core__tick--north" />
        <span className="ai-core__tick ai-core__tick--east" />
        <span className="ai-core__tick ai-core__tick--south" />
        <span className="ai-core__tick ai-core__tick--west" />
      </div>
      <motion.div
        className="ai-core__halo"
        animate={{
          scale: isAlive ? (isIdle ? [1, 1.045, 1] : [1, 1.08, 1]) : 1,
          opacity: isAlive ? (isIdle ? [0.28, 0.48, 0.28] : [0.35, 0.55, 0.35]) : 0.15,
        }}
        transition={{
          duration:
            state === 'listening'
              ? 1.4
              : state === 'thinking'
                ? 2.2
                : isIdle
                  ? 5.5
                  : 4,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />

      {/* Particulate ember ring — the burning-debris halo. */}
      <motion.div
        className="ai-core__ember"
        aria-hidden
        animate={{
          rotate: isAlive ? 360 : 0,
          opacity: isAlive ? (isIdle ? [0.72, 0.95, 0.72] : 1) : 0.25,
        }}
        transition={{
          rotate: {
            duration: isIdle ? 110 : 90,
            repeat: Infinity,
            ease: 'linear',
          },
          opacity: {
            duration: isIdle ? 4.5 : 1,
            repeat: isIdle ? Infinity : 0,
            ease: 'easeInOut',
          },
        }}
      />
      <motion.div
        className="ai-core__ember ai-core__ember--inner"
        aria-hidden
        animate={{ rotate: isAlive ? -360 : 0 }}
        transition={{
          duration:
            state === 'thinking' ? 28 : isIdle ? 75 : 60,
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
          duration: isIdle ? 48 : 36,
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
          rotate: state === 'thinking' ? 360 : isIdle ? [0, 12, 0] : [0, 8, 0],
        }}
        transition={{
          duration: state === 'thinking' ? 4 : isIdle ? 14 : 10,
          repeat: Infinity,
          ease: state === 'thinking' ? 'linear' : 'easeInOut',
        }}
      />
      <motion.div
        className="ai-core__ring ai-core__ring--secondary"
        animate={{
          rotate: state === 'thinking' ? -360 : isIdle ? [0, -16, 0] : [0, -12, 0],
        }}
        transition={{
          duration: state === 'thinking' ? 7 : isIdle ? 18 : 14,
          repeat: Infinity,
          ease: state === 'thinking' ? 'linear' : 'easeInOut',
        }}
      />

      <motion.div
        className="ai-core__orb"
        animate={{
          scale: isIdle ? [1, 1.025, 1] : pulse,
          boxShadow:
            state === 'listening'
              ? '0 0 60px rgba(255, 166, 42, 0.55), 0 0 120px rgba(255, 140, 20, 0.25)'
              : state === 'speaking'
                ? '0 0 50px rgba(255, 166, 42, 0.45), 0 0 100px rgba(255, 140, 20, 0.2)'
                : state === 'thinking'
                  ? '0 0 40px rgba(255, 166, 42, 0.35), inset 0 0 40px rgba(255, 166, 42, 0.15)'
                  : state === 'offline'
                    ? '0 0 20px rgba(120, 120, 120, 0.2)'
                    : '0 0 36px rgba(255, 166, 42, 0.22), 0 0 90px rgba(255, 140, 20, 0.14)',
        }}
        transition={{
          scale: isIdle
            ? { duration: 5.5, repeat: Infinity, ease: 'easeInOut' }
            : { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
          boxShadow: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
        }}
      >
        <motion.div
          className="ai-core__core"
          animate={
            state === 'speaking'
              ? { scale: [1, 1.08, 0.96, 1.04, 1] }
              : state === 'listening'
                ? { scale: [1, 1.05, 1] }
                : { scale: 1 }
          }
          transition={{
            duration: state === 'speaking' ? 1.1 : 1.6,
            repeat: state === 'speaking' || state === 'listening' ? Infinity : 0,
            ease: 'easeInOut',
          }}
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
