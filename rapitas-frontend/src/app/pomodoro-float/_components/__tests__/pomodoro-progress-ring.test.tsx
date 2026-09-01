/**
 * pomodoroProgressRing.test
 *
 * Verifies the ring's stroke-dashoffset reflects 0%/100% progress at the
 * boundary inputs and that a zero totalSeconds does not crash (division by
 * zero guard).
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import PomodoroProgressRing from '../pomodoro-progress-ring';

const RADIUS = (120 - 8) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function getProgressCircle(container: HTMLElement): SVGCircleElement {
  const circles = container.querySelectorAll('circle');
  // Second circle is the progress indicator (first is the track).
  return circles[1] as SVGCircleElement;
}

describe('PomodoroProgressRing', () => {
  it('remainingSeconds === totalSeconds renders 0% progress (full dashoffset)', () => {
    const { container } = render(
      <PomodoroProgressRing remainingSeconds={1500} totalSeconds={1500} isBreakTime={false} />,
    );
    const circle = getProgressCircle(container);
    expect(Number(circle.getAttribute('stroke-dashoffset'))).toBeCloseTo(CIRCUMFERENCE, 5);
  });

  it('remainingSeconds === 0 renders 100% progress (zero dashoffset)', () => {
    const { container } = render(
      <PomodoroProgressRing remainingSeconds={0} totalSeconds={1500} isBreakTime={false} />,
    );
    const circle = getProgressCircle(container);
    expect(Number(circle.getAttribute('stroke-dashoffset'))).toBeCloseTo(0, 5);
  });

  it('does not crash when totalSeconds is 0', () => {
    expect(() =>
      render(<PomodoroProgressRing remainingSeconds={0} totalSeconds={0} isBreakTime={false} />),
    ).not.toThrow();
  });
});
