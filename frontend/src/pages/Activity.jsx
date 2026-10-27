import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';

export default function Activity() {
  const { token } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchEvents() {
      try {
        const res = await api.get('/api/auth/events', token);
        setEvents(res.events || []);
        setError('');
      } catch (err) {
        setError(err.message || 'Failed to load activity.');
      } finally {
        setLoading(false);
      }
    }
    if (token) fetchEvents();
  }, [token]);

  if (loading) return <div className="loading-center"><div className="spinner" /></div>;

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-heading">
          <h1 className="page-title">Safety Activity</h1>
          <p className="page-desc">Your emergency events and safety sessions</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {events.length === 0 ? (
          <div className="card">
            <div className="empty">
              <div className="empty-icon">
                <svg width="28" height="28" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="empty-title">No activity yet</div>
              <div className="empty-desc">Your safety events and sessions will appear here.</div>
            </div>
          </div>
        ) : (
          <div className="card">
            {events.map((event) => (
              <div key={event._id} className="activity-item">
                <div className="activity-icon" style={{
                  background: event.status === 'active' ? 'rgba(230,57,70,0.15)' : 'rgba(16,185,129,0.15)',
                  color: event.status === 'active' ? '#E63946' : '#10B981'
                }}>
                  <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="activity-content">
                  <div className="activity-title">Emergency SOS — {event.category}</div>
                  <div className="activity-desc">
                    Status: {event.status} | {new Date(event.triggeredAt).toLocaleString()}
                  </div>
                </div>
                <span className="activity-time">{new Date(event.triggeredAt).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}