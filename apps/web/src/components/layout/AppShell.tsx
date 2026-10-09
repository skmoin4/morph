import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Sidebar } from './Sidebar';
import { TopBar, type RunningTimer } from './TopBar';
import { MobileNav } from './MobileNav';
import { CommandPalette, useCommandPaletteShortcut } from '../command/CommandPalette';

const COLLAPSED_KEY = 'opsvera:sidebar-collapsed';

export interface AppShellProps {
  userName: string;
  roleName: string;
  permissions: ReadonlySet<string>;
  unreadCount?: number;
  timer?: RunningTimer | null;
  onSignOut?: () => void;
  children: ReactNode;
}

/**
 * Sidebar + top bar + content column.
 *
 * The sidebar collapse preference is per browser, so it is kept in
 * localStorage rather than on the server.
 */
export function AppShell({
  userName,
  roleName,
  permissions,
  unreadCount = 0,
  timer,
  onSignOut,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === 'true';
    } catch {
      // Private browsing or blocked storage: fall back to expanded.
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, String(collapsed));
    } catch {
      // Not worth surfacing — the layout still works.
    }
  }, [collapsed]);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  useCommandPaletteShortcut(openPalette);

  return (
    <div className="flex min-h-screen">
      <Sidebar
        permissions={permissions}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          userName={userName}
          roleName={roleName}
          unreadCount={unreadCount}
          timer={timer}
          onOpenSearch={openPalette}
          onOpenMobileNav={() => setMobileOpen(true)}
          onQuickAction={() => toast('Quick actions arrive with the modules.')}
          onOpenNotifications={() => toast('Notifications arrive in step 14.')}
          onSignOut={onSignOut}
        />

        <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-5 sm:px-6">{children}</main>

        <MobileNav permissions={permissions} />
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        permissions={permissions}
        actions={[
          {
            id: 'action:new-booking',
            label: 'New booking',
            section: 'Quick actions',
            permission: 'booking.create',
            run: () => toast('Booking form arrives in step 6.'),
          },
          {
            id: 'action:start-timer',
            label: 'Start timer',
            section: 'Quick actions',
            permission: 'timesheet.create',
            run: () => toast('Timer arrives in step 10.'),
          },
          {
            id: 'action:apply-leave',
            label: 'Apply for leave',
            section: 'Quick actions',
            permission: 'leave.create',
            run: () => toast('Leave form arrives in step 9.'),
          },
        ]}
      />
    </div>
  );
}
