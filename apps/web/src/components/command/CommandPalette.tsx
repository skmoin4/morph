import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Search } from 'lucide-react';
import { cn } from '../../lib/cn';
import { visibleGroups } from '../layout/navigation';

export interface CommandAction {
  id: string;
  label: string;
  /** Grouping heading in the list, e.g. "Quick actions" or "Projects". */
  section: string;
  hint?: string;
  /** The permission needed to see it. Omit for always-available entries. */
  permission?: string;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  permissions: ReadonlySet<string>;
  /** Quick actions and search results supplied by the shell. */
  actions?: CommandAction[];
}

/**
 * Ctrl/⌘ + K palette.
 *
 * Searches navigation plus whatever actions the shell supplies, and in later
 * steps the live project / employee / client / booking results.
 */
export function CommandPalette({ open, onClose, permissions, actions = [] }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const navActions = useMemo<CommandAction[]>(
    () =>
      visibleGroups(permissions).flatMap((group) =>
        group.items.map((item) => ({
          id: `nav:${item.to}`,
          label: item.label,
          section: 'Go to',
          hint: group.label,
          run: () => navigate(item.to),
        })),
      ),
    [permissions, navigate],
  );

  const all = useMemo(
    () => [...actions.filter((a) => !a.permission || permissions.has(a.permission)), ...navActions],
    [actions, navActions, permissions],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 12);
    return all
      .filter((a) => `${a.label} ${a.hint ?? ''} ${a.section}`.toLowerCase().includes(q))
      .slice(0, 20);
  }, [all, query]);

  // Grouped for display, but the keyboard walks the flat `results` order.
  const sections = useMemo(() => {
    const map = new Map<string, CommandAction[]>();
    for (const result of results) {
      map.set(result.section, [...(map.get(result.section) ?? []), result]);
    }
    return [...map.entries()];
  }, [results]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 10);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const option = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    // Not every environment implements scrollIntoView (jsdom, older embedded
    // webviews); keeping the highlight visible is a nicety, not a requirement.
    if (option && typeof option.scrollIntoView === 'function') {
      option.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  if (!open) return null;

  function choose(action: CommandAction | undefined) {
    if (!action) return;
    onClose();
    action.run();
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]">
      <div aria-hidden onClick={onClose} className="absolute inset-0 animate-fade-in bg-ink/50" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-xl animate-slide-up overflow-hidden rounded-panel border border-line bg-surface shadow-float"
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Search aria-hidden className="size-4 shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((i) => (i + 1) % Math.max(1, results.length));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((i) => (i - 1 + results.length) % Math.max(1, results.length));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                choose(results[activeIndex]);
              } else if (event.key === 'Escape') {
                onClose();
              }
            }}
            role="combobox"
            aria-expanded
            aria-controls="command-results"
            aria-activedescendant={`command-option-${activeIndex}`}
            placeholder="Search or jump to…"
            className="h-12 w-full border-0 bg-transparent text-body text-ink outline-none placeholder:text-muted-2"
          />
          <kbd className="shrink-0 rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] font-heavy text-muted-2">
            Esc
          </kbd>
        </div>

        <ul
          ref={listRef}
          id="command-results"
          role="listbox"
          className="scroll-slim max-h-[52vh] overflow-y-auto p-2"
        >
          {results.length === 0 && (
            <li className="px-3 py-8 text-center text-sub text-muted">
              Nothing matches “{query}”.
            </li>
          )}

          {sections.map(([section, items]) => (
            <li key={section}>
              <p className="px-2 pb-1 pt-2.5 text-micro font-heavy uppercase text-muted-2">
                {section}
              </p>
              <ul>
                {items.map((item) => {
                  const index = results.indexOf(item);
                  const active = index === activeIndex;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        id={`command-option-${index}`}
                        data-index={index}
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => choose(item)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-left text-body transition-colors',
                          active ? 'bg-pill-blue-bg text-ink' : 'text-ink-2 hover:bg-surface-2',
                        )}
                      >
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.hint && (
                          <span className="shrink-0 text-micro tracking-normal text-muted">
                            {item.hint}
                          </span>
                        )}
                        {active && (
                          <CornerDownLeft aria-hidden className="size-3.5 shrink-0 text-blue" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

/** Binds ⌘K / Ctrl+K globally. */
export function useCommandPaletteShortcut(onOpen: () => void) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpen();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onOpen]);
}
