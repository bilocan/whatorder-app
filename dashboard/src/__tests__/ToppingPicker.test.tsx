import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import ToppingPicker from '../components/intent-playground/ToppingPicker';
import type { MenuOptionGroup } from '../types';

const MULTI_GROUP: MenuOptionGroup = {
  id: 'beilagen',
  label: 'Beilagen',
  type: 'multi',
  multiDefault: 'custom',
  defaultOptionIds: ['tomato'],
  options: [
    { id: 'tomato', label: 'Tomate' },
    { id: 'salad', label: 'Salat' },
    { id: 'onion', label: 'Zwiebel' },
  ],
};

const SINGLE_GROUP: MenuOptionGroup = {
  id: 'size',
  label: 'Größe',
  type: 'single',
  options: [
    { id: 's33', label: '33cm' },
    { id: 's40', label: '40cm' },
  ],
};

describe('ToppingPicker', () => {
  it('toggles a multi option on and off', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ToppingPicker
        groups={[MULTI_GROUP]}
        value={{ beilagen: ['tomato'] }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByLabelText('Salat'));
    expect(onChange).toHaveBeenCalledWith({ beilagen: ['tomato', 'salad'] });

    await user.click(screen.getByLabelText('Tomate'));
    expect(onChange).toHaveBeenCalledWith({ beilagen: [] });
  });

  it('picks exactly one option in a single group', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ToppingPicker
        groups={[SINGLE_GROUP]}
        value={{ size: ['s33'] }}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByLabelText('40cm'));
    expect(onChange).toHaveBeenCalledWith({ size: ['s40'] });
  });

  it('marks default options with a hint dot', () => {
    render(
      <ToppingPicker
        groups={[MULTI_GROUP]}
        value={{ beilagen: [] }}
        onChange={vi.fn()}
      />,
    );

    // multiDefault: 'custom' with defaultOptionIds ['tomato'] → only one marker
    expect(screen.getAllByTitle('Default')).toHaveLength(1);
  });

  it('ignores clicks while disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ToppingPicker
        groups={[MULTI_GROUP]}
        value={{ beilagen: ['tomato'] }}
        onChange={onChange}
        disabled
      />,
    );

    await user.click(screen.getByLabelText('Salat'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Salat')).toBeDisabled();
  });
});
