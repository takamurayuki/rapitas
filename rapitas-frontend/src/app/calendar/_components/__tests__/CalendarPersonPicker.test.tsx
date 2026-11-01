/**
 * CalendarPersonPicker.test
 *
 * Choosing whose month is on screen (#1270).
 *
 * The one thing worth pinning down besides the obvious: the picker is absent
 * when nobody has shared with me. A select whose only option is 「自分」 is a
 * control that looks broken, and this app grants sharing from settings.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CalendarPersonPicker } from '../CalendarPersonPicker';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { buildLucideMock } = await import('@/__tests__/helpers/lucide-react-mock');
  return buildLucideMock(importOriginal);
});

const PEOPLE = [
  { workspaceId: 5, username: 'ゆうき', email: 'y@example.com' },
  { workspaceId: 9, username: 'あやか', email: null },
];

describe('CalendarPersonPicker', () => {
  it('renders nothing when nobody has shared a calendar', () => {
    const { container } = render(
      <CalendarPersonPicker people={[]} value={null} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('offers my own calendar and every shared one', () => {
    render(<CalendarPersonPicker people={PEOPLE} value={null} onChange={vi.fn()} />);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['shared.myCalendar', 'ゆうき', 'あやか']);
  });

  it('reports the chosen workspace', () => {
    const onChange = vi.fn();
    render(<CalendarPersonPicker people={PEOPLE} value={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '9' } });
    expect(onChange).toHaveBeenCalledWith(9);
  });

  it('reports null for going back to my own calendar', () => {
    // Null, not 0 and not a string: the page treats null as "mine" and
    // anything else as a workspace to read.
    const onChange = vi.fn();
    render(<CalendarPersonPicker people={PEOPLE} value={9} onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'mine' } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('shows the person currently being viewed', () => {
    render(<CalendarPersonPicker people={PEOPLE} value={5} onChange={vi.fn()} />);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('5');
  });
});
