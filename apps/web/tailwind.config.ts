import type { Config } from 'tailwindcss';

/**
 * Design tokens lifted from the client's interactive prototype
 * (docs/OPSVERA_Fully_Openable_Interactive_Product.html).
 *
 * Components must use these names — no hard-coded hex anywhere in src/.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#0b1220', 2: '#14213d' },
        muted: { DEFAULT: '#6b7890', 2: '#8b98ab' },
        blue: { DEFAULT: '#3366ff', 2: '#5b8cff' },
        cyan: { DEFAULT: '#15b8d6' },
        green: { DEFAULT: '#16a36a' },
        amber: { DEFAULT: '#f59e0b' },
        red: { DEFAULT: '#e5484d' },
        violet: { DEFAULT: '#7c5cfc' },
        bg: '#f5f7fb',
        surface: { DEFAULT: '#ffffff', 2: '#f8fafd' },
        line: { DEFAULT: '#e5eaf1', soft: '#eef1f5' },
        nav: {
          DEFAULT: '#0d1526',
          2: '#111b31',
          // Sidebar foreground scale, straight from the prototype.
          text: '#a8b5ca',
          label: '#667c9d',
          hover: '#16233a',
          note: '#8193b0',
        },
        // Status pill pairs. Named by meaning, not by hue, so a pill's intent
        // survives a palette change.
        pill: {
          'green-bg': '#eaf8f1',
          'green-fg': '#13794f',
          'amber-bg': '#fff4e7',
          'amber-fg': '#b6690a',
          'red-bg': '#fdebec',
          'red-fg': '#b83236',
          'blue-bg': '#eef3ff',
          'blue-fg': '#315cc7',
          'gray-bg': '#eef1f5',
          'gray-fg': '#607088',
          'violet-bg': '#f2eeff',
          'violet-fg': '#5b43c4',
        },
        track: '#eef1f6',
      },
      borderRadius: {
        control: '10px',
        card: '15px',
        panel: '17px',
        'panel-lg': '22px',
      },
      boxShadow: {
        card: '0 8px 28px rgba(15,23,42,.07)',
        'card-soft': '0 5px 15px rgba(15,23,42,.035)',
        float: '0 20px 60px rgba(15,23,42,.18)',
        brand: '0 8px 24px rgba(51,102,255,.33)',
        'btn-primary': '0 8px 18px rgba(51,102,255,.2)',
      },
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      fontSize: {
        // The prototype runs 8–12px. Those are mock sizes; the smallest are
        // below a readable floor, so the scale is lifted while the hierarchy
        // and the step between levels are kept exactly.
        micro: ['11px', { lineHeight: '14px', letterSpacing: '0.07em' }],
        label: ['11px', { lineHeight: '15px', letterSpacing: '0.13em' }],
        pill: ['11px', { lineHeight: '14px' }],
        sub: ['12px', { lineHeight: '17px' }],
        body: ['13px', { lineHeight: '19px' }],
        title: ['14px', { lineHeight: '20px' }],
        metric: ['28px', { lineHeight: '32px', letterSpacing: '-0.015em' }],
        display: ['34px', { lineHeight: '40px', letterSpacing: '-0.02em' }],
      },
      fontWeight: {
        heavy: '850',
        black: '880',
      },
      spacing: {
        sidebar: '260px',
        'sidebar-collapsed': '76px',
        topbar: '72px',
      },
      backgroundImage: {
        'nav-gradient': 'linear-gradient(180deg, #0d1526 0%, #111b31 100%)',
        'nav-active': 'linear-gradient(90deg, rgba(51,102,255,.25), rgba(21,184,214,.08))',
        'brand-gradient': 'linear-gradient(135deg, #3366ff 0%, #15b8d6 100%)',
        'progress-fill': 'linear-gradient(90deg, #3366ff 0%, #15b8d6 100%)',
        'progress-risk': 'linear-gradient(90deg, #f59e0b 0%, #ff7a45 100%)',
        'avatar-gradient': 'linear-gradient(135deg, #dce7ff 0%, #caf5fb 100%)',
        'timer-gradient': 'linear-gradient(135deg, #101b34 0%, #183261 100%)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'slide-in-right': 'slide-in-right 220ms cubic-bezier(.16,1,.3,1)',
        'slide-up': 'slide-up 160ms cubic-bezier(.16,1,.3,1)',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
