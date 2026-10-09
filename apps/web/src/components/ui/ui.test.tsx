import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Button } from './Button';
import { Pill, StatusPill, toneForStatus, humanizeStatus } from './Pill';
import { Drawer } from './Drawer';
import { ConfirmDialog } from './Dialog';
import { Progress } from './Progress';
import { MetricCard } from './MetricCard';
import { Sidebar } from '../layout/Sidebar';
import { visibleGroups } from '../layout/navigation';

describe('Button', () => {
  it('blocks clicks while loading but keeps the element', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: /save/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('status pills', () => {
  it('maps a status to one tone everywhere it appears', () => {
    expect(toneForStatus('APPROVED')).toBe('green');
    expect(toneForStatus('PENDING')).toBe('amber');
    expect(toneForStatus('REJECTED')).toBe('red');
    expect(toneForStatus('SUBMITTED')).toBe('blue');
    expect(toneForStatus('DRAFT')).toBe('gray');
    // Anything unmapped falls back to neutral rather than guessing a colour.
    expect(toneForStatus('SOMETHING_NEW')).toBe('gray');
  });

  it('humanizes SCREAMING_SNAKE statuses', () => {
    expect(humanizeStatus('PROJECT_CREATED')).toBe('Project created');
    expect(humanizeStatus('ON_LEAVE')).toBe('On leave');
  });

  it('renders the label and allows an override', () => {
    const { rerender } = render(<StatusPill status="PROJECT_CREATED" />);
    expect(screen.getByText('Project created')).toBeInTheDocument();

    rerender(<StatusPill status="CONFIRMED" label="Email pending" />);
    expect(screen.getByText('Email pending')).toBeInTheDocument();
  });

  it('renders a custom pill', () => {
    render(<Pill tone="violet">Hourly</Pill>);
    expect(screen.getByText('Hourly')).toBeInTheDocument();
  });
});

describe('Progress', () => {
  it('exposes its value to assistive technology and clamps the bar', () => {
    const { rerender } = render(<Progress value={47} label="Budget burn" />);
    const bar = screen.getByRole('progressbar', { name: 'Budget burn' });
    expect(bar).toHaveAttribute('aria-valuenow', '47');

    // Over-budget is real information, so the number is reported honestly
    // even though the bar itself cannot exceed its track.
    rerender(<Progress value={140} label="Budget burn" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '140');
  });
});

describe('MetricCard', () => {
  it('shows a skeleton instead of the value while loading', () => {
    const { container, rerender } = render(<MetricCard label="Booked MTD" value="" loading />);
    expect(container.querySelector('.animate-pulse')).toBeTruthy();

    rerender(<MetricCard label="Booked MTD" value="₹ 21.0 L" foot="4 bookings" />);
    expect(screen.getByText('₹ 21.0 L')).toBeInTheDocument();
    expect(screen.getByText('4 bookings')).toBeInTheDocument();
  });
});

describe('Drawer', () => {
  function Harness({ onClose }: { onClose: () => void }) {
    return (
      <Drawer open onClose={onClose} title="Project detail" subtitle="MOR-26-27-HOS-0001">
        <button type="button">Inside one</button>
        <button type="button">Inside two</button>
      </Drawer>
    );
  }

  it('renders as a modal dialog with its title', () => {
    render(<Harness onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByText('Project detail')).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes from the header button', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps Tab inside the drawer', async () => {
    render(<Harness onClose={vi.fn()} />);
    const inside = screen.getAllByRole('button').map((b) => b.textContent);
    expect(inside).toContain('Inside one');

    // Tabbing from the last control wraps to the first rather than escaping
    // to the page behind the drawer.
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });
});

describe('ConfirmDialog', () => {
  it('warns that the action cannot be undone and reports both choices', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open
        destructive
        onClose={onClose}
        onConfirm={onConfirm}
        title="Cancel this booking?"
        description="Its number is never reused."
        confirmLabel="Cancel booking"
        cancelLabel="Keep it"
      />,
    );

    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(onClose).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel booking' }));
    expect(onConfirm).toHaveBeenCalled();
  });
});

describe('sidebar permissions', () => {
  const ALL = new Set([
    'dashboard.view',
    'client.view',
    'booking.view',
    'employee.view',
    'attendance.view',
    'shift.view',
    'leave.view',
    'timesheet.view',
    'project.view',
    'task.view',
    'expense.view',
    'cost.view',
    'report.view',
    'role.view',
    'settings.view',
  ]);

  it('shows the full Phase 1 sidebar to a user with everything', () => {
    const groups = visibleGroups(ALL);
    expect(groups.map((g) => g.label)).toEqual([
      'Command Center',
      'Commercial',
      'People & Work',
      'Projects',
      'Money',
      'Insights & Admin',
    ]);
  });

  it('drops groups entirely when none of their items are granted', () => {
    const employee = new Set([
      'dashboard.view',
      'attendance.view',
      'leave.view',
      'timesheet.view',
      'project.view',
      'task.view',
      'expense.view',
    ]);
    const labels = visibleGroups(employee).map((g) => g.label);

    expect(labels).toContain('People & Work');
    expect(labels).toContain('Projects');
    // No client or booking permission, so Commercial does not appear at all.
    expect(labels).not.toContain('Commercial');
    // expense.view alone still shows Money, but not Project Cost.
    const money = visibleGroups(employee).find((g) => g.label === 'Money');
    expect(money?.items.map((i) => i.label)).toEqual(['Expenses']);
  });

  it('renders only the permitted links', () => {
    render(
      <MemoryRouter>
        <Sidebar
          permissions={new Set(['dashboard.view', 'booking.view'])}
          collapsed={false}
          onToggleCollapsed={vi.fn()}
          mobileOpen={false}
          onCloseMobile={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /executive dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /bookings/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /roles & permissions/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /^people$/i })).toBeNull();
  });
});

describe('stacked overlays', () => {
  it('closes only the top overlay on Escape', async () => {
    const closeDrawer = vi.fn();
    const closeDialog = vi.fn();
    render(
      <>
        <Drawer open onClose={closeDrawer} title="Booking">
          body
        </Drawer>
        <ConfirmDialog
          open
          onClose={closeDialog}
          onConfirm={() => undefined}
          title="Confirm?"
          description="Sure?"
        />
      </>,
    );

    await userEvent.keyboard('{Escape}');

    // The dialog was opened last, so it owns the keyboard.
    expect(closeDialog).toHaveBeenCalledTimes(1);
    expect(closeDrawer).not.toHaveBeenCalled();
  });
});
