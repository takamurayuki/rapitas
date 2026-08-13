import { getAppHidden, setAppHidden, subscribeAppHidden } from '../common/app-visibility-store';

describe('app-visibility-store', () => {
  afterEach(() => {
    // Reset the module-level singleton back to its default so tests stay isolated.
    setAppHidden(false);
  });

  it('初期値はfalse(可視)であること', () => {
    expect(getAppHidden()).toBe(false);
  });

  it('setAppHidden(true)で購読者に通知されること', () => {
    const listener = vi.fn();
    subscribeAppHidden(listener);

    setAppHidden(true);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getAppHidden()).toBe(true);
  });

  it('値が変化しない場合は購読者に通知しないこと', () => {
    const listener = vi.fn();
    subscribeAppHidden(listener);

    setAppHidden(false);

    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribe後は通知されないこと', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAppHidden(listener);

    unsubscribe();
    setAppHidden(true);

    expect(listener).not.toHaveBeenCalled();
  });

  it('複数回のsetAppHiddenで変化時のみ通知されること', () => {
    const listener = vi.fn();
    subscribeAppHidden(listener);

    setAppHidden(true);
    setAppHidden(true);
    setAppHidden(false);

    expect(listener).toHaveBeenCalledTimes(2);
  });
});
