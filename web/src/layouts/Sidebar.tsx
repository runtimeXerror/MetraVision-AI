import { PanelLeftClose, PanelLeftOpen, ScanLine, X } from 'lucide-react';
import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';

import { useRole } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import { cn } from '@/utils/cn';

import { visibleSections } from './navigation';

/**
 * The navy rail.
 *
 * Fixed dark in both themes: it is the constant the rest of the console is read
 * against, and it gives the page a spine that a light-on-light sidebar does not.
 * Collapsing leaves the icons in place so the muscle memory of position
 * survives — the labels go, the order never does.
 */

export function Sidebar({
  counts,
}: {
  counts: { pendingReviews: number; violations: number };
}) {
  const role = useRole();
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggle = useUiStore((state) => state.toggleSidebar);
  const mobileOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNav = useUiStore((state) => state.setMobileNav);

  const sections = visibleSections(role);

  // The slide-over sits over a page that is still scrollable underneath it;
  // without this the list behind the drawer moves as the drawer is swiped.
  useEffect(() => {
    if (!mobileOpen) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  const content = (
    <>
      <div
        className={cn(
          'flex h-16 shrink-0 items-center gap-2.5 border-b border-rail-line px-4',
          collapsed && 'lg:justify-center lg:px-0',
        )}
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand text-white">
          <ScanLine className="h-5 w-5" strokeWidth={2.25} aria-hidden />
        </span>
        <div className={cn('min-w-0', collapsed && 'lg:hidden')}>
          <p className="truncate text-sm font-semibold text-rail-ink">LM Compliance</p>
          <p className="truncate text-2xs text-rail-muted">Legal Metrology</p>
        </div>

        <button
          type="button"
          onClick={() => setMobileNav(false)}
          className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-rail-muted hover:bg-rail-raised hover:text-rail-ink lg:hidden"
          aria-label="Close navigation"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      <nav className="scroll-slim flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
        {sections.map((section) => (
          <div key={section.heading} className="mb-5 last:mb-0">
            <p
              className={cn(
                'mb-1.5 px-2 text-2xs font-semibold uppercase tracking-wider text-rail-muted/70',
                collapsed && 'lg:sr-only',
              )}
            >
              {section.heading}
            </p>

            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const count = item.badgeKey ? counts[item.badgeKey] : 0;

                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      onClick={() => setMobileNav(false)}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          'group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors',
                          collapsed && 'lg:justify-center lg:px-0',
                          isActive
                            ? 'bg-rail-raised font-medium text-rail-ink'
                            : 'text-rail-muted hover:bg-rail-raised/60 hover:text-rail-ink',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {/* Position marker, so the active item is not signalled
                              by a background tint alone. */}
                          <span
                            className={cn(
                              'absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-brand transition-opacity',
                              isActive ? 'opacity-100' : 'opacity-0',
                            )}
                            aria-hidden
                          />
                          <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />
                          <span className={cn('flex-1 truncate', collapsed && 'lg:hidden')}>
                            {item.label}
                          </span>

                          {count > 0 ? (
                            <span
                              className={cn(
                                'rounded-full bg-brand px-1.5 py-0.5 text-2xs font-semibold tabular text-white',
                                collapsed && 'lg:absolute lg:right-1.5 lg:top-1 lg:px-1',
                              )}
                            >
                              {count > 99 ? '99+' : count}
                            </span>
                          ) : null}
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="hidden shrink-0 border-t border-rail-line p-3 lg:block">
        <button
          type="button"
          onClick={toggle}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-rail-muted transition-colors hover:bg-rail-raised hover:text-rail-ink',
            collapsed && 'justify-center px-0',
          )}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
          ) : (
            <>
              <PanelLeftClose className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Desktop rail */}
      <aside
        className={cn(
          'hidden shrink-0 flex-col bg-rail transition-[width] duration-200 lg:flex',
          collapsed ? 'w-[68px]' : 'w-64',
        )}
      >
        {content}
      </aside>

      {/* Mobile slide-over */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileNav(false)}
            aria-label="Close navigation"
            tabIndex={-1}
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 max-w-[85vw] flex-col bg-rail shadow-pop">
            {content}
          </aside>
        </div>
      ) : null}
    </>
  );
}
