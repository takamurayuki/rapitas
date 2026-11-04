/**
 * TaskStatusChange — the selected status is exposed, not only painted
 *
 * The browser E2E (#1418) had to read a CSS class to tell which status was
 * current, because the buttons carried no state a screen reader (or a test)
 * could read. Each button is a toggle in a single-choice group, so it says
 * whether it is pressed and names itself even when only the icon shows.
 */
import { render, screen } from '@testing-library/react';
import TaskStatusChange from '../TaskStatusChange';

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

describe('TaskStatusChange', () => {
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
