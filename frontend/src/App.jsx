import { useState } from 'react'
import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { useNetworkStatus } from './hooks/useNetworkStatus'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import Safety from './pages/Safety'
import SafetySessions from './pages/SafetySessions'
import Activity from './pages/Activity'
import SafetyGuide from './pages/SafetyGuide'
import SafeZones from './pages/SafeZones'
import Settings from './pages/Settings'
import EvidenceVault from './pages/EvidenceVault'

function Navigation() {
  const { isAuthenticated, user, logout } = useAuth()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const { isOnline, pendingCount } = useNetworkStatus()

  const links = isAuthenticated
    ? [
        { to: '/dashboard', label: 'Dashboard' },
        { to: '/safety', label: 'Safety' },
        { to: '/sessions', label: 'Sessions' },
        { to: '/activity', label: 'Activity' },
        { to: '/guide', label: 'Guide' },
        { to: '/zones', label: 'Zones' },
        { to: '/evidence', label: 'Evidence' },
        { to: '/settings', label: 'Settings' },
      ]
    : [{ to: '/login', label: 'Sign In' }, { to: '/register', label: 'Get Started' }]

  const isActive = (p) => location.pathname === p

  return (
    <>
      <nav className="nav">
        <div className="nav-bar">
          <Link to="/" className="nav-brand" onClick={() => setMenuOpen(false)}>
            <div className="nav-brand-icon">
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <span>KAVACH</span>
          </Link>

          <div className="nav-items">
            {links.map(({ to, label }) => (
              <Link key={to} to={to} className={`nav-item ${isActive(to) ? 'active' : ''}`}>{label}</Link>
            ))}
            {isAuthenticated && (
              <>
                <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', padding: '0 0.5rem' }}>
                  {user?.name?.split(' ')[0]}
                </span>
                <button onClick={logout} className="nav-item" style={{ color: '#F87171' }}>Logout</button>
              </>
            )}
          </div>

          <button className="nav-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu">
            <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {menuOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
          </button>
        </div>
      </nav>

      <div className={`nav-dropdown ${menuOpen ? 'open' : ''}`}>
        {links.map(({ to, label }) => (
          <Link key={to} to={to} className={`nav-item ${isActive(to) ? 'active' : ''}`} onClick={() => setMenuOpen(false)}>{label}</Link>
        ))}
        {isAuthenticated && <button onClick={logout} className="nav-item" style={{ color: '#F87171', textAlign: 'left' }}>Logout</button>}
      </div>

      {!isOnline && (
        <div style={{
          position: 'fixed', top: '3.5rem', left: 0, right: 0, zIndex: 48,
          background: 'rgba(230,57,70,0.95)', color: '#fff', textAlign: 'center',
          padding: '0.375rem', fontSize: '0.75rem', fontWeight: 600,
        }}>
          Offline Mode {pendingCount > 0 ? `• ${pendingCount} queued` : ''}
        </div>
      )}
    </>
  )
}

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth()
  if (loading) return <div className="loading-center"><div className="spinner" style={{ width: '2.5rem', height: '2.5rem' }} /></div>
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}

function LandingPage() {
  const { isAuthenticated } = useAuth()
  if (isAuthenticated) return <Navigate to="/dashboard" replace />

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--navy)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
      <div style={{ textAlign: 'center', maxWidth: '28rem' }}>
        <div style={{ width: '5rem', height: '5rem', borderRadius: '1.25rem', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 2rem', boxShadow: '0 8px 32px rgba(232,180,37,0.3)' }}>
          <svg width="3rem" height="3rem" fill="none" stroke="var(--navy)" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
        <h1 style={{ fontSize: '2.25rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
          Your Safety.<br /><span style={{ color: 'var(--gold)' }}>Your Shield.</span>
        </h1>
        <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '1rem', marginTop: '1rem', marginBottom: '2.5rem', lineHeight: 1.7 }}>
          Personal safety platform with one-tap emergency response and real-time location sharing.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', maxWidth: '16rem', margin: '0 auto' }}>
          <Link to="/register" className="btn btn-gold btn-lg btn-block">Create Account</Link>
          <Link to="/login" className="btn btn-block" style={{ background: 'transparent', color: 'var(--gold)', border: '1px solid rgba(232,180,37,0.3)' }}>Sign In</Link>
        </div>
        <p style={{ color: 'rgba(255,255,255,0.25)', fontSize: '0.75rem', marginTop: '3rem' }}>
          One tap. One signal. Someone knows.
        </p>
      </div>
    </div>
  )
}

function App() {
  return (
    <Router>
      <Navigation />
      <main>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/safety" element={<ProtectedRoute><Safety /></ProtectedRoute>} />
          <Route path="/sessions" element={<ProtectedRoute><SafetySessions /></ProtectedRoute>} />
          <Route path="/activity" element={<ProtectedRoute><Activity /></ProtectedRoute>} />
          <Route path="/guide" element={<ProtectedRoute><SafetyGuide /></ProtectedRoute>} />
          <Route path="/zones" element={<ProtectedRoute><SafeZones /></ProtectedRoute>} />
          <Route path="/evidence" element={<ProtectedRoute><EvidenceVault /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </Router>
  )
}

export default App