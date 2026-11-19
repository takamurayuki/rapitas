/**
 * CopyReplyButton unmount tests
 *
 * The clipboard write can still be pending when the reply leaves the screen.
 * Once it settles, success or failure, the button must not touch its state
 * or start a timer. React 19 drops a state update on an unmounted component
 * silently, so `useState` is wrapped to record setter calls made after
 * unmount; a leaked timer shows up in `vi.getTimerCount()`.
 */
import { act, render, screen, fireEvent } from '@testing-library/react';
import type * as ReactModule from 'react';
import { CopyReplyButton } from '../CopyReplyButton';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

const lateSetterCalls: unknown[] = [];
let unmounted = false;

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactModule>();
  return {
    ...actual,
    useState: <S,>(initial: S | (() => S)) => {
      const [value, set] = actual.useState(initial);
      const record = (next: S | ((prev: S) => S)) => {
        if (unmounted) lateSetterCalls.push(next);
        set(next);
      };
      return [value, record] as const;
    },
  };
});

const writeText = vi.fn<(text: string) => Promise<void>>();

/** A clipboard write the test settles by hand. */
function pendingWrite() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  writeText.mockImplementationOnce(
    () =>
      new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
      }),
  );
  return { resolve: () => resolve(), reject: (error: Error) => reject(error) };
}

describe('CopyReplyButton after unmount', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    lateSetterCalls.length = 0;
    unmounted = false;
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not start a check or a timer when a pending write succeeds after unmount', async () => {
    const write = pendingWrite();
    const { unmount } = render(<CopyReplyButton text="**md**" />);

    fireEvent.click(screen.getByRole('button', { name: 'copy' }));
    unmount();
    unmounted = true;
    await act(async () => {
      write.resolve();
    });

    expect(writeText).toHaveBeenCalledWith('**md**');
    expect(lateSetterCalls).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not touch state when a pending write fails after unmount during a check', async () => {
    const { unmount } = render(<CopyReplyButton text="**md**" />);

    fireEvent.click(screen.getByRole('button', { name: 'copy' }));
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'copied' })).toBeInTheDocument();

    const write = pendingWrite();
    fireEvent.click(screen.getByRole('button', { name: 'copied' }));
    unmount();
    unmounted = true;
    await act(async () => {
      write.reject(new Error('denied'));
    });

    expect(lateSetterCalls).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
