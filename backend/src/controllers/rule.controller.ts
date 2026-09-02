import type { Request, Response } from 'express';
import type { FilterQuery } from 'mongoose';

import { Rule, type RuleAttrs } from '../models';
import { query } from '../middleware/validate';
import { ApiError } from '../utils/ApiError';
import { created, ok, paginated } from '../utils/respond';
import type { CreateRuleBody, ListRulesQuery, UpdateRuleBody } from '../validators/schemas';

/**
 * The rule repository.
 *
 * Read by any signed-in user — an inspector is entitled to see the provision
 * they are being measured against. Writes are admin-only and are handled as
 * amendments rather than edits: see `updateRule`.
 */

async function loadRule(req: Request) {
  const { id } = req.params as { id: string };

  // Accept either the Mongo id or the human reference, so a URL a supervisor
  // reads off the screen works when pasted.
  const rule = /^[0-9a-fA-F]{24}$/.test(id)
    ? await Rule.findById(id)
    : await Rule.findOne({ ruleId: id.toUpperCase() });

  if (!rule) throw ApiError.notFound('That rule could not be found.', 'RULE_NOT_FOUND');
  return rule;
}

export async function listRules(req: Request, res: Response): Promise<Response> {
  const params = query<ListRulesQuery>(req);

  const filter: FilterQuery<RuleAttrs> = {};
  if (params.status && params.status !== 'ALL') filter.status = params.status;
  if (params.category) filter.category = params.category;
  if (params.field) filter.field = params.field;
  if (params.validationType) filter.validationType = params.validationType;

  if (params.search) {
    const escaped = params.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'i');
    filter.$or = [
      { ruleId: pattern },
      { title: pattern },
      { requirement: pattern },
      { ruleReference: pattern },
      { fieldLabel: pattern },
    ];
  }

  const [items, total] = await Promise.all([
    Rule.find(filter)
      .sort({ ruleId: 1 })
      .skip((params.page - 1) * params.pageSize)
      .limit(params.pageSize),
    Rule.countDocuments(filter),
  ]);

  return paginated(
    res,
    items.map((rule) => rule.toDTO()),
    {
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
    },
  );
}

export async function getRule(req: Request, res: Response): Promise<Response> {
  const rule = await loadRule(req);
  return ok(res, rule.toDTO());
}

export async function createRule(req: Request, res: Response): Promise<Response> {
  const body = req.body as CreateRuleBody;

  const existing = await Rule.findOne({ ruleId: body.ruleId.toUpperCase() });
  if (existing) {
    throw ApiError.conflict('A rule with that identifier already exists.', 'RULE_EXISTS');
  }

  const rule = await Rule.create({
    ...body,
    ruleId: body.ruleId.toUpperCase(),
    effectiveFrom: new Date(body.effectiveFrom),
    effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : undefined,
    version: 1,
    history: [],
  });

  return created(res, rule.toDTO(), 'Rule created successfully');
}

/**
 * Amends a rule.
 *
 * A change to the *substance* of a rule — its requirement text, how it is
 * validated, or its parameters — is an amendment: the outgoing text is closed
 * off with an `effectiveTo` and pushed onto `history`, and `version`
 * increments. Editing it in place would leave every past inspection appearing
 * to have been judged against wording that did not exist at the time.
 *
 * Everything else (title, severity, status, which categories it covers) is
 * metadata and is updated without minting a version.
 */
export async function updateRule(req: Request, res: Response): Promise<Response> {
  const rule = await loadRule(req);
  const body = req.body as UpdateRuleBody;
  const user = req.user!;

  const substantive =
    (body.requirement !== undefined && body.requirement !== rule.requirement) ||
    (body.validationType !== undefined && body.validationType !== rule.validationType) ||
    (body.parameters !== undefined &&
      JSON.stringify(body.parameters) !== JSON.stringify(rule.parameters));

  if (substantive) {
    const effectiveFrom = body.effectiveFrom ? new Date(body.effectiveFrom) : new Date();

    rule.history.push({
      version: rule.version,
      requirement: rule.requirement,
      validationType: rule.validationType,
      parameters: rule.parameters ?? {},
      effectiveFrom: rule.effectiveFrom,
      effectiveTo: effectiveFrom,
      changedBy: user.id as unknown as RuleAttrs['history'][number]['changedBy'],
      changeNote: body.changeNote,
      recordedAt: new Date(),
    });

    rule.version += 1;
    rule.effectiveFrom = effectiveFrom;

    if (body.requirement !== undefined) rule.requirement = body.requirement;
    if (body.validationType !== undefined) rule.validationType = body.validationType;
    if (body.parameters !== undefined) rule.parameters = body.parameters;
  }

  if (body.title !== undefined) rule.title = body.title;
  if (body.fieldLabel !== undefined) rule.fieldLabel = body.fieldLabel;
  if (body.severity !== undefined) rule.severity = body.severity;
  if (body.status !== undefined) rule.status = body.status;
  if (body.source !== undefined) rule.source = body.source;
  if (body.ruleReference !== undefined) rule.ruleReference = body.ruleReference;
  if (body.appliesToCategories !== undefined) rule.appliesToCategories = body.appliesToCategories;
  if (body.effectiveTo !== undefined) {
    rule.effectiveTo = body.effectiveTo ? new Date(body.effectiveTo) : undefined;
  }

  await rule.save();

  return ok(
    res,
    rule.toDTO(),
    substantive ? `Rule amended — now at version ${rule.version}` : 'Rule updated successfully',
  );
}

/**
 * Activates or retires a rule.
 *
 * Retiring is deliberately not deletion. A rule that produced findings must
 * remain readable for as long as those findings are on record.
 */
export async function setRuleStatus(req: Request, res: Response): Promise<Response> {
  const rule = await loadRule(req);
  const { status } = req.body as { status: RuleAttrs['status'] };

  rule.status = status;
  if (status === 'RETIRED' && !rule.effectiveTo) rule.effectiveTo = new Date();
  if (status === 'ACTIVE') rule.effectiveTo = undefined;

  await rule.save();

  return ok(res, rule.toDTO(), `Rule ${status.toLowerCase()}`);
}
