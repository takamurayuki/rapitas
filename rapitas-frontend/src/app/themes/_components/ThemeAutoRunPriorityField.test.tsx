/**
 * ThemeAutoRunPriorityField.test
 *
 * The theme form's auto-run priority input (task 1543): a typed value is
 * clamped to -100..100 on blur and written into the form data that
 * useThemeCrud sends to POST /themes and PATCH /themes/:id.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeAutoRunPriorityField } from './ThemeAutoRunPriorityField';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

function renderField(value = 0) {
  const onChange = vi.fn();
  render(<ThemeAutoRunPriorityField value={value} onChange={onChange} />);
  return { onChange, input: screen.getByLabelText('autoRunPriorityLabel') as HTMLInputElement };
}

describe('ThemeAutoRunPriorityField', () => {
  it('shows the current value', () => {
    const { input } = renderField(5);
    expect(input.value).toBe('5');
  });

  it('commits an edited value on blur', () => {
    const { onChange, input } = renderField(0);
    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it('clamps to -100..100 and treats empty as 0', () => {
    const { onChange, input } = renderField(3);
    fireEvent.change(input, { target: { value: '250' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(100);
    fireEvent.change(input, { target: { value: '-250' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(-100);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('does not report an unchanged value', () => {
    const { onChange, input } = renderField(4);
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });
});
