import { useState, useEffect, useRef, useCallback } from 'react';
import { shakeService } from '../services/shakeService';
import { storage, KEYS } from '../services/storage';

export function useShakeDetection(onShake, enabled = false) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');
  const [supported, setSupported] = useState(shakeService.isSupported());
  const listenerRef = useRef(null);
  const callbackRef = useRef(onShake);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    callbackRef.current = onShake;
  }, [onShake]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const start = useCallback(async () => {
    setError('');
    if (!shakeService.isSupported()) {
      setSupported(false);
      setError('Motion sensors not available on this device.');
      return false;
    }

    const permission = await shakeService.requestPermission();
    if (!permission) {
      setError('Motion permission denied.');
      return false;
    }

    const listener = await shakeService.startListening(
      (event) => {
        if (enabledRef.current && callbackRef.current) {
          callbackRef.current(event);
        }
      },
      {
        sensitivity: storage.get(KEYS.SHAKE_SETTINGS, {}).sensitivity || 'medium',
        cooldownMs: 15000,
      }
    );

    listenerRef.current = listener;
    setActive(true);
    return true;
  }, []);

  const stop = useCallback(async () => {
    if (listenerRef.current) {
      await listenerRef.current.stop();
      listenerRef.current = null;
    }
    setActive(false);
  }, []);

  useEffect(() => {
    return () => {
      if (listenerRef.current) {
        listenerRef.current.stop();
      }
    };
  }, []);

  return { active, supported, error, start, stop };
}