/**
 * HelpTip.test
 *
 * A field's explanation behind a small ? beside its label, so the form shows
 * the fields and the details only on demand: on hover, on keyboard focus, and
 * on tap; Escape closes it.
 */
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HelpTip } from '../HelpTip';

describe('HelpTip', () => {
  it('hides the explanation until asked', () => {
    render(<HelpTip label="成果物の説明">PR はコードを変えます</HelpTip>);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.getByRole('button', { name: '成果物の説明' })).toBeTruthy();
  });

  it('shows it on hover and hides it when the pointer leaves', () => {
    render(<HelpTip label="成果物の説明">PR はコードを変えます</HelpTip>);
    const button = screen.getByRole('button', { name: '成果物の説明' });
    fireEvent.mouseEnter(button);
    expect(screen.getByRole('tooltip').textContent).toBe('PR はコードを変えます');
    expect(button.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
    fireEvent.mouseLeave(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows it on keyboard focus and closes on Escape', () => {
    render(<HelpTip label="成果物の説明">PR はコードを変えます</HelpTip>);
    const button = screen.getByRole('button', { name: '成果物の説明' });
    fireEvent.focus(button);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('toggles on tap, for a screen with no hover', () => {
    render(<HelpTip label="成果物の説明">PR はコードを変えます</HelpTip>);
    const button = screen.getByRole('button', { name: '成果物の説明' });
    fireEvent.click(button);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.click(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
