import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import {
  Image,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

import {
  checkResultTones,
  complianceStatusIcons,
  complianceStatusLabels,
  complianceStatusTones,
  imageSideLabels,
  qualityRatingLabels,
  qualityRatingTones,
  severityLabels,
  severityTones,
} from '../constants/labels';
import { colors, radius, spacing, toneColors, typography } from '../constants/theme';
import type {
  ComplianceStatus,
  ExtractedField,
  ImageQuality,
  InspectionSummary,
  ProductImage,
  QualityRating,
  Severity,
  Tone,
  Violation,
} from '../types';
import {
  formatConfidence,
  formatDate,
  formatRelative,
  initials,
  timestampParts,
} from '../utils/format';

import { Badge, Card, Meter, Row, Skeleton, Txt } from './ui';

/**
 * Domain-aware components — the pieces that know what an inspection is.
 * Anything below this file is generic; anything above composes screens.
 */

/* ── Status ───────────────────────────────────────────────────────────────── */

export function ComplianceBadge({
  status,
  size = 'md',
}: {
  status: ComplianceStatus;
  size?: 'sm' | 'md';
}) {
  return (
    <Badge
      label={complianceStatusLabels[status]}
      tone={complianceStatusTones[status]}
      icon={complianceStatusIcons[status]}
      size={size}
    />
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <Badge label={severityLabels[severity]} tone={severityTones[severity]} size="sm" />;
}

/**
 * The large verdict panel at the top of the result screen.
 *
 * Colour is never the only signal: the icon, the heading and the score all
 * carry the verdict independently.
 */
export function VerdictPanel({
  status,
  score,
  ruleSetLabel,
}: {
  status: ComplianceStatus;
  score: number;
  ruleSetLabel: string;
}) {
  const tone = complianceStatusTones[status];
  const palette = toneColors[tone];

  return (
    <View style={[styles.verdict, { backgroundColor: palette.bg, borderColor: palette.fg }]}>
      <View style={[styles.verdictIcon, { backgroundColor: palette.fg }]}>
        <Ionicons name={complianceStatusIcons[status]} size={26} color={colors.textInverse} />
      </View>

      <Txt variant="title" color={palette.fg} center style={{ marginTop: spacing.md }}>
        {complianceStatusLabels[status].toUpperCase()}
      </Txt>

      <Txt variant="caption" color={colors.textMuted} center style={{ marginTop: spacing.xs }}>
        Assessed against {ruleSetLabel}
      </Txt>

      <View style={{ width: '100%', marginTop: spacing.base }}>
        <Row justify="space-between" style={{ marginBottom: 6 }}>
          <Txt variant="overline" color={colors.textMuted}>
            Compliance score
          </Txt>
          <Txt variant="bodyStrong" color={palette.fg}>
            {score}%
          </Txt>
        </Row>
        <Meter value={score / 100} tone={tone} height={8} />
      </View>
    </View>
  );
}

/* ── Statistics ───────────────────────────────────────────────────────────── */

export function StatTile({
  label,
  value,
  icon,
  tone = 'neutral',
  onPress,
  style,
}: {
  label: string;
  value: number | string;
  icon: keyof typeof Ionicons.glyphMap;
  tone?: Tone;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = toneColors[tone];

  const content = (
    <>
      <View style={[styles.statIcon, { backgroundColor: palette.bg }]}>
        <Ionicons name={icon} size={17} color={palette.fg} />
      </View>
      <Txt variant="display" style={{ marginTop: spacing.sm }} numberOfLines={1}>
        {value}
      </Txt>
      <Txt variant="caption" color={colors.textMuted} style={{ marginTop: 2 }} numberOfLines={2}>
        {label}
      </Txt>
    </>
  );

  if (!onPress) {
    return <Card style={[styles.statTile, style]}>{content}</Card>;
  }

  // The Pressable is what the surrounding Row lays out, so it — not the Card
  // inside it — has to carry the flex. With the flex on the Card the tile
  // shrank to its content and left the row short of the right margin.
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => [styles.statTileTouch, pressed && { opacity: 0.85 }, style]}
    >
      <Card style={styles.statTile}>{content}</Card>
    </Pressable>
  );
}

/**
 * A row of two tile-shaped placeholders.
 *
 * Lives beside `StatTile` so the loading state cannot drift from the grid it
 * resolves into — a placeholder of a different shape makes the page jump the
 * moment the figures land.
 */
export function StatTileRowSkeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <Row gap={spacing.md} align="stretch" style={style}>
      {[0, 1].map((key) => (
        <Card key={key} style={styles.statTile}>
          <Skeleton height={32} width={32} style={{ borderRadius: 16 }} />
          <Skeleton height={26} width="45%" style={{ marginTop: spacing.sm }} />
          <Skeleton height={12} width="80%" style={{ marginTop: spacing.sm }} />
        </Card>
      ))}
    </Row>
  );
}

/* ── Inspection card ──────────────────────────────────────────────────────── */

/**
 * The day over the time, right-aligned.
 *
 * Two lines because the two are scanned at different moments: an officer runs
 * down the list looking for a day and only reads the time once they have found
 * the row. Stacked, the days form a column the eye can run down; strung
 * together on one line they do not.
 *
 * The day is the darker of the two, since it is the one being scanned for.
 */
function TimeStamp({ createdAt }: { createdAt: string }) {
  const { day, time } = timestampParts(createdAt);

  return (
    <View style={{ alignItems: 'flex-end' }}>
      <Txt variant="caption" color={colors.textMuted}>
        {day}
      </Txt>
      {time ? (
        <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 1 }}>
          {time}
        </Txt>
      ) : null}
    </View>
  );
}

export function InspectionCard({
  inspection,
  onPress,
  compact,
}: {
  inspection: InspectionSummary;
  onPress: () => void;
  compact?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Inspection ${inspection.referenceId}, ${inspection.businessName}, ${complianceStatusLabels[inspection.complianceStatus]}`}
      style={({ pressed }) => pressed && { opacity: 0.9, transform: [{ scale: 0.995 }] }}
    >
      <Card style={{ marginBottom: spacing.md }}>
        <Row justify="space-between" align="flex-start">
          <View style={{ flex: 1, paddingRight: spacing.sm }}>
            <Txt variant="mono" color={colors.textMuted}>
              {inspection.referenceId}
            </Txt>
            <Txt variant="heading" style={{ marginTop: 6 }} numberOfLines={1}>
              {inspection.businessName}
            </Txt>
            <Txt variant="body" color={colors.textMuted} numberOfLines={1} style={{ marginTop: 2 }}>
              {inspection.productLabel}
            </Txt>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
        </Row>

        <Row
          justify="space-between"
          // `center`, so the two-line stamp sits centred against the badge and
          // the counts rather than dragging the whole row to its top edge.
          align="center"
          style={{ marginTop: spacing.md }}
          wrap
          gap={spacing.sm}
        >
          <ComplianceBadge status={inspection.complianceStatus} size="sm" />

          <Row gap={spacing.md} align="center">
            {inspection.violationCount > 0 ? (
              <Row gap={4}>
                <Ionicons name="warning-outline" size={13} color={colors.danger} />
                <Txt variant="caption" color={colors.danger}>
                  {inspection.violationCount}
                </Txt>
              </Row>
            ) : null}

            <Row gap={4}>
              <Ionicons name="images-outline" size={13} color={colors.textFaint} />
              <Txt variant="caption" color={colors.textFaint}>
                {inspection.imageCount}
              </Txt>
            </Row>

            {compact ? (
              <TimeStamp createdAt={inspection.createdAt} />
            ) : (
              <Txt variant="caption" color={colors.textFaint}>
                {formatDate(inspection.createdAt)}
              </Txt>
            )}
          </Row>
        </Row>
      </Card>
    </Pressable>
  );
}

/* ── Images ───────────────────────────────────────────────────────────────── */

/**
 * Image thumbnail with its package face and optional actions.
 *
 * Seeded demo records carry no photograph, so an empty `uri` renders a labelled
 * placeholder rather than a broken image box.
 */
export function ImageThumb({
  image,
  size = 96,
  onPress,
  onRemove,
  selected,
}: {
  image: ProductImage;
  size?: number;
  onPress?: () => void;
  onRemove?: () => void;
  selected?: boolean;
}) {
  return (
    <View style={{ width: size }}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : 'image'}
        accessibilityLabel={`${imageSideLabels[image.side]} image`}
        style={({ pressed }) => [
          styles.thumb,
          { width: size, height: size },
          selected && { borderColor: colors.accent, borderWidth: 2 },
          pressed && { opacity: 0.85 },
        ]}
      >
        {image.uri ? (
          <Image source={{ uri: image.uri }} style={styles.thumbImage} resizeMode="cover" />
        ) : (
          <View style={styles.thumbPlaceholder}>
            <Ionicons name="image-outline" size={22} color={colors.textFaint} />
          </View>
        )}

        {onRemove ? (
          <Pressable
            onPress={onRemove}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Delete ${imageSideLabels[image.side]} image`}
            style={styles.thumbRemove}
          >
            <Ionicons name="close" size={13} color={colors.textInverse} />
          </Pressable>
        ) : null}
      </Pressable>

      <Txt variant="caption" color={colors.textMuted} numberOfLines={1} style={{ marginTop: 5 }}>
        {imageSideLabels[image.side]}
      </Txt>
    </View>
  );
}

/** One row of the image-quality report. */
export function QualityRow({ label, rating }: { label: string; rating: QualityRating }) {
  return (
    <Row justify="space-between" style={{ paddingVertical: spacing.md }}>
      <Txt variant="body">{label}</Txt>
      <Badge label={qualityRatingLabels[rating]} tone={qualityRatingTones[rating]} size="sm" />
    </Row>
  );
}

export function QualityReport({ quality }: { quality: ImageQuality }) {
  return (
    <View>
      <QualityRow label="Sharpness" rating={quality.sharpness} />
      <View style={styles.hairline} />
      <QualityRow label="Lighting" rating={quality.lighting} />
      <View style={styles.hairline} />
      <QualityRow label="Text Visibility" rating={quality.textVisibility} />
      <View style={styles.hairline} />
      <QualityRow label="Glare" rating={quality.glare} />

      {quality.notes.length > 0 ? (
        <View style={{ marginTop: spacing.md }}>
          {quality.notes.map((note) => (
            <Row key={note} gap={spacing.sm} align="flex-start" style={{ marginTop: spacing.xs }}>
              <Ionicons
                name="information-circle-outline"
                size={14}
                color={colors.textFaint}
                style={{ marginTop: 2 }}
              />
              <Txt variant="caption" color={colors.textMuted} style={{ flex: 1 }}>
                {note}
              </Txt>
            </Row>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/* ── Extracted fields ─────────────────────────────────────────────────────── */

export function ConfidencePill({ confidence }: { confidence: number }) {
  const tone: Tone = confidence >= 0.9 ? 'success' : confidence >= 0.75 ? 'info' : 'warning';
  return <Badge label={formatConfidence(confidence)} tone={tone} size="sm" icon="analytics-outline" />;
}

/**
 * A single extracted declaration.
 *
 * Shows the model's read and, when the inspector has corrected it, both values
 * — the corrected one as the value of record and the original as provenance.
 */
export function ExtractedFieldCard({
  field,
  onViewEvidence,
  onReview,
  style,
}: {
  field: ExtractedField;
  onViewEvidence?: () => void;
  onReview?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const corrected = field.reviewAction !== undefined;
  const displayValue =
    field.reviewAction === 'marked_unavailable' ? null : (field.humanValue ?? field.aiValue);
  const missing = displayValue === null || displayValue.trim() === '';

  return (
    <Card style={[{ marginBottom: spacing.md }, style]}>
      <Row justify="space-between" align="flex-start">
        <Txt variant="overline" color={colors.textFaint} style={{ flex: 1 }}>
          {field.label}
          {field.required ? ' · Required' : ''}
        </Txt>
        {field.aiValue !== null ? <ConfidencePill confidence={field.confidence} /> : null}
      </Row>

      <Txt
        variant="title"
        color={missing ? colors.danger : colors.text}
        style={{ marginTop: spacing.sm }}
      >
        {missing ? 'Not declared' : displayValue}
      </Txt>

      {corrected ? (
        <View style={styles.provenance}>
          <Row gap={6}>
            <Ionicons name="person-outline" size={12} color={colors.info} />
            <Txt variant="caption" color={colors.info}>
              {field.reviewAction === 'edited'
                ? 'Corrected by inspector'
                : field.reviewAction === 'accepted'
                  ? 'Accepted by inspector'
                  : 'Marked unavailable by inspector'}
            </Txt>
          </Row>
          {field.reviewAction === 'edited' ? (
            <Txt variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
              Model read: {field.aiValue ?? 'nothing'}
            </Txt>
          ) : null}
          {field.reviewComment ? (
            <Txt variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
              Note: {field.reviewComment}
            </Txt>
          ) : null}
        </View>
      ) : null}

      {field.aiValue !== null ? (
        <View style={{ marginTop: spacing.md }}>
          <Meter
            value={field.confidence}
            tone={field.confidence >= 0.9 ? 'success' : field.confidence >= 0.75 ? 'info' : 'warning'}
          />
        </View>
      ) : null}

      {onViewEvidence || onReview ? (
        <Row gap={spacing.lg} style={{ marginTop: spacing.md }}>
          {onViewEvidence && field.boundingBox ? (
            <Pressable onPress={onViewEvidence} hitSlop={10} accessibilityRole="button">
              <Row gap={5}>
                <Ionicons name="scan-outline" size={14} color={colors.accent} />
                <Txt variant="label" color={colors.accent}>
                  View Evidence
                </Txt>
              </Row>
            </Pressable>
          ) : null}

          {onReview ? (
            <Pressable onPress={onReview} hitSlop={10} accessibilityRole="button">
              <Row gap={5}>
                <Ionicons name="create-outline" size={14} color={colors.accent} />
                <Txt variant="label" color={colors.accent}>
                  {corrected ? 'Change' : 'Review'}
                </Txt>
              </Row>
            </Pressable>
          ) : null}
        </Row>
      ) : null}
    </Card>
  );
}

/**
 * Evidence view: the source image with the detection box drawn over it.
 *
 * The box coordinates are normalised (0–1), so the overlay is laid out as
 * percentages and stays correct at any rendered size. When the source image is
 * unavailable — as in the seeded demo records — the frame renders as a labelled
 * placeholder so the geometry is still legible.
 */
export function EvidenceView({
  image,
  field,
  height = 240,
}: {
  image?: ProductImage;
  field: ExtractedField;
  height?: number;
}) {
  const box = field.boundingBox;

  return (
    <View>
      <View style={[styles.evidenceFrame, { height }]}>
        {image?.uri ? (
          <Image source={{ uri: image.uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.evidenceEmpty]}>
            <Ionicons name="scan-outline" size={26} color={colors.textFaint} />
            <Txt variant="caption" color={colors.textFaint} center style={{ marginTop: spacing.sm }}>
              Source image not stored for this record
            </Txt>
          </View>
        )}

        {box ? (
          <View
            pointerEvents="none"
            style={[
              styles.evidenceBox,
              {
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.width * 100}%`,
                height: `${box.height * 100}%`,
              },
            ]}
          >
            <View style={styles.evidenceTag}>
              <Txt variant="caption" color={colors.textInverse}>
                {formatConfidence(field.confidence)}
              </Txt>
            </View>
          </View>
        ) : null}
      </View>

      <Txt variant="caption" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
        {image ? `${imageSideLabels[image.side]} · captured ${formatRelative(image.capturedAt)}` : 'No source image'}
      </Txt>
    </View>
  );
}

/* ── Violations ───────────────────────────────────────────────────────────── */

export function ViolationCard({ violation }: { violation: Violation }) {
  return (
    <Card style={{ marginBottom: spacing.md, borderLeftWidth: 3, borderLeftColor: colors.danger }}>
      <Row justify="space-between" align="flex-start">
        <Txt variant="heading" style={{ flex: 1, paddingRight: spacing.sm }}>
          {violation.title}
        </Txt>
        <SeverityBadge severity={violation.severity} />
      </Row>

      <Txt variant="body" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
        {violation.description}
      </Txt>

      <View style={styles.ruleRef}>
        <Row gap={6}>
          <Ionicons name="document-text-outline" size={13} color={colors.navy} />
          <Txt variant="caption" color={colors.navy}>
            {violation.ruleReference}
          </Txt>
        </Row>
      </View>

      <View style={{ marginTop: spacing.md }}>
        <Txt variant="overline" color={colors.textFaint}>
          Expected
        </Txt>
        <Txt variant="body" style={{ marginTop: 2 }}>
          {violation.expected}
        </Txt>
      </View>

      <View style={{ marginTop: spacing.md }}>
        <Txt variant="overline" color={colors.textFaint}>
          Observed
        </Txt>
        <Txt variant="body" color={violation.observed ? colors.text : colors.danger} style={{ marginTop: 2 }}>
          {violation.observed ?? 'Not declared on any captured face'}
        </Txt>
      </View>

      <View style={styles.recommendation}>
        <Txt variant="overline" color={colors.warning}>
          Recommended action
        </Txt>
        <Txt variant="body" color={colors.text} style={{ marginTop: 4 }}>
          {violation.recommendation}
        </Txt>
      </View>
    </Card>
  );
}

/** Compact row for the rule-check list. */
export function CheckRow({
  title,
  ruleReference,
  result,
  message,
}: {
  title: string;
  ruleReference: string;
  result: keyof typeof checkResultTones;
  message: string;
}) {
  const tone = checkResultTones[result];
  const icon =
    result === 'pass'
      ? 'checkmark-circle'
      : result === 'fail'
        ? 'close-circle'
        : result === 'warning'
          ? 'alert-circle'
          : 'remove-circle-outline';

  return (
    <Row align="flex-start" gap={spacing.md} style={{ paddingVertical: spacing.md }}>
      <Ionicons name={icon} size={19} color={toneColors[tone].fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        <Row justify="space-between" gap={spacing.sm}>
          <Txt variant="bodyStrong" style={{ flex: 1 }}>
            {title}
          </Txt>
          <Txt variant="caption" color={colors.textFaint}>
            {ruleReference}
          </Txt>
        </Row>
        <Txt variant="caption" color={colors.textMuted} style={{ marginTop: 2 }}>
          {message}
        </Txt>
      </View>
    </Row>
  );
}

/* ── Avatar ───────────────────────────────────────────────────────────────── */

export function Avatar({
  name,
  color = colors.navy,
  size = 44,
}: {
  name: string;
  color?: string;
  size?: number;
}) {
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
      ]}
    >
      <Txt
        variant="bodyStrong"
        color={colors.textInverse}
        style={{ fontSize: size * 0.36, lineHeight: size * 0.44 }}
      >
        {initials(name)}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  verdict: {
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
  },
  verdictIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statTileTouch: { flex: 1, minWidth: 0 },
  statTile: {
    flex: 1,
    minWidth: 0,
    // A floor on the height keeps a one-word tile ("Compliant") the same size
    // as a wrapping one ("Total Inspections") when they are not in the same row.
    minHeight: 124,
    paddingVertical: spacing.base,
    paddingHorizontal: spacing.base,
  },
  statIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.neutralSoft,
    overflow: 'hidden',
  },
  thumbImage: { width: '100%', height: '100%' },
  thumbPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hairline: { height: 1, backgroundColor: colors.border },
  provenance: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  evidenceFrame: {
    width: '100%',
    borderRadius: radius.md,
    backgroundColor: colors.navyDeep,
    overflow: 'hidden',
  },
  evidenceEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutralSoft,
    padding: spacing.lg,
  },
  evidenceBox: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: 3,
    backgroundColor: 'rgba(29, 111, 224, 0.14)',
  },
  evidenceTag: {
    position: 'absolute',
    top: -19,
    left: -2,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  ruleRef: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.navyTint,
  },
  recommendation: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningSoft,
  },
  avatar: { alignItems: 'center', justifyContent: 'center' },
});

