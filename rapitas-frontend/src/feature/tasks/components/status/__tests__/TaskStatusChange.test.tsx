/**
 * TaskStatusChange.test
 *
 * The current-status button must draw its icon in the status's icon colour, so
 * the done check matches the card's green left line rather than the darker
 * text green.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TaskStatusChange from '../TaskStatusChange';
import { getStatusDisplay, renderStatusIcon } from '../../../config/StatusConfig';

const t = (key: string) => key;

describe('TaskStatusChange', () => {
  it('colours the current done icon like the card line', () => {
    render(
      <TaskStatusChange
        status="done"
        currentStatus="done"
        config={getStatusDisplay(t, 'done')}
        renderIcon={renderStatusIcon}
        onClick={vi.fn()}
      />,
    );
    const button = screen.getByRole('button');
    expect(button.className).toContain('text-green-500');
    expect(button.className).not.toContain('text-green-700');
  });

  it('keeps the label text green-700 in the labelled variant', () => {
    render(
      <TaskStatusChange
        status="done"
        currentStatus="done"
        config={getStatusDisplay(t, 'done')}
        renderIcon={renderStatusIcon}
        onClick={vi.fn()}
        showLabel
      />,
    );
    expect(screen.getByRole('button').className).toContain('text-green-700');
    expect(screen.getByRole('button').querySelector('span')?.className).toContain('text-green-500');
  });
});
