/** @type {import('tailwindcss').Config} */

/**
 * Design tokens for the compliance console.
 *
 * Every colour is a CSS custom property defined in `src/index.css`, so light
 * and dark are the same class names against a different set of variables. A
 * component never names a raw colour, which is what keeps the two themes from
 * drifting apart one hardcoded `slate-700` at a time.
 *
 * The palette is deliberately restrained: a single authoritative blue carries
 * every interactive affordance, and colour is otherwise reserved for the three
 * compliance verdicts. On an enforcement screen a colour has to *mean*
 * something: if buttons, links and badges are all tinted, nothing reads as a
 * signal.
 */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'hsl(var(--canvas) / <alpha-value>)',
        surface: 'hsl(var(--surface) / <alpha-value>)',
        'surface-raised': 'hsl(var(--surface-raised) / <alpha-value>)',
        'surface-sunken': 'hsl(var(--surface-sunken) / <alpha-value>)',

        ink: 'hsl(var(--ink) / <alpha-value>)',
        'ink-muted': 'hsl(var(--ink-muted) / <alpha-value>)',
        'ink-faint': 'hsl(var(--ink-faint) / <alpha-value>)',
        'ink-inverse': 'hsl(var(--ink-inverse) / <alpha-value>)',

        line: 'hsl(var(--line) / <alpha-value>)',
        'line-strong': 'hsl(var(--line-strong) / <alpha-value>)',

        brand: {
          DEFAULT: 'hsl(var(--brand) / <alpha-value>)',
          hover: 'hsl(var(--brand-hover) / <alpha-value>)',
          soft: 'hsl(var(--brand-soft) / <alpha-value>)',
          ring: 'hsl(var(--brand-ring) / <alpha-value>)',
        },

        rail: {
          DEFAULT: 'hsl(var(--rail) / <alpha-value>)',
          raised: 'hsl(var(--rail-raised) / <alpha-value>)',
          ink: 'hsl(var(--rail-ink) / <alpha-value>)',
          muted: 'hsl(var(--rail-muted) / <alpha-value>)',
          line: 'hsl(var(--rail-line) / <alpha-value>)',
        },

        /* The three verdicts, plus the two workflow states. */
        compliant: {
          DEFAULT: 'hsl(var(--compliant) / <alpha-value>)',
          soft: 'hsl(var(--compliant-soft) / <alpha-value>)',
          ink: 'hsl(var(--compliant-ink) / <alpha-value>)',
        },
        violation: {
          DEFAULT: 'hsl(var(--violation) / <alpha-value>)',
          soft: 'hsl(var(--violation-soft) / <alpha-value>)',
          ink: 'hsl(var(--violation-ink) / <alpha-value>)',
        },
        review: {
          DEFAULT: 'hsl(var(--review) / <alpha-value>)',
          soft: 'hsl(var(--review-soft) / <alpha-value>)',
          ink: 'hsl(var(--review-ink) / <alpha-value>)',
        },
        neutralState: {
          DEFAULT: 'hsl(var(--neutral-state) / <alpha-value>)',
          soft: 'hsl(var(--neutral-state-soft) / <alpha-value>)',
          ink: 'hsl(var(--neutral-state-ink) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'hsl(var(--info) / <alpha-value>)',
          soft: 'hsl(var(--info-soft) / <alpha-value>)',
          ink: 'hsl(var(--info-ink) / <alpha-value>)',
        },
      },

      fontFamily: {
        sans: [
          'Inter var',
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        // Reference numbers, rule citations and measured values. A tabular
        // face stops INS-2026-00001 from shifting width between rows.
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },

      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.02em' }],
      },

      borderRadius: {
        card: '0.75rem',
      },

      boxShadow: {
        /* Deliberately shallow. Depth here separates surfaces, it does not decorate. */
        card: '0 1px 2px 0 hsl(var(--shadow) / 0.06), 0 1px 3px 0 hsl(var(--shadow) / 0.04)',
        raised: '0 4px 12px -2px hsl(var(--shadow) / 0.10), 0 2px 6px -2px hsl(var(--shadow) / 0.06)',
        pop: '0 12px 32px -8px hsl(var(--shadow) / 0.22), 0 4px 12px -4px hsl(var(--shadow) / 0.10)',
      },

      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 180ms ease-out',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
};
