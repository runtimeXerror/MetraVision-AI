import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ArrowLeft,
  ClipboardCheck,
  Mail,
  MapPin,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  UserRound,
  Users,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import { InspectorChart, TrendChart } from '@/components/charts';
import { RoleBadge, UserStatusBadge } from '@/components/domain/badges';
import {
  Avatar,
  Button,
  Card,
  CardBody,
  CardHeader,
  DetailRow,
  Notice,
  PageHeader,
} from '@/components/ui/primitives';
import { CardSkeleton, ChartSkeleton, EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { TBody, TD, TH, THead, TR, TableWrap } from '@/components/ui/table';
import { Input } from '@/components/ui/forms';
import { dashboardService, userService } from '@/services';
import { useIsAdmin } from '@/store/authStore';
import { cn } from '@/utils/cn';
import { formatNumber, formatPercent, formatRelative } from '@/utils/format';

/**
 * The inspector roster.
 *
 * Driven from the user collection outward rather than from inspections, so an
 * officer who has filed nothing still has a row. A roster that silently omits
 * the inactive is exactly the wrong roster for a supervisor.
 */

export function InspectorsPage() {
  const isAdmin = useIsAdmin();
  const [enrolling, setEnrolling] = useState(false);

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['analytics', 'inspector-activity'],
    queryFn: () => userService.listInspectorActivity(),
  });

  return (
    <>
      <PageHeader
        title="Inspectors"
        description="Field officers, their workload and the outcomes they are recording."
        actions={
          isAdmin ? (
            <Button icon={UserPlus} onClick={() => setEnrolling(true)}>
              Register inspector
            </Button>
          ) : null
        }
      />

      {enrolling ? (
        <EnrolDialog
          onClose={() => setEnrolling(false)}
          onEnrolled={() => void refetch()}
        />
      ) : null}

      {isPending ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <CardSkeleton key={index} />
            ))}
          </div>
          <Card className="mt-4">
            <TableSkeleton columns={7} />
          </Card>
        </>
      ) : error ? (
        <Card>
          <ErrorState error={error} onRetry={() => void refetch()} />
        </Card>
      ) : !data || data.length === 0 ? (
        <Card>
          <EmptyState
            icon={Users}
            title="No inspectors on the roster"
            description="Inspector accounts created by an administrator will appear here."
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryTile
              label="Inspectors"
              value={formatNumber(data.length)}
              hint={`${data.filter((row) => row.status === 'ACTIVE').length} active`}
              icon={Users}
            />
            <SummaryTile
              label="Total inspections"
              value={formatNumber(data.reduce((sum, row) => sum + row.totalInspections, 0))}
              hint="Across all officers"
              icon={ClipboardCheck}
            />
            <SummaryTile
              label="Violations found"
              value={formatNumber(data.reduce((sum, row) => sum + row.violations, 0))}
              hint="Records with a finding"
              icon={ShieldAlert}
            />
            <SummaryTile
              label="Pending reviews"
              value={formatNumber(data.reduce((sum, row) => sum + row.pendingReviews, 0))}
              hint="Awaiting verification"
              icon={UserRound}
            />
          </div>

          <Card className="mt-4">
            <CardHeader
              icon={Users}
              title="Workload comparison"
              description="Inspections carried out against violations found"
            />
            <CardBody className="pl-2 pr-4">
              <InspectorChart data={data} height={240} />
            </CardBody>
          </Card>

          <Card className="mt-4">
            <CardHeader icon={Users} title="Roster" description="Select an officer for their record" />
            <TableWrap>
              <THead>
                <TH>Inspector</TH>
                <TH>Status</TH>
                <TH>District</TH>
                <TH align="right">Inspections</TH>
                <TH align="right">Violations</TH>
                <TH align="right">Pending</TH>
                <TH align="right">Compliance rate</TH>
                <TH>Last activity</TH>
              </THead>
              <TBody>
                {data.map((inspector) => (
                  <TR key={inspector.id}>
                    <TD label="Inspector" hideLabel>
                      <Link
                        to={`/inspectors/${inspector.id}`}
                        className="flex items-center gap-2.5 hover:underline"
                      >
                        <Avatar name={inspector.name} size={30} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-ink">
                            {inspector.name}
                          </span>
                          <span className="block font-mono text-2xs text-ink-muted">
                            {inspector.inspectorId}
                          </span>
                        </span>
                      </Link>
                    </TD>
                    <TD label="Status">
                      <UserStatusBadge status={inspector.status} />
                    </TD>
                    <TD label="District" className="text-xs text-ink-muted">{inspector.district ?? '—'}</TD>
                    <TD label="Inspections" align="right" className="tabular text-sm font-medium">
                      {formatNumber(inspector.totalInspections)}
                    </TD>
                    <TD label="Violations" align="right" className="tabular text-sm text-violation">
                      {formatNumber(inspector.violations)}
                    </TD>
                    <TD label="Pending" align="right" className="tabular text-sm text-review-ink">
                      {formatNumber(inspector.pendingReviews)}
                    </TD>
                    <TD label="Compliance rate" align="right">
                      <RateCell rate={inspector.complianceRate} assessed={inspector.compliant + inspector.violations} />
                    </TD>
                    <TD label="Last activity" className="whitespace-nowrap text-xs text-ink-muted">
                      {formatRelative(inspector.lastActivityAt)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </TableWrap>
          </Card>
        </>
      )}
    </>
  );
}

/**
 * A rate with nothing behind it is misleading — one compliant inspection out of
 * one is not "100% compliance". The denominator is shown alongside.
 */
function RateCell({ rate, assessed }: { rate: number; assessed: number }) {
  if (assessed === 0) return <span className="text-xs text-ink-faint">No data</span>;

  return (
    <span
      className={cn(
        'text-sm font-medium tabular',
        rate >= 60 ? 'text-compliant' : rate >= 40 ? 'text-review-ink' : 'text-violation',
      )}
    >
      {formatPercent(rate)}
      <span className="ml-1 text-2xs font-normal text-ink-faint">of {assessed}</span>
    </span>
  );
}

function SummaryTile({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof Users;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">{label}</p>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
          <Icon className="h-4 w-4" strokeWidth={2} aria-hidden />
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold tabular tracking-tight text-ink">{value}</p>
      <p className="mt-1 text-xs text-ink-muted">{hint}</p>
    </Card>
  );
}

/* ── Individual inspector ─────────────────────────────────────────────────── */

export function InspectorDetailPage() {
  const { id = '' } = useParams();

  const { data: roster, isPending: rosterPending } = useQuery({
    queryKey: ['analytics', 'inspector-activity'],
    queryFn: () => userService.listInspectorActivity(),
  });

  const { data: trend, isPending: trendPending } = useQuery({
    queryKey: ['analytics', 'trend', id],
    queryFn: () => dashboardService.getTrend({ inspectorId: id, days: 30 }),
    enabled: Boolean(id),
  });

  const inspector = roster?.find((entry) => entry.id === id);

  if (rosterPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <CardSkeleton key={index} />
        ))}
      </div>
    );
  }

  if (!inspector) {
    return (
      <Card>
        <EmptyState
          icon={UserRound}
          title="Inspector not found"
          description="This officer is not on the roster you are authorised to see."
          action={
            <Link to="/inspectors" className="text-sm font-medium text-brand hover:underline">
              Back to roster
            </Link>
          }
        />
      </Card>
    );
  }

  const assessed = inspector.compliant + inspector.violations;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link
            to="/inspectors"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-brand"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            All inspectors
          </Link>
        }
        title={inspector.name}
        description={inspector.inspectorId}
        actions={<UserStatusBadge status={inspector.status} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile
          label="Total inspections"
          value={formatNumber(inspector.totalInspections)}
          hint="All time"
          icon={ClipboardCheck}
        />
        <SummaryTile
          label="Compliance rate"
          value={assessed > 0 ? formatPercent(inspector.complianceRate) : '—'}
          hint={assessed > 0 ? `Of ${assessed} assessed` : 'Nothing assessed yet'}
          icon={ShieldCheck}
        />
        <SummaryTile
          label="Violations detected"
          value={formatNumber(inspector.violations)}
          hint="Records with a finding"
          icon={ShieldAlert}
        />
        <SummaryTile
          label="Pending reviews"
          value={formatNumber(inspector.pendingReviews)}
          hint="Awaiting their verification"
          icon={UserRound}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            icon={ClipboardCheck}
            title="Activity"
            description="This officer's inspections over the last 30 days"
          />
          {trendPending ? (
            <ChartSkeleton height={240} />
          ) : (
            <CardBody className="pl-2 pr-4">
              <TrendChart data={trend ?? []} height={240} />
            </CardBody>
          )}
        </Card>

        <Card>
          <CardHeader icon={UserRound} title="Officer" />
          <CardBody className="py-1">
            <dl>
              <DetailRow label="Name">{inspector.name}</DetailRow>
              <DetailRow label="Inspector ID" mono>
                {inspector.inspectorId}
              </DetailRow>
              <DetailRow label="Role">
                <RoleBadge role="INSPECTOR" />
              </DetailRow>
              <DetailRow label="Status">
                <UserStatusBadge status={inspector.status} />
              </DetailRow>
              <DetailRow label="District">
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2} aria-hidden />
                  {inspector.district ?? 'Not assigned'}
                </span>
              </DetailRow>
              <DetailRow label="Last activity">
                {formatRelative(inspector.lastActivityAt)}
              </DetailRow>
            </dl>
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          icon={ClipboardCheck}
          title="Records"
          description="Every inspection carried out by this officer"
          action={
            <Link
              to={`/inspections?inspectorId=${inspector.id}`}
              className="text-xs font-medium text-brand hover:underline"
            >
              Open in the register
            </Link>
          }
        />
        <CardBody>
          <p className="text-sm text-ink-muted">
            The inspection register, filtered to this officer, carries the full list with its own
            search and paging.
          </p>
        </CardBody>
      </Card>
    </>
  );
}

/* ── Enrolling an officer ─────────────────────────────────────────────────── */

/**
 * Registers an officer, then shows the credentials once.
 *
 * The dialog has two states rather than closing on success, and that is the
 * point: the temporary password exists in exactly one response and is stored
 * only as a hash. If this closed on save, the administrator would have enrolled
 * someone they can no longer give access to, and the only remedy would be
 * deleting the account and starting again.
 *
 * Sending the credentials by email is the intended delivery and is not built.
 * Until it is, the dialog says so and puts the two values where they can be
 * copied — rather than implying a mail went out that did not.
 */
function EnrolDialog({ onClose, onEnrolled }: { onClose: () => void; onEnrolled: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', district: '', state: '' });
  const [issued, setIssued] = useState<userService.EnrolledInspector | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      userService.createInspector({
        name: form.name.trim(),
        email: form.email.trim(),
        district: form.district.trim() || undefined,
        state: form.state.trim() || undefined,
      }),
    onSuccess: (result) => {
      setIssued(result);
      onEnrolled();
    },
  });

  const ready = form.name.trim().length >= 2 && /\S+@\S+\.\S+/.test(form.email);

  if (issued) {
    return (
      <Dialog
        title="Officer enrolled"
        description="These credentials are shown once. Hand them over before closing this dialog."
        onClose={onClose}
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <Notice tone="review" icon={Mail}>
          Email delivery is not wired up yet, so nothing has been sent. Give the officer the
          Inspector ID and password below; they can change the password from their profile after
          signing in.
        </Notice>
        <dl className="divide-y divide-line rounded-lg border border-line">
          <CredentialRow label="Name" value={issued.user.name} />
          <CredentialRow label="Email" value={issued.user.email} />
          <CredentialRow label="Inspector ID" value={issued.user.inspectorId} mono />
          <CredentialRow label="Temporary password" value={issued.temporaryPassword} mono />
        </dl>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="Register inspector"
      description="The Inspector ID and a temporary password are generated automatically — you do not set them."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={mutation.isPending} disabled={!ready} onClick={() => mutation.mutate()}>
            Register
          </Button>
        </>
      }
    >
      {mutation.error ? (
        <Notice tone="violation" icon={ShieldAlert}>
          {mutation.error instanceof Error
            ? mutation.error.message
            : 'The officer could not be registered.'}
        </Notice>
      ) : null}

      <Input
        label="Full name"
        value={form.name}
        onChange={(event) => setForm({ ...form, name: event.target.value })}
        placeholder="Ravi Sharma"
      />
      <Input
        label="Email"
        type="email"
        value={form.email}
        onChange={(event) => setForm({ ...form, email: event.target.value })}
        placeholder="ravi.sharma@legalmetrology.gov.in"
        hint="The address the credentials will be sent to once mail delivery is enabled."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="District"
          value={form.district}
          onChange={(event) => setForm({ ...form, district: event.target.value })}
          placeholder="Optional"
        />
        <Input
          label="State"
          value={form.state}
          onChange={(event) => setForm({ ...form, state: event.target.value })}
          placeholder="Optional"
        />
      </div>
    </Dialog>
  );
}

function CredentialRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className={cn('text-sm text-ink', mono && 'font-mono')}>{value}</dd>
    </div>
  );
}

/** Local to this page, matching the profile dialogs. */
function Dialog({
  title,
  description,
  children,
  footer,
  onClose,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-label="Close"
        tabIndex={-1}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-lg overflow-hidden rounded-card border border-line bg-surface shadow-pop"
      >
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-ink-muted">{description}</p> : null}
        </div>
        <div className="space-y-4 p-5">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
          {footer}
        </div>
      </div>
    </div>
  );
}
