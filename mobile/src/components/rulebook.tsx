import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '../constants/theme';
import { listRules, type LegalRuleSummary } from '../services/ruleService';
import { formatDate } from '../utils/format';

import { Badge, Card, ChipBar, ErrorState, LoadingState, Row, Txt } from './ui';

/**
 * ── THE RULEBOOK ────────────────────────────────────────────────────────────
 *
 * Every provision the engine is currently deciding on, in one place an officer
 * can read in the field.
 *
 * It matters that this is the *same corpus* the verdicts come from, fetched
 * from the same endpoint, rather than a summary written into the app. An
 * inspector who reads a requirement here and then quotes it to a shopkeeper is
 * relying on it being the text the finding will cite — and the moment those two
 * can drift, the more useful one is the one nobody trusts.
 *
 * Collapsed by default and loaded on first open. Twenty-one provisions with
 * their full gazette text is a great deal of reading to put between a
 * dashboard's figures and the reports below it, and most visits to this screen
 * are not looking for the law.
 * ────────────────────────────────────────────────────────────────────────────
 */

const SEVERITY_TONE = {
  CRITICAL: 'danger',
  MAJOR: 'warning',
  MINOR: 'neutral',
} as const;

/** Corpus category keys, set as an officer would say them. */
const CATEGORY_LABELS: Record<string, string> = {
  DECLARATION: 'Declarations',
  QUANTITY: 'Quantity',
  PRICING: 'Pricing',
  TYPOGRAPHY: 'Lettering',
  PLACEMENT: 'Placement',
  E_COMMERCE: 'E-commerce',
  REGISTRATION: 'Registration',
  PROCEDURAL: 'Procedure',
  DEFINITION: 'Definitions',
};

export function RuleBook() {
  const [open, setOpen] = useState(false);
  const [rules, setRules] = useState<LegalRuleSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [category, setCategory] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setRules(await listRules());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      // Fetched on first open only. Re-opening shows what was already read
      // rather than spending an officer's data on a corpus that changes when
      // an amendment is seeded, not between two taps.
      if (!wasOpen && rules === null && !loading) void load();
      return !wasOpen;
    });
  }, [rules, loading, load]);

  const categories = useMemo(() => {
    if (!rules) return [];
    const counts = new Map<string, number>();
    for (const rule of rules) counts.set(rule.category, (counts.get(rule.category) ?? 0) + 1);

    return [
      { value: 'all', label: `All ${rules.length}` },
      ...[...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([key, count]) => ({ value: key, label: `${CATEGORY_LABELS[key] ?? key} ${count}` })),
    ];
  }, [rules]);

  const visible = useMemo(
    () => (rules ?? []).filter((rule) => category === 'all' || rule.category === category),
    [rules, category],
  );

  return (
    <Card padded={false} style={{ marginTop: spacing.md }}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.header, pressed && { backgroundColor: colors.surfaceAlt }]}
      >
        <View style={styles.icon}>
          <Ionicons name="book-outline" size={20} color={colors.text} />
        </View>

        <View style={{ flex: 1 }}>
          <Txt variant="bodyStrong">Rulebook</Txt>
          <Txt variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
            {rules
              ? `${rules.length} provisions in force · tap any one to read it`
              : 'Every provision these inspections are checked against'}
          </Txt>
        </View>

        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textFaint}
        />
      </Pressable>

      {open ? (
        <View style={styles.body}>
          {loading ? (
            <LoadingState label="Loading the rulebook…" />
          ) : failed ? (
            <ErrorState
              title="The rulebook could not be loaded"
              message="Check the connection and try again. Findings already recorded are unaffected."
              onRetry={() => void load()}
            />
          ) : (
            <>
              {categories.length > 2 ? (
                <View style={{ marginHorizontal: -spacing.base }}>
                  <ChipBar options={categories} value={category} onChange={setCategory} />
                </View>
              ) : null}

              {visible.map((rule, index) => (
                <RuleRow
                  key={`${rule.ruleId}@${rule.ruleVersion}`}
                  rule={rule}
                  first={index === 0}
                  expanded={expanded === rule.ruleId}
                  onToggle={() =>
                    setExpanded((current) => (current === rule.ruleId ? null : rule.ruleId))
                  }
                />
              ))}

              {/*
                The engine decides; this is the text it decided on. Said here
                because a screen listing statutory requirements invites being
                read as the statute, and an app is not one.
              */}
              <Txt variant="caption" color={colors.textFaint} style={{ marginTop: spacing.base }}>
                Reproduced from the Legal Metrology (Packaged Commodities) Rules, 2011 as amended.
                Where this differs from the Gazette, the Gazette governs.
              </Txt>
            </>
          )}
        </View>
      ) : null}
    </Card>
  );
}

function RuleRow({
  rule,
  first,
  expanded,
  onToggle,
}: {
  rule: LegalRuleSummary;
  first: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <View>
      {!first ? <View style={styles.hairline} /> : null}

      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`Rule ${rule.clause}, ${rule.title}`}
        style={({ pressed }) => [styles.rule, pressed && { backgroundColor: colors.surfaceAlt }]}
      >
        <Row gap={spacing.md} align="flex-start">
          <View style={{ flex: 1 }}>
            <Row gap={spacing.sm} align="center" wrap>
              <Txt variant="mono" color={colors.text}>
                {rule.clause}
              </Txt>
              <Badge label={rule.severity} tone={SEVERITY_TONE[rule.severity]} size="sm" />
            </Row>

            <Txt variant="bodyStrong" style={{ marginTop: 4 }}>
              {rule.title}
            </Txt>

            {/* Collapsed, the requirement is the summary. Expanded, the full
                text takes over and this would just repeat its opening line. */}
            {!expanded ? (
              <Txt
                variant="caption"
                color={colors.textMuted}
                numberOfLines={2}
                style={{ marginTop: 3 }}
              >
                {rule.requirement}
              </Txt>
            ) : null}
          </View>

          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textFaint}
            style={{ marginTop: 2 }}
          />
        </Row>

        {expanded ? (
          <View style={{ marginTop: spacing.md }}>
            <Field label="What it requires">{rule.requirement}</Field>
            <Field label="Text of the provision" italic>
              {rule.legalText}
            </Field>
            <Field label="How this system reads it">{rule.machineInterpretation}</Field>

            <Txt variant="caption" color={colors.textFaint} style={{ marginTop: spacing.md }}>
              {rule.notification} ({formatDate(rule.notificationDate)}) · in force from{' '}
              {formatDate(rule.effectiveFrom)}
            </Txt>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

function Field({
  label,
  italic,
  children,
}: {
  label: string;
  italic?: boolean;
  children: string;
}) {
  return (
    <View style={{ marginTop: spacing.md }}>
      <Txt variant="overline" color={colors.textFaint}>
        {label}
      </Txt>
      <Txt
        variant="caption"
        color={colors.textMuted}
        style={[{ marginTop: 3 }, italic ? { fontStyle: 'italic' } : null]}
      >
        {children}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.base,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.neutralSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.base,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rule: { paddingVertical: spacing.base },
  hairline: { height: 1, backgroundColor: colors.border },
});
