/**
 * DropdownMenu.test
 *
 * The menu grew a controlled mode so a right-click somewhere else can open
 * it — the browser convention for tab groups. The uncontrolled behaviour
 * every existing caller relies on has to be untouched by that.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DropdownMenu, { type DropdownMenuItem } from '../DropdownMenu';

const items: DropdownMenuItem[] = [
  { label: 'Rename', onClick: vi.fn() },
  { label: 'Delete', onClick: vi.fn(), variant: 'danger' },
];

beforeEach(() => {
  for (const item of items) (item.onClick as ReturnType<typeof vi.fn>).mockReset();
});

describe('uncontrolled', () => {
  it('opens on the trigger and closes after a choice', () => {
    render(<DropdownMenu items={items} triggerLabel="More" />);
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(screen.getByLabelText('More'));
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.click(screen.getByText('Rename'));
    expect(items[0].onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape', () => {
    render(<DropdownMenu items={items} triggerLabel="More" />);
    fireEvent.click(screen.getByLabelText('More'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not run a disabled item', () => {
    const disabled: DropdownMenuItem[] = [{ label: 'Nope', onClick: vi.fn(), disabled: true }];
    render(<DropdownMenu items={disabled} triggerLabel="More" />);
    fireEvent.click(screen.getByLabelText('More'));
    fireEvent.click(screen.getByText('Nope'));
    expect(disabled[0].onClick).not.toHaveBeenCalled();
  });
});

describe('controlled', () => {
  it('shows the menu when the owner says it is open', () => {
    render(<DropdownMenu items={items} open onOpenChange={vi.fn()} hideTrigger />);
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('stays shut when the owner says it is closed', () => {
    render(<DropdownMenu items={items} open={false} onOpenChange={vi.fn()} hideTrigger />);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  // The owner holds the state, so the menu asks to close rather than
  // closing itself — otherwise it would reopen on the next render.
  it('asks the owner to close after a choice, and does not close itself', () => {
    const onOpenChange = vi.fn();
    render(<DropdownMenu items={items} open onOpenChange={onOpenChange} hideTrigger />);
    fireEvent.click(screen.getByText('Delete'));
    expect(items[1].onClick).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('asks the owner to close on Escape', () => {
    const onOpenChange = vi.fn();
    render(<DropdownMenu items={items} open onOpenChange={onOpenChange} hideTrigger />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // A tab sits at the left of the strip; a menu pinned to its right edge
  // would open off screen.
  it('can align to the left edge', () => {
    const { container } = render(
      <DropdownMenu items={items} open onOpenChange={vi.fn()} hideTrigger align="left" />,
    );
    expect(container.querySelector('[role="menu"]')?.className).toContain('left-0');
  });

  it('pins to the right edge by default', () => {
    const { container } = render(
      <DropdownMenu items={items} open onOpenChange={vi.fn()} hideTrigger />,
    );
    expect(container.querySelector('[role="menu"]')?.className).toContain('right-0');
  });
});

describe('hideTrigger', () => {
  it('renders no trigger button when the menu is opened from elsewhere', () => {
    render(<DropdownMenu items={items} open={false} onOpenChange={vi.fn()} hideTrigger />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('still renders one by default', () => {
    render(<DropdownMenu items={items} triggerLabel="More" />);
    expect(screen.getByLabelText('More')).toBeTruthy();
  });
});
