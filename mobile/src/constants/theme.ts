import { Platform } from 'react-native';

import type { Tone } from '../types';

/**
 * ── FIELD-CONDITIONS DESIGN SYSTEM ──────────────────────────────────────────
 * This app is used outdoors, one-handed, often in bright sunlight, by an
 * inspector who may be wearing gloves. Three consequences drive every token:
 *
 *   1. High contrast over subtlety — body text sits at >= 7:1 on its surface.
 *   2. Large touch targets — nothing interactive is under 48dp.
 *   3. Status is never colour-only — every badge pairs a tint with a label,
 *      so a red/green colour-blind inspector still reads the verdict.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * The palette carries two jobs at once: it has to survive direct sunlight, and
 * it has to look like a tool someone wants to pick up. The first was met by
 * desaturating everything, which cost the second — the result read as washed
 * out indoors, where most of the reviewing actually happens.
 *
 * So the ink stays dark and the tints got *more* saturated, not less. Every
 * status pair below is measured against the surface it sits on, and each one
 * beats the value it replaced:
 *
 *   success 4.75 → 5.92   danger  5.08 → 5.82   warning 3.77 → 4.51
 *   info    5.47 → 6.59   neutral 5.17 → 6.43   accent  4.77 → 5.70
 *
 * Colour got stronger and legibility went up with it. If you retune these,
 * re-measure — the ≥ 4.5:1 floor on a status pair is the promise this file
 * makes to an inspector reading a verdict on a phone held at arm's length.
 */
export const colors = {
  /** Institutional navy — the enforcement chrome. */
  navy: '#0A2A5C',
  navyDeep: '#061B3D',
  navySoft: '#153E7E',
  navyTint: '#E6EDF9',

  accent: '#1B5FD9',
  accentSoft: '#DCE8FD',

  background: '#F2F5FB',
  surface: '#FFFFFF',
  surfaceAlt: '#F8FAFE',

  text: '#0F1729',
  textMuted: '#51607A',
  textFaint: '#8592AC',
  textInverse: '#FFFFFF',

  border: '#DBE3F0',
  borderStrong: '#BECBDF',

  success: '#03694C',
  successSoft: '#D1FAE5',
  danger: '#B01818',
  dangerSoft: '#FEE4E2',
  warning: '#B45309',
  warningSoft: '#FEF3C7',
  info: '#075985',
  infoSoft: '#E0F2FE',
  neutral: '#4B5563',
  neutralSoft: '#E9EDF3',

  overlay: 'rgba(6, 27, 61, 0.62)',
} as const;

/** Maps the `Tone` union onto concrete fill/ink pairs. */
export const toneColors: Record<Tone, { bg: string; fg: string; dot: string }> = {
  success: { bg: colors.successSoft, fg: colors.success, dot: colors.success },
  danger: { bg: colors.dangerSoft, fg: colors.danger, dot: colors.danger },
  warning: { bg: colors.warningSoft, fg: colors.warning, dot: colors.warning },
  info: { bg: colors.infoSoft, fg: colors.info, dot: colors.info },
  neutral: { bg: colors.neutralSoft, fg: colors.neutral, dot: colors.neutral },
};

/** 4pt base scale. Named steps stop arbitrary paddings creeping in. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 44,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: '700' as const, letterSpacing: -0.5 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 17, lineHeight: 23, fontWeight: '700' as const },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '500' as const },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '700' as const },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '600' as const },
  /** Uppercase micro-label above a value. */
  overline: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700' as const,
    letterSpacing: 0.7,
    textTransform: 'uppercase' as const,
  },
  mono: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600' as const,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
} as const;

/**
 * Elevation is deliberately restrained: one raised level for cards and one for
 * sheets. More levels than that reads as decoration rather than hierarchy.
 */
export const shadow = {
  card: Platform.select({
    ios: {
      shadowColor: '#0B2545',
      shadowOpacity: 0.07,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 3 },
    },
    android: { elevation: 2 },
    default: {},
  }),
  sheet: Platform.select({
    ios: {
      shadowColor: '#0B2545',
      shadowOpacity: 0.16,
      shadowRadius: 24,
      shadowOffset: { width: -0, height: -4 },
    },
    android: { elevation: 12 },
    default: {},
  }),
} as const;

/** Minimum comfortable touch target for gloved use. */
export const HIT_TARGET = 48;
