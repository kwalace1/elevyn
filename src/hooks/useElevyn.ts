import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentPlan,
  AgentStepStatus,
  ElevynState,
  SurfaceCommand,
  SurfacePanel,
} from '../types';
import { elevynApi } from '../services/api/client';
import { API_BASE } from '../services/api/config';
import { BrowserSpeechRecognition } from '../services/voice/recognition';
import { ElevynSpeech } from '../services/voice/elevynSpeech';
import { SessionMemory } from '../services/session/memory';
import { DurableMemory } from '../services/memory/durable';
import { applyIntentEffects } from '../services/agent/effects';
import {
  buildPresenceSnapshot,
  buildWakeBrief,
} from '../services/presence/brief';
import { formatAgendaWhen, parseSpokenAgenda } from '../utils/agendaParse';
import {
  isEchoOfReply,
  matchAddress,
  matchCaptureShortcut,
} from '../utils/wakeWord';
import { safeSpeakReply } from '../utils/spokenReply';

type ListenPhase = 'wake' | 'command';

export interface ElevynHooks {
  /** Fired when Elevyn is woken (wake word or manual mic). */
  onWake?: () => void;
  /** Fired when the brain returns a surface action. */
  onSurface?: (cmd: SurfaceCommand) => void;
  /** Supplies on-screen context (notes/capture) for summarize + recall. */
  getContext?: () => string | undefined;
  /** Live panels for proactive wake briefs. */
  getPanels?: () => SurfacePanel[];
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
  /** Bumps when durable agenda/memory changes so UI status can refresh. */
  const [memoryEpoch, setMemoryEpoch] = useState(0);
  /** Live TTS amplitude 0–1 — drives orb presence while speaking. */
  const [voiceLevel, setVoiceLevel] = useState(0);

  const recognitionRef = useRef(new BrowserSpeechRecognition());
  const ttsRef = useRef(new ElevynSpeech());
  const sessionRef = useRef(new SessionMemory());
  const durableRef = useRef(new DurableMemory());
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
  // After a reply, keep command-phase listening open briefly so follow-ups
  // don't require re-saying "Elevyn" / "Eleven".
  const holdConversationRef = useRef(false);
  // In work mode Elevyn listens for its name (Elevyn / Eleven) mid-utterance.
  // While capture is armed, "note that…" also fires without the name.
  const workModeRef = useRef(false);
  const captureArmedRef = useRef(false);
  // Reply currently being spoken — used to tell Kevin's interruption apart
  // from the mic hearing Elevyn's own voice.
  const speakingReplyRef = useRef('');
  // Keep filtering echoes briefly after TTS ends (room / speaker bleed).
  const echoGuardUntilRef = useRef(0);
  const lastSpokenRef = useRef('');
  // Throttle situational wake briefs so Elevyn does not monologue every "Elevyn".
  const lastBriefAtRef = useRef(0);

  const startWakeListeningRef = useRef<() => void>(() => {});
  const startCommandListeningRef = useRef<() => void>(() => {});

  const onWakeRef = useRef<ElevynHooks['onWake']>(hooks.onWake);
  const onSurfaceRef = useRef<ElevynHooks['onSurface']>(hooks.onSurface);
  const getContextRef = useRef<ElevynHooks['getContext']>(hooks.getContext);
  const getPanelsRef = useRef<ElevynHooks['getPanels']>(hooks.getPanels);
  const getSurfaceFlagsRef = useRef<ElevynHooks['getSurfaceFlags']>(
    hooks.getSurfaceFlags,
  );
  onWakeRef.current = hooks.onWake;
  onSurfaceRef.current = hooks.onSurface;
  getContextRef.current = hooks.getContext;
  getPanelsRef.current = hooks.getPanels;
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
    }, 120);
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
      const raw = text.trim();
      if (!raw) {
        setState('idle');
        stateRef.current = 'idle';
        onDone?.();
        return;
      }
      // Final choke point — never let tool/XML/JSON leakage hit the speakers.
      const trimmed = safeSpeakReply(raw);

      // Mute the mic while Elevyn talks — open mics during TTS hear Sonia
      // and treat the reply as a user utterance.
      clearRestartTimer();
      recognitionRef.current.abort();

      setResponse(trimmed);
      setState('speaking');
      stateRef.current = 'speaking';
      speakingReplyRef.current = trimmed;
      lastSpokenRef.current = trimmed;

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        echoGuardUntilRef.current = Date.now() + 600;
        if (speakingReplyRef.current === trimmed) {
          speakingReplyRef.current = '';
        }
        if (stateRef.current === 'speaking') {
          setState('idle');
          stateRef.current = 'idle';
        }
        onDone?.();
      };

      ttsRef.current.speak(trimmed, {
        onEnd: () => {
          // Brief settle so speaker bleed dies, then always resume listening.
          window.setTimeout(finish, 350);
        },
      });

      // Hard safety: if TTS onEnd is lost, never stay stuck "speaking" with a dead mic.
      window.setTimeout(() => {
        if (stateRef.current === 'speaking' && speakingReplyRef.current === trimmed) {
          finish();
        }
      }, Math.min(20_000, 2500 + trimmed.length * 80));
    },
    [clearRestartTimer],
  );

  const speakAsync = useCallback(
    (text: string) =>
      new Promise<void>((resolve) => {
        speak(text, () => resolve());
      }),
    [speak],
  );

  const effectHooks = useCallback(
    (): Parameters<typeof applyIntentEffects>[1] => ({
      onSurface: (cmd) => onSurfaceRef.current?.(cmd),
      setWorkMode: (on) => {
        workModeRef.current = on;
      },
      setCaptureArmed: (on) => {
        captureArmedRef.current = on;
      },
    }),
    [],
  );

  const publishAgentPanel = useCallback(
    (title: string, steps: AgentStepStatus[], agentId: string) => {
      onSurfaceRef.current?.({
        op: 'upsertAgent',
        title,
        agentId,
        agentSteps: steps,
      });
      workModeRef.current = true;
    },
    [],
  );

  const runAgentPlan = useCallback(
    async (plan: AgentPlan, depth = 0): Promise<string> => {
      if (depth > 2) return 'Plan stopped — too many nested steps.';
      const agentId = `agent-${Date.now().toString(36)}`;
      let steps: AgentStepStatus[] = plan.steps.map((s) => ({
        ...s,
        status: 'pending' as const,
      }));
      publishAgentPanel(plan.title, steps, agentId);

      let lastUseful = '';
      for (let i = 0; i < steps.length; i++) {
        steps = steps.map((s, idx) => ({
          ...s,
          status:
            idx === i ? 'running' : idx < i ? s.status : 'pending',
        }));
        publishAgentPanel(plan.title, steps, agentId);

        const step = plan.steps[i];
        try {
          if (step.surface) {
            onSurfaceRef.current?.(step.surface);
            if (step.surface.op === 'work' || step.surface.op === 'createNote') {
              workModeRef.current = true;
            }
            if (step.surface.op === 'stopCapture') {
              captureArmedRef.current = false;
            }
          }

          if (step.remember) {
            sessionRef.current.addFact(step.remember);
            durableRef.current.addFact(step.remember);
            setMemoryEpoch((n) => n + 1);
          }

          if (step.copy) {
            const ctx = getContextRef.current?.();
            if (ctx?.trim()) {
              try {
                await navigator.clipboard.writeText(ctx);
              } catch {
                // ignore
              }
            }
          }

          if (step.utterance?.trim()) {
            const panelContext = getContextRef.current?.();
            const sessionBlock = sessionRef.current.toContextBlock();
            const durableBlock = durableRef.current.toContextBlock();
            const panels = getPanelsRef.current?.() ?? [];
            const openTaskItems = (
              panels.find((p) => p.kind === 'task')?.items ?? []
            ).filter((it) => !it.done);
            const openTasksBlock =
              openTaskItems.length > 0
                ? `=== OPEN TASKS ===\n${openTaskItems
                    .slice(0, 8)
                    .map((it) => `- ${it.text}`)
                    .join('\n')}`
                : undefined;
            const contextParts = [
              durableBlock,
              sessionBlock,
              openTasksBlock,
              panelContext ? `=== ON SCREEN ===\n${panelContext}` : undefined,
            ].filter(Boolean);
            const context = contextParts.length
              ? contextParts.join('\n\n').slice(0, 7500)
              : undefined;

            const { intent, execution } = await elevynApi.interpret(
              step.utterance.trim(),
              context,
            );

            if (intent.type === 'agent' && intent.plan) {
              await runAgentPlan(intent.plan, depth + 1);
            } else {
              applyIntentEffects(intent, effectHooks());
              const fact = intent.args?.sessionFact;
              if (typeof fact === 'string' && fact.trim()) {
                sessionRef.current.addFact(fact);
              }
              const durableFact = intent.args?.durableFact;
              if (typeof durableFact === 'string' && durableFact.trim()) {
                durableRef.current.addFact(durableFact);
                setMemoryEpoch((n) => n + 1);
              }
              const scheduleUtterance = intent.args?.scheduleUtterance;
              if (typeof scheduleUtterance === 'string') {
                const parsed = parseSpokenAgenda(scheduleUtterance);
                if (parsed) {
                  durableRef.current.addEvent({
                    title: parsed.title,
                    start: parsed.startIso,
                    end: parsed.endIso,
                    source: 'voice',
                  });
                  setMemoryEpoch((n) => n + 1);
                }
              }
              const clipboard = intent.args?.clipboard;
              if (typeof clipboard === 'string' && clipboard.trim()) {
                try {
                  await navigator.clipboard.writeText(clipboard);
                } catch {
                  // ignore
                }
              }
              const rawStep =
                execution && !execution.success
                  ? execution.message
                  : intent.reply;
              const stepReply = rawStep?.trim()
                ? safeSpeakReply(rawStep)
                : '';
              if (stepReply.trim()) lastUseful = stepReply.trim();
            }
          }

          steps = steps.map((s, idx) =>
            idx === i ? { ...s, status: 'done' } : s,
          );
          publishAgentPanel(plan.title, steps, agentId);
          // Brief beat so the glass update is readable.
          await new Promise((r) => window.setTimeout(r, 280));
        } catch {
          steps = steps.map((s, idx) =>
            idx === i ? { ...s, status: 'failed' } : s,
          );
          publishAgentPanel(plan.title, steps, agentId);
          return `I hit a snag on: ${step.label}.`;
        }
      }

      const doneCount = steps.filter((s) => s.status === 'done').length;
      if (lastUseful) {
        return `Done. ${lastUseful}`;
      }
      return `Done. ${doneCount} step${doneCount === 1 ? '' : 's'} complete.`;
    },
    [effectHooks, publishAgentPanel],
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
      // Stay in command phase while thinking if we're holding a conversation,
      // so the post-reply mic comes back as follow-up listening — not wake.
      if (!holdConversationRef.current) {
        phaseRef.current = 'wake';
      }
      setState('thinking');
      stateRef.current = 'thinking';
      setError(null);

      try {
        const panelContext = getContextRef.current?.();
        const sessionBlock = sessionRef.current.toContextBlock();
        const durableBlock = durableRef.current.toContextBlock();
        const panels = getPanelsRef.current?.() ?? [];
        const openTaskItems = (
          panels.find((p) => p.kind === 'task')?.items ?? []
        ).filter((it) => !it.done);
        const openTasksBlock =
          openTaskItems.length > 0
            ? `=== OPEN TASKS ===\n${openTaskItems
                .slice(0, 8)
                .map((it) => `- ${it.text}`)
                .join('\n')}`
            : undefined;
        const contextParts = [
          durableBlock,
          sessionBlock,
          openTasksBlock,
          panelContext ? `=== ON SCREEN ===\n${panelContext}` : undefined,
        ].filter(Boolean);
        const context = contextParts.length
          ? contextParts.join('\n\n').slice(0, 7500)
          : undefined;

        sessionRef.current.addTurn('user', toSend);
        const { intent, execution } = await elevynApi.interpret(toSend, context);

        // Session / durable bookkeeping from brain args.
        if (intent.args?.clearSession === true) {
          sessionRef.current.clear();
        }
        const fact = intent.args?.sessionFact;
        if (typeof fact === 'string' && fact.trim()) {
          sessionRef.current.addFact(fact);
        }
        const durableFact = intent.args?.durableFact;
        if (typeof durableFact === 'string' && durableFact.trim()) {
          durableRef.current.addFact(durableFact);
          setMemoryEpoch((n) => n + 1);
        }

        // Voice-scheduled agenda item.
        const scheduleUtterance = intent.args?.scheduleUtterance;
        if (typeof scheduleUtterance === 'string') {
          const parsed = parseSpokenAgenda(scheduleUtterance);
          if (parsed) {
            durableRef.current.addEvent({
              title: parsed.title,
              start: parsed.startIso,
              end: parsed.endIso,
              source: 'voice',
            });
            intent.reply = `Noted. ${parsed.title} at ${formatAgendaWhen(parsed.startIso)}.`;
            setMemoryEpoch((n) => n + 1);
          } else {
            intent.reply =
              'I caught that you want something on the agenda, but I need a time — for example, meeting with Sarah at 3.';
          }
        }

        // Multi-step agency: ack → run plan on glass → final summary.
        if (intent.type === 'agent' && intent.plan?.steps?.length) {
          setTranscript('');
          const opening = safeSpeakReply(intent.reply.trim() || 'On it.');
          sessionRef.current.addTurn('assistant', opening);
          await speakAsync(opening);
          const summary = safeSpeakReply(
            (await runAgentPlan(intent.plan)) || 'Done.',
          );
          sessionRef.current.addTurn('assistant', summary);
          await speakAsync(summary);
          resumeWakeSoon();
          return;
        }

        // Flip the surface immediately so work mode never looks "stuck loading"
        // while speech is synthesizing.
        applyIntentEffects(intent, effectHooks());
        if (intent.type === 'surface' && intent.surface) {
          setTranscript('');
        }

        const openUrl = intent.args?.openUrl;
        if (typeof openUrl === 'string' && openUrl.startsWith('/')) {
          // Full navigation so OAuth cookies land on this origin (incl. Vite proxy).
          window.setTimeout(() => {
            window.location.assign(`${API_BASE}${openUrl}`);
          }, 600);
        }

        const rawReply =
          execution && !execution.success
            ? execution.message
            : intent.reply;
        const reply = rawReply?.trim() ? safeSpeakReply(rawReply) : '';

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

        // Always hold an open conversation window after a reply so follow-ups
        // don't require re-addressing Elevyn for ~10s.
        const nextAwait = intent.awaiting ?? null;
        pendingAwaitRef.current = nextAwait;
        holdConversationRef.current = true;
        const resume = () => resumeConversationRef.current();

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
            if (stateRef.current === 'listening' && phaseRef.current === 'command') {
              return;
            }
            if (holdConversationRef.current || pendingAwaitRef.current) {
              resumeConversationRef.current();
            } else {
              startWakeListeningRef.current();
            }
          }, Math.min(6_000, 900 + reply.length * 45));
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Something went wrong.';
        setError(message);
        speak('Pardon me — I lost that for a moment. Could you try again?', resumeWakeSoon);
      } finally {
        processingRef.current = false;
      }
    },
    [
      clearCommandDebounce,
      clearCommandTimeout,
      clearWakeCommit,
      effectHooks,
      resumeWakeSoon,
      runAgentPlan,
      speak,
      speakAsync,
    ],
  );

  /** How long to keep accepting follow-ups without re-saying the name. */
  const CONVERSATION_HOLD_MS = 10_000;

  const armCommandTimeout = useCallback(() => {
    clearCommandTimeout();
    commandTimeoutRef.current = window.setTimeout(() => {
      if (phaseRef.current !== 'command' || processingRef.current) return;
      holdConversationRef.current = false;
      phaseRef.current = 'wake';
      setState('idle');
      stateRef.current = 'idle';
      setTranscript('');
      pendingAwaitRef.current = null;
      clearCommandDebounce();
      recognitionRef.current.abort();
      resumeWakeSoon();
    }, CONVERSATION_HOLD_MS);
  }, [clearCommandDebounce, clearCommandTimeout, resumeWakeSoon]);

  // Keep the mic open (command phase) so Kevin can answer a follow-up
  // without re-saying "Elevyn" / "Eleven".
  const resumeConversation = useCallback(() => {
    holdConversationRef.current = true;
    window.setTimeout(() => {
      if (!armedRef.current || !brainOnlineRef.current) return;
      if (processingRef.current) return;
      // Force out of a stuck speaking/thinking state so the mic can reopen.
      if (stateRef.current === 'speaking' || stateRef.current === 'thinking') {
        setState('idle');
        stateRef.current = 'idle';
        speakingReplyRef.current = '';
      }
      startCommandListeningRef.current();
      armCommandTimeout();
    }, 120);
  }, [armCommandTimeout]);
  resumeConversationRef.current = resumeConversation;

  const wakeGreetings = useRef([
    'Yes?',
    'Go ahead.',
    "I'm here.",
    'Listening.',
  ]);
  const greetIndexRef = useRef(0);

  const dayPart = useCallback((): 'morning' | 'afternoon' | 'evening' => {
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        hour12: false,
        timeZone: 'America/New_York',
      }).format(new Date()),
    );
    if (hour < 12) return 'morning';
    if (hour < 18) return 'afternoon';
    return 'evening';
  }, []);

  const enterCommandMode = useCallback(
    (seedCommand?: string) => {
      clearCommandTimeout();
      clearRestartTimer();
      clearCommandDebounce();
      clearWakeCommit();
      recognitionRef.current.abort();
      syncSurfaceFlags();
      phaseRef.current = 'command';
      // Bring Elevyn forward (systems dashboard → ambient orb).
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

      // Prefer a sparse situational brief when something is worth noticing;
      // otherwise a short Jarvis ack. Never brief twice within ~80s.
      ttsRef.current.stop();
      speakingReplyRef.current = '';
      const panels = getPanelsRef.current?.() ?? [];
      const next = durableRef.current.upcoming(18)[0];
      const nextAgenda = next
        ? `${next.title} at ${formatAgendaWhen(next.start)}`
        : null;
      const snap = buildPresenceSnapshot(
        panels,
        sessionRef.current.snapshot(),
        nextAgenda,
      );
      const now = Date.now();
      const briefFresh = now - lastBriefAtRef.current > 80_000;
      const brief =
        briefFresh && !workModeRef.current
          ? buildWakeBrief(snap, dayPart())
          : briefFresh && workModeRef.current
            ? buildWakeBrief(snap, 'generic')
            : null;

      let greeting: string;
      if (brief) {
        lastBriefAtRef.current = now;
        greeting = brief;
      } else if (workModeRef.current) {
        greeting = 'Yes?';
      } else {
        greeting =
          wakeGreetings.current[
            greetIndexRef.current % wakeGreetings.current.length
          ];
        greetIndexRef.current += 1;
      }

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
      dayPart,
      processUtterance,
      speak,
      syncSurfaceFlags,
    ],
  );

  const handleWakeResult = useCallback(
    (text: string, isFinal: boolean) => {
      if (phaseRef.current !== 'wake') return;
      if (stateRef.current === 'thinking' || processingRef.current) return;
      // Never process mic input while Elevyn is talking.
      if (stateRef.current === 'speaking') return;
      // Drop post-TTS echo tails.
      if (
        Date.now() < echoGuardUntilRef.current &&
        isEchoOfReply(text, lastSpokenRef.current || speakingReplyRef.current)
      ) {
        return;
      }
      syncSurfaceFlags();

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

      // Name + command: wait for a stable remainder so Chrome interim
      // fragments ("Elevyn make") don't truncate the real utterance.
      if (remainder) {
        const words = remainder.trim().split(/\s+/).filter(Boolean);
        const stableEnough = isFinal || words.length >= 3;
        clearWakeCommit();
        wakeCommitRef.current = window.setTimeout(
          () => commitWake(remainder),
          isFinal ? 280 : stableEnough ? 700 : 1100,
        );
        return;
      }

      // Name only — commit after a short pause even if isFinal never arrives.
      clearWakeCommit();
      wakeCommitRef.current = window.setTimeout(
        () => commitWake(),
        isFinal ? 180 : 650,
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
      if (stateRef.current === 'thinking' || stateRef.current === 'speaking') {
        return;
      }
      // Drop speaker bleed right after Elevyn finishes talking — but never
      // drop a bare wake address ("Eleven" / "hey Elevyn").
      const addressed = matchAddress(text, { leadingOnly: true });
      if (
        Date.now() < echoGuardUntilRef.current &&
        !addressed.heard &&
        isEchoOfReply(text, lastSpokenRef.current || speakingReplyRef.current)
      ) {
        return;
      }

      // Command phase: only strip a leading name — never mid-utterance "eleven".
      const command = (addressed.heard ? addressed.remainder : text).trim();

      // Bare "Elevyn" / "Eleven" while already in conversation — soft re-ack.
      if (addressed.heard && !command) {
        armCommandTimeout();
        setTranscript('');
        if (isFinal) {
          speak('Yes?', () => {
            if (phaseRef.current !== 'command') return;
            startCommandListeningRef.current();
            armCommandTimeout();
          });
        }
        return;
      }

      if (!command) return;
      if (
        Date.now() < echoGuardUntilRef.current &&
        isEchoOfReply(command, lastSpokenRef.current)
      ) {
        return;
      }

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
          if (isEchoOfReply(ready, lastSpokenRef.current)) return;
          void processUtterance(ready);
        }
      }, isFinal ? 900 : 1300);
    },
    [armCommandTimeout, clearCommandDebounce, processUtterance, speak],
  );

  const startWakeListening = useCallback(() => {
    if (!recognitionRef.current.supported) return;
    if (!armedRef.current || !brainOnlineRef.current) return;
    if (processingRef.current) return;
    if (stateRef.current === 'thinking' || stateRef.current === 'speaking') return;
    syncSurfaceFlags();

    clearRestartTimer();
    phaseRef.current = 'wake';
    if (stateRef.current !== 'offline') {
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
          if (stateRef.current === 'thinking' || stateRef.current === 'speaking') {
            return;
          }
          clearRestartTimer();
          restartTimerRef.current = window.setTimeout(() => {
            startWakeListeningRef.current();
          }, 140);
        },
        onError: (err) => {
          if (err === 'not-allowed') {
            setError('Microphone permission is required for “Hey Elevyn”.');
            setArmed(false);
          } else {
            // Network / service blips — retry wake shortly.
            clearRestartTimer();
            restartTimerRef.current = window.setTimeout(() => {
              if (phaseRef.current === 'wake') startWakeListeningRef.current();
            }, 400);
          }
        },
      },
      'wake',
    );
  }, [clearRestartTimer, handleWakeResult, syncSurfaceFlags]);

  const startCommandListening = useCallback(() => {
    if (!recognitionRef.current.supported) return;
    if (processingRef.current) return;
    if (stateRef.current === 'speaking' || stateRef.current === 'thinking') {
      // Don't permanently skip — clear stuck speaking so the next watchdog can open the mic.
      return;
    }
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
          }, 100);
        },
        onError: (err) => {
          if (err === 'not-allowed') {
            setError('Microphone permission is required for “Hey Elevyn”.');
            setArmed(false);
            return;
          }
          clearRestartTimer();
          restartTimerRef.current = window.setTimeout(() => {
            if (phaseRef.current === 'command') {
              startCommandListeningRef.current();
            }
          }, 400);
        },
      },
      'command',
    );
  }, [clearRestartTimer, handleCommandResult]);

  startWakeListeningRef.current = startWakeListening;
  startCommandListeningRef.current = startCommandListening;

  // Mic watchdog — if Chrome drops recognition after a reply, reopen it.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!armedRef.current || !brainOnlineRef.current) return;
      if (processingRef.current) return;
      if (stateRef.current === 'speaking' || stateRef.current === 'thinking') return;
      if (recognitionRef.current.active) return;
      if (phaseRef.current === 'command' || holdConversationRef.current) {
        startCommandListeningRef.current();
      } else {
        startWakeListeningRef.current();
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, []);

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

  // Live speech amplitude → orb presence.
  useEffect(() => {
    return ttsRef.current.subscribeLevel(setVoiceLevel);
  }, []);

  // Optional ICS calendar → durable agenda (when ELEVYN_CALENDAR_ICS is set).
  useEffect(() => {
    if (!brainOnline) return;
    let cancelled = false;

    const sync = async () => {
      try {
        const payload = await elevynApi.calendar();
        if (cancelled || !payload.configured) return;
        durableRef.current.mergeCalendarEvents(
          (payload.events ?? []).map((e) => ({
            title: e.title,
            start: e.start,
            end: e.end,
          })),
        );
        setMemoryEpoch((n) => n + 1);
      } catch {
        // Calendar is optional — voice agenda still works.
      }
    };

    void sync();
    const id = window.setInterval(sync, 15 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [brainOnline]);

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

  // Spoken announcement Elevyn initiates itself (timer warning, time up),
  // then quietly returns to listening. Never interrupts an active exchange.
  const announce = useCallback(
    (text: string) => {
      if (processingRef.current) return;
      if (stateRef.current === 'thinking' || stateRef.current === 'speaking') return;
      if (phaseRef.current === 'command') return;
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
    memoryEpoch,
    voiceLevel,
    speechSupported: recognitionRef.current.supported,
    startListening,
    stopListening,
    toggleListening,
    toggleArmed,
    processUtterance,
    announce,
    getSessionSnapshot: () => sessionRef.current.snapshot(),
    getDurableSnapshot: () => durableRef.current.snapshot(),
    getUpcomingAgenda: () => durableRef.current.upcoming(36),
  };
}
