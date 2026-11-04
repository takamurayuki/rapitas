/**
 * TaskStatusChange.test
 *
 * Two contracts of the status toggle:
 * - The current-status button draws its icon in the status's icon colour, so
 *   the done check matches the card's green left line rather than the darker
 *   text green.
 * - The selected status is exposed, not only painted. The browser E2E (#1418)
 *   had to read a CSS class to tell which status was current; each button is a
 *   toggle in a single-choice group, so it says whether it is pressed and names
 *   itself even when only the icon shows.
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

describe('TaskStatusChange pressed state', () => {
  const config = {
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-l-blue-500',
    label: '進行中',
  };

  function renderButton(currentStatus: string, showLabel = false) {
    render(
      <TaskStatusChange
        status="in-progress"
        currentStatus={currentStatus}
        config={config}
        renderIcon={() => <svg data-testid="icon" />}
        onClick={() => {}}
        showLabel={showLabel}
      />,
    );
    return screen.getByRole('button', { name: '進行中' });
  }

  it.each([
    ['icon-only', false],
    ['labelled', true],
  ])('%s button is pressed when it is the current status', (_kind, showLabel) => {
    expect(renderButton('in-progress', showLabel).getAttribute('aria-pressed')).toBe('true');
  });

  it.each([
    ['icon-only', false],
    ['labelled', true],
  ])('%s button is not pressed for another status', (_kind, showLabel) => {
    expect(renderButton('todo', showLabel).getAttribute('aria-pressed')).toBe('false');
  });
});
