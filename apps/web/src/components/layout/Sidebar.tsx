import { NavLink } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { IconButton } from '../ui/Button';
import { visibleGroups } from './navigation';

export interface SidebarProps {
  permissions: ReadonlySet<string>;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Mobile drawer state. On desktop the sidebar is always present. */
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  permissions,
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const groups = visibleGroups(permissions);

  return (
    <>
      {/* Mobile scrim */}
      {mobileOpen && (
        <div
          aria-hidden
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 animate-fade-in bg-ink/40 lg:hidden"
        />
      )}

      <aside
        className={cn(
          'on-dark scroll-slim z-50 flex shrink-0 flex-col overflow-y-auto bg-nav-gradient px-4 py-5 text-nav-text',
          // Desktop: sticky column. Mobile: an off-canvas drawer.
          'fixed inset-y-0 left-0 w-sidebar transition-transform duration-200 lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed ? 'lg:w-sidebar-collapsed lg:px-2.5' : 'lg:w-sidebar',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-3 px-2 pb-5',
            collapsed && 'lg:justify-center lg:px-0',
          )}
        >
          <BrandMark />
          <div className={cn('min-w-0', collapsed && 'lg:hidden')}>
            <b className="block text-[17px] font-black tracking-[0.04em] text-white">OPSVERA</b>
            <small className="mt-0.5 block text-[10px] font-heavy tracking-[0.12em] text-[#8496b5]">
              BUSINESS OPERATIONS OS
            </small>
          </div>
          <IconButton
            label="Close navigation"
            onClick={onCloseMobile}
            size="sm"
            className="ml-auto border-white/10 bg-white/5 text-nav-text hover:bg-nav-hover hover:text-white lg:hidden"
          >
            <X />
          </IconButton>
        </div>

        <nav className="flex-1">
          {groups.map((group) => (
            <div key={group.label} className="mb-4">
              <p
                className={cn(
                  'px-2.5 pb-1.5 text-label font-heavy uppercase text-nav-label',
                  collapsed && 'lg:sr-only',
                )}
              >
                {group.label}
              </p>
              <ul>
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      onClick={onCloseMobile}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          'my-0.5 flex items-center gap-2.5 rounded-control border border-transparent px-2.5 py-2 text-sub transition-colors',
                          collapsed && 'lg:justify-center lg:px-0',
                          isActive
                            ? 'border-[rgba(91,140,255,.22)] bg-nav-active text-white'
                            : 'text-nav-text hover:bg-nav-hover hover:text-white',
                        )
                      }
                    >
                      <item.icon aria-hidden className="size-[17px] shrink-0 opacity-90" />
                      <span className={cn('truncate', collapsed && 'lg:hidden')}>{item.label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <button
          type="button"
          onClick={onToggleCollapsed}
          className={cn(
            'mt-2 hidden items-center gap-2.5 rounded-control px-2.5 py-2 text-sub text-nav-label transition-colors hover:bg-nav-hover hover:text-white lg:flex',
            collapsed && 'lg:justify-center lg:px-0',
          )}
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden className="size-[17px]" />
          ) : (
            <PanelLeftClose aria-hidden className="size-[17px]" />
          )}
          <span className={cn(collapsed && 'lg:hidden')}>Collapse</span>
        </button>
      </aside>
    </>
  );
}

/** The brand square: the prototype's gradient tile with its two white bars. */
function BrandMark() {
  return (
    <span
      aria-hidden
      className="relative grid size-9 shrink-0 place-items-center rounded-[11px] bg-brand-gradient shadow-brand"
    >
      <span className="absolute left-[9px] top-[9px] h-1.5 w-[17px] rounded-[5px] bg-white" />
      <span className="absolute left-[14px] top-[13px] h-4 w-1.5 rounded-[5px] bg-white" />
    </span>
  );
}
