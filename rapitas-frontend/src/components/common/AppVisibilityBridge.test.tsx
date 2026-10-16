import { render } from '@testing-library/react';
import AppVisibilityBridge from './AppVisibilityBridge';

const { mockUseAppVisibility } = vi.hoisted(() => ({ mockUseAppVisibility: vi.fn() }));
vi.mock('@/hooks/common/useAppVisibility', () => ({
  useAppVisibility: mockUseAppVisibility,
}));

describe('AppVisibilityBridge', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-app-hidden');
    mockUseAppVisibility.mockReset();
  });

  it('hidden=trueのときdata-app-hidden="true"を付与すること', () => {
    mockUseAppVisibility.mockReturnValue(true);

    render(<AppVisibilityBridge />);

    expect(document.documentElement.getAttribute('data-app-hidden')).toBe('true');
  });

  it('hidden=falseのときdata-app-hidden属性が無いこと', () => {
    mockUseAppVisibility.mockReturnValue(false);

    render(<AppVisibilityBridge />);

    expect(document.documentElement.hasAttribute('data-app-hidden')).toBe(false);
  });

  it('hiddenからvisibleへ復帰すると属性が除去されること', () => {
    mockUseAppVisibility.mockReturnValue(true);
    const { rerender } = render(<AppVisibilityBridge />);
    expect(document.documentElement.getAttribute('data-app-hidden')).toBe('true');

    mockUseAppVisibility.mockReturnValue(false);
    rerender(<AppVisibilityBridge />);

    expect(document.documentElement.hasAttribute('data-app-hidden')).toBe(false);
  });

  it('何もレンダリングしないこと', () => {
    mockUseAppVisibility.mockReturnValue(false);
    const { container } = render(<AppVisibilityBridge />);

    expect(container).toBeEmptyDOMElement();
  });
});
