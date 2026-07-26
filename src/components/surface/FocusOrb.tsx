import { motion } from 'framer-motion';
import type { ElevynState } from '../../types';

interface FocusOrbProps {
  state: ElevynState;
  /** Compact presence for docks / side rails. */
  minimal?: boolean;
  /** Work mode shifts the core to amber — instantly distinct from home cyan. */
  variant?: 'focus' | 'work';
}

/**
 * Focus / work presence.
 * Work mode uses a living amber core so the OS feels like a different surface.
 */
export function FocusOrb({ state, minimal, variant = 'focus' }: FocusOrbProps) {
  const listening = state === 'listening';
  const speaking = state === 'speaking';
  const thinking = state === 'thinking';
  const work = variant === 'work';

  return (
    <div
      className={`focus-orb ${minimal ? 'focus-orb--compact' : ''} ${work ? 'focus-orb--work' : ''}`}
      data-state={state}
      aria-label={`Elevyn ${state}`}
    >
      <motion.div
        className="focus-orb__aura"
        animate={{
          scale: listening ? [1, 1.22, 1] : thinking ? [1, 1.12, 1] : [1, 1.07, 1],
          opacity: thinking ? [0.35, 0.8, 0.35] : [0.42, 0.72, 0.42],
        }}
        transition={{
          duration: listening ? 1.15 : thinking ? 1.5 : 3.1,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
      <motion.div
        className="focus-orb__ring focus-orb__ring--primary"
        animate={{ rotate: thinking ? 360 : listening ? 180 : work ? [0, 12, 0] : 0 }}
        transition={{
          duration: thinking ? 3.6 : listening ? 8 : 14,
          repeat: Infinity,
          ease: thinking || listening ? 'linear' : 'easeInOut',
        }}
      />
      {work ? (
        <motion.div
          className="focus-orb__ring focus-orb__ring--secondary"
          animate={{ rotate: thinking ? -360 : [0, -18, 0] }}
          transition={{
            duration: thinking ? 6 : 18,
            repeat: Infinity,
            ease: thinking ? 'linear' : 'easeInOut',
          }}
        />
      ) : null}
      <motion.div
        className="focus-orb__core"
        animate={
          speaking
            ? { scale: [1, 1.14, 0.95, 1.08, 1] }
            : listening
              ? { scale: [1, 1.08, 1] }
              : thinking
                ? { scale: [1, 1.05, 1] }
                : { scale: 1 }
        }
        transition={{
          duration: speaking ? 0.95 : thinking ? 1.15 : 1.55,
          repeat: speaking || listening || thinking ? Infinity : 0,
          ease: 'easeInOut',
        }}
      />
      {work ? <span className="focus-orb__scan" aria-hidden /> : null}
    </div>
  );
}
