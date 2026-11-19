/**
 * PhaseRoutingStatus.test
 *
 * The panel replaces the manual provider picker: it only reports which
 * providers the automatic configuration can use and why the others are out.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PhaseRoutingStatus } from '../PhaseRoutingStatus';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PhaseRoutingStatus', () => {
  it('lists usable providers and the reason each excluded one is out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          usable: ['claude'],
          unavailable: [
            {
              provider: 'openai',
              reason: 'Codex CLI に ChatGPT でログインしていない',
              cooled: false,
            },
            { provider: 'gemini', reason: 'CLI エージェントがない', cooled: false },
          ],
          roles: [],
        }),
      })),
    );
    render(<PhaseRoutingStatus />);
    await waitFor(() => expect(screen.getByText('Claude')).toBeInTheDocument());
    expect(screen.getByText('Codex CLI に ChatGPT でログインしていない')).toBeInTheDocument();
    // Ollama has no phase route and is not worth listing.
    expect(screen.queryByText('Ollama')).not.toBeInTheDocument();
    // Nothing to pick: the panel has no controls.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('marks a provider in cooldown as paused rather than unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          usable: ['claude'],
          unavailable: [{ provider: 'openai', reason: 'usage limit', cooled: true }],
          roles: [],
        }),
      })),
    );
    render(<PhaseRoutingStatus />);
    await waitFor(() => expect(screen.getByText('cooled')).toBeInTheDocument());
  });

  it('says it could not check when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    render(<PhaseRoutingStatus />);
    await waitFor(() => expect(screen.getByText('failed')).toBeInTheDocument());
  });
});
