import { motion } from 'framer-motion';
import type { ElevynState } from '../../types';

interface MicButtonProps {
  state: ElevynState;
  armed: boolean;
  onClick: () => void;
  onToggleArmed?: () => void;
  disabled?: boolean;
}

export function MicButton({
  state,
  armed,
  onClick,
  onToggleArmed,
  disabled,
}: MicButtonProps) {
  const listening = state === 'listening';

  return (
    <div className="mic-cluster">
      <motion.button
        type="button"
        className={`mic-button ${listening ? 'is-listening' : ''} ${armed ? 'is-armed' : ''}`}
        onClick={onClick}
        disabled={disabled}
        whileTap={{ scale: 0.96 }}
        aria-pressed={listening}
        aria-label={listening ? 'Cancel listening' : 'Talk to Elevyn'}
      >
        <span className="mic-button__icon" aria-hidden>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
            <path
              d="M12 3a3 3 0 0 0-3 3v6a3 3 0 1 0 6 0V6a3 3 0 0 0-3-3Z"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M5 11a7 7 0 0 0 14 0M12 18v3"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <span className="mic-button__text">
          {listening
            ? 'Listening…'
            : armed
              ? 'Say “Hey Elevyn”'
              : 'Wake word off'}
        </span>
      </motion.button>

      {onToggleArmed ? (
        <button
          type="button"
          className={`mic-arm ${armed ? 'is-on' : ''}`}
          onClick={onToggleArmed}
          aria-pressed={armed}
        >
          {armed ? 'Listening for wake' : 'Enable wake word'}
        </button>
      ) : null}
    </div>
  );
}
