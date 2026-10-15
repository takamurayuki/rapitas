import { useNavStore } from '../nav-store';

describe('navStore', () => {
  beforeEach(() => {
    useNavStore.setState({ isMenuPinned: false });
  });

  it('starts unpinned', () => {
    expect(useNavStore.getState().isMenuPinned).toBe(false);
  });

  it('setMenuPinned(true) pins the nav', () => {
    useNavStore.getState().setMenuPinned(true);
    expect(useNavStore.getState().isMenuPinned).toBe(true);
  });

  it('setMenuPinned(false) unpins the nav', () => {
    useNavStore.setState({ isMenuPinned: true });
    useNavStore.getState().setMenuPinned(false);
    expect(useNavStore.getState().isMenuPinned).toBe(false);
  });
});
