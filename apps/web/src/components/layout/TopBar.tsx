import { useState, type ReactNode } from 'react';
import { Bell, ChevronDown, Menu, Plus, Search } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Button, IconButton } from '../ui/Button';
import { Avatar } from '../ui/Avatar';

export interface TopBarProps {
  userName: string;
  roleName: string;
  unreadCount?: number;
  /** The global timer, when this person tracks time. */
  timerSlot?: ReactNode;
  onOpenSearch: () => void;
  onOpenMobileNav: () => void;
  onQuickAction?: () => void;
  onOpenNotifications?: () => void;
  onSignOut?: () => void;
}

export function TopBar({
  userName,
  roleName,
  unreadCount = 0,
  timerSlot,
  onOpenSearch,
  onOpenMobileNav,
  onQuickAction,
  onOpenNotifications,
  onSignOut,
}: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 flex h-topbar items-center justify-between gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur-xl sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <IconButton label="Open navigation" onClick={onOpenMobileNav} className="lg:hidden">
          <Menu />
        </IconButton>

        {/* A button, not an input: it opens the command palette. */}
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex h-10 w-full max-w-[470px] items-center gap-2.5 rounded-[11px] border border-line bg-surface-2 px-3 text-left text-sub text-muted transition-colors hover:border-blue-2/40 hover:bg-surface"
        >
          <Search aria-hidden className="size-4 shrink-0" />
          <span className="truncate">Search projects, people, clients, bookings…</span>
          <kbd className="ml-auto hidden shrink-0 rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-heavy text-muted-2 sm:block">
            ⌘K
          </kbd>
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {timerSlot}

        <Button
          variant="primary"
          onClick={onQuickAction}
          leadingIcon={<Plus />}
          className="hidden sm:inline-flex"
        >
          Quick Action
        </Button>

        <div className="relative">
          <IconButton label="Notifications" onClick={onOpenNotifications}>
            <Bell />
          </IconButton>
          {unreadCount > 0 && (
            <span className="pointer-events-none absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-red px-1 text-[10px] font-black text-white">
              <span className="sr-only">{unreadCount} unread notifications</span>
              <span aria-hidden>{unreadCount > 9 ? '9+' : unreadCount}</span>
            </span>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex items-center gap-1.5 rounded-control p-0.5 transition-colors hover:bg-surface-2"
          >
            <Avatar name={userName} />
            <ChevronDown aria-hidden className="hidden size-3.5 text-muted sm:block" />
          </button>

          {menuOpen && (
            <>
              <div aria-hidden className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div
                role="menu"
                className="absolute right-0 top-[calc(100%+8px)] z-20 w-56 animate-slide-up overflow-hidden rounded-panel border border-line bg-surface shadow-float"
              >
                <div className="border-b border-line px-3.5 py-3">
                  <p className="truncate text-body font-heavy text-ink">{userName}</p>
                  <p className="mt-0.5 truncate text-sub text-muted">{roleName}</p>
                </div>
                <MenuItem onClick={() => setMenuOpen(false)}>My profile</MenuItem>
                <MenuItem onClick={() => setMenuOpen(false)}>Change password</MenuItem>
                <MenuItem
                  onClick={() => {
                    setMenuOpen(false);
                    onSignOut?.();
                  }}
                  tone="danger"
                >
                  Sign out
                </MenuItem>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function MenuItem({
  children,
  onClick,
  tone = 'default',
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'block w-full px-3.5 py-2.5 text-left text-body transition-colors hover:bg-surface-2',
        tone === 'danger' ? 'text-red' : 'text-ink-2',
      )}
    >
      {children}
    </button>
  );
}
