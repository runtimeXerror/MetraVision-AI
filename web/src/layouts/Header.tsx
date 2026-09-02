import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  ChevronDown,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sun,
  UserRound,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Avatar, Badge } from '@/components/ui/primitives';
import { notificationService } from '@/services';
import { useAuthStore, useUser } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import { cn } from '@/utils/cn';
import { humanise } from '@/utils/format';

import { GlobalSearch } from './GlobalSearch';

/**
 * The application header.
 *
 * Carries the three things that must be reachable from every page: search, what
 * needs attention, and who is signed in.
 */

export function Header() {
  const user = useUser();
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();

  const theme = useUiStore((state) => state.theme);
  const toggleTheme = useUiStore((state) => state.toggleTheme);
  const setMobileNav = useUiStore((state) => state.setMobileNav);

  return (
    <header className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-2 border-b border-line bg-surface/85 px-3 backdrop-blur-md sm:gap-3 sm:px-6">
      <button
        type="button"
        onClick={() => setMobileNav(true)}
        className="grid h-9 w-9 place-items-center rounded-lg text-ink-muted hover:bg-surface-sunken hover:text-ink lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" strokeWidth={2} />
      </button>

      <GlobalSearch />

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={toggleTheme}
          className="grid h-9 w-9 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? (
            <Sun className="h-[18px] w-[18px]" strokeWidth={2} />
          ) : (
            <Moon className="h-[18px] w-[18px]" strokeWidth={2} />
          )}
        </button>

        <NotificationBell />

        {user ? <AccountMenu name={user.name} role={user.role} color={user.avatarColor} onSignOut={async () => {
          await logout();
          navigate('/login', { replace: true });
        }} /> : null}
      </div>
    </header>
  );
}

/* ── Notifications ────────────────────────────────────────────────────────── */

/**
 * Derived from live figures rather than mocked — see `notificationService`.
 * A bell showing counts nothing else in the system agrees with is worse than
 * no bell.
 */
function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose<HTMLDivElement>(() => setOpen(false));

  const { data = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: notificationService.list,
    staleTime: 60_000,
  });

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative grid h-9 w-9 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
        aria-label={`Notifications${data.length ? ` (${data.length})` : ''}`}
        aria-expanded={open}
      >
        <Bell className="h-[18px] w-[18px]" strokeWidth={2} />
        {data.length > 0 ? (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-violation ring-2 ring-surface" />
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-1.5rem)] animate-fade-up overflow-hidden rounded-card border border-line bg-surface shadow-pop">
          <div className="border-b border-line px-4 py-3">
            <p className="text-sm font-semibold text-ink">Attention required</p>
            <p className="mt-0.5 text-xs text-ink-muted">Derived from current inspection data</p>
          </div>

          {data.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-muted">Nothing needs attention.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.map((item) => (
                <li key={item.id}>
                  <Link
                    to={item.href}
                    onClick={() => setOpen(false)}
                    className="block px-4 py-3 transition-colors hover:bg-surface-sunken"
                  >
                    <div className="flex items-start gap-2.5">
                      <span
                        className={cn(
                          'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                          item.tone === 'violation' && 'bg-violation',
                          item.tone === 'review' && 'bg-review',
                          item.tone === 'info' && 'bg-info',
                        )}
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">{item.title}</p>
                        <p className="mt-0.5 text-xs text-ink-muted">{item.detail}</p>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ── Account ──────────────────────────────────────────────────────────────── */

function AccountMenu({
  name,
  role,
  color,
  onSignOut,
}: {
  name: string;
  role: string;
  color?: string;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose<HTMLDivElement>(() => setOpen(false));

  return (
    <div className="relative ml-1" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition-colors hover:bg-surface-sunken"
        aria-expanded={open}
        aria-label="Account menu"
      >
        <Avatar name={name} color={color} size={32} />
        <span className="hidden text-left sm:block">
          <span className="block max-w-[10rem] truncate text-xs font-medium text-ink">{name}</span>
          <span className="block text-2xs text-ink-muted">{humanise(role)}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-ink-faint" strokeWidth={2} aria-hidden />
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-60 max-w-[calc(100vw-1.5rem)] animate-fade-up overflow-hidden rounded-card border border-line bg-surface shadow-pop">
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <Avatar name={name} color={color} size={38} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink">{name}</p>
              <Badge tone={role === 'ADMIN' ? 'brand' : 'info'} className="mt-1">
                {humanise(role)}
              </Badge>
            </div>
          </div>

          <div className="p-1.5">
            <MenuLink to="/profile" icon={UserRound} onClick={() => setOpen(false)}>
              Profile
            </MenuLink>
            <MenuLink to="/settings" icon={Settings} onClick={() => setOpen(false)}>
              Settings
            </MenuLink>
          </div>

          <div className="border-t border-line p-1.5">
            <button
              type="button"
              onClick={onSignOut}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-violation transition-colors hover:bg-violation-soft"
            >
              <LogOut className="h-4 w-4" strokeWidth={2} aria-hidden />
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({
  to,
  icon: Icon,
  onClick,
  children,
}: {
  to: string;
  icon: typeof UserRound;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
    >
      <Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
      {children}
    </Link>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/** Closes a popover on an outside click or Escape. */
function useOutsideClose<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  const handlerRef = useRef(onClose);
  handlerRef.current = onClose;

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) handlerRef.current();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') handlerRef.current();
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return ref;
}
