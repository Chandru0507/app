import { Motion } from '@capacitor/motion';
import { createShakeDetector } from './shakeDetector';

export const shakeService = {
  isSupported() {
    if (typeof window === 'undefined' || !window.DeviceMotionEvent) return false;
    return true;
  },

  isNative() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  },

  async requestPermission() {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        const permission = await DeviceMotionEvent.requestPermission();
        return permission === 'granted';
      } catch {
        return false;
      }
    }
    return true;
  },

  async startListening(callback, options = {}) {
    const detector = createShakeDetector(options);

    const listener = await Motion.addListener('accel', (event) => {
      const trigger = detector.process(event.accelerationIncludingGravity);
      if (trigger && callback) callback(trigger);
    });

    return {
      stop: async () => {
        try {
          await listener.remove();
        } catch (e) {
          console.warn('Error removing motion listener:', e.message);
        }
      },
      isActive: () => true,
    };
  },
};