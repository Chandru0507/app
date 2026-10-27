import { useState, useEffect, useCallback } from 'react';
import { offlineQueue } from '../services/offlineQueue';

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [lastSync, setLastSync] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const updateCount = () => {
      setPendingCount(offlineQueue.getPending().length);
    };
    updateCount();
    const unsub = offlineQueue.subscribe(updateCount);
    return unsub;
  }, []);

  const syncNow = useCallback(async (api, token) => {
    if (!navigator.onLine) return { success: false, reason: 'offline' };
    try {
      const results = await offlineQueue.sync(api, token);
      setLastSync(Date.now());
      return { success: true, results };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  }, []);

  return { isOnline, lastSync, pendingCount, syncNow };
}