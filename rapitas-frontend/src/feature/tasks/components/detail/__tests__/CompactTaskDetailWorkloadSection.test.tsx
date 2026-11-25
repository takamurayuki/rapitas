/**
 * CompactTaskDetailWorkloadSection.test
 *
 * The due date is saved by this section, and the only thing that proves it is
 * saved is that the value the user chose reaches `patchTask`.
 *
 * It did not. The section persists on blur, and picking a date from the
 * calendar button never blurs the text field — the hidden picker input is
 * `tabIndex=-1` and the click lands on the button — so a date chosen that way
 * appeared in the field and was never stored (reported 2026-10-31).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { Task } from '@/types';
import CompactTaskDetailWorkloadSection from '../CompactTaskDetailWorkloadSection';

/** The parent passes its own translator down; only the keys matter here. */
const t = ((key: string) => key) as unknown as React.ComponentProps<
  typeof CompactTaskDetailWorkloadSection
>['t'];

const task = { id: 1, title: 'x', status: 'todo', subtasks: [] } as unknown as Task;

type PatchTask = React.ComponentProps<typeof CompactTaskDetailWorkloadSection>['patchTask'];

function renderSection(overrides: { dueDateInput?: string }) {
  const patchTask = vi.fn<PatchTask>(async () => {});
  const setDueDateInput = vi.fn();
  const result = render(
    <CompactTaskDetailWorkloadSection
      task={task}
      t={t}
      estHoursInput=""
      setEstHoursInput={vi.fn()}
      actHoursInput=""
      setActHoursInput={vi.fn()}
      dueDateInput={overrides.dueDateInput ?? ''}
      setDueDateInput={setDueDateInput}
      patchTask={patchTask}
    />,
  );
  return { ...result, patchTask, setDueDateInput };
}

/** The hidden `datetime-local` the calendar button opens. */
const pickerIn = (container: HTMLElement) =>
  container.querySelector('input[type="datetime-local"]') as HTMLInputElement;

describe('the due date', () => {
  it('is saved with the value picked from the calendar', () => {
    const { container, patchTask } = renderSection({});

    fireEvent.change(pickerIn(container), { target: { value: '2026-12-24T10:00' } });

    expect(patchTask).toHaveBeenCalledWith({
      dueDate: new Date('2026-12-24T10:00').toISOString(),
    });
  });

  // The value has to come from the pick itself, not from the state the section
  // was rendered with: a save that reads `dueDateInput` in the same tick still
  // holds the previous render's value and would store the old date.
  it('is saved as the date just picked, not the one already on screen', () => {
    const { container, patchTask } = renderSection({ dueDateInput: '2026-01-01T09:00' });

    fireEvent.change(pickerIn(container), { target: { value: '2026-12-24T10:00' } });

    expect(patchTask).toHaveBeenCalledWith({
      dueDate: new Date('2026-12-24T10:00').toISOString(),
    });
  });

  it('still saves what was typed when the field is left', () => {
    const { container, patchTask } = renderSection({ dueDateInput: '2026-12-24T10:00' });
    const field = container.querySelector('input[type="text"]') as HTMLInputElement;

    fireEvent.blur(field);

    expect(patchTask).toHaveBeenCalledWith({
      dueDate: new Date('2026-12-24T10:00').toISOString(),
    });
  });

  // 2026-11-25: 「日付と時刻を登録しても登録されないことがある」. A pick saves
  // the new date, and leaving the field afterwards saved `dueDateInput` — still
  // the date from before the pick — as a second, unordered PATCH. Whichever
  // reached the backend last won, so the picked date was sometimes lost.
  it('does not overwrite a picked date with the old one when the field is left', async () => {
    const { container, patchTask } = renderSection({ dueDateInput: '2026-01-01T09:00' });

    fireEvent.change(pickerIn(container), { target: { value: '2026-12-24T10:00' } });
    fireEvent.blur(container.querySelector('input[type="text"]') as HTMLInputElement);
    await Promise.resolve();
    await Promise.resolve();

    const sent = patchTask.mock.calls.map(([data]) => data.dueDate);
    expect(sent.at(-1)).toBe(new Date('2026-12-24T10:00').toISOString());
    expect(sent).not.toContain(new Date('2026-01-01T09:00').toISOString());
  });

  it('sends a second pick only after the first save finished, in order', async () => {
    let release: () => void = () => {};
    const { container, patchTask } = renderSection({});
    patchTask.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));

    fireEvent.change(pickerIn(container), { target: { value: '2026-12-24T10:00' } });
    fireEvent.change(pickerIn(container), { target: { value: '2026-12-25T11:00' } });
    await Promise.resolve();
    expect(patchTask).toHaveBeenCalledTimes(1);

    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(patchTask).toHaveBeenCalledTimes(2);
    expect(patchTask.mock.calls[1][0]).toEqual({
      dueDate: new Date('2026-12-25T11:00').toISOString(),
    });
  });

  it('clears the date when the field is emptied', () => {
    const { container, patchTask } = renderSection({ dueDateInput: '' });

    fireEvent.blur(container.querySelector('input[type="text"]') as HTMLInputElement);

    expect(patchTask).toHaveBeenCalledWith({ dueDate: null });
  });
});
