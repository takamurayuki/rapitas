import { render, screen, fireEvent } from '@testing-library/react';
import { ShortcutRecorderSection } from '../shortcut-recorder-section';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const BASE_PROPS = {
  title: 'Test Title',
  description: 'Test Description',
  currentShortcut: 'Ctrl+Alt+I',
  modifiers: ['Ctrl', 'Alt'],
  activeKey: 'I',
  isRecording: false,
  isSaving: false,
  message: null,
  newShortcut: 'Ctrl+Alt+I',
  hasChanges: false,
  onToggleRecording: vi.fn(),
  onToggleModifier: vi.fn(),
  onKeyChange: vi.fn(),
  onSave: vi.fn(),
  onReset: vi.fn(),
} as const;

describe('ShortcutRecorderSection', () => {
  it('renders the given title, description, and current shortcut', () => {
    render(<ShortcutRecorderSection {...BASE_PROPS} modifiers={[...BASE_PROPS.modifiers]} />);
    expect(screen.getByText('Test Title')).toBeTruthy();
    expect(screen.getByText('Test Description')).toBeTruthy();
    expect(screen.getByText('Ctrl+Alt+I')).toBeTruthy();
  });

  it('reflects active modifiers and calls onToggleModifier on click', () => {
    const onToggleModifier = vi.fn();
    render(
      <ShortcutRecorderSection
        {...BASE_PROPS}
        modifiers={['Ctrl']}
        onToggleModifier={onToggleModifier}
      />,
    );
    fireEvent.click(screen.getByText('Alt'));
    expect(onToggleModifier).toHaveBeenCalledWith('Alt');
  });

  it('calls onSave and onReset when the action buttons are clicked', () => {
    const onSave = vi.fn();
    const onReset = vi.fn();
    render(
      <ShortcutRecorderSection
        {...BASE_PROPS}
        modifiers={[...BASE_PROPS.modifiers]}
        hasChanges
        onSave={onSave}
        onReset={onReset}
      />,
    );
    fireEvent.click(screen.getByText('save'));
    fireEvent.click(screen.getByText('resetToDefault'));
    expect(onSave).toHaveBeenCalled();
    expect(onReset).toHaveBeenCalled();
  });

  it('shows the new-shortcut preview only when hasChanges is true', () => {
    const { rerender } = render(
      <ShortcutRecorderSection
        {...BASE_PROPS}
        modifiers={[...BASE_PROPS.modifiers]}
        hasChanges={false}
      />,
    );
    expect(screen.queryByText('newShortcut')).toBeNull();

    rerender(
      <ShortcutRecorderSection
        {...BASE_PROPS}
        modifiers={[...BASE_PROPS.modifiers]}
        hasChanges
        newShortcut="Ctrl+Alt+K"
      />,
    );
    expect(screen.getByText('Ctrl+Alt+K')).toBeTruthy();
  });
});
