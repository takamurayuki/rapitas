/**
 * settings-link.test
 *
 * The old /settings/* URLs still arrive from the backend and from stored
 * notifications; they must open the matching settings-modal section instead
 * of navigating to pages that no longer exist.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { followInAppLink, settingsSectionFromHref } from '../settings-link';
import { useSettingsModalStore } from '../settings-modal-store';

describe('settingsSectionFromHref', () => {
  it.each([
    ['/settings', 'api-keys'],
    ['/settings/', 'api-keys'],
    ['/settings/general', 'general'],
    ['/settings/general?showHeader=true', 'general'],
    ['/settings/personal#rapi-profile', 'personal'],
    ['/settings/developer-mode', 'developer-mode'],
    ['/settings/shortcuts', 'shortcuts'],
    ['/settings/cli-tools', 'cli-tools'],
  ])('maps %s to the %s section', (href, section) => {
    expect(settingsSectionFromHref(href)).toBe(section);
  });

  it.each(['/', '/tasks/detail?id=3', '/backlog/settings', '/agents/7/settings', '/settingsx'])(
    'leaves %s alone',
    (href) => {
      expect(settingsSectionFromHref(href)).toBeNull();
    },
  );
});

describe('followInAppLink', () => {
  beforeEach(() => {
    useSettingsModalStore.setState({ isOpen: false, section: 'general' });
  });

  it('opens the modal for a settings URL without navigating', () => {
    const router = { push: vi.fn() };
    followInAppLink(router, '/settings/general');
    expect(router.push).not.toHaveBeenCalled();
    expect(useSettingsModalStore.getState()).toMatchObject({ isOpen: true, section: 'general' });
  });

  it('navigates for any other URL', () => {
    const router = { push: vi.fn() };
    followInAppLink(router, '/tasks/detail?id=3');
    expect(router.push).toHaveBeenCalledWith('/tasks/detail?id=3');
    expect(useSettingsModalStore.getState().isOpen).toBe(false);
  });
});
