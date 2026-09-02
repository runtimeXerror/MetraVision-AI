import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  Bot,
  Database,
  HardDrive,
  Layout,
  Lock,
  Moon,
  Server,
  ShieldCheck,
  Sun,
  UserRound,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { RoleBadge } from '@/components/domain/badges';
import { SegmentedControl } from '@/components/ui/forms';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  DetailRow,
  Notice,
  PageHeader,
} from '@/components/ui/primitives';
import { Skeleton } from '@/components/ui/states';
import { API_BASE_URL, authService } from '@/services';
import { useIsAdmin, useUser } from '@/store/authStore';
import { useUiStore } from '@/store/uiStore';
import { humanise } from '@/utils/format';

/**
 * Settings.
 *
 * Only two things here actually change anything — the theme and the sidebar —
 * and both are workstation preferences held in the browser. Everything else is
 * *reported*, not configured: what the console is talking to, and what it is
 * running against. On a system that produces enforcement records, a settings
 * page that pretends to configure things it does not is worse than a short one.
 */

export function SettingsPage() {
  const user = useUser();
  const isAdmin = useIsAdmin();

  const theme = useUiStore((state) => state.theme);
  const toggleTheme = useUiStore((state) => state.toggleTheme);
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

  const { data: health, isPending: healthPending, error: healthError } = useQuery({
    queryKey: ['health'],
    queryFn: authService.health,
    retry: 1,
    staleTime: 30_000,
  });

  return (
    <>
      <PageHeader
        title="Settings"
        description="Workstation preferences, and what this console is currently running against."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Account */}
        <Card>
          <CardHeader icon={UserRound} title="Account" description="Managed by your department" />
          <CardBody className="py-1">
            <dl>
              <DetailRow label="Signed in as">{user?.name ?? '—'}</DetailRow>
              <DetailRow label="Inspector ID" mono>
                {user?.inspectorId ?? '—'}
              </DetailRow>
              <DetailRow label="Email">{user?.email ?? '—'}</DetailRow>
              <DetailRow label="Role">
                {user ? <RoleBadge role={user.role} /> : '—'}
              </DetailRow>
              <DetailRow label="Manage">
                <Link to="/profile" className="text-brand hover:underline">
                  Open your profile
                </Link>
              </DetailRow>
            </dl>
          </CardBody>
        </Card>

        {/* Appearance */}
        <Card>
          <CardHeader
            icon={Layout}
            title="Dashboard preferences"
            description="Held in this browser, on this workstation"
          />
          <CardBody className="space-y-4">
            <Row
              icon={theme === 'dark' ? Moon : Sun}
              title="Theme"
              detail="Applies to charts and tables as well as the interface."
            >
              <SegmentedControl
                value={theme}
                onChange={(next) => {
                  if (next !== theme) toggleTheme();
                }}
                options={[
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
              />
            </Row>

            <Row
              icon={Layout}
              title="Sidebar"
              detail="Collapsing keeps the icons and their order, and drops the labels."
            >
              <SegmentedControl
                value={collapsed ? 'collapsed' : 'expanded'}
                onChange={(next) => {
                  if ((next === 'collapsed') !== collapsed) toggleSidebar();
                }}
                options={[
                  { value: 'expanded', label: 'Expanded' },
                  { value: 'collapsed', label: 'Collapsed' },
                ]}
              />
            </Row>
          </CardBody>
        </Card>

        {/* Notifications */}
        <Card>
          <CardHeader
            icon={Bell}
            title="Notification preferences"
            description="What the bell reports"
          />
          <CardBody>
            <Notice tone="neutral" icon={Bell}>
              Notifications are derived from live inspection figures — pending reviews, open
              findings and drafts — rather than stored as their own records. There is nothing to
              subscribe to yet, so there is nothing here to configure. When a notification service
              exists, its preferences will appear in this section.
            </Notice>
          </CardBody>
        </Card>

        {/* System */}
        <Card>
          <CardHeader
            icon={Server}
            title="System information"
            description="What this console is connected to"
          />
          <CardBody className="py-1">
            {healthPending ? (
              <div className="space-y-3 py-3">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-4" />
                ))}
              </div>
            ) : (
              <dl>
                <DetailRow label="Connection">
                  {healthError ? (
                    <span className="flex items-center gap-1.5 text-violation">
                      <WifiOff className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                      Unreachable
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-compliant">
                      <Wifi className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                      Connected
                    </span>
                  )}
                </DetailRow>
                <DetailRow label="API endpoint" mono>
                  {API_BASE_URL}
                </DetailRow>
                {health ? (
                  <>
                    <DetailRow label="Environment">{humanise(health.environment)}</DetailRow>
                    <DetailRow label="Database">
                      <span className="flex items-center gap-1.5">
                        <Database className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2} aria-hidden />
                        {health.database}
                      </span>
                    </DetailRow>
                    <DetailRow label="Image storage">
                      <span className="flex items-center gap-1.5">
                        <HardDrive className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2} aria-hidden />
                        {health.storageProvider}
                      </span>
                    </DetailRow>
                    <DetailRow label="Analysis provider">
                      <span className="flex items-center gap-1.5">
                        <Bot className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2} aria-hidden />
                        {health.analysisProvider}
                        {health.analysisProvider === 'mock' ? (
                          <Badge tone="review">Simulated</Badge>
                        ) : null}
                      </span>
                    </DetailRow>
                    <DetailRow label="Release">{health.phase}</DetailRow>
                    <DetailRow label="Uptime">
                      {Math.floor(health.uptimeSeconds / 60)} min
                    </DetailRow>
                  </>
                ) : null}
              </dl>
            )}
          </CardBody>
        </Card>

        {/* Administration */}
        <Card className="lg:col-span-2">
          <CardHeader
            icon={ShieldCheck}
            title="Administration"
            description={
              isAdmin
                ? 'Available to your account'
                : 'Restricted to administrator accounts'
            }
          />
          <CardBody>
            {isAdmin ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <AdminLink
                  to="/rules"
                  title="Rule repository"
                  detail="Create, amend and retire declaration requirements. Amendments are versioned."
                />
                <AdminLink
                  to="/inspectors"
                  title="Inspector roster"
                  detail="Field officers, their jurisdiction and their activity."
                />
              </div>
            ) : (
              <Notice tone="neutral" icon={Lock}>
                Rule authoring, account administration and system configuration are restricted to
                administrator accounts. Your account is signed in as{' '}
                <strong className="font-semibold">{humanise(user?.role ?? '')}</strong>. The API
                enforces this independently of what this console displays.
              </Notice>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Row({
  icon: Icon,
  title,
  detail,
  children,
}: {
  icon: typeof Sun;
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-sunken text-ink-muted">
          <Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{title}</p>
          <p className="mt-0.5 text-xs text-ink-muted">{detail}</p>
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function AdminLink({ to, title, detail }: { to: string; title: string; detail: string }) {
  return (
    <Link
      to={to}
      className="rounded-lg border border-line p-4 transition-colors hover:border-brand hover:bg-brand-soft/40"
    >
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">{detail}</p>
    </Link>
  );
}
