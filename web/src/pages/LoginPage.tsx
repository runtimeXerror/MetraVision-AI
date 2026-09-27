import { AlertCircle, ArrowRight, Lock, ScanLine, ShieldCheck, User } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { Input } from '@/components/ui/forms';
import { Button } from '@/components/ui/primitives';
import { useAuthStore } from '@/store/authStore';

/**
 * Sign-in.
 *
 * Authenticates against the *same* backend endpoint the mobile app uses. There
 * is deliberately no second identity system: an account suspended by an
 * administrator loses the console and the field app together, which is the only
 * behaviour that can be relied on during an enforcement action.
 */

interface LocationState {
  from?: { pathname: string };
}

export function LoginPage() {
  const login = useAuthStore((state) => state.login);
  const submitting = useAuthStore((state) => state.submitting);
  const error = useAuthStore((state) => state.error);
  const clearError = useAuthStore((state) => state.clearError);

  const navigate = useNavigate();
  const location = useLocation();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);

  const destination = (location.state as LocationState | null)?.from?.pathname ?? '/dashboard';

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!identifier.trim() || !password) return;

    const ok = await login(identifier.trim(), password);
    if (ok) navigate(destination, { replace: true });
  }

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Identity panel. Hidden below lg — on a narrow screen the form is the
          only thing worth the space. */}
      <aside className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-rail p-12 lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
            backgroundSize: '28px 28px',
          }}
          aria-hidden
        />

        <div className="relative flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand text-white">
            <ScanLine className="h-6 w-6" strokeWidth={2.25} aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-rail-ink">MetraVision AI</p>
            <p className="text-xs text-rail-muted">Department of Legal Metrology</p>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight text-rail-ink">
            Packaged commodity compliance, from the field to the file.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-rail-muted">
            Inspectors capture package labels on the mobile app. Declarations are
            extracted, checked against the rules that apply to the commodity, and
            filed as an enforcement record. This console is where that record is
            reviewed, endorsed and reported on.
          </p>

          <dl className="mt-10 grid grid-cols-3 gap-4 border-t border-rail-line pt-6">
            {[
              { label: 'Verdicts', value: 'Three' },
              { label: 'Evidence', value: 'Retained' },
              { label: 'AI output', value: 'Never overwritten' },
            ].map((item) => (
              <div key={item.label}>
                <dt className="text-2xs uppercase tracking-wide text-rail-muted">{item.label}</dt>
                <dd className="mt-1 text-sm font-medium text-rail-ink">{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="relative text-2xs text-rail-muted">
          Legal Metrology (Packaged Commodities) Rules, 2011 · SIH26034
        </p>
      </aside>

      {/* Form */}
      <main className="flex flex-1 items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-white">
              <ScanLine className="h-5 w-5" strokeWidth={2.25} aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold text-ink">MetraVision AI</p>
              <p className="text-xs text-ink-muted">Department of Legal Metrology</p>
            </div>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-ink">Sign in</h2>
          <p className="mt-1.5 text-sm text-ink-muted">
            Use your departmental credentials. The same account works in the field app.
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
            <Input
              label="Email or Inspector ID"
              icon={User}
              value={identifier}
              onChange={(event) => {
                setIdentifier(event.target.value);
                if (error) clearError();
              }}
              placeholder="meera.nair@legalmetrology.gov.in"
              autoComplete="username"
              autoFocus
              error={touched && !identifier.trim() ? 'Enter your email or Inspector ID.' : undefined}
            />

            <Input
              label="Password"
              icon={Lock}
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                if (error) clearError();
              }}
              placeholder="••••••••••"
              autoComplete="current-password"
              error={touched && !password ? 'Enter your password.' : undefined}
            />

            {error ? (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-lg bg-violation-soft px-3.5 py-3 text-xs text-violation-ink ring-1 ring-inset ring-violation/25"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                <span>{error.message}</span>
              </div>
            ) : null}

            <Button
              type="submit"
              size="lg"
              loading={submitting}
              iconRight={ArrowRight}
              className="w-full"
            >
              Sign in
            </Button>
          </form>

          <DemoCredentials
            onPick={(id, pass) => {
              setIdentifier(id);
              setPassword(pass);
              clearError();
            }}
          />

          <p className="mt-8 flex items-start gap-2 text-2xs leading-relaxed text-ink-faint">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
            Sessions are held for this browser tab only and end when it closes — this
            console is used on shared departmental workstations.
          </p>
        </div>
      </main>
    </div>
  );
}

/**
 * Demo accounts.
 *
 * Present because this is an evaluated prototype and a reviewer needs to see
 * both roles without being handed a password list. These are the seeded
 * accounts from `backend/src/seed/seed.ts` and exist only in a seeded database.
 */
function DemoCredentials({ onPick }: { onPick: (identifier: string, password: string) => void }) {
  const accounts = [
    { role: 'Supervisor', identifier: 'meera.nair@legalmetrology.gov.in', password: 'Supervisor@123' },
    { role: 'Administrator', identifier: 'admin@legalmetrology.gov.in', password: 'Admin@1234' },
    { role: 'Inspector', identifier: 'LM-INS-4471', password: 'Inspector@123' },
  ];

  return (
    <div className="mt-8 rounded-card border border-dashed border-line-strong bg-surface-sunken p-4">
      <p className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">
        Demonstration accounts
      </p>
      <div className="mt-2.5 space-y-1.5">
        {accounts.map((account) => (
          <button
            key={account.identifier}
            type="button"
            onClick={() => onPick(account.identifier, account.password)}
            className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface"
          >
            <span className="min-w-0">
              <span className="block text-xs font-medium text-ink">{account.role}</span>
              <span className="block truncate font-mono text-2xs text-ink-muted">
                {account.identifier}
              </span>
            </span>
            <span className="shrink-0 text-2xs font-medium text-brand">Use</span>
          </button>
        ))}
      </div>
    </div>
  );
}
