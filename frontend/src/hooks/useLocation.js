import { useState, useCallback } from 'react';
import {
  LOCATION_STATUS,
  LOCATION_DEADLINE_MS,
  GEO_OPTIONS,
  describeFix,
  unavailableLocation,
} from '../services/locationFix.js';

// There is no placeholder location anymore: when no fix is available the
// returned object keeps latitude/longitude null and says why in `status`.
// The hard deadline guarantees this hook never blocks a caller (SOS in
// particular) on GPS or on the Android permission dialog.

export { LOCATION_STATUS, unavailableLocation, describeFix };

export function useLocation() {
  const [location, setLocation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [permissionDenied, setPermissionDenied] = useState(false);

  const getCurrentLocation = useCallback(async () => {
    setLoading(true);
    setError('');

    let settled = false;
    const apply = (fn) => {
      if (!settled) fn();
    };

    const attempt = (async () => {
      // Capacitor Geolocation first (Android)
      if (
        typeof window !== 'undefined' &&
        window.Capacitor &&
        window.Capacitor.isNativePlatform &&
        window.Capacitor.isNativePlatform()
      ) {
        try {
          const { Geolocation } = await import('@capacitor/geolocation');
          const permission = await Geolocation.requestPermissions();
          if (permission.location !== 'granted') {
            setPermissionDenied(true);
            apply(() =>
              setError('Location permission denied. The SOS is recorded without coordinates.')
            );
            return unavailableLocation(LOCATION_STATUS.PERMISSION_DENIED);
          }
          const position = await Geolocation.getCurrentPosition(GEO_OPTIONS);
          const fix = describeFix(position, 'gps');
          if (fix.hasFix) {
            apply(() => setLocation(fix));
          } else {
            apply(() => setError('No usable GPS fix. The SOS is recorded without coordinates.'));
          }
          return fix;
        } catch (err) {
          console.warn('Geolocation error:', err.message);
          apply(() => setError('Unable to get a GPS fix. The SOS is recorded without coordinates.'));
          return unavailableLocation(LOCATION_STATUS.UNAVAILABLE);
        }
      }

      // Browser fallback
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        const position = await new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            resolve,
            (err) => resolve({ __error: err }),
            GEO_OPTIONS
          );
        });

        if (position && position.__error) {
          if (position.__error.code === 1) {
            setPermissionDenied(true);
            apply(() =>
              setError('Location permission denied. The SOS is recorded without coordinates.')
            );
            return unavailableLocation(LOCATION_STATUS.PERMISSION_DENIED);
          }
          apply(() => setError('Location unavailable. The SOS is recorded without coordinates.'));
          return unavailableLocation(LOCATION_STATUS.UNAVAILABLE);
        }

        const fix = describeFix(position, 'browser-gps');
        if (fix.hasFix) {
          apply(() => setLocation(fix));
        } else {
          apply(() => setError('No usable location fix. The SOS is recorded without coordinates.'));
        }
        return fix;
      }

      // No geolocation available
      apply(() => setError('Geolocation is not supported. The SOS is recorded without coordinates.'));
      return unavailableLocation(LOCATION_STATUS.UNAVAILABLE);
    })();

    let deadlineTimer;
    const deadline = new Promise((resolve) => {
      deadlineTimer = setTimeout(
        () => resolve(unavailableLocation(LOCATION_STATUS.TIMEOUT)),
        LOCATION_DEADLINE_MS
      );
    });

    let result;
    try {
      result = await Promise.race([attempt, deadline]);
    } catch (err) {
      console.warn('Location request failed:', err.message);
      result = unavailableLocation(LOCATION_STATUS.UNAVAILABLE);
    } finally {
      clearTimeout(deadlineTimer);
      settled = true;
      setLoading(false);
    }

    return result;
  }, []);

  return { location, loading, error, permissionDenied, getCurrentLocation, setPermissionDenied, setError };
}
