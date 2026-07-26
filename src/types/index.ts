/**
 * Elevyn shared domain types.
 * Keep client and server contracts aligned — these are the OS vocabulary.
 */

export type ElevynState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'offline';

export type MemoryCategory =
  | 'personal'
  | 'projects'
  | 'devices'
  | 'preferences'
  | 'notes'
  | 'conversations'
  | 'tasks';

export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AICompletionRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AICompletionResponse {
  content: string;
  provider: string;
  model: string;
  latencyMs: number;
}

export interface CommandDefinition {
  id: string;
  name: string;
  description: string;
  examples: string[];
  /** Natural-language patterns Elevyn may match before calling the LLM. */
  intents?: string[];
}

export interface CommandExecutionRequest {
  commandId: string;
  args?: Record<string, unknown>;
}

export interface CommandExecutionResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/**
 * Surface = the visual presence Elevyn projects.
 * - dashboard: full command center (home)
 * - focus: Jarvis conversation view (orb front and centre)
 * - work: stripped canvas where panels populate by voice
 */
export type SurfaceView = 'dashboard' | 'focus' | 'work';

export type SurfaceOp =
  | 'focus' // wake / come forward
  | 'work' // clear to minimal work canvas
  | 'dashboard' // return home
  | 'clear' // remove all panels
  | 'createNote'
  | 'createTask'
  | 'createList'
  | 'addItem'
  | 'removeLast'
  | 'startCapture' // begin a rolling meeting-capture panel
  | 'stopCapture' // stop recording into the capture panel
  | 'appendCapture' // add a line to the capture panel
  | 'timer' // start a countdown timer panel
  | 'cancelTimer' // cancel any running timer
  | 'upsertAgent' // show / update multi-step plan progress
  | 'clearAgent'; // remove agent progress panel

export interface SurfaceCommand {
  op: SurfaceOp;
  title?: string;
  text?: string;
  items?: string[];
  /** For "timer": countdown length in seconds. */
  seconds?: number;
  /** For upsertAgent: live step statuses. */
  agentSteps?: AgentStepStatus[];
  /** For upsertAgent: stable panel id. */
  agentId?: string;
}

export type SurfacePanelKind = 'note' | 'task' | 'list' | 'capture' | 'timer' | 'agent';

export interface SurfacePanel {
  id: string;
  kind: SurfacePanelKind;
  title: string;
  text?: string;
  items?: { id: string; text: string; done: boolean }[];
  createdAt: string;
  /** Capture: whether Elevyn is actively recording lines. */
  armed?: boolean;
  /** Timer: absolute end time (ISO) and original length. */
  endsAt?: string;
  seconds?: number;
  /** Agent plan progress (kind === 'agent'). */
  agentSteps?: AgentStepStatus[];
}

/** One step in a multi-step Elevyn plan. */
export interface AgentStep {
  label: string;
  /** Deterministic surface action. */
  surface?: SurfaceCommand;
  /** Ask the brain again (wrap meeting, draft, summarize, …). */
  utterance?: string;
  /** Store in durable + session memory. */
  remember?: string;
  /** Copy current on-screen context to clipboard. */
  copy?: boolean;
}

export interface AgentStepStatus extends AgentStep {
  status: 'pending' | 'running' | 'done' | 'failed';
}

export interface AgentPlan {
  title: string;
  steps: AgentStep[];
}

export interface InterpretedIntent {
  type: 'command' | 'chat' | 'surface' | 'agent';
  commandId?: string;
  args?: Record<string, unknown>;
  surface?: SurfaceCommand;
  /** Multi-step plan — client runs steps and shows progress on glass. */
  plan?: AgentPlan;
  reply: string;
  /**
   * Elevyn asked a question and is waiting for the answer as the next
   * utterance (e.g. "What should the note say?"). The client keeps the
   * mic open and routes the reply straight into this slot.
   */
  awaiting?: 'note' | 'task' | 'list' | 'timer';
}

export interface DeviceStatus {
  id: string;
  name: string;
  online: boolean;
  detail?: string;
}

export interface SystemHealth {
  cpuLoad: number;
  memoryUsedPercent: number;
  uptimeSeconds: number;
  hostname: string;
  platform: string;
}

export interface RunningApp {
  name: string;
  bundleId?: string;
}

export interface SystemSnapshot {
  macbook: DeviceStatus;
  windows: DeviceStatus;
  internet: DeviceStatus;
  health: SystemHealth;
  apps: RunningApp[];
  timestamp: string;
}

export interface WeatherPlaceholder {
  location: string;
  condition: string;
  temperatureF: number;
  highF: number;
  lowF: number;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  location?: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  time: string;
  unread: boolean;
}

export interface VoiceSession {
  transcript: string;
  response: string;
  state: ElevynState;
}
