export function Card({ children, className = '', style }) {
  return <div className={`card ${className}`.trim()} style={style}>{children}</div>;
}

export function CardHeader({ title, subtitle, action, icon }) {
  return (
    <div className="row between" style={{ marginBottom: '1rem' }}>
      <div className="row gap-sm">
        {icon && <div style={{ color: 'var(--gold)' }}>{icon}</div>}
        <div>
          <div className="card-title">{title}</div>
          {subtitle && <div className="card-subtitle">{subtitle}</div>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function StatusBadge({ status }) {
  const map = {
    active: 'badge-green', online: 'badge-green', emergency: 'badge-red',
    cancelled: 'badge-gray', resolved: 'badge-blue', completed: 'badge-green',
    terminated: 'badge-gray', paused: 'badge-yellow', pending: 'badge-yellow',
    failed: 'badge-red', away: 'badge-yellow', offline: 'badge-gray',
  };
  const cls = map[status] || 'badge-gray';
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={`badge ${cls}`}>
      <span className="badge-dot" />
      {label}
    </span>
  );
}
