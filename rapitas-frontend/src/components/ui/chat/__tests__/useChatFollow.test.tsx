/**
 * useChatFollow.test
 *
 * New lines pull a chat log to the bottom only right after the user sent,
 * or while they were already at the bottom; a reader scrolled up stays put
 * and gets the ▽, which takes them to the bottom and disappears.
 * jsdom has no layout, so the log's heights are set by hand.
 */
import { describe, it, expect } from 'vitest';
import { useRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { JumpToLatestButton, useChatFollow, JUMP_THRESHOLD_PX } from '..';

interface Line {
  id: number;
  role: 'user' | 'assistant';
}

function Log({ lines }: { lines: Line[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = lines[lines.length - 1];
  const follow = useChatFollow({
    ref,
    contentKey: `${last?.id}:${lines.length}`,
    sentByUser: last?.role === 'user',
  });
  return (
    <div className="relative">
      <div ref={ref} data-testid="log" onScroll={follow.onScroll}>
        {lines.map((l) => (
          <p key={l.id}>{l.id}</p>
        ))}
      </div>
      {follow.showJump && <JumpToLatestButton onClick={follow.jumpToLatest} label="jump" />}
    </div>
  );
}

const VIEW = 400;
const LINE = 150;

/** Gives the log a height that grows with its lines, like a real one. */
function layout(el: HTMLElement) {
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => VIEW });
  Object.defineProperty(el, 'scrollHeight', {
    configurable: true,
    get: () => Math.max(VIEW, el.children.length * LINE),
  });
}

function lines(n: number, lastRole: Line['role'] = 'assistant'): Line[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    role: i === n - 1 ? lastRole : i % 2 === 0 ? 'user' : 'assistant',
  }));
}

const log = () => screen.getByTestId('log');
const bottom = (el: HTMLElement) => el.scrollHeight - el.clientHeight;

function setup(n: number) {
  // Lay the element out before the first effect runs, as a browser would.
  const proto = HTMLDivElement.prototype;
  const originals = (['scrollHeight', 'clientHeight'] as const).map(
    (key) => [key, Object.getOwnPropertyDescriptor(proto, key)] as const,
  );
  Object.defineProperty(proto, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return Math.max(VIEW, this.children.length * LINE);
    },
  });
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => VIEW });
  const view = render(<Log lines={lines(n)} />);
  for (const [key, original] of originals) {
    if (original) Object.defineProperty(proto, key, original);
    else delete (proto as unknown as Record<string, unknown>)[key];
  }
  layout(log());
  return view;
}

function scrollTo(el: HTMLElement, top: number) {
  el.scrollTop = top;
  fireEvent.scroll(el);
}

describe('useChatFollow', () => {
  it('starts at the newest line with no jump button', () => {
    setup(10);
    expect(log().scrollTop).toBe(bottom(log()));
    expect(screen.queryByLabelText('jump')).toBeNull();
  });

  it('shows the button only once the reader is far enough from the bottom', () => {
    setup(10);
    scrollTo(log(), bottom(log()) - (JUMP_THRESHOLD_PX - 50));
    expect(screen.queryByLabelText('jump')).toBeNull();
    scrollTo(log(), bottom(log()) - JUMP_THRESHOLD_PX - 100);
    expect(screen.getByLabelText('jump')).toBeInTheDocument();
  });

  // nav63: the button sits at the bottom centre of the log, not the bottom right.
  it('floats the button at the bottom centre of the log', () => {
    setup(10);
    scrollTo(log(), 0);
    const cls = screen.getByLabelText('jump').className;
    expect(cls).toContain('left-1/2');
    expect(cls).toContain('-translate-x-1/2');
    expect(cls).toContain('bottom-3');
    expect(cls).not.toContain('right-3');
  });

  it('leaves a reader who scrolled up where they are when a reply arrives', () => {
    const view = setup(10);
    scrollTo(log(), 300);
    view.rerender(<Log lines={lines(11, 'assistant')} />);
    expect(log().scrollTop).toBe(300);
    expect(screen.getByLabelText('jump')).toBeInTheDocument();
  });

  it('follows a reply while the reader is at the bottom', () => {
    const view = setup(10);
    scrollTo(log(), bottom(log()));
    view.rerender(<Log lines={lines(11, 'assistant')} />);
    expect(log().scrollTop).toBe(bottom(log()));
    expect(screen.queryByLabelText('jump')).toBeNull();
  });

  it('goes to the bottom when the user sends, even from far up', () => {
    const view = setup(10);
    scrollTo(log(), 0);
    view.rerender(<Log lines={lines(11, 'user')} />);
    expect(log().scrollTop).toBe(bottom(log()));
    expect(screen.queryByLabelText('jump')).toBeNull();
  });

  it('jumps to the bottom when the button is pressed, and the button goes', () => {
    setup(10);
    scrollTo(log(), 0);
    const el = log();
    el.scrollTo = ((opts: ScrollToOptions) => {
      el.scrollTop = Number(opts.top);
    }) as typeof el.scrollTo;
    act(() => screen.getByLabelText('jump').click());
    fireEvent.scroll(el);
    expect(el.scrollTop).toBe(el.scrollHeight);
    expect(screen.queryByLabelText('jump')).toBeNull();
  });
});

describe('useChatFollow growth', () => {
  function Growing({ followGrowth }: { followGrowth: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    const follow = useChatFollow({ ref, contentKey: 1, sentByUser: false, followGrowth });
    return (
      <div ref={ref} data-testid="log" onScroll={follow.onScroll}>
        <p>reply</p>
      </div>
    );
  }

  function withResizeObserver(run: (grow: () => void) => void) {
    const callbacks: Array<() => void> = [];
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(cb: () => void) {
        callbacks.push(cb);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    try {
      run(() => act(() => callbacks.forEach((cb) => cb())));
    } finally {
      globalThis.ResizeObserver = original;
    }
  }

  function grownLog() {
    const el = screen.getByTestId('log');
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => VIEW });
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => 1400 });
    return el;
  }

  it('keeps a reader at the bottom while a text reply grows', () => {
    withResizeObserver((grow) => {
      render(<Growing followGrowth />);
      const el = grownLog();
      grow();
      expect(el.scrollTop).toBe(1400 - VIEW);
      expect(screen.queryByLabelText('jump')).toBeNull();
    });
  });

  it('leaves a growing card where it is and only measures', () => {
    withResizeObserver((grow) => {
      render(<Growing followGrowth={false} />);
      const el = grownLog();
      grow();
      expect(el.scrollTop).toBe(0);
    });
  });
});
