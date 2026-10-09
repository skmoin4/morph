import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface TabItem {
  key: string;
  label: string;
  /** Small count shown after the label, e.g. the number of open tasks. */
  count?: number;
}

export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
}

/** The underline tab row used on the 360 pages. */
export function Tabs({ tabs, value, onChange, className }: TabsProps) {
  return (
    <div
      role="tablist"
      className={cn('scroll-slim flex gap-1 overflow-x-auto border-b border-line', className)}
    >
      {tabs.map((tab) => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className={cn(
              'relative whitespace-nowrap rounded-t-control px-3 py-2.5 text-sub font-heavy transition-colors',
              active ? 'text-blue' : 'text-muted hover:text-ink-2',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  'ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-black',
                  active ? 'bg-pill-blue-bg text-pill-blue-fg' : 'bg-line-soft text-muted',
                )}
              >
                {tab.count}
              </span>
            )}
            {active && (
              <span
                aria-hidden
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-blue"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" className={cn('pt-4', className)}>
      {children}
    </div>
  );
}
