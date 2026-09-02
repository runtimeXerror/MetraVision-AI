import { ShieldX } from 'lucide-react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { Button, Card } from '@/components/ui/primitives';
import { EmptyState } from '@/components/ui/states';
import { atLeast, useAuthStore } from '@/store/authStore';
import type { UserRole } from '@/types/api';

/**
 * Route protection.
 *
 * This is a *usability* boundary, not a security one. The API independently
 * refuses anything the caller is not entitled to, and it is the only thing
 * standing between a role and data it should not see — a guard in the browser
 * can always be edited away by whoever is holding the browser. What this buys
 * is that a user is never shown a door that will not open.
 */

export function RequireAuth() {
  const user = useAuthStore((state) => state.user);
  const restoring = useAuthStore((state) => state.restoring);
  const location = useLocation();

  // Hold the route while the stored session is being confirmed, or a refresh
  // would bounce a signed-in user to the login page and back.
  if (restoring) return <BootSplash />;

  if (!user) {
    // Remember where they were headed, so sign-in returns them to it.
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}

export function RequireRole({ minRole }: { minRole: UserRole }) {
  const user = useAuthStore((state) => state.user);

  if (!user) return <Navigate to="/login" replace />;

  if (!atLeast(user.role, minRole)) {
    return (
      <Card>
        <EmptyState
          icon={ShieldX}
          title="You do not have access to this page"
          description={`This area is restricted to ${minRole === 'ADMIN' ? 'administrators' : 'supervisors and administrators'}. Your account is signed in as ${user.role.toLowerCase()}.`}
          action={
            <Button variant="secondary" size="sm" onClick={() => window.history.back()}>
              Go back
            </Button>
          }
        />
      </Card>
    );
  }

  return <Outlet />;
}

/** Sends an already-signed-in user away from the login page. */
export function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((state) => state.user);
  const restoring = useAuthStore((state) => state.restoring);

  if (restoring) return <BootSplash />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function BootSplash() {
  return (
    <div className="grid h-screen place-items-center bg-canvas">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-brand" />
        <p className="text-sm text-ink-muted">Restoring your session…</p>
      </div>
    </div>
  );
}
