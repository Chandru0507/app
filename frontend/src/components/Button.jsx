export function Button({ children, variant = 'primary', size = 'md', loading = false, disabled, className = '', block, ...props }) {
  const cls = `btn btn-${variant} btn-${size}${block ? ' btn-block' : ''} ${className}`.trim();
  return (
    <button className={cls} disabled={disabled || loading} {...props}>
      {loading && <span className="spinner" style={{ width: '1rem', height: '1rem', borderWidth: '2px', marginRight: '0.5rem' }} />}
      {children}
    </button>
  );
}

export function SOSButton({ onClick, loading, active }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`btn btn-block ${active ? 'sos-btn-active' : 'sos-btn'}`}
      aria-label={active ? 'Cancel SOS' : 'Activate SOS'}
    >
      {loading ? (
        <span className="spinner" style={{ width: '1.25rem', height: '1.25rem', borderWidth: '3px', marginRight: '0.625rem' }} />
      ) : (
        <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ marginRight: '0.625rem' }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      )}
      <span style={{ fontSize: '1.125rem', fontWeight: 800, letterSpacing: '0.05em' }}>
        {active ? 'CANCEL SOS' : 'ACTIVATE SOS'}
      </span>
    </button>
  );
}
