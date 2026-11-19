/**
 * CopyReplyButton unmount tests
 *
 * The clipboard write can still be pending when the reply leaves the screen.
 * Once it settles, success or failure, the button must not touch its state
 * or start a timer. React 19 drops a state update on an unmounted component
 * silently, so `useState` is wrapped to record setter calls made after
 * unmount; a leaked timer shows up in `vi.getTimerCount()`. The second suite
 * settles the write after the unmount commit but before passive cleanups.
 */
import { act, render, screen, fireEvent } from '@testing-library/react';
import { StrictMode, useEffect, useLayoutEffect, useState } from 'react';
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

  it('still shows the check under StrictMode, whose effect re-run resets the guard', async () => {
    render(
      <StrictMode>
        <CopyReplyButton text="**md**" />
      </StrictMode>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'copy' }));
    await act(async () => {});

    expect(screen.getByRole('button', { name: 'copied' })).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(1);
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

/**
 * Hides the button through a default-lane update outside `act`, so React
 * commits the unmount in one task and runs passive cleanups in a later one.
 * The sibling settles the write from its layout cleanup, i.e. during that
 * commit, which lets the write's continuation run in the window before the
 * passive cleanups.
 */
async function unmountWithWriteSettlingInWindow(settle: () => void) {
  let hide!: () => void;
  const passiveCleanupRan = { current: false };

  function Settler() {
    useLayoutEffect(
      () => () => {
        unmounted = true;
        settle();
      },
      [],
    );
    useEffect(
      () => () => {
        passiveCleanupRan.current = true;
      },
      [],
    );
    return null;
  }

  function Host() {
    const [shown, setShown] = useState(true);
    hide = () => setShown(false);
    return shown ? (
      <>
        <CopyReplyButton text="**md**" />
        <Settler />
      </>
    ) : null;
  }

  render(<Host />);
  return {
    hide: async () => {
      const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
      const previous = env.IS_REACT_ACT_ENVIRONMENT;
      env.IS_REACT_ACT_ENVIRONMENT = false;
      try {
        hide();
        for (let i = 0; i < 50 && !passiveCleanupRan.current; i += 1) {
          await new Promise<void>((done) => setImmediate(done));
        }
      } finally {
        env.IS_REACT_ACT_ENVIRONMENT = previous;
      }
      return passiveCleanupRan.current;
    },
  };
}

describe('CopyReplyButton when a write settles between unmount commit and cleanup', () => {
  beforeEach(() => {
    // NOTE: Only setTimeout is faked; React's scheduler must keep its real
    // setImmediate so the commit and the passive cleanups land in separate tasks.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    lateSetterCalls.length = 0;
    unmounted = false;
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not start a check or a timer on success in the window', async () => {
    const write = pendingWrite();
    const { hide } = await unmountWithWriteSettlingInWindow(() => write.resolve());

    fireEvent.click(screen.getByRole('button', { name: 'copy' }));
    expect(await hide()).toBe(true);

    expect(lateSetterCalls).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not touch state on failure in the window', async () => {
    const write = pendingWrite();
    const { hide } = await unmountWithWriteSettlingInWindow(() =>
      write.reject(new Error('denied')),
    );

    fireEvent.click(screen.getByRole('button', { name: 'copy' }));
    expect(await hide()).toBe(true);

    expect(lateSetterCalls).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
