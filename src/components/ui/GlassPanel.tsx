import type { ReactNode } from 'react';

interface GlassPanelProps {
  title: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}

export function GlassPanel({ title, children, className = '', action }: GlassPanelProps) {
  return (
    <section className={`glass-panel ${className}`.trim()}>
      <header className="glass-panel__header">
        <h2>{title}</h2>
        {action}
      </header>
      <div className="glass-panel__body">{children}</div>
    </section>
  );
}
