let ctx: AudioContext | null = null;

export type OrderAlertUnlockResult = 'running' | 'blocked' | 'unsupported';
export type OrderAlertSoundResult = 'started' | 'blocked' | 'unsupported';

function audioConstructor(): typeof AudioContext | undefined {
  return window.AudioContext
    || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

function getContext(): AudioContext | null {
  if (ctx && ctx.state !== 'closed') return ctx;
  const Ctor = audioConstructor();
  if (!Ctor) {
    ctx = null;
    return null;
  }
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
    return null;
  }
  return ctx;
}

/** Drops the cached context so tests can install a new AudioContext. */
export function resetOrderAlertAudioForTests(): void {
  ctx = null;
}

/**
 * Resumes the shared context. Must be called from a user gesture.
 * `resume()` is async: the returned state is the one after that promise settles.
 */
export async function unlockAudioContext(): Promise<OrderAlertUnlockResult> {
  const c = getContext();
  if (!c) return 'unsupported';
  // `interrupted` exists in Chrome but not in this project's DOM lib.
  const state = c.state as AudioContextState | 'interrupted';
  if (state === 'running') return 'running';
  if (state === 'suspended' || state === 'interrupted') {
    try {
      await c.resume();
    } catch {
      return 'blocked';
    }
  }
  return c.state === 'running' ? 'running' : 'blocked';
}

/** Plays the two-tone beep. No-ops unless the shared context is already running. */
export function playOrderAlertSound(): boolean {
  const c = getContext();
  if (!c || c.state !== 'running') return false;

  const playTone = (freq: number, startAt: number, durationSec: number) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(0.3, startAt + 0.02);
    gain.gain.linearRampToValueAtTime(0, startAt + durationSec);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(startAt);
    osc.stop(startAt + durationSec);
  };

  const now = c.currentTime;
  playTone(880, now, 0.15);
  playTone(1175, now + 0.18, 0.18);
  return true;
}

/** Unlocks, then plays the same beep a new order uses. */
export async function playTestOrderAlert(): Promise<OrderAlertSoundResult> {
  const unlocked = await unlockAudioContext();
  if (unlocked === 'unsupported') return 'unsupported';
  if (unlocked !== 'running') return 'blocked';
  return playOrderAlertSound() ? 'started' : 'blocked';
}
