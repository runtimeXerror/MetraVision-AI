import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Power, PowerOff, ScrollText } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { RuleStatusBadge, SeverityBadge } from '@/components/domain/badges';
import { Input, SearchInput, Select, Textarea } from '@/components/ui/forms';
import { Badge, Button, Card, Notice, PageHeader } from '@/components/ui/primitives';
import { EmptyState, ErrorState, NoResults, TableSkeleton } from '@/components/ui/states';
import { Pagination, TBody, TD, TH, THead, TR, TableWrap } from '@/components/ui/table';
import { useFilters } from '@/hooks';
import { ruleService } from '@/services';
import { useIsAdmin } from '@/store/authStore';
import { PRODUCT_CATEGORIES, RULE_STATUSES, SEVERITIES, VALIDATION_TYPES } from '@/types/api';
import { categoryLabel, formatDate, humanise } from '@/utils/format';

/**
 * The rule repository.
 *
 * Every row comes from the API — there is deliberately no rule table anywhere
 * in this codebase. A requirement is amended by notification, and a console
 * that carried its own copy of the law would start telling inspectors something
 * different from the engine that judged their inspections.
 */

const DEFAULTS = {
  search: undefined,
  status: undefined,
  validationType: undefined,
} as Record<string, string | undefined>;

export function RulesPage() {
  const isAdmin = useIsAdmin();
  const [creating, setCreating] = useState(false);
  const { filters, setFilter, page, setPage, pageSize, setPageSize, clear, isFiltered } =
    useFilters(DEFAULTS);

  const params = {
    page,
    pageSize,
    search: filters.search,
    status: filters.status,
    validationType: filters.validationType,
  };

  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['rules', params],
    queryFn: () => ruleService.listRules(params),
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <PageHeader
        title="Rule Repository"
        description="The declarations a package must carry, the provision each is drawn from, and since when."
        actions={
          isAdmin ? (
            <Button icon={Plus} onClick={() => setCreating(true)}>
              New rule
            </Button>
          ) : null
        }
      />

      <Notice tone="info" icon={ScrollText} className="mb-4">
        Amending a rule does not overwrite it. The outgoing text is retained with the window it was
        in force for, so an inspection carried out last year can still be shown against the wording
        that applied when it was carried out.
      </Notice>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-card border border-line bg-surface p-3.5 shadow-card">
        <SearchInput
          value={filters.search ?? ''}
          onChange={(value) => setFilter('search', value || undefined)}
          placeholder="Search rule, declaration or provision…"
          className="min-w-[16rem] flex-1"
        />
        <Select
          aria-label="Status"
          value={filters.status ?? ''}
          onChange={(event) => setFilter('status', event.target.value || undefined)}
          placeholder="All statuses"
          options={RULE_STATUSES.map((status) => ({ value: status, label: humanise(status) }))}
          containerClassName="w-auto min-w-[10rem]"
        />
        <Select
          aria-label="Validation type"
          value={filters.validationType ?? ''}
          onChange={(event) => setFilter('validationType', event.target.value || undefined)}
          placeholder="All validation types"
          options={VALIDATION_TYPES.map((type) => ({ value: type, label: humanise(type) }))}
          containerClassName="w-auto min-w-[12rem]"
        />
        {isFiltered ? (
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear
          </Button>
        ) : null}
      </div>

      <Card>
        {isPending ? (
          <TableSkeleton columns={8} />
        ) : error ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data && data.items.length === 0 ? (
          isFiltered ? (
            <NoResults onClear={clear} />
          ) : (
            <EmptyState
              icon={ScrollText}
              title="The repository is empty"
              description="Run the backend seed to populate the rule catalogue from the Packaged Commodities Rules."
            />
          )
        ) : (
          <>
            <TableWrap>
              <THead>
                <TH>Rule</TH>
                <TH>Declaration</TH>
                <TH>Requirement</TH>
                <TH>Validation</TH>
                <TH>Applies to</TH>
                <TH>Severity</TH>
                <TH align="right">Version</TH>
                <TH>Effective</TH>
                <TH>Status</TH>
                {isAdmin ? <TH align="right">Actions</TH> : null}
              </THead>
              <TBody>
                {data?.items.map((rule) => (
                  <TR key={rule.id}>
                    <TD label="Rule" hideLabel>
                      <Link
                        to={`/rules/${rule.id}`}
                        className="block font-mono text-xs font-medium text-brand hover:underline"
                      >
                        {rule.ruleId}
                      </Link>
                      <span className="mt-0.5 block font-mono text-2xs text-ink-muted">
                        {rule.ruleReference}
                      </span>
                    </TD>

                    <TD label="Declaration">
                      <span className="block text-sm text-ink">{rule.fieldLabel}</span>
                      <span className="block font-mono text-2xs text-ink-faint">{rule.field}</span>
                    </TD>

                    <TD label="Requirement">
                      <span className="block max-w-full md:max-w-[20rem] truncate text-xs text-ink-muted" title={rule.requirement}>
                        {rule.requirement}
                      </span>
                    </TD>

                    <TD label="Validation">
                      <Badge tone="neutral">{humanise(rule.validationType)}</Badge>
                    </TD>

                    <TD label="Applies to">
                      <span className="text-xs text-ink-muted">
                        {rule.appliesToCategories.length === 0
                          ? 'All categories'
                          : rule.appliesToCategories.length <= 2
                            ? rule.appliesToCategories.map(categoryLabel).join(', ')
                            : `${rule.appliesToCategories.length} categories`}
                      </span>
                    </TD>

                    <TD label="Severity">
                      <SeverityBadge severity={rule.severity} />
                    </TD>

                    <TD label="Version" align="right" className="tabular text-sm">
                      v{rule.version}
                    </TD>

                    <TD label="Effective" className="whitespace-nowrap text-xs text-ink-muted">
                      {formatDate(rule.effectiveFrom)}
                    </TD>

                    <TD label="Status">
                      <RuleStatusBadge status={rule.status} />
                    </TD>

                    {isAdmin ? (
                      <TD label="Actions" align="right">
                        <StatusToggle rule={rule} />
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </TableWrap>

            {data ? <Pagination meta={data} onPageChange={setPage} onPageSizeChange={setPageSize} /> : null}
          </>
        )}
      </Card>

      {creating ? <CreateRuleDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}

/* ── Activate / retire ────────────────────────────────────────────────────── */

/**
 * Retiring is not deletion.
 *
 * A rule that has produced findings has to stay readable for as long as those
 * findings are on record, so the only lifecycle operations are activate and
 * retire.
 */
function StatusToggle({ rule }: { rule: { id: string; status: string } }) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (status: 'ACTIVE' | 'RETIRED') => ruleService.setRuleStatus(rule.id, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rules'] });
    },
  });

  const retiring = rule.status === 'ACTIVE';

  return (
    <Button
      size="sm"
      variant="ghost"
      icon={retiring ? PowerOff : Power}
      loading={mutation.isPending}
      onClick={() => mutation.mutate(retiring ? 'RETIRED' : 'ACTIVE')}
    >
      {retiring ? 'Retire' : 'Activate'}
    </Button>
  );
}

/* ── Create ───────────────────────────────────────────────────────────────── */

function CreateRuleDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    ruleId: '',
    fieldLabel: '',
    field: '',
    title: '',
    requirement: '',
    ruleReference: '',
    validationType: 'PRESENCE',
    severity: 'MAJOR',
    category: 'Mandatory Declarations',
    appliesToCategories: [] as string[],
  });

  const mutation = useMutation({
    mutationFn: () =>
      ruleService.createRule({
        ...form,
        effectiveFrom: new Date().toISOString(),
        status: 'ACTIVE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rules'] });
      onClose();
    },
  });

  const valid =
    form.ruleId.trim().length >= 3 &&
    form.field.trim().length >= 2 &&
    form.fieldLabel.trim().length >= 2 &&
    form.title.trim().length >= 3 &&
    form.requirement.trim().length >= 5 &&
    form.ruleReference.trim().length >= 2;

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
        aria-label="Create rule"
        className="relative max-h-[88vh] w-full max-w-2xl overflow-hidden rounded-card border border-line bg-surface shadow-pop"
      >
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">New rule</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Records a declaration requirement in the repository. It takes effect immediately and is
            versioned from creation.
          </p>
        </div>

        <div className="scroll-slim max-h-[60vh] space-y-4 overflow-y-auto p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Rule identifier"
              value={form.ruleId}
              onChange={(event) => setForm({ ...form, ruleId: event.target.value.toUpperCase() })}
              placeholder="LM-PKG-6-1-C-NET-QUANTITY"
              hint="Letters, digits and hyphens"
            />
            <Input
              label="Provision reference"
              value={form.ruleReference}
              onChange={(event) => setForm({ ...form, ruleReference: event.target.value })}
              placeholder="Rule 6(1)(c)"
            />
            <Input
              label="Declaration key"
              value={form.field}
              onChange={(event) => setForm({ ...form, field: event.target.value })}
              placeholder="net_quantity"
              hint="Must match the extracted-field name"
            />
            <Input
              label="Declaration label"
              value={form.fieldLabel}
              onChange={(event) => setForm({ ...form, fieldLabel: event.target.value })}
              placeholder="Net Quantity"
            />
          </div>

          <Input
            label="Title"
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            placeholder="Net Quantity — Rule 6(1)(c)"
          />

          <Textarea
            label="Requirement"
            value={form.requirement}
            onChange={(event) => setForm({ ...form, requirement: event.target.value })}
            placeholder="State plainly what the provision demands of the package."
            rows={3}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Validation type"
              value={form.validationType}
              onChange={(event) => setForm({ ...form, validationType: event.target.value })}
              options={VALIDATION_TYPES.map((type) => ({ value: type, label: humanise(type) }))}
            />
            <Select
              label="Severity when breached"
              value={form.severity}
              onChange={(event) => setForm({ ...form, severity: event.target.value })}
              options={SEVERITIES.map((severity) => ({ value: severity, label: humanise(severity) }))}
            />
          </div>

          <fieldset>
            <legend className="mb-1.5 text-xs font-medium text-ink-muted">
              Applies to categories
            </legend>
            <p className="mb-2 text-2xs text-ink-faint">
              Select none to apply the rule to every commodity category.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {PRODUCT_CATEGORIES.map((category) => {
                const selected = form.appliesToCategories.includes(category);
                return (
                  <button
                    key={category}
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        appliesToCategories: selected
                          ? form.appliesToCategories.filter((entry) => entry !== category)
                          : [...form.appliesToCategories, category],
                      })
                    }
                    aria-pressed={selected}
                    className={
                      selected
                        ? 'rounded-full bg-brand px-2.5 py-1 text-2xs font-medium text-white'
                        : 'rounded-full border border-line-strong px-2.5 py-1 text-2xs font-medium text-ink-muted hover:border-brand hover:text-brand'
                    }
                  >
                    {categoryLabel(category)}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {mutation.error ? (
            <Notice tone="violation">
              {mutation.error instanceof Error
                ? mutation.error.message
                : 'The rule could not be created.'}
            </Notice>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={mutation.isPending} disabled={!valid} onClick={() => mutation.mutate()}>
            Create rule
          </Button>
        </div>
      </div>
    </div>
  );
}
