import React from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  EMBLEM_ASPECT,
  EMBLEM_IMAGE,
  LETTERHEAD_ASPECT,
  LETTERHEAD_IMAGE,
} from '../constants/brandAssets';
import { LETTERHEAD } from '../constants/identity';
import { colors, radius, shadow, spacing } from '../constants/theme';

import { Row, Txt } from './ui';

/**
 * ── DEPARTMENT IDENTITY ─────────────────────────────────────────────────────
 * The masthead the app wears, and the same identity the exported PDF carries.
 *
 * The band is white on a light ground rather than the institutional navy the
 * rest of the chrome uses, because the department's mark is a fine-lined
 * monochrome lockup: reversed out on a dark panel at 34pt its detail closes up
 * and it reads as a smudge.
 *
 * It takes its fill from the tab bar at the other end of the screen, so the two
 * read as one frame around the page rather than as two surfaces that happen to
 * sit above and below it. Where the tab bar closes with a hairline, this band
 * closes with a rounded edge and a shadow — see `styles.header`.
 *
 * **No mark is drawn in code.** The department's seal is its own artwork file
 * (see `constants/brandAssets.ts`); where none is installed the masthead falls
 * back to type rather than to a drawn stand-in. See `identity.ts` for why an
 * approximation was rejected rather than shipped.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * The Lion Capital on its own.
 *
 * Sized by height with the width derived from the file's own aspect, so
 * replacing the artwork with a differently-proportioned file cannot squash it.
 */
export function Emblem({ size = 34 }: { size?: number }) {
  if (EMBLEM_IMAGE === null) return null;

  return (
    <Image
      source={EMBLEM_IMAGE}
      style={{ width: size * EMBLEM_ASPECT, height: size }}
      resizeMode="contain"
      accessibilityLabel="State Emblem of India"
    />
  );
}

/**
 * The department's identity block: the lockup where it is installed, the
 * emblem beside set type where only the emblem is, and type alone otherwise.
 *
 * The three cases are ordered rather than combined on purpose — the lockup
 * already contains the department's name, so drawing the wordmark beside it
 * would print the name twice, once as a picture and once as text.
 */
export function DepartmentMark({ height = 34 }: { height?: number }) {
  if (LETTERHEAD_IMAGE !== null) {
    return (
      <Image
        source={LETTERHEAD_IMAGE}
        /**
         * Drawn at full strength, always.
         *
         * The artwork is pure black on a transparent ground — every opaque
         * pixel in the file is `rgb(0,0,0)` — so it needs no tint to read as
         * black, and any opacity below 1 is what makes it look washed out. If
         * the mark ever needs to sit back from something, move that something
         * rather than fading the department's identity.
         *
         * `maxWidth` guards the derived width: the officer's block shares this
         * row, and an image given an explicit width overflows rather than
         * shrinking when the two no longer fit on a narrow handset.
         */
        style={{ width: height * LETTERHEAD_ASPECT, height, maxWidth: '100%' }}
        resizeMode="contain"
        accessibilityLabel={LETTERHEAD.departmentEn}
      />
    );
  }

  if (EMBLEM_IMAGE !== null) {
    return (
      <Row gap={spacing.sm} align="center">
        <Emblem size={height * 1.25} />
        <DepartmentWordmark compact />
      </Row>
    );
  }

  return <DepartmentWordmark />;
}

/**
 * The department's name, set as the reference lockup sets it: the Hindi line,
 * then "Department of", then the subject in bold.
 *
 * Used by `DepartmentMark` only where the lockup artwork is absent — that
 * artwork already carries these words, and setting them again would print the
 * department's name beside a picture of the department's name.
 */
export function DepartmentWordmark({ compact }: { compact?: boolean }) {
  return (
    <View>
      <Txt variant="caption" color={colors.textMuted} numberOfLines={1}>
        {LETTERHEAD.departmentHi}
      </Txt>
      <Txt variant="caption" color={colors.textMuted} numberOfLines={1} style={{ marginTop: 1 }}>
        Department of
      </Txt>
      <Txt variant={compact ? 'bodyStrong' : 'heading'} numberOfLines={1}>
        CONSUMER AFFAIRS
      </Txt>
    </View>
  );
}

/**
 * The application masthead.
 *
 * Identity on the left, the signed-in officer on the right. The officer's block
 * is text rather than an avatar monogram: a two-letter disc says nothing a
 * colleague picking up the handset can use, whereas the badge number is what an
 * inspection is filed under and what a supervisor asks for.
 */
export function GovHeader({
  officerName,
  officerId,
  officerZone,
  compact,
  style,
}: {
  officerName?: string;
  officerId?: string;
  officerZone?: string;
  /** Tightens the block, for screens deeper than the tab roots. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }, style]}>
      <Row align="center" gap={spacing.md}>
        <View style={{ flex: 1 }}>
          <DepartmentMark height={compact ? 38 : 46} />
        </View>

        {officerName ? (
          <View style={styles.officer}>
            {/* `textMuted` rather than `textFaint`. The faint token sits at
                about 3:1 on white, which is thin for a screen this app expects
                to be read outdoors; one step darker takes these two lines past
                5:1 and costs nothing, since neither competes with the name. */}
            <Txt variant="caption" color={colors.textMuted} style={styles.right}>
              Signed in
            </Txt>
            <Txt variant="bodyStrong" numberOfLines={1} style={styles.right}>
              {officerName}
            </Txt>
            {officerId ? (
              <Txt variant="mono" color={colors.textMuted} numberOfLines={1} style={styles.right}>
                {officerId}
              </Txt>
            ) : null}
            {officerZone ? (
              <Txt variant="caption" color={colors.textMuted} numberOfLines={1} style={styles.right}>
                {officerZone}
              </Txt>
            ) : null}
          </View>
        ) : null}
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * The masthead band.
   *
   * The fill is the tab bar's — see `navigation/TabNavigator.tsx`. The two are
   * the app's chrome and should read as one frame around the page rather than
   * as two different surfaces that happen to sit above and below it.
   *
   * The bottom corners are rounded — only the bottom two, because the band runs
   * up under the status bar and there is no edge up there to round. `radius.xl`
   * rather than the card radius: across a full screen width a tighter curve
   * reads as a rendering artefact rather than as a decision.
   *
   * The shadow replaces the hairline rather than joining it. Both together
   * print two edges under one curve, and the softer of the two is the one that
   * suits a rounded corner — a hairline has to trace the arc exactly and shows
   * every pixel where it does not.
   *
   * `shadow.card` and not a new level: `theme.ts` allows exactly two, one for
   * cards and one for sheets, on the grounds that a third reads as decoration.
   * A masthead is raised chrome, which is what the card level already means.
   *
   * `zIndex` keeps the band above the scroll view on iOS, where a later sibling
   * would otherwise paint over the shadow as soon as content reached it.
   */
  header: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.md,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    zIndex: 1,
    ...shadow.card,
  },
  officer: { maxWidth: 138, alignItems: 'flex-end' },
  right: { textAlign: 'right' },
});
