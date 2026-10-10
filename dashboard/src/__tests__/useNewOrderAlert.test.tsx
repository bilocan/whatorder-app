import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNewOrderAlert } from '../hooks/useNewOrderAlert';

const { onSnapshot, playOrderAlertSound, unlockAudioContext } = vi.hoisted(() => ({
  onSnapshot: vi.fn(),
  playOrderAlertSound: vi.fn(),
  unlockAudioContext: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  onSnapshot,
  orderBy: vi.fn(),
  query: vi.fn(),
  limit: vi.fn(),
}));

vi.mock('../lib/orderAlertSound', () => ({
  playOrderAlertSound,
  unlockAudioContext,
}));

type SnapDoc = { id: string; data: () => Record<string, unknown> };
type Change = { type: 'added' | 'modified'; doc: SnapDoc };

function snap(docs: SnapDoc[], changes: Change[] = []) {
  return {
    docs,
    docChanges: () => changes,
  };
}

function doc(id: string, data: Record<string, unknown>): SnapDoc {
  return { id, data: () => data };
}

function Probe() {
  const { unseenCount } = useNewOrderAlert('biz-1');
  return <span>{unseenCount}</span>;
}

function futureStamp() {
  return new Date(Date.now() + 60_000).toISOString();
}

describe('useNewOrderAlert', () => {
  let emit: ((snap: ReturnType<typeof snap>) => void) | null = null;

  beforeEach(() => {
    emit = null;
    playOrderAlertSound.mockReset();
    unlockAudioContext.mockReset();
    unlockAudioContext.mockResolvedValue('blocked');
    vi.stubEnv('VITE_WHATSAPP_PHONE_NUMBER_ID', '');
    onSnapshot.mockImplementation((_q: unknown, cb: (snap: ReturnType<typeof snap>) => void) => {
      emit = cb;
      return vi.fn();
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function renderProbe() {
    render(<Probe />);
    if (!emit) throw new Error('snapshot listener missing');
    const send = emit;
    return (next: ReturnType<typeof snap>) => {
      act(() => { send(next); });
    };
  }

  it('keeps listening until resume resolves to running', async () => {
    const pending: Array<(value: 'running' | 'blocked') => void> = [];
    unlockAudioContext.mockImplementation(() => new Promise((resolve) => {
      pending.push(resolve);
    }));
    renderProbe();

    window.dispatchEvent(new Event('pointerdown'));
    expect(unlockAudioContext).toHaveBeenCalledTimes(1);
    pending[0]('blocked');
    await vi.waitFor(() => expect(pending).toHaveLength(1));

    window.dispatchEvent(new Event('pointerdown'));
    expect(unlockAudioContext).toHaveBeenCalledTimes(2);

    pending[1]('running');
    await vi.waitFor(() => expect(unlockAudioContext).toHaveBeenCalledTimes(2));

    window.dispatchEvent(new Event('pointerdown'));
    expect(unlockAudioContext).toHaveBeenCalledTimes(2);
  });

  it('does not play for the first snapshot', () => {
    const send = renderProbe();
    send(snap([doc('old', { status: 'pending', createdAt: futureStamp() })]));
    expect(playOrderAlertSound).not.toHaveBeenCalled();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('skips an added order whose createdAt is before subscribe time', () => {
    const send = renderProbe();
    send(snap([]));
    send(snap(
      [doc('late', { status: 'pending', createdAt: '2000-01-01T00:00:00.000Z' })],
      [{ type: 'added', doc: doc('late', { status: 'pending', createdAt: '2000-01-01T00:00:00.000Z' }) }],
    ));
    expect(playOrderAlertSound).not.toHaveBeenCalled();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('plays once for a new pending order and not again after unlock', () => {
    const send = renderProbe();
    const order = doc('new', { status: 'pending', createdAt: futureStamp(), whatsappPhoneNumberId: 'line_a' });
    send(snap([]));
    send(snap([order], [{ type: 'added', doc: order }]));
    expect(playOrderAlertSound).toHaveBeenCalledTimes(1);
    expect(screen.getByText('1')).toBeInTheDocument();

    send(snap([order], [{ type: 'modified', doc: order }]));
    expect(playOrderAlertSound).toHaveBeenCalledTimes(1);
  });

  it('ignores a non-pending add and a later status change', () => {
    const send = renderProbe();
    const approved = doc('a', { status: 'approved', createdAt: futureStamp() });
    send(snap([]));
    send(snap([approved], [{ type: 'added', doc: approved }]));
    const pending = doc('a', { status: 'pending', createdAt: futureStamp() });
    send(snap([pending], [{ type: 'modified', doc: pending }]));
    expect(playOrderAlertSound).not.toHaveBeenCalled();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('skips an order on a different WhatsApp line', () => {
    vi.stubEnv('VITE_WHATSAPP_PHONE_NUMBER_ID', 'line_a');
    const send = renderProbe();
    const other = doc('x', { status: 'pending', createdAt: futureStamp(), whatsappPhoneNumberId: 'line_b' });
    const missing = doc('y', { status: 'pending', createdAt: futureStamp() });
    send(snap([]));
    send(snap([other, missing], [
      { type: 'added', doc: other },
      { type: 'added', doc: missing },
    ]));
    expect(playOrderAlertSound).not.toHaveBeenCalled();
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});
