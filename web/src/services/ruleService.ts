import type { Paged, Rule, RuleStatus } from '@/types/api';

import { get, patch, post } from './client';

/**
 * The rule repository.
 *
 * Rules are records on the backend, never a table hardcoded in a component:
 * a legal metrology requirement is amended by notification, and the console has
 * to be able to show which text was in force when an inspection was carried
 * out. Amendments are versioned server-side — see `rule.controller.updateRule`.
 */

export interface RuleFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  category?: string;
  field?: string;
  validationType?: string;
}

export function listRules(filters: RuleFilters = {}): Promise<Paged<Rule>> {
  return get<Paged<Rule>>('/rules', filters as Record<string, unknown>);
}

export function getRule(id: string): Promise<Rule> {
  return get<Rule>(`/rules/${id}`);
}

export interface RuleInput {
  ruleId: string;
  category: string;
  field: string;
  fieldLabel: string;
  title: string;
  requirement: string;
  validationType: string;
  parameters?: Record<string, unknown>;
  ruleReference: string;
  source?: string;
  severity: string;
  effectiveFrom: string;
  effectiveTo?: string;
  status?: RuleStatus;
  appliesToCategories?: string[];
}

/** Admin only — the API enforces this regardless of what the UI shows. */
export function createRule(input: RuleInput): Promise<Rule> {
  return post<Rule>('/rules', input);
}

export function updateRule(id: string, input: Partial<RuleInput> & { changeNote?: string }): Promise<Rule> {
  return patch<Rule>(`/rules/${id}`, input);
}

export function setRuleStatus(id: string, status: RuleStatus): Promise<Rule> {
  return post<Rule>(`/rules/${id}/status`, { status });
}
