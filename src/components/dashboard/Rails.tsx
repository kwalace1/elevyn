import { GlassPanel } from '../ui/GlassPanel';
import { StatusDot } from '../ui/StatusDot';
import type { DashboardPayload } from '../../services/api/client';
import type { ElevynState, RunningApp } from '../../types';

interface DashboardProps {
  data: DashboardPayload | null;
  transcript: string;
  response: string;
  state: ElevynState;
  aiProvider: string | null;
  error: string | null;
}

export function LeftRail({ data, aiProvider }: Pick<DashboardProps, 'data' | 'aiProvider'>) {
  const system = data?.system;

  return (
    <div className="rail rail--left">
      <GlassPanel title="Presence">
        <div className="stack">
          <StatusDot
            online={system?.macbook.online ?? false}
            label="MacBook"
            detail={system?.macbook.detail}
          />
          <StatusDot
            online={system?.windows.online ?? false}
            label="Windows PC"
            detail={system?.windows.detail}
          />
          <StatusDot
            online={system?.internet.online ?? false}
            label="Internet"
            detail={system?.internet.detail}
          />
          <StatusDot
            online={Boolean(aiProvider)}
            label="AI Provider"
            detail={aiProvider ? aiProvider : 'Local intent engine'}
          />
        </div>
      </GlassPanel>

      <GlassPanel title="Weather" action={<DemoTag />}>
        {data?.weather ? (
          <div className="weather">
            <div className="weather__temp">{data.weather.temperatureF}°</div>
            <div className="weather__meta">
              <span>{data.weather.condition}</span>
              <span>
                H {data.weather.highF}° · L {data.weather.lowF}°
              </span>
              <span className="muted">{data.weather.location}</span>
            </div>
          </div>
        ) : (
          <p className="muted">Syncing…</p>
        )}
      </GlassPanel>

      <GlassPanel title="System Health">
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
  data,
  transcript,
  response,
  state,
  error,
}: DashboardProps) {
  return (
    <div className="rail rail--right">
      <GlassPanel title="Today" action={<DemoTag />}>
        <div className="stack">
          {(data?.calendar ?? []).map((event) => (
            <div key={event.id} className="calendar-item">
              <span className="calendar-item__time">
                {new Date(event.start).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
              <div>
                <div className="calendar-item__title">{event.title}</div>
                {event.location ? (
                  <div className="muted">{event.location}</div>
                ) : null}
              </div>
            </div>
          ))}
          {!data?.calendar?.length ? <p className="muted">No events</p> : null}
        </div>
      </GlassPanel>

      <GlassPanel title="Notifications" action={<DemoTag />}>
        <div className="stack">
          {(data?.notifications ?? []).map((n) => (
            <div key={n.id} className="notice">
              <div className="notice__title">
                {n.unread ? <span className="notice__pip" /> : null}
                {n.title}
              </div>
              <div className="muted">{n.body}</div>
            </div>
          ))}
        </div>
      </GlassPanel>

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

      <GlassPanel title="Running">
        <div className="app-list">
          {(data?.system.apps ?? []).map((app: RunningApp) => (
            <span key={app.name} className="app-chip">
              {app.name}
            </span>
          ))}
          {!data?.system.apps?.length ? <p className="muted">—</p> : null}
        </div>
      </GlassPanel>
    </div>
  );
}

function DemoTag() {
  return <span className="panel-tag">Demo</span>;
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
