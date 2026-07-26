import { motion } from 'framer-motion';
import type { ElevynState } from '../../types';

interface FocusOrbProps {
  state: ElevynState;
  /** Compact presence for docks / side rails. */
  minimal?: boolean;
  /** Work mode shifts the core to amber — instantly distinct from home cyan. */
  variant?: 'focus' | 'work';
  /** 0–1 speech amplitude while Elevyn is talking. */
  level?: number;
}

/**
 * Focus / work presence.
 * Work mode uses a living amber core so the OS feels like a different surface.
 */
export function FocusOrb({
  state,
  minimal,
  variant = 'focus',
  level = 0,
}: FocusOrbProps) {
  const listening = state === 'listening';
  const speaking = state === 'speaking';
  const thinking = state === 'thinking';
  const work = variant === 'work';
  const amp = speaking ? Math.max(0.08, level) : 0;

  return (
    <div
      className={`focus-orb ${minimal ? 'focus-orb--compact' : ''} ${work ? 'focus-orb--work' : ''}`}
      data-state={state}
      aria-label={`Elevyn ${state}`}
    >
      {thinking ? (
        <motion.div
          className="focus-orb__bloom"
          aria-hidden
          animate={{
            opacity: [0.2, 0.55, 0.2],
            scale: [0.9, 1.35, 1],
            rotate: 360,
          }}
          transition={{
            opacity: { duration: 1.4, repeat: Infinity, ease: 'easeInOut' },
            scale: { duration: 1.8, repeat: Infinity, ease: 'easeInOut' },
            rotate: { duration: 10, repeat: Infinity, ease: 'linear' },
          }}
        />
      ) : null}
      <motion.div
        className="focus-orb__aura"
        animate={{
          scale: speaking
            ? 1 + amp * 0.4
            : listening
              ? [1, 1.22, 1]
              : thinking
                ? [1, 1.2, 1]
                : [1, 1.07, 1],
          opacity: speaking
            ? 0.4 + amp * 0.45
            : thinking
              ? [0.35, 0.85, 0.35]
              : [0.42, 0.72, 0.42],
        }}
        transition={
          speaking
            ? { duration: 0.08, ease: 'linear' }
            : {
                duration: listening ? 1.15 : thinking ? 1.2 : 3.1,
                repeat: Infinity,
                ease: 'easeInOut',
              }
        }
      />
      <motion.div
        className="focus-orb__ring focus-orb__ring--primary"
        animate={{
          rotate: thinking ? 360 : listening ? 180 : work ? [0, 12, 0] : 0,
        }}
        transition={{
          duration: thinking ? 1.6 : listening ? 8 : 14,
          repeat: Infinity,
          ease: thinking || listening ? 'linear' : 'easeInOut',
        }}
      />
      {work ? (
        <motion.div
          className="focus-orb__ring focus-orb__ring--secondary"
          animate={{ rotate: thinking ? -360 : [0, -18, 0] }}
          transition={{
            duration: thinking ? 2.4 : 18,
            repeat: Infinity,
            ease: thinking ? 'linear' : 'easeInOut',
          }}
        />
      ) : null}
      <motion.div
        className="focus-orb__core"
        animate={
          speaking
            ? { scale: 1 + amp * 0.32 }
            : listening
              ? { scale: [1, 1.08, 1] }
              : thinking
                ? { scale: [1, 1.1, 0.97, 1.05, 1] }
                : { scale: 1 }
        }
        transition={
          speaking
            ? { duration: 0.08, ease: 'linear' }
            : {
                duration: thinking ? 0.95 : 1.55,
                repeat: speaking || listening || thinking ? Infinity : 0,
                ease: 'easeInOut',
              }
        }
      />
      {work ? <span className="focus-orb__scan" aria-hidden /> : null}
    </div>
  );
}
