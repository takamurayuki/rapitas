/**
 * useThemeSetup.test
 *
 * Pins how the wizard reports a rejected scaffold: when no category was picked
 * and the backend has no development-mode category to fall back to (the user
 * deleted 開発), the error tells them to pick one instead of a bare failure.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useThemeSetup } from '../useThemeSetup';
import type { AppProposal, GenerateResult } from '../../_types/types';

const t = (key: string) => key;
const proposal = { name: 'app', tagline: 'tag' } as AppProposal;
const result = { claude_md: '# x', scaffold: [] } as unknown as GenerateResult;

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

afterEach(() => vi.restoreAllMocks());

describe('useThemeSetup error reporting', () => {
  it('asks the user to pick a category on category_required', async () => {
    respond(400, { success: false, error: '…', code: 'category_required' });
    const { result: hook } = renderHook(() => useThemeSetup(t));

    await act(() => hook.current.createTheme(proposal, result));

    expect(hook.current.setupPhase).toBe('error');
    expect(hook.current.setupError).toBe('themeCategoryRequired');
  });

  it('keeps the generic message for other failures', async () => {
    respond(500, { success: false, error: 'boom' });
    const { result: hook } = renderHook(() => useThemeSetup(t));

    await act(() => hook.current.createTheme(proposal, result));

    expect(hook.current.setupError).toBe('themeCreateError');
  });
});
