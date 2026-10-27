export function AlertDialog({ open, title, description, confirmText, cancelText, onConfirm, onCancel, loading, variant = 'danger' }) {
  if (!open) return null;
  const iconCls = variant === 'danger' ? 'dialog-icon-danger' : 'dialog-icon-info';
  const icon = variant === 'danger' ? (
    <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ) : (
    <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className={`dialog-icon ${iconCls}`}>{icon}</div>
        <div className="dialog-title">{title}</div>
        <div className="dialog-desc">{description}</div>
        <div className="dialog-actions">
          <button onClick={onCancel} disabled={loading} className="btn btn-outline">{cancelText || 'Cancel'}</button>
          <button onClick={onConfirm} disabled={loading} className={`btn btn-${variant}`}>
            {loading ? 'Processing...' : confirmText || 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ConfirmDialog(props) {
  return <AlertDialog {...props} variant="primary" />;
}
