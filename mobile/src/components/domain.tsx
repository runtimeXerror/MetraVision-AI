import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
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
  AIAnalysis,
  ComplianceStatus,
  ExtractedField,
  ImageQuality,
  InspectionSummary,
  ProductImage,
  QualityRating,
  ScanRecord,
  Severity,
  Tone,
  Violation,
} from '../types';
import {
  formatConfidence,
  formatDate,
  formatRelative,
  initials,
  pluralize,
  timestampParts,
} from '../utils/format';

import { ImageViewer } from './ImageViewer';
import { RemoteImage } from './offline';
import { Badge, Card, EmptyState, Row, Skeleton, Txt } from './ui';

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
 * Colour is never the only signal: the icon and the heading each carry the
 * verdict independently.
 *
 * ── THE PERCENTAGE THAT USED TO BE HERE ─────────────────────────────────
 *
 * "Compliance score 67%", over a meter. Neither an inspector nor anyone else
 * could say what it was 67% *of*, and the true answer is not something a
 * percentage can carry: it is the share of the rule checks the engine was able
 * to decide that this package met — excluding every rule that did not apply to
 * the commodity, and every one still waiting on a measurement no part of this
 * system takes. On the corpus package that is four out of six, with fourteen
 * checks outside the fraction entirely.
 *
 * Printed as a bare percentage next to a verdict, it reads as a grade — as
 * though the package were 67% legal. It is not, and no packaged commodity is;
 * a missing MRP is a contravention whatever the other twenty checks said.
 *
 * So the number is gone from here and the counts it was hiding are stated
 * plainly by `ComplianceTally`, directly beneath this panel on all three
 * screens that show it: declarations read, checks passed, checks failed, with
 * the not-applicable ones named rather than silently dropped. The score is
 * still computed and still stored on the record — it is a defensible figure
 * for an aggregate over many inspections, which is where it now appears.
 */
export function VerdictPanel({
  status,
  ruleSetLabel,
}: {
  status: ComplianceStatus;
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
          <RemoteImage uri={image.uri} style={styles.thumbImage} resizeMode="cover" />
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

/**
 * ── WHAT THE SCAN ACTUALLY FOUND, IN THREE NUMBERS ──────────────────────────
 *
 * The verdict panel above says what the package *is* — compliant, in
 * contravention, or a question for a person. It does not say how much was
 * examined to get there, and those are different claims. "Violation" carried by
 * two readable declarations out of eleven is a much weaker document than the
 * same verdict carried by all eleven, and an officer standing in front of a
 * dealer is entitled to see which one they are holding before they say it out
 * loud.
 *
 * So: how many declarations were read off the label, how many rule checks
 * passed, and how many failed. The bar underneath is the same three counts as
 * proportions, because "3 of 19" is a fact and the width of the red band is
 * what the eye actually reads.
 *
 * Checks that did not apply to this commodity are excluded from the bar and
 * stated in the footnote instead. Folding them into the passes would inflate
 * the compliant share with rules the package was never subject to — a number
 * that looks like an assessment and is not one.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function ComplianceTally({ analysis }: { analysis: AIAnalysis }) {
  const fields = analysis.fields;
  const checks = analysis.compliance.checks;

  // Mirrors `effectiveValue`: an inspector who marked a declaration absent has
  // overruled whatever the camera thought it saw, and that field was not read.
  const read = fields.filter((field) => {
    if (field.reviewAction === 'marked_unavailable') return null;
    const value = field.humanValue ?? field.aiValue;
    return value !== null && value !== undefined && value.trim() !== '';
  }).length;

  const passed = checks.filter((check) => check.result === 'pass').length;
  const failed = checks.filter((check) => check.result === 'fail').length;
  const advisory = checks.filter((check) => check.result === 'warning').length;
  const notApplicable = checks.filter((check) => check.result === 'not_applicable').length;

  const assessed = passed + failed + advisory;

  return (
    <Card style={{ marginTop: spacing.md }}>
      <Row gap={spacing.sm} align="stretch">
        <TallyCell
          value={`${read}/${fields.length}`}
          label="Declarations read"
          tone={read === fields.length ? 'success' : 'neutral'}
          icon="scan-outline"
        />
        <TallyCell value={passed} label="Compliant" tone="success" icon="checkmark-circle-outline" />
        <TallyCell
          value={failed}
          label="Non-compliant"
          tone={failed > 0 ? 'danger' : 'neutral'}
          icon="close-circle-outline"
        />
      </Row>

      {assessed > 0 ? (
        <View style={styles.tallyBar}>
          {passed > 0 ? (
            <View style={{ flex: passed, backgroundColor: colors.success }} />
          ) : null}
          {advisory > 0 ? (
            <View style={{ flex: advisory, backgroundColor: colors.warning }} />
          ) : null}
          {failed > 0 ? <View style={{ flex: failed, backgroundColor: colors.danger }} /> : null}
        </View>
      ) : null}

      <Txt variant="caption" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
        {assessed === 0
          ? 'No rule check could be applied to this record.'
          : `${pluralize(assessed, 'rule check')} applied` +
            (advisory > 0 ? ` · ${advisory} advisory` : '') +
            (notApplicable > 0 ? ` · ${notApplicable} not applicable to this commodity` : '')}
      </Txt>
    </Card>
  );
}

function TallyCell({
  value,
  label,
  tone,
  icon,
}: {
  value: number | string;
  label: string;
  tone: 'success' | 'danger' | 'neutral';
  icon: keyof typeof Ionicons.glyphMap;
}) {
  const fg = toneColors[tone].fg;

  return (
    <View style={styles.tallyCell}>
      <Ionicons name={icon} size={15} color={fg} />
      {/* The number carries the tone, the label stays neutral. Colouring both
          turns a count into an alarm, and two of these three are ordinary. */}
      <Txt variant="title" color={fg} style={{ marginTop: 4 }}>
        {value}
      </Txt>
      <Txt variant="caption" color={colors.textMuted} numberOfLines={2} style={{ marginTop: 2 }}>
        {label}
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
/**
 * One declaration, closed until it is asked about.
 *
 * ── WHY IT COLLAPSES ────────────────────────────────────────────────────
 *
 * A cosmetic label carries a dozen declarations and a food label more. Every
 * card opened to its full height — value, provenance line, and two buttons —
 * so the list an officer scrolls to answer "what did it read?" was three
 * screens long, and the two declarations that actually matter sat somewhere in
 * the middle of ten that were fine.
 *
 * What survives collapsed is what the scan is for: the declaration, the value
 * of record, and how sure the recogniser was. "Not declared" stays in red and
 * stays visible, because that is the finding — a list that hides its own
 * findings until each row is opened would be worse than the long one.
 *
 * What folds away is what you only want once you have picked a row: who
 * confirmed or corrected it, what the model originally read, and the two
 * actions. Those are per-declaration work, and per-declaration work belongs
 * behind the declaration you chose.
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
  const [open, setOpen] = useState(false);

  const corrected = field.reviewAction !== undefined;
  const displayValue =
    field.reviewAction === 'marked_unavailable' ? null : (field.humanValue ?? field.aiValue);
  const missing = displayValue === null || displayValue.trim() === '';

  const hasMore = corrected || Boolean(onViewEvidence && field.boundingBox) || Boolean(onReview);

  return (
    <Card style={[{ marginBottom: spacing.sm }, style]}>
      <Pressable
        onPress={() => setOpen((current) => !current)}
        disabled={!hasMore}
        accessibilityRole={hasMore ? 'button' : 'text'}
        accessibilityLabel={`${field.label}: ${missing ? 'not declared' : displayValue}`}
        accessibilityState={hasMore ? { expanded: open } : undefined}
        style={({ pressed }) => (pressed && hasMore ? { opacity: 0.7 } : undefined)}
      >
        <Row justify="space-between" align="flex-start">
          <Txt variant="overline" color={colors.textFaint} style={{ flex: 1 }}>
            {field.label}
            {field.required ? ' · Required' : ''}
          </Txt>
          {field.aiValue !== null ? <ConfidencePill confidence={field.confidence} /> : null}
        </Row>

        <Row justify="space-between" align="center" gap={spacing.sm}>
          <Txt
            variant="heading"
            color={missing ? colors.danger : colors.text}
            style={{ flex: 1, marginTop: spacing.xs }}
          >
            {missing ? 'Not declared' : displayValue}
          </Txt>

          {hasMore ? (
            <Ionicons
              name={open ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.textFaint}
            />
          ) : null}
        </Row>

        {/* One word, closed, where an officer has already reviewed this. It is
            the difference between a value the machine read and one a person
            stood behind, and it must not need a tap to discover. */}
        {corrected && !open ? (
          <Txt variant="caption" color={colors.info} style={{ marginTop: 2 }}>
            Confirmed by the inspector
          </Txt>
        ) : null}
      </Pressable>

      {open && corrected ? (
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

      {/*
        The confidence bar that used to sit here is gone. It said the same
        thing as the pill in the corner, in the same card, twice — and across
        twenty declarations that is twenty bars of chart doing no work, which
        is most of what made this list read as clutter.

        What replaced it matters more. `View evidence` opens the crop of the
        photograph this value was read from, with the detection box on it, and
        it is the only way an inspector can check a reading before it becomes a
        finding: a batch number read as ":" or a brand read as "anacur: Beirhi
        Co." is obvious in one glance at the pixels and invisible in a list. So
        it is a bordered target now rather than a faint blue link.
      */}
      {open && (onViewEvidence || onReview) ? (
        <Row gap={spacing.sm} style={{ marginTop: spacing.md }}>
          {onViewEvidence && field.boundingBox ? (
            <Pressable
              onPress={onViewEvidence}
              accessibilityRole="button"
              accessibilityLabel={`View evidence for ${field.label}`}
              style={({ pressed }) => [styles.fieldAction, pressed && { backgroundColor: colors.accentSoft }]}
            >
              <Ionicons name="scan-outline" size={15} color={colors.accent} />
              <Txt variant="label" color={colors.accent}>
                View evidence
              </Txt>
            </Pressable>
          ) : null}

          {onReview ? (
            <Pressable
              onPress={onReview}
              accessibilityRole="button"
              style={({ pressed }) => [styles.fieldAction, pressed && { backgroundColor: colors.accentSoft }]}
            >
              <Ionicons name="create-outline" size={15} color={colors.accent} />
              <Txt variant="label" color={colors.accent}>
                {corrected ? 'Change' : 'Review'}
              </Txt>
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

  /**
   * ── THE ONE PLACE ZOOM WAS MISSING ────────────────────────────────────
   *
   * This is the view an officer uses to answer the only question the review
   * step asks — *is this what the package says?* — and it was the one image in
   * the app that could not be magnified.
   *
   * It is also the image that most needs it. The declarations under review are
   * the ones the recogniser was least sure of: a smudged MRP, a batch code in
   * one-millimetre type, a date on a crimp. Rendered into a 200-pixel strip
   * those are unreadable by construction, so the officer was being asked to
   * confirm a reading against evidence they could not actually read, and the
   * detail was in the file the whole time.
   *
   * The evidence box travels into the viewer with the photograph. Losing it on
   * the way in would drop the thing this view exists to show — *where* on the
   * label the value came from — at exactly the moment the officer went looking
   * for it.
   */
  const [zoomed, setZoomed] = useState(false);
  const canZoom = Boolean(image?.uri);

  return (
    <View>
      <Pressable
        onPress={() => setZoomed(true)}
        disabled={!canZoom}
        accessibilityRole={canZoom ? 'button' : 'image'}
        accessibilityLabel={
          canZoom ? `Open the ${imageSideLabels[image!.side]} photograph full screen` : undefined
        }
        style={({ pressed }) => [styles.evidenceFrame, { height }, pressed && { opacity: 0.9 }]}
      >
        {image?.uri ? (
          <RemoteImage uri={image.uri} style={StyleSheet.absoluteFill} resizeMode="contain" />
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

        {/* The affordance, on the image rather than as a line of text under it.
            A caption saying "tap to zoom" is a caption competing with the
            photograph; a magnifier in the corner is the control itself. */}
        {canZoom ? (
          <View style={styles.evidenceZoom} pointerEvents="none">
            <Ionicons name="expand-outline" size={14} color={colors.textInverse} />
          </View>
        ) : null}
      </Pressable>

      <Txt variant="caption" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
        {image ? `${imageSideLabels[image.side]} · captured ${formatRelative(image.capturedAt)}` : 'No source image'}
      </Txt>

      {image ? (
        <ImageViewer
          images={[image]}
          visible={zoomed}
          onClose={() => setZoomed(false)}
          highlight={box}
        />
      ) : null}
    </View>
  );
}

/**
 * ── WHAT THE CAMERA ACTUALLY READ ───────────────────────────────────────────
 *
 * Every other view on this record shows what the system *concluded*: the
 * declarations it matched, the rules it applied, the findings it raised. None
 * of them can answer the question an officer asks when a mandatory declaration
 * comes back missing — was it not printed on the package, or was it printed and
 * not read?
 *
 * Those are two completely different things. The first is a finding against the
 * trader under rule 6(1); the second is a defect in this software, and recording
 * it as the first is the worst thing this system can do. The evidence to tell
 * them apart is the text itself, and it was being thrown away at the edge of the
 * screen while sitting in the record all along.
 *
 * So: the lines, in reading order, with the ones no declaration claimed shown
 * faintly. An officer scanning for "MRP" finds it here or does not, and either
 * way they know which of the two they are looking at.
 *
 * Deliberately plain. This is a diagnostic read, not a document — no cards, no
 * icons, no per-line chrome. A hundred lines of label text with a tick against
 * each one is unreadable, and unreadable is the one thing this must not be.
 */
export function LabelTextView({ scan }: { scan: ScanRecord }) {
  const lines = (scan.ocr.rawText ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

  // Membership, not position: the same string can appear on two faces, and the
  // extractor reports unclaimed lines by value.
  const unclaimed = new Set(scan.extraction.unclaimedLines ?? []);

  if (lines.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="document-outline"
          title="No text was read"
          message="The recogniser returned nothing from these photographs. A declaration cannot be reported missing on this evidence."
        />
      </Card>
    );
  }

  const claimedCount = lines.filter((line) => !unclaimed.has(line)).length;

  return (
    <>
      <Card>
        {lines.map((line, index) => {
          const used = !unclaimed.has(line);

          return (
            <Txt
              key={`${index}-${line}`}
              variant="caption"
              color={used ? colors.text : colors.textFaint}
              style={{ paddingVertical: 3 }}
            >
              {line}
            </Txt>
          );
        })}
      </Card>

      {/* Under the text, not over it. The reader came here for the lines. */}
      <Txt variant="caption" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
        {pluralize(lines.length, 'line')} read · {claimedCount} used for a declaration ·{' '}
        {lines.length - claimedCount} shown faintly, matched to none
      </Txt>
    </>
  );
}

/* ── Violations ───────────────────────────────────────────────────────────── */

export function ViolationCard({
  violation,
  index,
}: {
  violation: Violation;
  /**
   * 1-based position in the list.
   *
   * Findings get numbered because they get *referred to*. An officer reads
   * them out to a dealer, a supervisor asks about one over the phone, and the
   * exported PDF prints them in this order — "the second finding" has to mean
   * the same thing in all three places. Optional, so a card shown on its own
   * is not numbered "1 of nothing".
   */
  index?: number;
}) {
  return (
    <Card style={{ marginBottom: spacing.md, borderLeftWidth: 3, borderLeftColor: colors.danger }}>
      <Row justify="space-between" align="flex-start" gap={spacing.sm}>
        <Row gap={spacing.sm} align="flex-start" style={{ flex: 1 }}>
          {index !== undefined ? <OrdinalChip value={index} tone="danger" /> : null}
          <Txt variant="heading" style={{ flex: 1 }}>
            {violation.title}
          </Txt>
        </Row>
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

/**
 * A small numbered disc.
 *
 * Tinted rather than filled: at this size a solid danger-red disc beside a
 * danger-red card border reads as a second alarm, when all it is doing is
 * counting.
 */
function OrdinalChip({ value, tone }: { value: number; tone: Tone }) {
  const palette = toneColors[tone];

  return (
    <View style={[styles.ordinal, { backgroundColor: palette.bg }]}>
      <Txt variant="caption" color={palette.fg}>
        {value}
      </Txt>
    </View>
  );
}

/** Compact row for the rule-check list. */
export function CheckRow({
  title,
  ruleReference,
  result,
  message,
  index,
}: {
  title: string;
  ruleReference: string;
  result: keyof typeof checkResultTones;
  message: string;
  /** 1-based position, for the same reason `ViolationCard` takes one. */
  index?: number;
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
      {/* The result icon stays, and the number sits under it rather than
          replacing it: the number says *which* check, the icon says how it
          went, and an officer scanning the list for failures is reading the
          second of those. */}
      <View style={{ alignItems: 'center', width: 20 }}>
        <Ionicons name={icon} size={19} color={toneColors[tone].fg} style={{ marginTop: 1 }} />
        {index !== undefined ? (
          <Txt variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
            {index}
          </Txt>
        ) : null}
      </View>
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
  /** The magnifier badge on an evidence frame. */
  evidenceZoom: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  ordinal: {
    minWidth: 22,
    height: 22,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  tallyCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: 4,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  /**
   * The proportion bar.
   *
   * `overflow: hidden` with a pill radius so the three flex children are
   * clipped into one continuous band rather than three abutting rectangles —
   * at this height a visible seam reads as a gap in the data.
   */
  tallyBar: {
    flexDirection: 'row',
    height: 6,
    marginTop: spacing.md,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: colors.neutralSoft,
  },
  fieldAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.accentSoft,
    backgroundColor: colors.surfaceAlt,
  },
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

