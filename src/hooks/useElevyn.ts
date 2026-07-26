import { useCallback, useEffect, useRef, useState } from 'react';
import type { ElevynState, SurfaceCommand } from '../types';
import { elevynApi } from '../services/api/client';
import { BrowserSpeechRecognition } from '../services/voice/recognition';
import { ElevynSpeech } from '../services/voice/elevynSpeech';
import { SessionMemory } from '../services/session/memory';
import { matchAddress, matchCaptureShortcut } from '../utils/wakeWord';

type ListenPhase = 'wake' | 'command';

export interface ElevynHooks {
  /** Fired when Elevyn is woken (wake word or manual mic). */
  onWake?: () => void;
  /** Fired when the brain returns a surface action. */
  onSurface?: (cmd: SurfaceCommand) => void;
  /** Supplies on-screen context (notes/capture) for summarize + recall. */
  getContext?: () => string | undefined;
  /** Live surface flags (work mode / capture armed) — survives refresh. */
  getSurfaceFlags?: () => { work: boolean; capturing: boolean };
}

/**
 * Elevyn interaction loop:
 * Wake ("Hey Elevyn" / "Hey Eleven") → Listen → Think → Act → Speak → Wake
 */
export function useElevyn(hooks: ElevynHooks = {}) {
  const [state, setState] = useState<ElevynState>('idle');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [brainOnline, setBrainOnline] = useState(false);
  const [aiProvider, setAiProvider] = useState<string | null>(null);
  const [armed, setArmed] = useState(true);

  const recognitionRef = useRef(new BrowserSpeechRecognition());
  const ttsRef = useRef(new ElevynSpeech());
  const sessionRef = useRef(new SessionMemory());
  const processingRef = useRef(false);
  const phaseRef = useRef<ListenPhase>('wake');
  const stateRef = useRef<ElevynState>('idle');
  const armedRef = useRef(true);
  const brainOnlineRef = useRef(false);
  const commandTimeoutRef = useRef<number | null>(null);
  const restartTimerRef = useRef<number | null>(null);
  const commandDebounceRef = useRef<number | null>(null);
  const pendingCommandRef = useRef('');
  const wakeCommitRef = useRef<number | null>(null);
  // When Elevyn asks a question ("what should the note say?"), it stores the
  // slot it's waiting to fill so the next utterance answers it directly.
  const pendingAwaitRef = useRef<'note' | 'task' | 'list' | 'timer' | null>(null);
  const resumeConversationRef = useRef<() => void>(() => {});
  // In work mode Elevyn listens for its name (Elevyn / Eleven) mid-utterance.
  // While capture is armed, "note that…" also fires without the name.
  const workModeRef = useRef(false);
  const captureArmedRef = useRef(false);

  const startWakeListeningRef = useRef<() => void>(() => {});
  const startCommandListeningRef = useRef<() => void>(() => {});

  const onWakeRef = useRef<ElevynHooks['onWake']>(hooks.onWake);
  const onSurfaceRef = useRef<ElevynHooks['onSurface']>(hooks.onSurface);
  const getContextRef = useRef<ElevynHooks['getContext']>(hooks.getContext);
  const getSurfaceFlagsRef = useRef<ElevynHooks['getSurfaceFlags']>(
    hooks.getSurfaceFlags,
  );
  onWakeRef.current = hooks.onWake;
  onSurfaceRef.current = hooks.onSurface;
  getContextRef.current = hooks.getContext;
  getSurfaceFlagsRef.current = hooks.getSurfaceFlags;

  const syncSurfaceFlags = useCallback(() => {
    const flags = getSurfaceFlagsRef.current?.();
    if (!flags) return;
    workModeRef.current = flags.work;
    captureArmedRef.current = flags.capturing;
  }, []);

  stateRef.current = state;
  armedRef.current = armed;
  brainOnlineRef.current = brainOnline;

  const clearCommandTimeout = useCallback(() => {
    if (commandTimeoutRef.current !== null) {
      window.clearTimeout(commandTimeoutRef.current);
      commandTimeoutRef.current = null;
    }
  }, []);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const resumeWakeSoon = useCallback(() => {
    window.setTimeout(() => {
      if (!armedRef.current || !brainOnlineRef.current) return;
      if (processingRef.current) return;
      if (stateRef.current === 'thinking') return;
      // Don't yank the mic if Elevyn is mid-ack and about to open command mode.
      if (phaseRef.current === 'command' && stateRef.current === 'listening') return;
      startWakeListeningRef.current();
    }, 220);
  }, []);

  const clearCommandDebounce = useCallback(() => {
    if (commandDebounceRef.current !== null) {
      window.clearTimeout(commandDebounceRef.current);
      commandDebounceRef.current = null;
    }
    pendingCommandRef.current = '';
  }, []);

  const clearWakeCommit = useCallback(() => {
    if (wakeCommitRef.current !== null) {
      window.clearTimeout(wakeCommitRef.current);
      wakeCommitRef.current = null;
    }
  }, []);

  const speak = useCallback(
    (text: string, onDone?: () => void) => {
      const trimmed = text.trim();
      if (!trimmed) {
        setState('idle');
        stateRef.current = 'idle';
        onDone?.();
        return;
      }

      setResponse(trimmed);
      setState('speaking');
      stateRef.current = 'speaking';
      ttsRef.current.speak(trimmed, {
        onStart: () => {
          // Barge-in only for longer replies. Short confirms ("Noted.") pick up
          // Elevyn's own voice on the mic and kill the next wake session.
          if (
            trimmed.length >= 48 &&
            workModeRef.current &&
            phaseRef.current === 'wake' &&
            armedRef.current &&
            brainOnlineRef.current
          ) {
            window.setTimeout(() => {
              if (stateRef.current === 'speaking' && phaseRef.current === 'wake') {
                startWakeListeningRef.current();
              }
            }, 1200);
          }
        },
        onEnd: () => {
          setState('idle');
          stateRef.current = 'idle';
          onDone?.();
        },
      });
    },
    [],
  );

  const processUtterance = useCallback(
    async (utterance: string) => {
      if (processingRef.current) return;
      const cleaned = utterance.trim();
      if (!cleaned) return;

      // Answering a follow-up question ("what should the note say?").
      let toSend = cleaned;
      const awaiting = pendingAwaitRef.current;
      pendingAwaitRef.current = null;
      if (awaiting) {
        const readdressed =
          /\b(elevyn|eleven|evelyn|elevan|elevin|elevon|elevation)\b/i.test(cleaned);
        const cancel = /^(never ?mind|cancel|forget it|nothing|stop|scratch that)\b/i.test(
          cleaned,
        );
        if (cancel && !readdressed) {
          clearCommandTimeout();
          clearCommandDebounce();
          clearWakeCommit();
          recognitionRef.current.abort();
          phaseRef.current = 'wake';
          setState('idle');
          stateRef.current = 'idle';
          speak('Of course.', resumeWakeSoon);
          return;
        }
        if (!readdressed) {
          // Re-compose the answer into the original command for the brain.
          const prefix =
            awaiting === 'note'
              ? 'make a note '
              : awaiting === 'task'
                ? 'add a task '
                : awaiting === 'list'
                  ? 'make a list '
                  : 'set a timer for ';
          toSend = prefix + cleaned;
        }
        // If re-addressed, fall through and treat `cleaned` as a fresh command.
      }

      processingRef.current = true;
      clearCommandTimeout();
      clearCommandDebounce();
      clearWakeCommit();
      recognitionRef.current.abort();
      phaseRef.current = 'wake';
      setState('thinking');
      stateRef.current = 'thinking';
      setError(null);

      try {
        const panelContext = getContextRef.current?.();
        const sessionBlock = sessionRef.current.toContextBlock();
        const contextParts = [
          sessionBlock,
          panelContext ? `=== ON SCREEN ===\n${panelContext}` : undefined,
        ].filter(Boolean);
        const context = contextParts.length
          ? contextParts.join('\n\n').slice(0, 7500)
          : undefined;

        sessionRef.current.addTurn('user', toSend);
        const { intent, execution } = await elevynApi.interpret(toSend, context);

        // Session bookkeeping from brain args.
        if (intent.args?.clearSession === true) {
          sessionRef.current.clear();
        }
        const fact = intent.args?.sessionFact;
        if (typeof fact === 'string' && fact.trim()) {
          sessionRef.current.addFact(fact);
        }

        // Flip the surface immediately so work mode never looks "stuck loading"
        // while speech is synthesizing.
        if (intent.type === 'surface' && intent.surface) {
          onSurfaceRef.current?.(intent.surface);
          setTranscript('');

          const op = intent.surface.op;
          if (
            op === 'work' ||
            op === 'createNote' ||
            op === 'createTask' ||
            op === 'createList' ||
            op === 'startCapture' ||
            op === 'appendCapture' ||
            op === 'timer'
          ) {
            workModeRef.current = true;
          } else if (op === 'dashboard') {
            workModeRef.current = false;
            captureArmedRef.current = false;
          }

          if (op === 'startCapture' || op === 'appendCapture') {
            captureArmedRef.current = true;
          } else if (op === 'stopCapture' || op === 'clear') {
            captureArmedRef.current = false;
          }
        }

        // Meeting wrap-up: stop capture + materialize action items as tasks.
        if (intent.args?.stopCapture === true) {
          onSurfaceRef.current?.({ op: 'stopCapture' });
          captureArmedRef.current = false;
        }
        const actionItems = intent.args?.actionItems;
        if (Array.isArray(actionItems)) {
          for (const item of actionItems) {
            if (typeof item === 'string' && item.trim()) {
              onSurfaceRef.current?.({ op: 'createTask', text: item.trim() });
            }
          }
        }

        const reply =
          execution && !execution.success
            ? execution.message
            : intent.reply;

        // Capture lines stay on the panel — don't flood session chat history.
        const silent =
          intent.type === 'surface' && intent.surface?.op === 'appendCapture';
        if (silent) {
          sessionRef.current.dropLastUserTurn();
        } else if (reply.trim()) {
          sessionRef.current.addTurn('assistant', reply);
        }

        // "copy that" — write on-screen notes to the system clipboard.
        const clipboard = intent.args?.clipboard;
        if (typeof clipboard === 'string' && clipboard.trim()) {
          try {
            await navigator.clipboard.writeText(clipboard);
          } catch {
            // Fall through — Elevyn still speaks the confirmation.
          }
        }

        // Elevyn asked a question — keep the mic open for the answer.
        const nextAwait = intent.awaiting ?? null;
        pendingAwaitRef.current = nextAwait;
        const resume = nextAwait ? resumeConversationRef.current : resumeWakeSoon;

        // Meeting capture lines stay silent — visual confirm only, stay listening.
        if (silent || !reply.trim()) {
          setResponse(silent ? 'Captured.' : reply);
          setState('idle');
          stateRef.current = 'idle';
          resume();
        } else {
          speak(reply, resume);
          // Safety net: if TTS onEnd is lost (browser quirk / interrupted audio),
          // still put the mic back on after a beat.
          window.setTimeout(() => {
            if (!armedRef.current || !brainOnlineRef.current) return;
            if (processingRef.current) return;
            if (stateRef.current === 'speaking' || stateRef.current === 'thinking') {
              return;
            }
            if (stateRef.current === 'listening') return;
            if (nextAwait && pendingAwaitRef.current) {
              resumeConversationRef.current();
            } else if (phaseRef.current === 'wake') {
              startWakeListeningRef.current();
            }
          }, Math.min(6_000, 900 + reply.length * 45));
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Something went wrong.';
        setError(message);
        speak('Pardon me — I could not reach the Elevyn brain.', resumeWakeSoon);
      } finally {
        processingRef.current = false;
      }
    },
    [clearCommandDebounce, clearCommandTimeout, clearWakeCommit, resumeWakeSoon, speak],
  );

  const armCommandTimeout = useCallback(() => {
    clearCommandTimeout();
    commandTimeoutRef.current = window.setTimeout(() => {
      if (phaseRef.current !== 'command' || processingRef.current) return;
      phaseRef.current = 'wake';
      setState('idle');
      stateRef.current = 'idle';
      setTranscript('');
      pendingAwaitRef.current = null;
      clearCommandDebounce();
      recognitionRef.current.abort();
      resumeWakeSoon();
    }, 18_000);
  }, [clearCommandDebounce, clearCommandTimeout, resumeWakeSoon]);

  // Keep the mic open (command phase) so Kevin can answer a follow-up
  // question without re-saying "Elevyn".
  const resumeConversation = useCallback(() => {
    window.setTimeout(() => {
      if (!armedRef.current || !brainOnlineRef.current) return;
      if (processingRef.current) return;
      startCommandListeningRef.current();
      armCommandTimeout();
    }, 150);
  }, [armCommandTimeout]);
  resumeConversationRef.current = resumeConversation;

  const wakeGreetings = useRef([
    'Yes?',
    'Go ahead.',
    'At your service.',
  ]);
  const greetIndexRef = useRef(0);

  const enterCommandMode = useCallback(
    (seedCommand?: string) => {
      clearCommandTimeout();
      clearRestartTimer();
      clearCommandDebounce();
      clearWakeCommit();
      recognitionRef.current.abort();
      phaseRef.current = 'command';
      // Bring Elevyn forward (dashboard → focus).
      onWakeRef.current?.();
      setState('listening');
      stateRef.current = 'listening';
      setTranscript(seedCommand ?? '');
      setError(null);
      setResponse('');

      if (seedCommand?.trim()) {
        void processUtterance(seedCommand);
        return;
      }

      // Always speak a short ack so Kevin knows Elevyn heard him —
      // silent "Listening…" felt like the mic was dead in work mode.
      ttsRef.current.stop();
      const greeting = workModeRef.current
        ? 'Yes?'
        : wakeGreetings.current[greetIndexRef.current % wakeGreetings.current.length];
      if (!workModeRef.current) greetIndexRef.current += 1;
      speak(greeting, () => {
        if (phaseRef.current !== 'command') return;
        startCommandListeningRef.current();
        armCommandTimeout();
      });
    },
    [
      armCommandTimeout,
      clearCommandDebounce,
      clearCommandTimeout,
      clearRestartTimer,
      clearWakeCommit,
      processUtterance,
      speak,
    ],
  );

  const handleWakeResult = useCallback(
    (text: string, isFinal: boolean) => {
      if (phaseRef.current !== 'wake') return;
      if (stateRef.current === 'thinking' || processingRef.current) return;
      syncSurfaceFlags();

      // Barge-in: address Elevyn while it's speaking → cut TTS and take the command.
      if (stateRef.current === 'speaking') {
        const { heard, remainder } = matchAddress(text, {
          workMode: workModeRef.current,
        });
        if (!heard || (!isFinal && !remainder)) return;
        clearWakeCommit();
        ttsRef.current.stop();
        setState('idle');
        stateRef.current = 'idle';
        recognitionRef.current.abort();
        enterCommandMode(remainder || undefined);
        return;
      }

      const { heard, remainder } = matchAddress(text, {
        workMode: workModeRef.current,
      });

      // While capturing, "note that…" works without saying Elevyn.
      if (!heard && captureArmedRef.current) {
        const capture = matchCaptureShortcut(text);
        if (capture && (isFinal || capture.length > 18)) {
          clearWakeCommit();
          setTranscript(capture);
          recognitionRef.current.abort();
          void processUtterance(capture);
          return;
        }
      }

      if (!heard) return;

      setTranscript(text);

      const commitWake = (cmd?: string) => {
        clearWakeCommit();
        recognitionRef.current.abort();
        enterCommandMode(cmd || undefined);
      };

      // Name + command: act as soon as we have a real remainder.
      // Don't wait for Chrome's flaky "all final" signal.
      if (remainder && (isFinal || remainder.trim().split(/\s+/).length >= 1)) {
        // Tiny debounce so "Elevyn make…" can finish the next word.
        clearWakeCommit();
        wakeCommitRef.current = window.setTimeout(
          () => commitWake(remainder),
          isFinal ? 120 : 450,
        );
        return;
      }

      // Name only — commit after a short pause even if isFinal never arrives.
      clearWakeCommit();
      wakeCommitRef.current = window.setTimeout(
        () => commitWake(),
        isFinal ? 150 : 700,
      );
    },
    [
      clearWakeCommit,
      enterCommandMode,
      processUtterance,
      syncSurfaceFlags,
    ],
  );

  const handleCommandResult = useCallback(
    (text: string, isFinal: boolean) => {
      if (phaseRef.current !== 'command') return;
      if (stateRef.current === 'speaking' || stateRef.current === 'thinking') {
        return;
      }

      const { heard, remainder } = matchAddress(text, {
        workMode: workModeRef.current,
      });
      const command = (heard ? remainder : text).trim();
      if (!command) return;

      setTranscript(command);
      pendingCommandRef.current = command;
      armCommandTimeout();

      // Chrome often splits one spoken command into multiple "final" chunks.
      // Debounce so "make a note" + "buy milk" land as one utterance.
      if (commandDebounceRef.current !== null) {
        window.clearTimeout(commandDebounceRef.current);
      }
      commandDebounceRef.current = window.setTimeout(() => {
        const ready = pendingCommandRef.current.trim();
        pendingCommandRef.current = '';
        commandDebounceRef.current = null;
        if (ready && phaseRef.current === 'command' && !processingRef.current) {
          void processUtterance(ready);
        }
      }, isFinal ? 750 : 1100);
    },
    [armCommandTimeout, processUtterance],
  );

  const startWakeListening = useCallback(() => {
    if (!recognitionRef.current.supported) return;
    if (!armedRef.current || !brainOnlineRef.current) return;
    if (processingRef.current) return;
    if (stateRef.current === 'thinking') return;
    if (phaseRef.current === 'command' && stateRef.current === 'listening') return;
    syncSurfaceFlags();

    clearRestartTimer();
    phaseRef.current = 'wake';
    // Don't clobber "speaking" — barge-in listening runs under that state.
    if (stateRef.current !== 'speaking' && stateRef.current !== 'offline') {
      setState('idle');
      stateRef.current = 'idle';
    }

    recognitionRef.current.start(
      {
        onResult: handleWakeResult,
        onEnd: () => {
          if (!armedRef.current || !brainOnlineRef.current) return;
          if (processingRef.current) return;
          if (phaseRef.current !== 'wake') return;
          if (stateRef.current === 'thinking') return;
          clearRestartTimer();
          restartTimerRef.current = window.setTimeout(() => {
            startWakeListeningRef.current();
          }, 280);
        },
        onError: (err) => {
          if (err === 'not-allowed') {
            setError('Microphone permission is required for “Hey Elevyn”.');
            setArmed(false);
          }
        },
      },
      'wake',
    );
  }, [clearRestartTimer, handleWakeResult, syncSurfaceFlags]);

  const startCommandListening = useCallback(() => {
    if (!recognitionRef.current.supported) return;
    clearRestartTimer();
    phaseRef.current = 'command';
    setState('listening');
    stateRef.current = 'listening';

    recognitionRef.current.start(
      {
        onResult: handleCommandResult,
        onEnd: () => {
          if (phaseRef.current !== 'command' || processingRef.current) return;
          if (stateRef.current === 'thinking' || stateRef.current === 'speaking') {
            return;
          }
          clearRestartTimer();
          restartTimerRef.current = window.setTimeout(() => {
            startCommandListeningRef.current();
          }, 200);
        },
      },
      'command',
    );
  }, [clearRestartTimer, handleCommandResult]);

  startWakeListeningRef.current = startWakeListening;
  startCommandListeningRef.current = startCommandListening;

  useEffect(() => {
    let cancelled = false;

    const ping = async () => {
      try {
        const health = await elevynApi.health();
        if (!cancelled) {
          setBrainOnline(health.ok);
          setAiProvider(health.aiProvider);
          setState((s) => (s === 'offline' ? 'idle' : s));
        }
      } catch {
        if (!cancelled) {
          setBrainOnline(false);
          setAiProvider(null);
          setState('offline');
        }
      }
    };

    void ping();
    const id = window.setInterval(ping, 8_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Bootstrap / re-arm wake listening when online — do not tie to every state change.
  useEffect(() => {
    if (!armed || !brainOnline || !recognitionRef.current.supported) {
      recognitionRef.current.abort();
      return;
    }

    const timer = window.setTimeout(() => {
      if (phaseRef.current === 'wake' && stateRef.current !== 'speaking') {
        startWakeListeningRef.current();
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [armed, brainOnline]);

  useEffect(() => {
    return () => {
      recognitionRef.current.abort();
      ttsRef.current.stop();
      clearCommandTimeout();
      clearRestartTimer();
      clearCommandDebounce();
      clearWakeCommit();
    };
  }, [
    clearCommandDebounce,
    clearCommandTimeout,
    clearRestartTimer,
    clearWakeCommit,
  ]);

  const stopListening = useCallback(() => {
    clearCommandTimeout();
    clearWakeCommit();
    recognitionRef.current.abort();
    workModeRef.current = false;
    captureArmedRef.current = false;
    pendingAwaitRef.current = null;
    phaseRef.current = 'wake';
    if (stateRef.current === 'listening') {
      setState('idle');
      stateRef.current = 'idle';
    }
    // Always return to wake listening when armed — Escape/exit used to leave the mic dead.
    if (armedRef.current && brainOnlineRef.current) {
      resumeWakeSoon();
    }
  }, [clearCommandTimeout, clearWakeCommit, resumeWakeSoon]);

  const toggleArmed = useCallback(() => {
    setArmed((prev) => {
      const next = !prev;
      if (!next) {
        recognitionRef.current.abort();
        ttsRef.current.stop();
        clearCommandTimeout();
        clearWakeCommit();
        workModeRef.current = false;
        captureArmedRef.current = false;
        pendingAwaitRef.current = null;
        phaseRef.current = 'wake';
        setState((s) => (s === 'listening' ? 'idle' : s));
      } else {
        // Start inside the click gesture so Chrome grants the mic.
        window.setTimeout(() => startWakeListeningRef.current(), 0);
      }
      return next;
    });
  }, [clearCommandTimeout, clearWakeCommit]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current.supported) {
      setError('Speech recognition needs Chrome or Edge on this Mac.');
      return;
    }
    if (!brainOnline) {
      setError('Elevyn brain is offline.');
      setState('offline');
      return;
    }
    ttsRef.current.stop();
    enterCommandMode();
  }, [brainOnline, enterCommandMode]);

  const toggleListening = useCallback(() => {
    if (state === 'listening' || phaseRef.current === 'command') {
      stopListening();
      return;
    }
    startListening();
  }, [startListening, state, stopListening]);

  // Spoken announcement Elevyn initiates itself (e.g. a timer finishing),
  // then quietly returns to listening.
  const announce = useCallback(
    (text: string) => {
      if (processingRef.current) return;
      recognitionRef.current.abort();
      phaseRef.current = 'wake';
      speak(text, resumeWakeSoon);
    },
    [resumeWakeSoon, speak],
  );

  return {
    state,
    transcript,
    response,
    error,
    brainOnline,
    aiProvider,
    armed,
    speechSupported: recognitionRef.current.supported,
    startListening,
    stopListening,
    toggleListening,
    toggleArmed,
    processUtterance,
    announce,
  };
}
