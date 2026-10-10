import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CommandPalette, type CommandAction } from './CommandPalette';

const PERMISSIONS = new Set([
  'dashboard.view',
  'booking.view',
  'booking.create',
  'project.view',
  'timesheet.view',
]);

function renderPalette(overrides: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
  const onClose = vi.fn();
  const newBooking = vi.fn();

  const actions: CommandAction[] = [
    {
      id: 'action:new-booking',
      label: 'New booking',
      section: 'Quick actions',
      permission: 'booking.create',
      run: newBooking,
    },
    {
      id: 'action:approve',
      label: 'Approve timesheets',
      section: 'Quick actions',
      // Not granted below, so it must never be offered.
      permission: 'timesheet.approve',
      run: vi.fn(),
    },
  ];

  render(
    <MemoryRouter>
      <CommandPalette
        open
        onClose={onClose}
        permissions={PERMISSIONS}
        actions={actions}
        {...overrides}
      />
    </MemoryRouter>,
  );

  return { onClose, newBooking };
}

describe('CommandPalette', () => {
  it('opens as a labelled modal with the input focused', async () => {
    renderPalette();
    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeInTheDocument();

    const input = screen.getByRole('combobox');
    await vi.waitFor(() => expect(input).toHaveFocus());
  });

  it('offers navigation for permitted modules only', () => {
    renderPalette();
    expect(screen.getByRole('option', { name: /^dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /bookings/i })).toBeInTheDocument();
    // No settings.view permission.
    expect(screen.queryByRole('option', { name: /^settings/i })).toBeNull();
  });

  it('hides quick actions the user lacks permission for', () => {
    renderPalette();
    expect(screen.getByRole('option', { name: /new booking/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /approve timesheets/i })).toBeNull();
  });

  it('filters as you type and says so when nothing matches', async () => {
    renderPalette();
    const input = screen.getByRole('combobox');

    await userEvent.type(input, 'book');
    expect(screen.getByRole('option', { name: /new booking/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^dashboard/i })).toBeNull();

    await userEvent.clear(input);
    await userEvent.type(input, 'zzzzz');
    expect(screen.getByText(/nothing matches/i)).toBeInTheDocument();
  });

  it('runs the highlighted entry on Enter and closes', async () => {
    const { onClose, newBooking } = renderPalette();
    const input = screen.getByRole('combobox');

    await userEvent.type(input, 'new booking');
    await userEvent.keyboard('{Enter}');

    expect(newBooking).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('moves the highlight with the arrow keys', async () => {
    renderPalette();
    const input = screen.getByRole('combobox');

    const first = screen.getAllByRole('option')[0];
    expect(first).toHaveAttribute('aria-selected', 'true');

    await userEvent.type(input, '{ArrowDown}');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'false');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');

    // Wraps back to the top from the end.
    await userEvent.type(input, '{ArrowUp}{ArrowUp}');
    const options = screen.getAllByRole('option');
    expect(options[options.length - 1]).toHaveAttribute('aria-selected', 'true');
  });

  it('closes on Escape', async () => {
    const { onClose } = renderPalette();
    await userEvent.type(screen.getByRole('combobox'), '{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing when closed', () => {
    render(
      <MemoryRouter>
        <CommandPalette open={false} onClose={vi.fn()} permissions={PERMISSIONS} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
