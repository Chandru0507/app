// Web Audio API based emergency siren — no plugin required.
// Generates an alternating two-tone siren using oscillators.

let audioContext = null;
let sirenNodes = null;

function getContext() {
  if (!audioContext) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioContext = new Ctx();
  }
  return audioContext;
}

export const sirenService = {
  isSupported() {
    return !!(window.AudioContext || window.webkitAudioContext);
  },

  async start(frequencyLow = 700, frequencyHigh = 1000, intervalMs = 600) {
    const ctx = getContext();
    if (!ctx) return { started: false, reason: 'audio_unsupported' };

    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* ignore */ }
    }

    this.stop();

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequencyLow;
    gain.gain.value = 0.15;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();

    let high = false;
    const toggle = setInterval(() => {
      high = !high;
      try {
        oscillator.frequency.setValueAtTime(high ? frequencyHigh : frequencyLow, ctx.currentTime);
      } catch { /* ignore */ }
    }, intervalMs);

    sirenNodes = { oscillator, gain, toggle, ctx };

    return { started: true };
  },

  stop() {
    if (!sirenNodes) return;
    try {
      clearInterval(sirenNodes.toggle);
      sirenNodes.oscillator.stop();
      sirenNodes.gain.disconnect();
      sirenNodes.oscillator.disconnect();
    } catch { /* ignore */ }
    sirenNodes = null;
  },

  isPlaying() {
    return sirenNodes !== null;
  },
};