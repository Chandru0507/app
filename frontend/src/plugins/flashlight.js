import { registerPlugin } from '@capacitor/core';

const Flashlight = registerPlugin('Flashlight');

export const flashlightService = {
  isNative() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  },

  async isAvailable() {
    if (!this.isNative()) return { available: false, reason: 'native_only' };
    try {
      const result = await Flashlight.isAvailable();
      return { available: result.available };
    } catch (err) {
      return { available: false, reason: err.message };
    }
  },

  async enable() {
    if (!this.isNative()) throw new Error('Flashlight requires a native Android device');
    return Flashlight.enable();
  },

  async disable() {
    if (!this.isNative()) return;
    return Flashlight.disable();
  },

  async isEnabled() {
    if (!this.isNative()) return { enabled: false };
    try {
      const result = await Flashlight.isEnabled();
      return result;
    } catch {
      return { enabled: false };
    }
  },

  async strobe(patternMs = 200, durationMs = 3000) {
    if (!this.isNative()) return { started: false, reason: 'native_only' };
    const start = Date.now();
    let on = false;
    const interval = setInterval(async () => {
      if (Date.now() - start >= durationMs) {
        clearInterval(interval);
        await this.disable();
        return;
      }
      on = !on;
      try {
        if (on) await this.enable();
        else await this.disable();
      } catch {
        clearInterval(interval);
      }
    }, patternMs);
    return { started: true, stop: () => { clearInterval(interval); this.disable(); } };
  },
};