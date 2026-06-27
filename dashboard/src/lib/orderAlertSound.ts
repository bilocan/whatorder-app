let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

/** Resumes the (autoplay-suspended) AudioContext — must be called from a user gesture handler. */
export function unlockAudioContext(): void {
  const c = getContext();
  if (c && c.state === 'suspended') {
    c.resume().catch(() => {});
  }
}

/** Plays a short two-tone beep. No-ops if AudioContext is unsupported or still suspended. */
export function playOrderAlertSound(): void {
  const c = getContext();
  if (!c || c.state !== 'running') return;

  const playTone = (freq: number, startAt: number, durationSec: number) => {
    const osc = c!.createOscillator();
    const gain = c!.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(0.3, startAt + 0.02);
    gain.gain.linearRampToValueAtTime(0, startAt + durationSec);
    osc.connect(gain);
    gain.connect(c!.destination);
    osc.start(startAt);
    osc.stop(startAt + durationSec);
  };

  const now = c.currentTime;
  playTone(880, now, 0.15);
  playTone(1175, now + 0.18, 0.18);
}
