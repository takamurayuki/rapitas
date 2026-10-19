/**
 * RapiAvatar.test
 *
 * The acceptance conditions from `rapi-avatar-spec.md` that can be checked
 * without eyes: what animates, what does not, and what colour it is.
 *
 * Deliberately asserts the spec's VALUES, not just that something rendered.
 * The design is the contract here, so a silent drift in a colour or a
 * duration is the failure worth catching.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `rapiAvatar.${key}`,
}));

import { RapiAvatar, RAPI_AVATAR_TOKENS } from '../RapiAvatar';
import { RapiAvatarDock } from '../RapiAvatarDock';

/** Every `<animate>` / `<animateTransform>` in the rendered avatar. */
const animations = (el: HTMLElement) => el.querySelectorAll('animate, animateTransform');

/**
 * The comet strokes, which only exist while running.
 *
 * Found by `pathLength`: the comets are the only ellipses given one, and
 * their colour lives on the wrapping `<g>` rather than on each ellipse.
 */
const comets = (el: HTMLElement) => Array.from(el.querySelectorAll('ellipse[pathLength]'));

/**
 * The two rects that make the "+".
 *
 * Filtered by `fill`, because the clipPath holds an unfilled rect of its
 * own and it comes first in the document.
 */
const plusBars = (el: HTMLElement) => Array.from(el.querySelectorAll('rect[fill]'));

describe('idle', () => {
  it('draws the ring and no comet', () => {
    const { container } = render(<RapiAvatar state="idle" />);
    expect(comets(container)).toHaveLength(0);
    // The ring itself is still there, at the spec's opacity.
    const ring = container.querySelector('ellipse[stroke-width="1"]');
    expect(ring?.getAttribute('opacity')).toBe(String(RAPI_AVATAR_TOKENS.trackOpacity.light));
  });

  it('wears the body colour on its "+"', () => {
    const { container } = render(<RapiAvatar state="idle" />);
    expect(plusBars(container)[0].getAttribute('fill')).toBe(RAPI_AVATAR_TOKENS.body.light);
  });

  it('can wear amber instead when asked', () => {
    const { container } = render(<RapiAvatar state="idle" accent="amber" />);
    expect(plusBars(container)[0].getAttribute('fill')).toBe(RAPI_AVATAR_TOKENS.comet);
  });
});

/** The gap in a head layer's dasharray — `period - 0.01` — says how many
 *  comets are spaced around the ring: period = 100 / comets. */
const cometPeriod = (el: HTMLElement): number => {
  const head = comets(el).find((e) => e.getAttribute('stroke-dasharray')?.startsWith('0.01'));
  const gap = Number(head?.getAttribute('stroke-dasharray')?.split(' ')[1]);
  return gap + 0.01;
};

describe('running', () => {
  // Four layers make one comet (tail tip, tail, root, head), and the whole
  // ring is drawn twice — once behind the body, once clipped to the front
  // half — so eight elements is one comet, not two.
  it('sends four comet layers round the ring, in both ring passes', () => {
    const { container } = render(<RapiAvatar state="running" />);
    expect(comets(container)).toHaveLength(8);
    expect(cometPeriod(container)).toBeCloseTo(100);
  });

  it('takes six seconds for a lap', () => {
    const { container } = render(<RapiAvatar state="running" />);
    const lap = comets(container)[0].querySelector('animate');
    expect(lap?.getAttribute('dur')).toBe('6s');
  });

  it('spaces the comets evenly for the agent count', () => {
    const { container } = render(<RapiAvatar state="running" agents={3} />);
    expect(cometPeriod(container)).toBeCloseTo(100 / 3);
  });

  it('never spaces for more than four', () => {
    const { container } = render(<RapiAvatar state="running" agents={99} />);
    expect(cometPeriod(container)).toBeCloseTo(25);
  });
});

/**
 * The "+" is the name, not a spinner. It bobs, and in `error` it sits at a
 * different angle — but it is never animated round.
 */
describe('the "+"', () => {
  it.each(['idle', 'thinking', 'running', 'waiting', 'done', 'error'] as const)(
    'does not rotate in %s',
    (state) => {
      const { container } = render(<RapiAvatar state={state} />);
      const rotations = Array.from(animations(container)).filter(
        (a) => a.getAttribute('type') === 'rotate',
      );
      expect(rotations).toHaveLength(0);
    },
  );

  it('sits at 15° normally and 60° on error, without animating there', () => {
    const { container: ok } = render(<RapiAvatar state="idle" />);
    const { container: bad } = render(<RapiAvatar state="error" />);
    expect(ok.innerHTML).toContain('rotate(15)');
    expect(bad.innerHTML).toContain('rotate(60)');
  });

  it.each([
    ['thinking', RAPI_AVATAR_TOKENS.plus.thinking],
    ['running', RAPI_AVATAR_TOKENS.plus.running],
    ['waiting', RAPI_AVATAR_TOKENS.plus.waiting],
    ['done', RAPI_AVATAR_TOKENS.plus.done],
    ['error', RAPI_AVATAR_TOKENS.plus.error],
  ] as const)('is %s-coloured', (state, colour) => {
    const { container } = render(<RapiAvatar state={state} />);
    expect(plusBars(container)[0].getAttribute('fill')).toBe(colour);
  });

  it('stops bobbing on error', () => {
    const { container } = render(<RapiAvatar state="error" />);
    const translates = Array.from(animations(container)).filter(
      (a) => a.getAttribute('type') === 'translate',
    );
    expect(translates).toHaveLength(0);
  });
});

describe('dark theme', () => {
  it('lightens the body and strengthens the ring', () => {
    const { container } = render(<RapiAvatar state="idle" theme="dark" />);
    expect(container.querySelector('circle')?.getAttribute('fill')).toBe(
      RAPI_AVATAR_TOKENS.body.dark,
    );
    const ring = container.querySelector('ellipse[stroke-width="1"]');
    expect(ring?.getAttribute('opacity')).toBe(String(RAPI_AVATAR_TOKENS.trackOpacity.dark));
  });
});

describe('reduced motion', () => {
  it('holds everything still', () => {
    const { container } = render(<RapiAvatar state="running" reducedMotion />);
    expect(animations(container)).toHaveLength(0);
    // Still drawn, just not moving.
    expect(comets(container)).toHaveLength(8);
  });
});

// Two avatars on one page must not share a clipPath id, or the second one
// steals the first one's ring mask.
describe('two at once', () => {
  it('gives each its own clip id', () => {
    const { container } = render(
      <>
        <RapiAvatar state="idle" />
        <RapiAvatar state="idle" />
      </>,
    );
    const ids = Array.from(container.querySelectorAll('clipPath')).map((c) => c.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('the dock', () => {
  it('says nothing while idle', () => {
    const { queryByText } = render(<RapiAvatarDock state="idle" message="anything" />);
    expect(queryByText('anything')).toBeNull();
  });

  it('speaks once something is happening', () => {
    const { getByText } = render(<RapiAvatarDock state="running" message="2 agents" />);
    expect(getByText('2 agents')).toBeTruthy();
  });

  // The avatar floats over every page, so everything except the avatar and
  // its bubble has to let clicks through.
  it('lets clicks through everywhere but itself', () => {
    const { container } = render(<RapiAvatarDock state="running" message="x" />);
    const dock = container.firstChild as HTMLElement;
    expect(dock.style.pointerEvents).toBe('none');
    expect(container.querySelector('button')?.style.pointerEvents).toBe('auto');
  });

  it('sits bottom-right where the spec puts it', () => {
    const { container } = render(<RapiAvatarDock state="idle" />);
    const dock = container.firstChild as HTMLElement;
    expect(dock.style.position).toBe('fixed');
    expect(dock.style.right).toBe('24px');
    expect(dock.style.bottom).toBe('20px');
  });

  it('reads its state out to assistive tech', () => {
    const { container } = render(<RapiAvatarDock state="waiting" message="approve me" />);
    expect(container.querySelector('[aria-live="polite"]')).toBeTruthy();
    expect(container.querySelector('svg')?.getAttribute('role')).toBe('img');
  });
});
