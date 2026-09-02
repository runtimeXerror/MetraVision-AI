import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  FileCheck2,
  Loader2,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/primitives';
import type { ComplianceStatus, InspectionStatus, Severity, UserStatus } from '@/types/api';
import { humanise, severityLabels, statusLabels } from '@/utils/format';

/**
 * The enforcement vocabulary, rendered.
 *
 * Every place a verdict, a status or a severity appears, it appears through
 * one of these. That is what stops "Violation Detected" being red in the table
 * and amber on the detail page — the mapping from meaning to colour exists
 * exactly once.
 *
 * Each badge carries a shape as well as a colour: an enforcement record must be
 * readable by someone who cannot distinguish red from green.
 */

type Tone = 'compliant' | 'violation' | 'review' | 'neutral' | 'info' | 'brand';

const STATUS_TONE: Record<InspectionStatus, Tone> = {
  DRAFT: 'neutral',
  PROCESSING: 'info',
  REVIEW_REQUIRED: 'review',
  COMPLIANT: 'compliant',
  VIOLATION_DETECTED: 'violation',
  FINALIZED: 'brand',
};

const STATUS_ICON: Record<InspectionStatus, LucideIcon> = {
  DRAFT: CircleDashed,
  PROCESSING: Loader2,
  REVIEW_REQUIRED: AlertTriangle,
  COMPLIANT: CheckCircle2,
  VIOLATION_DETECTED: ShieldAlert,
  FINALIZED: FileCheck2,
};

export function StatusBadge({ status }: { status: InspectionStatus }) {
  const Icon = STATUS_ICON[status] ?? CircleDashed;

  return (
    <Badge tone={STATUS_TONE[status] ?? 'neutral'}>
      <Icon
        className={status === 'PROCESSING' ? 'h-3 w-3 animate-spin' : 'h-3 w-3'}
        strokeWidth={2.5}
        aria-hidden
      />
      {statusLabels[status] ?? humanise(status)}
    </Badge>
  );
}

const COMPLIANCE_TONE: Record<ComplianceStatus, Tone> = {
  COMPLIANT: 'compliant',
  VIOLATION_DETECTED: 'violation',
  REVIEW_REQUIRED: 'review',
};

const COMPLIANCE_ICON: Record<ComplianceStatus, LucideIcon> = {
  COMPLIANT: CheckCircle2,
  VIOLATION_DETECTED: ShieldAlert,
  REVIEW_REQUIRED: AlertTriangle,
};

export function ComplianceBadge({ status }: { status: ComplianceStatus }) {
  const Icon = COMPLIANCE_ICON[status];

  return (
    <Badge tone={COMPLIANCE_TONE[status]}>
      <Icon className="h-3 w-3" strokeWidth={2.5} aria-hidden />
      {status === 'VIOLATION_DETECTED'
        ? 'Violation'
        : status === 'REVIEW_REQUIRED'
          ? 'Review'
          : 'Compliant'}
    </Badge>
  );
}

const SEVERITY_TONE: Record<Severity, Tone> = {
  CRITICAL: 'violation',
  MAJOR: 'review',
  MINOR: 'neutral',
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <Badge tone={SEVERITY_TONE[severity]} dot>
      {severityLabels[severity] ?? humanise(severity)}
    </Badge>
  );
}

export function OpenClosedBadge({ status }: { status: 'OPEN' | 'RESOLVED' }) {
  return (
    <Badge tone={status === 'OPEN' ? 'review' : 'compliant'}>
      {status === 'OPEN' ? (
        <AlertOctagon className="h-3 w-3" strokeWidth={2.5} aria-hidden />
      ) : (
        <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} aria-hidden />
      )}
      {status === 'OPEN' ? 'Open' : 'Resolved'}
    </Badge>
  );
}

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const tone: Tone =
    status === 'ACTIVE' ? 'compliant' : status === 'SUSPENDED' ? 'violation' : 'neutral';
  return (
    <Badge tone={tone} dot>
      {humanise(status)}
    </Badge>
  );
}

export function RoleBadge({ role }: { role: string }) {
  return (
    <Badge tone={role === 'ADMIN' ? 'brand' : role === 'SUPERVISOR' ? 'info' : 'neutral'}>
      {humanise(role)}
    </Badge>
  );
}

export function RuleStatusBadge({ status }: { status: string }) {
  const tone: Tone =
    status === 'ACTIVE' ? 'compliant' : status === 'DRAFT' ? 'review' : 'neutral';
  return (
    <Badge tone={tone} dot>
      {humanise(status)}
    </Badge>
  );
}
