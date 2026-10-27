import { useState } from 'react';

export function FormField({ label, error, children, required }) {
  return (
    <div className="field">
      {label && (
        <label className="field-label">
          {label} {required && <span className="req">*</span>}
        </label>
      )}
      {children}
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}

export function TextInput({ icon, error, className = '', ...props }) {
  return (
    <div className={`input-wrap ${className}`.trim()}>
      {icon && <span className="input-icon">{icon}</span>}
      <input
        className={`input ${icon ? 'input-with-icon' : ''} ${error ? 'input-error' : ''}`}
        {...props}
      />
    </div>
  );
}

export function PasswordInput({ value, onChange, placeholder, error }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="input-wrap">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={`input input-with-icon ${error ? 'input-error' : ''}`}
        autoComplete="current-password"
      />
      <button
        type="button"
        onClick={() => setVisible(!visible)}
        className="input-toggle"
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? (
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
          </svg>
        ) : (
          <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        )}
      </button>
    </div>
  );
}
