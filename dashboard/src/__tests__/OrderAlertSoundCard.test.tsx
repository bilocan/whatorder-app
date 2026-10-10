import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OrderAlertSoundCard from '../components/OrderAlertSoundCard';
import de from '../locales/de.json';
import en from '../locales/en.json';
import tr from '../locales/tr.json';

const { playTestOrderAlert } = vi.hoisted(() => ({
  playTestOrderAlert: vi.fn(),
}));

vi.mock('../lib/orderAlertSound', () => ({
  playTestOrderAlert,
}));

const KEYS = ['title', 'description', 'test', 'started', 'blocked', 'unsupported'] as const;

describe('OrderAlertSoundCard', () => {
  beforeEach(() => {
    playTestOrderAlert.mockReset();
  });

  it('has the same orderAlert keys in de, en, and tr', () => {
    for (const key of KEYS) {
      expect(en.settings.orderAlert[key]).toBeTruthy();
      expect(de.settings.orderAlert[key]).toBeTruthy();
      expect(tr.settings.orderAlert[key]).toBeTruthy();
    }
  });

  it('shows started only after the beep promise resolves', async () => {
    let release: (value: 'started') => void = () => {};
    playTestOrderAlert.mockImplementation(() => new Promise((resolve) => {
      release = resolve;
    }));

    render(<OrderAlertSoundCard />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Test sound' }));

    expect(screen.queryByText(/Beep started/)).not.toBeInTheDocument();
    release('started');
    expect(await screen.findByText(/Beep started/)).toBeInTheDocument();
    expect(screen.getByText(/check this PC's speakers/)).toBeInTheDocument();
  });

  it('shows the blocked line when the browser still holds audio', async () => {
    playTestOrderAlert.mockResolvedValue('blocked');
    render(<OrderAlertSoundCard />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Test sound' }));
    expect(await screen.findByText(/still blocking sound/)).toBeInTheDocument();
  });
});
