/**
 * SettingsModal.test
 *
 * The modal shell: hidden until opened, a sidebar entry per section that
 * switches the content pane, and the usual ways to close (button, Esc,
 * backdrop) — while clicks inside the panel keep it open.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// Each section stands in as a marker so the test exercises the shell, not
// every settings screen (those have their own tests).
vi.mock('../settings-sections', async () => {
  const { SETTINGS_SECTION_IDS } = await import('../settings-modal-store');
  const icon = () => null;
  return {
    SETTINGS_SECTIONS: Object.fromEntries(
      SETTINGS_SECTION_IDS.map((id) => [
        id,
        { labelKey: `label.${id}`, icon, Component: () => <p>content:{id}</p> },
      ]),
    ),
  };
});

import { SettingsModal } from '../SettingsModal';
import { openSettings, useSettingsModalStore } from '../settings-modal-store';
import { useWebviewOcclusionStore } from '@/stores/webview-occlusion-store';

describe('SettingsModal', () => {
  beforeEach(() => {
    useSettingsModalStore.setState({ isOpen: false, section: 'general' });
    useWebviewOcclusionStore.setState({ occluders: [] });
  });

  it('renders nothing until opened', () => {
    render(<SettingsModal />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens on the requested section and switches sections from the sidebar', () => {
    render(<SettingsModal />);
    act(() => openSettings('shortcuts'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('content:shortcuts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'label.shortcuts' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    fireEvent.click(screen.getByRole('button', { name: 'label.api-keys' }));
    expect(screen.getByText('content:api-keys')).toBeInTheDocument();
    expect(screen.queryByText('content:shortcuts')).toBeNull();
  });

  it('closes with the close button, Esc and the backdrop, but not on a click inside', () => {
    render(<SettingsModal />);

    act(() => openSettings());
    fireEvent.click(screen.getByText('content:general'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'close' })[0]);
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => openSettings());
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => openSettings());
    fireEvent.click(screen.getByTestId('settings-modal-backdrop'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reopens on the section it was left on', () => {
    render(<SettingsModal />);
    act(() => openSettings('cli-tools'));
    fireEvent.keyDown(window, { key: 'Escape' });
    act(() => openSettings());
    expect(screen.getByText('content:cli-tools')).toBeInTheDocument();
  });

  it('hides the in-app browser webview while open, so it cannot cover the modal', () => {
    render(<SettingsModal />);
    expect(useWebviewOcclusionStore.getState().occluders).toHaveLength(0);
    act(() => openSettings());
    expect(useWebviewOcclusionStore.getState().occluders).toHaveLength(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useWebviewOcclusionStore.getState().occluders).toHaveLength(0);
  });
});
