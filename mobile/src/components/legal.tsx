import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';

import { colors, spacing } from '../constants/theme';
import type { ComplianceIssue } from '../types';
import { formatConfidence } from '../utils/format';

import { Badge, Card, Row, Txt } from './ui';

/**
 * ── THE LEGAL LAYER, ON SCREEN ──────────────────────────────────────────────
 *
 * Two components, both of which exist to keep one distinction visible.
 *
 * A rule's *severity* is the corpus's grading of the requirement: how serious
 * it is, in law, to sell goods with no declared price. A finding's
 * *classification* is how good this scan's evidence is about this package. They
 * are different questions with different answers, and a CRITICAL rule read off
 * a blurred photograph is a review, not a violation.
 *
 * Every legal string rendered here — the requirement, the clause, the
 * notification, the legal text — arrives from the backend's rule corpus and is
 * printed unchanged. Nothing in this file composes an explanation of the law.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * One finding, expandable to the evidence and the provision behind it.
 *
 * The expansion is the point of the card. A finding an inspector cannot trace
 * back to a line of text on a photograph and a clause in a gazette notification
 * is a finding they cannot defend, and this is where both live.
 */
export function IssueCard({ issue }: { issue: ComplianceIssue }) {
  const [expanded, setExpanded] = useState(false);
  const isViolation = issue.classification === 'potential_violation';

  return (
    <Card style={{ marginBottom: spacing.md }}>
      <Row justify="space-between" align="flex-start" gap={spacing.sm}>
        <View style={{ flex: 1 }}>
          <Txt variant="bodyStrong">{issue.title}</Txt>
          {issue.fieldLabel ? (
            <Txt variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
              {issue.fieldLabel}
            </Txt>
          ) : null}
        </View>
        <Badge
          label={
            isViolation ? 'Potential violation' : issue.classification === 'review' ? 'Review' : 'Note'
          }
          tone={isViolation ? 'danger' : issue.classification === 'review' ? 'warning' : 'neutral'}
          size="sm"
        />
      </Row>

      <Txt variant="caption" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
        {issue.description}
      </Txt>

      <Row gap={spacing.xs} wrap style={{ marginTop: spacing.sm }}>
        <Badge
          label={issue.source.clause ?? issue.source.rule}
          tone="neutral"
          size="sm"
          icon="book-outline"
        />
        {/* The rule's grading, not this finding's strength. Labelled so. */}
        <Badge label={`Rule grading: ${issue.severity}`} tone="neutral" size="sm" />
        <Badge
          label={
            issue.confidence === null
              ? 'Confidence not reported'
              : `Read at ${formatConfidence(issue.confidence)}`
          }
          tone="neutral"
          size="sm"
        />
      </Row>

      <Pressable onPress={() => setExpanded((open) => !open)} style={{ marginTop: spacing.md }}>
        <Row gap={spacing.xs} align="center">
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={colors.accent}
          />
          <Txt variant="caption" color={colors.accent}>
            {expanded ? 'Hide evidence and rule' : 'Show evidence and rule'}
          </Txt>
        </Row>
      </Pressable>

      {expanded ? (
        <Card flat style={{ marginTop: spacing.md, backgroundColor: colors.surfaceAlt }}>
          <Txt variant="overline" color={colors.textFaint}>
            What the rule requires
          </Txt>
          <Txt variant="caption" style={{ marginTop: 3 }}>
            {issue.expectedRequirement}
          </Txt>

          <Txt variant="overline" color={colors.textFaint} style={{ marginTop: spacing.md }}>
            What was detected
          </Txt>
          <Txt variant="caption" style={{ marginTop: 3 }}>
            {issue.observedValue ?? 'Nothing was detected for this declaration.'}
          </Txt>

          <Txt variant="overline" color={colors.textFaint} style={{ marginTop: spacing.md }}>
            Evidence
          </Txt>
          {issue.evidence.length === 0 ? (
            <Txt variant="caption" color={colors.textMuted} style={{ marginTop: 3 }}>
              No located evidence — nothing matching this declaration was read from the images.
            </Txt>
          ) : (
            issue.evidence.map((entry, index) => (
              <Txt
                key={`${entry.imageId}:${index}`}
                variant="caption"
                color={colors.textMuted}
                style={{ marginTop: 3 }}
              >
                &ldquo;{entry.text ?? '—'}&rdquo;
              </Txt>
            ))
          )}

          <Txt variant="overline" color={colors.textFaint} style={{ marginTop: spacing.md }}>
            Source
          </Txt>
          <Txt variant="caption" color={colors.textMuted} style={{ marginTop: 3 }}>
            {issue.source.clause ?? issue.source.rule} · {issue.source.notification} (
            {issue.source.notificationDate}), in force from {issue.source.effectiveFrom}
          </Txt>

          <Txt variant="overline" color={colors.textFaint} style={{ marginTop: spacing.md }}>
            Legal text relied on
          </Txt>
          <Txt
            variant="caption"
            color={colors.textMuted}
            style={{ marginTop: 3, fontStyle: 'italic' }}
          >
            {issue.legalText}
          </Txt>

          <Txt variant="overline" color={colors.textFaint} style={{ marginTop: spacing.md }}>
            How this system read it
          </Txt>
          <Txt variant="caption" color={colors.textMuted} style={{ marginTop: 3 }}>
            {issue.machineInterpretation}
          </Txt>
        </Card>
      ) : null}
    </Card>
  );
}
