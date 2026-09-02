import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  IdCard,
  KeyRound,
  LogOut,
  Mail,
  MapPin,
  PencilLine,
  Phone,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { RoleBadge, UserStatusBadge } from '@/components/domain/badges';
import { Input } from '@/components/ui/forms';
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
import { ErrorState, Skeleton } from '@/components/ui/states';
import { authService } from '@/services';
import { useAuthStore } from '@/store/authStore';
import { formatDateTime } from '@/utils/format';

/**
 * The signed-in account.
 *
 * Reads from `/users/me` rather than the cached session, so a role or
 * jurisdiction changed by an administrator since sign-in shows here rather than
 * persisting until the token expires.
 */

export function ProfilePage() {
  const queryClient = useQueryClient();
  const setUser = useAuthStore((state) => state.setUser);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();

  const [editing, setEditing] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['profile'],
    queryFn: authService.getProfile,
  });

  if (isPending) {
    return (
      <Card className="space-y-3 p-5">
        {Array.from({ length: 7 }).map((_, index) => (
          <Skeleton key={index} className="h-4" />
        ))}
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <ErrorState error={error} onRetry={() => void refetch()} />
      </Card>
    );
  }

  if (!data) return null;

  return (
    <>
      <PageHeader
        title="Profile"
        description="Your departmental account. The same credentials sign you into the field application."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" icon={KeyRound} onClick={() => setChangingPassword(true)}>
              Change password
            </Button>
            <Button variant="secondary" icon={PencilLine} onClick={() => setEditing(true)}>
              Edit
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardBody className="flex flex-col items-center py-8 text-center">
            <Avatar name={data.name} color={data.avatarColor} size={80} />
            <h2 className="mt-4 text-lg font-semibold text-ink">{data.name}</h2>
            <p className="font-mono text-xs text-ink-muted">{data.inspectorId}</p>
            <div className="mt-3 flex items-center gap-2">
              <RoleBadge role={data.role} />
              <UserStatusBadge status={data.status} />
            </div>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader icon={UserRound} title="Account details" />
          <CardBody className="py-1">
            <dl>
              <DetailRow label="Full name">{data.name}</DetailRow>
              <DetailRow label="Inspector ID" mono>
                {data.inspectorId}
              </DetailRow>
              <DetailRow label="Email">
                <span className="flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2} aria-hidden />
                  {data.email}
                </span>
              </DetailRow>
              <DetailRow label="Phone">
                <span className="flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2} aria-hidden />
                  {data.phone || 'Not recorded'}
                </span>
              </DetailRow>
              <DetailRow label="Role">
                <RoleBadge role={data.role} />
              </DetailRow>
              <DetailRow label="Account status">
                <UserStatusBadge status={data.status} />
              </DetailRow>
              <DetailRow label="Department">
                <span className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2} aria-hidden />
                  {data.department}
                </span>
              </DetailRow>
              <DetailRow label="Jurisdiction">
                <span className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2} aria-hidden />
                  {[data.zone, data.district, data.state].filter(Boolean).join(' · ') ||
                    'Not assigned'}
                </span>
              </DetailRow>
              <DetailRow label="Last sign-in">{formatDateTime(data.lastLoginAt)}</DetailRow>
              <DetailRow label="Account created">{formatDateTime(data.createdAt)}</DetailRow>
            </dl>
          </CardBody>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader icon={ShieldCheck} title="Session" />
          <CardBody className="flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-xl text-xs leading-relaxed text-ink-muted">
              Your session is held for this browser tab only and ends when the tab closes — this
              console is used on shared departmental workstations. Signing out revokes the session
              on the server as well.
            </p>
            <Button
              variant="danger"
              icon={LogOut}
              onClick={async () => {
                await logout();
                queryClient.clear();
                navigate('/login', { replace: true });
              }}
            >
              Sign out
            </Button>
          </CardBody>
        </Card>
      </div>

      {editing ? (
        <EditProfileDialog
          initial={data}
          onClose={() => setEditing(false)}
          onSaved={(user) => {
            setUser(user);
            queryClient.setQueryData(['profile'], user);
            setEditing(false);
          }}
        />
      ) : null}

      {changingPassword ? (
        <ChangePasswordDialog
          onClose={() => setChangingPassword(false)}
          onChanged={async () => {
            setChangingPassword(false);
            // The server revokes every session on a password change, so staying
            // signed in here would leave a token the API has already rejected.
            await logout();
            queryClient.clear();
            navigate('/login', { replace: true });
          }}
        />
      ) : null}
    </>
  );
}

/* ── Dialogs ──────────────────────────────────────────────────────────────── */

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

function EditProfileDialog({
  initial,
  onClose,
  onSaved,
}: {
  initial: { name: string; phone?: string; zone?: string; district?: string; state?: string };
  onClose: () => void;
  onSaved: (user: Awaited<ReturnType<typeof authService.updateProfile>>) => void;
}) {
  const [form, setForm] = useState({
    name: initial.name,
    phone: initial.phone ?? '',
    zone: initial.zone ?? '',
    district: initial.district ?? '',
    state: initial.state ?? '',
  });

  const mutation = useMutation({
    mutationFn: () => authService.updateProfile(form),
    onSuccess: onSaved,
  });

  return (
    <Dialog
      title="Edit profile"
      description="Your email, Inspector ID and role are set by your department and cannot be changed here."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={form.name.trim().length < 2}
            onClick={() => mutation.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      <Input
        label="Full name"
        icon={UserRound}
        value={form.name}
        onChange={(event) => setForm({ ...form, name: event.target.value })}
      />
      <Input
        label="Phone"
        icon={Phone}
        value={form.phone}
        onChange={(event) => setForm({ ...form, phone: event.target.value })}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Input
          label="Zone"
          value={form.zone}
          onChange={(event) => setForm({ ...form, zone: event.target.value })}
        />
        <Input
          label="District"
          value={form.district}
          onChange={(event) => setForm({ ...form, district: event.target.value })}
        />
        <Input
          label="State"
          value={form.state}
          onChange={(event) => setForm({ ...form, state: event.target.value })}
        />
      </div>

      {mutation.error ? (
        <Notice tone="violation">
          {mutation.error instanceof Error
            ? mutation.error.message
            : 'Your profile could not be saved.'}
        </Notice>
      ) : null}
    </Dialog>
  );
}

function ChangePasswordDialog({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const mutation = useMutation({
    mutationFn: () => authService.changePassword(current, next),
    onSuccess: onChanged,
  });

  const mismatch = confirm.length > 0 && next !== confirm;
  const valid = current.length > 0 && next.length >= 8 && next === confirm;

  return (
    <Dialog
      title="Change password"
      description="Every session is revoked when your password changes, so you will be signed out."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={mutation.isPending} disabled={!valid} onClick={() => mutation.mutate()}>
            Update password
          </Button>
        </>
      }
    >
      <Input
        label="Current password"
        icon={KeyRound}
        type="password"
        value={current}
        onChange={(event) => setCurrent(event.target.value)}
        autoComplete="current-password"
      />
      <Input
        label="New password"
        icon={IdCard}
        type="password"
        value={next}
        onChange={(event) => setNext(event.target.value)}
        hint="At least 8 characters"
        autoComplete="new-password"
      />
      <Input
        label="Confirm new password"
        icon={IdCard}
        type="password"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        error={mismatch ? 'The passwords do not match.' : undefined}
        autoComplete="new-password"
      />

      {mutation.error ? (
        <Notice tone="violation">
          {mutation.error instanceof Error
            ? mutation.error.message
            : 'The password could not be changed.'}
        </Notice>
      ) : null}
    </Dialog>
  );
}
