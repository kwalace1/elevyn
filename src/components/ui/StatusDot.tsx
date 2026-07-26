interface StatusDotProps {
  online: boolean;
  label: string;
  detail?: string;
}

export function StatusDot({ online, label, detail }: StatusDotProps) {
  return (
    <div className="status-row">
      <span className={`status-dot ${online ? 'is-online' : 'is-offline'}`} />
      <div className="status-row__text">
        <span className="status-row__label">{label}</span>
        {detail ? <span className="status-row__detail">{detail}</span> : null}
      </div>
    </div>
  );
}
