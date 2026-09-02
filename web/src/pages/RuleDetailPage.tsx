import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, History, PencilLine, ScrollText, Scale } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { RuleStatusBadge, SeverityBadge } from '@/components/domain/badges';
import { Select, Textarea } from '@/components/ui/forms';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DetailRow,
  Notice,
  PageHeader,
} from '@/components/ui/primitives';
import { ErrorState, Skeleton } from '@/components/ui/states';
import { ruleService } from '@/services';
import { useIsAdmin } from '@/store/authStore';
import { VALIDATION_TYPES, type Rule } from '@/types/api';
import { categoryLabel, formatDate, formatDateTime, humanise } from '@/utils/format';

/**
 * One rule, and everything it has ever said.
 *
 * The version history is the reason this page exists. Regulatory requirements
 * change, and an enforcement record is only defensible if the system can show
 * which text was in force on the date the inspection was carried out.
 */

export function RuleDetailPage() {
  const { id = '' } = useParams();
  const isAdmin = useIsAdmin();
  const [amending, setAmending] = useState(false);

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['rule', id],
    queryFn: () => ruleService.getRule(id),
    enabled: Boolean(id),
  });

  if (isPending) {
    return (
      <Card className="space-y-3 p-5">
        {Array.from({ length: 8 }).map((_, index) => (
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
        breadcrumb={
          <Link
            to="/rules"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-brand"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
            Rule repository
          </Link>
        }
        title={data.fieldLabel}
        description={`${data.ruleId} · ${data.ruleReference}`}
        actions={
          <div className="flex items-center gap-2">
            <RuleStatusBadge status={data.status} />
            {isAdmin ? (
              <Button variant="secondary" icon={PencilLine} onClick={() => setAmending(true)}>
                Amend
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader icon={ScrollText} title="Current text" description={`Version ${data.version}, in force`} />
          <CardBody className="py-1">
            <dl>
              <DetailRow label="Rule ID" mono>
                {data.ruleId}
              </DetailRow>
              <DetailRow label="Title">{data.title}</DetailRow>
              <DetailRow label="Declaration">
                <span className="block">{data.fieldLabel}</span>
                <span className="block font-mono text-2xs text-ink-muted">{data.field}</span>
              </DetailRow>
              <DetailRow label="Requirement">
                <span className="leading-relaxed">{data.requirement}</span>
              </DetailRow>
              <DetailRow label="Validation type">
                <Badge tone="neutral">{humanise(data.validationType)}</Badge>
              </DetailRow>
              <DetailRow label="Parameters">
                {Object.keys(data.parameters ?? {}).length === 0 ? (
                  <span className="text-ink-faint">None — presence is the whole test</span>
                ) : (
                  <pre className="scroll-slim max-h-40 overflow-auto rounded-lg bg-surface-sunken p-3 font-mono text-2xs leading-relaxed text-ink">
                    {JSON.stringify(data.parameters, null, 2)}
                  </pre>
                )}
              </DetailRow>
              <DetailRow label="Severity when breached">
                <SeverityBadge severity={data.severity} />
              </DetailRow>
              <DetailRow label="Applies to">
                {data.appliesToCategories.length === 0 ? (
                  <span>Every commodity category</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {data.appliesToCategories.map((category) => (
                      <Badge key={category} tone="neutral">
                        {categoryLabel(category)}
                      </Badge>
                    ))}
                  </span>
                )}
              </DetailRow>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader icon={Scale} title="Provenance" />
          <CardBody className="py-1">
            <dl>
              <DetailRow label="Source">
                <span className="leading-relaxed">{data.source}</span>
              </DetailRow>
              <DetailRow label="Provision" mono>
                {data.ruleReference}
              </DetailRow>
              <DetailRow label="Category">{data.category}</DetailRow>
              <DetailRow label="Version" mono>
                v{data.version}
              </DetailRow>
              <DetailRow label="Effective from">{formatDate(data.effectiveFrom)}</DetailRow>
              <DetailRow label="Effective to">
                {data.effectiveTo ? formatDate(data.effectiveTo) : 'Still in force'}
              </DetailRow>
              <DetailRow label="Status">
                <RuleStatusBadge status={data.status} />
              </DetailRow>
              <DetailRow label="Recorded">{formatDateTime(data.createdAt)}</DetailRow>
            </dl>
          </CardBody>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader
            icon={History}
            title="Version history"
            description="Superseded texts, retained with the window each was in force for"
          />
          <CardBody>
            <VersionHistory rule={data} />
          </CardBody>
        </Card>
      </div>

      {amending ? <AmendDialog rule={data} onClose={() => setAmending(false)} /> : null}
    </>
  );
}

function VersionHistory({ rule }: { rule: Rule }) {
  const entries = [
    {
      version: rule.version,
      requirement: rule.requirement,
      validationType: rule.validationType,
      effectiveFrom: rule.effectiveFrom,
      effectiveTo: rule.effectiveTo,
      changeNote: undefined as string | undefined,
      current: true,
    },
    ...rule.history.map((entry) => ({
      version: entry.version,
      requirement: entry.requirement,
      validationType: entry.validationType,
      effectiveFrom: entry.effectiveFrom,
      effectiveTo: entry.effectiveTo,
      changeNote: entry.changeNote,
      current: false,
    })),
  ];

  return (
    <ol className="relative space-y-4 before:absolute before:left-[0.9375rem] before:top-3 before:h-[calc(100%-1.5rem)] before:w-px before:bg-line">
      {entries.map((entry) => (
        <li key={entry.version} className="relative flex gap-3.5">
          <span
            className={
              entry.current
                ? 'relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-compliant-soft text-compliant-ink ring-4 ring-surface'
                : 'relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-sunken text-ink-faint ring-4 ring-surface'
            }
          >
            <span className="text-2xs font-semibold tabular">v{entry.version}</span>
          </span>

          <div className="min-w-0 flex-1 pt-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-ink">Version {entry.version}</p>
              {entry.current ? <Badge tone="compliant">In force</Badge> : <Badge tone="neutral">Superseded</Badge>}
              <Badge tone="neutral">{humanise(entry.validationType)}</Badge>
            </div>

            <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{entry.requirement}</p>

            <p className="mt-1.5 text-2xs text-ink-faint">
              {formatDate(entry.effectiveFrom)} —{' '}
              {entry.effectiveTo ? formatDate(entry.effectiveTo) : 'present'}
            </p>

            {entry.changeNote ? (
              <p className="mt-1.5 rounded-lg bg-surface-sunken px-3 py-2 text-xs italic text-ink-muted">
                “{entry.changeNote}”
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * Amendment.
 *
 * Changing the requirement text, how it is validated or its parameters is a
 * *substantive* change: the API closes off the outgoing version and increments.
 * The note is what a later reader needs to understand why the text moved.
 */
function AmendDialog({ rule, onClose }: { rule: Rule; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [requirement, setRequirement] = useState(rule.requirement);
  const [validationType, setValidationType] = useState(rule.validationType);
  const [changeNote, setChangeNote] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      ruleService.updateRule(rule.id, {
        requirement,
        validationType,
        changeNote: changeNote.trim() || undefined,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['rule', rule.id], updated);
      void queryClient.invalidateQueries({ queryKey: ['rules'] });
      onClose();
    },
  });

  const substantive =
    requirement.trim() !== rule.requirement || validationType !== rule.validationType;

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
        aria-label="Amend rule"
        className="relative w-full max-w-xl overflow-hidden rounded-card border border-line bg-surface shadow-pop"
      >
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">Amend {rule.ruleId}</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Currently at version {rule.version}, in force since {formatDate(rule.effectiveFrom)}.
          </p>
        </div>

        <div className="space-y-4 p-5">
          <Textarea
            label="Requirement"
            value={requirement}
            onChange={(event) => setRequirement(event.target.value)}
            rows={4}
          />

          <Select
            label="Validation type"
            value={validationType}
            onChange={(event) =>
              setValidationType(event.target.value as typeof validationType)
            }
            options={VALIDATION_TYPES.map((type) => ({ value: type, label: humanise(type) }))}
          />

          <Textarea
            label="Change note"
            value={changeNote}
            onChange={(event) => setChangeNote(event.target.value)}
            placeholder="Why the text is changing — the notification it follows, for instance."
            rows={2}
          />

          {substantive ? (
            <Notice tone="review" icon={History}>
              This is a substantive change. Version {rule.version} will be closed off and retained,
              and the rule will become version {rule.version + 1}. Inspections already assessed
              stay associated with the text that applied to them.
            </Notice>
          ) : (
            <Notice tone="neutral">
              No substantive change yet — edit the requirement or validation type to record an
              amendment.
            </Notice>
          )}

          {mutation.error ? (
            <Notice tone="violation">
              {mutation.error instanceof Error
                ? mutation.error.message
                : 'The amendment could not be saved.'}
            </Notice>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={!substantive || requirement.trim().length < 5}
            onClick={() => mutation.mutate()}
          >
            Record amendment
          </Button>
        </div>
      </div>
    </div>
  );
}
