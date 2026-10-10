import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  playOrderAlertSound,
  playTestOrderAlert,
  resetOrderAlertAudioForTests,
  unlockAudioContext,
} from '../orderAlertSound';

type MockCtx = {
  state: AudioContextState;
  currentTime: number;
  destination: Record<string, never>;
  resume: ReturnType<typeof vi.fn>;
  createOscillator: () => { start: ReturnType<typeof vi.fn> };
};

function installAudio(initial: AudioContextState = 'suspended') {
  const start = vi.fn();
  const ctx: MockCtx = {
    state: initial,
    currentTime: 0,
    destination: {},
    resume: vi.fn(),
    createOscillator: () => ({
      type: 'sine',
      frequency: { value: 0 },
      connect: () => {},
      start,
      stop: () => {},
    } as unknown as { start: ReturnType<typeof vi.fn> }),
    createGain: () => ({
      gain: {
        setValueAtTime: () => {},
        linearRampToValueAtTime: () => {},
      },
      connect: () => {},
    }),
  } as unknown as MockCtx;
  ctx.resume.mockImplementation(() => {
    ctx.state = 'running';
    return Promise.resolve();
  });
  class FakeAudioContext {
    constructor() {
      return ctx;
    }
  }
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('webkitAudioContext', undefined);
  resetOrderAlertAudioForTests();
  return { ctx, start };
}

describe('orderAlertSound', () => {
  afterEach(() => {
    resetOrderAlertAudioForTests();
    vi.unstubAllGlobals();
  });

  it('does not play or resume while the context is suspended', () => {
    const { ctx, start } = installAudio('suspended');
    expect(playOrderAlertSound()).toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(ctx.resume).not.toHaveBeenCalled();
  });

  it('plays only after resume resolves to running', async () => {
    const { ctx, start } = installAudio('suspended');
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    ctx.resume.mockImplementation(() => gate.then(() => {
      ctx.state = 'running';
    }));

    const pending = playTestOrderAlert();
    expect(start).not.toHaveBeenCalled();

    release();
    await expect(pending).resolves.toBe('started');
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('resumes an interrupted context', async () => {
    const { start } = installAudio('interrupted');
    await expect(unlockAudioContext()).resolves.toBe('running');
    expect(playOrderAlertSound()).toBe(true);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('reports blocked when resume fails', async () => {
    const { ctx, start } = installAudio('suspended');
    ctx.resume.mockRejectedValue(new Error('gesture'));
    await expect(playTestOrderAlert()).resolves.toBe('blocked');
    expect(start).not.toHaveBeenCalled();
  });

  it('reports unsupported when AudioContext is missing', async () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
    resetOrderAlertAudioForTests();
    await expect(playTestOrderAlert()).resolves.toBe('unsupported');
  });
});
