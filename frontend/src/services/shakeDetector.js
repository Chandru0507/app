// Pure shake-detection algorithm — no Capacitor/browser dependencies.
// Keeps this logic unit-testable in Node.js.

export const SENSITIVITY_PRESETS = {
  low: { threshold: 30, minShakes: 4, windowMs: 1000 },
  medium: { threshold: 22, minShakes: 3, windowMs: 800 },
  high: { threshold: 16, minShakes: 2, windowMs: 600 },
};

export function magnitudeFromAcceleration(acc) {
  const x = acc && typeof acc.x === 'number' ? acc.x : 0;
  const y = acc && typeof acc.y === 'number' ? acc.y : 0;
  const z = acc && typeof acc.z === 'number' ? acc.z : 0;
  return Math.sqrt(x * x + y * y + z * z);
}

export function createShakeDetector(options = {}) {
  const preset = SENSITIVITY_PRESETS[options.sensitivity] || SENSITIVITY_PRESETS.medium;
  const cooldownMs = typeof options.cooldownMs === 'number' ? options.cooldownMs : 15000;

  let motionTimes = [];
  let lastTrigger = 0;
  let triggerCount = 0;

  const detector = {
    // Process a single accelerometer sample.
    // Returns a trigger event object, or null if no shake detected.
    process(acc, now = Date.now()) {
      const magnitude = magnitudeFromAcceleration(acc);
      if (magnitude < preset.threshold) return null;

      motionTimes.push(now);
      while (motionTimes.length > 0 && now - motionTimes[0] > preset.windowMs) {
        motionTimes.shift();
      }

      if (motionTimes.length < preset.minShakes) return null;

      if (now - lastTrigger < cooldownMs) return null;

      lastTrigger = now;
      motionTimes = [];
      triggerCount += 1;

      return {
        timestamp: now,
        magnitude,
        sensitivity: options.sensitivity || 'medium',
        triggerCount,
      };
    },

    reset() {
      motionTimes = [];
      lastTrigger = 0;
      triggerCount = 0;
    },

    get triggerCount() {
      return triggerCount;
    },
  };

  return detector;
}