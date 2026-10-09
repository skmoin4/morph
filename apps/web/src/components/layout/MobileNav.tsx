import { NavLink } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { MOBILE_NAV } from './navigation';

/**
 * Bottom navigation for the employee screens on a phone.
 * Large touch targets, and it sits above the home indicator on iOS.
 */
export function MobileNav({ permissions }: { permissions: ReadonlySet<string> }) {
  const items = MOBILE_NAV.filter((item) => permissions.has(item.permission));
  if (items.length === 0) return null;

  return (
    <nav
      aria-label="Primary"
      className="sticky bottom-0 z-30 flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden"
    >
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) =>
            cn(
              'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px] font-heavy transition-colors',
              isActive ? 'text-blue' : 'text-muted',
            )
          }
        >
          <item.icon aria-hidden className="size-5" />
          <span className="truncate">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
