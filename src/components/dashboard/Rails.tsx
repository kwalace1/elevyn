import { GlassPanel } from '../ui/GlassPanel';
import { StatusDot } from '../ui/StatusDot';
import type { DashboardPayload } from '../../services/api/client';
import type { AgendaEvent } from '../../services/memory/durable';
import type { SessionSnapshot } from '../../services/session/memory';
import { formatAgendaWhen } from '../../utils/agendaParse';
import type { ElevynState } from '../../types';

interface DashboardProps {
  data: DashboardPayload | null;
  transcript: string;
  response: string;
  state: ElevynState;
  aiProvider: string | null;
  error: string | null;
  presenceStatus?: string;
  agenda?: AgendaEvent[];
  session?: SessionSnapshot;
  memoryEpoch?: number;
  microsoft?: {
    configured: boolean;
    connected: boolean;
    account: string | null;
  } | null;
  onConnectMicrosoft?: () => void;
  onDisconnectMicrosoft?: () => void;
}

export function LeftRail({
  data,
  aiProvider,
  presenceStatus,
  agenda = [],
  microsoft,
  onConnectMicrosoft,
  onDisconnectMicrosoft,
}: Pick<
  DashboardProps,
  | 'data'
  | 'aiProvider'
  | 'presenceStatus'
  | 'agenda'
  | 'memoryEpoch'
  | 'microsoft'
  | 'onConnectMicrosoft'
  | 'onDisconnectMicrosoft'
>) {
  const system = data?.system;
  const upcoming = agenda.slice(0, 4);

  return (
    <div className="rail rail--left">
      <GlassPanel title="Standing by">
        <div className="stack">
          <p className="presence-line">{presenceStatus ?? 'All systems standing by'}</p>
          <StatusDot
            online={Boolean(aiProvider)}
            label="Brain"
            detail={aiProvider ? aiProvider : 'Local intent engine'}
          />
          <StatusDot
            online={system?.internet.online ?? false}
            label="Link"
            detail={system?.internet.detail ?? 'Checking…'}
          />
          {microsoft?.configured ? (
            <div className="ms-status">
              <StatusDot
                online={microsoft.connected}
                label="Microsoft 365"
                detail={
                  microsoft.connected
                    ? microsoft.account ?? 'Connected'
                    : 'Not connected'
                }
              />
              {microsoft.connected ? (
                <button
                  type="button"
                  className="ms-status__btn"
                  onClick={onDisconnectMicrosoft}
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  className="ms-status__btn"
                  onClick={onConnectMicrosoft}
                >
                  Connect
                </button>
              )}
            </div>
          ) : null}
        </div>
      </GlassPanel>

      <GlassPanel title="Agenda">
        <div className="stack">
          {upcoming.map((event) => (
            <div key={event.id} className="calendar-item">
              <span className="calendar-item__time">
                {formatAgendaWhen(event.start)}
              </span>
              <div>
                <div className="calendar-item__title">{event.title}</div>
                <div className="muted">
                  {event.source === 'voice' ? 'Voice' : 'Calendar'}
                </div>
              </div>
            </div>
          ))}
          {!upcoming.length ? (
            <p className="muted">
              {microsoft?.connected
                ? 'Nothing in the next day or so from Microsoft.'
                : 'Nothing scheduled — say “meeting with Sarah at 3.”'}
            </p>
          ) : null}
        </div>
      </GlassPanel>

      <GlassPanel title="Core">
        {system ? (
          <div className="metrics">
            <Metric label="CPU" value={`${system.health.cpuLoad}%`} />
            <Metric label="Memory" value={`${system.health.memoryUsedPercent}%`} />
            <Metric
              label="Uptime"
              value={formatUptime(system.health.uptimeSeconds)}
            />
          </div>
        ) : (
          <p className="muted">Connecting to brain…</p>
        )}
      </GlassPanel>
    </div>
  );
}

export function RightRail({
  transcript,
  response,
  state,
  error,
  session,
}: DashboardProps) {
  const facts = (session?.facts ?? []).slice(-4).reverse();
  const turns = (session?.turns ?? []).slice(-3).reverse();

  return (
    <div className="rail rail--right">
      <GlassPanel title="Voice">
        <div className="voice-feed">
          <div className="voice-feed__block">
            <span className="voice-feed__label">You</span>
            <p>{transcript || (state === 'listening' ? 'Speak naturally…' : '—')}</p>
          </div>
          <div className="voice-feed__block">
            <span className="voice-feed__label">Elevyn</span>
            <p>{response || '—'}</p>
          </div>
          {error ? <p className="voice-feed__error">{error}</p> : null}
        </div>
      </GlassPanel>

      <GlassPanel title="Session">
        <div className="stack">
          {facts.length ? (
            facts.map((fact, i) => (
              <div key={`${i}-${fact.slice(0, 24)}`} className="notice">
                <div className="notice__title">{fact}</div>
              </div>
            ))
          ) : (
            <p className="muted">Say “remember that…” to pin a fact.</p>
          )}
          {turns.length ? (
            <div className="session-turns">
              <span className="voice-feed__label">Recent</span>
              {turns.map((t, i) => (
                <p key={`${t.at}-${i}`} className="muted session-turns__line">
                  <span>{t.role === 'user' ? 'You' : 'Elevyn'}</span>
                  {t.text.slice(0, 72)}
                  {t.text.length > 72 ? '…' : ''}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </GlassPanel>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span className="metric__label">{label}</span>
      <span className="metric__value">{value}</span>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return `${h}h ${m}m`;
}
