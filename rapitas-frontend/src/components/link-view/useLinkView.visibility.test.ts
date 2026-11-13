/**
 * useLinkView.visibility.test
 *
 * The single visibility decision (nav60 §3.1): a webview is shown only when
 * it is the shown tab, its surface is attached with a box and its rectangle
 * was sent for THAT element, and no HTML overlay is registered — and every
 * decision carries a fresh, increasing sequence number for the Rust side.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { LinkTab } from '@/stores/link-view-store';
import { useWebviewOcclusionStore } from '@/stores/webview-occlusion-store';
import { useLinkViewStatusStore } from '@/stores/link-view-status-store';

const openLinkView = vi.fn();
const setLinkViewVisible = vi.fn();
const setLinkViewBounds = vi.fn();
const closeLinkView = vi.fn();

vi.mock('@/utils/link-view', () => ({
  openLinkView: (...args: unknown[]) => openLinkView(...args),
  setLinkViewBounds: (...args: unknown[]) => setLinkViewBounds(...args),
  setLinkViewVisible: (...args: unknown[]) => setLinkViewVisible(...args),
  closeLinkView: (...args: unknown[]) => closeLinkView(...args),
  linkViewHistory: vi.fn().mockResolvedValue(true),
  onLinkViewPageChanged: () => Promise.resolve(() => {}),
}));

import { useLinkView } from './useLinkView';

const TABS: LinkTab[] = [
  { id: 't1', url: 'https://one.example' },
  { id: 't2', url: 'https://two.example' },
];

function surface(box = { left: 10, top: 20, width: 300, height: 400 }): HTMLDivElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => box as DOMRect;
  document.body.appendChild(el);
  return el;
}

type Props = { t: LinkTab[]; a: string | null; s: HTMLElement | null };
const render = (props: Props) =>
  renderHook(({ t, a, s }: Props) => useLinkView(t, a, s), { initialProps: props });

/** The visibility calls for one tab, as [visible, seq]. */
const callsFor = (id: string) =>
  setLinkViewVisible.mock.calls.filter((c) => c[0] === id).map((c) => [c[1], c[2]] as const);
const lastFor = (id: string) => callsFor(id).at(-1)?.[0];

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));

beforeEach(() => {
  openLinkView.mockReset().mockResolvedValue(true);
  setLinkViewVisible.mockReset().mockResolvedValue(true);
  setLinkViewBounds.mockReset().mockResolvedValue(true);
  closeLinkView.mockReset().mockResolvedValue(true);
  useWebviewOcclusionStore.setState({ occluders: [] });
  useLinkViewStatusStore.setState({ webviewEpoch: 0, loadingSince: {}, bands: {} });
  document.body.innerHTML = '';
});

describe('applyVisibility', () => {
  it('shows a new tab only after its webview has been created', async () => {
    let finishCreate: (ok: boolean) => void = () => {};
    openLinkView.mockImplementation(() => new Promise<boolean>((r) => (finishCreate = r)));
    render({ t: TABS, a: 't1', s: surface() });
    await settle();
    expect(callsFor('t1').some(([v]) => v === true)).toBe(false);

    await act(async () => finishCreate(true));
    await waitFor(() => expect(lastFor('t1')).toBe(true));
  });

  it('uses a strictly increasing sequence number for every command', async () => {
    const { rerender } = render({ t: TABS, a: 't1', s: surface() });
    await waitFor(() => expect(lastFor('t1')).toBe(true));
    const el = surface();
    rerender({ t: TABS, a: 't2', s: el });
    await waitFor(() => expect(lastFor('t2')).toBe(true));
    rerender({ t: TABS, a: 't1', s: el });
    await waitFor(() => expect(lastFor('t1')).toBe(true));
    const seqs = setLinkViewVisible.mock.calls.map((c) => c[2] as number);
    for (let i = 1; i < seqs.length; i += 1) expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
  });

  it('hides while an overlay is registered and shows again when it goes', async () => {
    render({ t: TABS, a: 't1', s: surface() });
    await waitFor(() => expect(lastFor('t1')).toBe(true));

    act(() => useWebviewOcclusionStore.getState().add('dialog'));
    await waitFor(() => expect(lastFor('t1')).toBe(false));

    act(() => useWebviewOcclusionStore.getState().remove('dialog'));
    await waitFor(() => expect(lastFor('t1')).toBe(true));
  });

  it('does not show a tab switched to while a dialog is open', async () => {
    const el = surface();
    const { rerender } = render({ t: TABS, a: 't1', s: el });
    await waitFor(() => expect(lastFor('t1')).toBe(true));
    act(() => useWebviewOcclusionStore.getState().add('dialog'));
    rerender({ t: TABS, a: 't2', s: el });
    await settle();
    expect(callsFor('t2').some(([v]) => v === true)).toBe(false);
    expect(lastFor('t1')).toBe(false);
  });

  it('never shows a webview on a surface with no box', async () => {
    render({ t: TABS, a: 't1', s: surface({ left: 0, top: 0, width: 0, height: 0 }) });
    await settle();
    expect(callsFor('t1').some(([v]) => v === true)).toBe(false);
  });

  it('hides when the surface goes away', async () => {
    const { rerender } = render({ t: TABS, a: 't1', s: surface() });
    await waitFor(() => expect(lastFor('t1')).toBe(true));
    rerender({ t: TABS, a: 't1', s: null });
    await waitFor(() => expect(lastFor('t1')).toBe(false));
  });
});

describe('moving between pane and screen', () => {
  it('hides first, sends the new rectangle, then shows — without reopening', async () => {
    const pane = surface({ left: 600, top: 64, width: 400, height: 700 });
    const { rerender } = render({ t: TABS, a: 't1', s: pane });
    await waitFor(() => expect(lastFor('t1')).toBe(true));

    let finishBounds: () => void = () => {};
    setLinkViewBounds.mockImplementation(
      () => new Promise<boolean>((r) => (finishBounds = () => r(true))),
    );
    openLinkView.mockClear();
    const screen = surface({ left: 0, top: 64, width: 1280, height: 700 });
    rerender({ t: TABS, a: 't1', s: screen });

    // Hidden before the new rectangle is confirmed: no flash at the old one.
    await waitFor(() => expect(lastFor('t1')).toBe(false));
    expect(setLinkViewBounds).toHaveBeenLastCalledWith('t1', {
      x: 0,
      y: 64,
      width: 1280,
      height: 700,
    });
    await act(async () => finishBounds());
    await waitFor(() => expect(lastFor('t1')).toBe(true));
    expect(openLinkView).not.toHaveBeenCalled();
  });
});

describe('after browsing data is cleared', () => {
  it('rebuilds the shown tab from its URL', async () => {
    render({ t: TABS, a: 't1', s: surface() });
    await waitFor(() => expect(openLinkView).toHaveBeenCalledTimes(1));
    act(() => useLinkViewStatusStore.getState().bumpWebviewEpoch());
    await waitFor(() => expect(openLinkView).toHaveBeenCalledTimes(2));
    expect(openLinkView).toHaveBeenLastCalledWith('t1', 'https://one.example', expect.anything());
  });
});
