/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /* 冷调工具型 —— 与 index.css 的 CSS 变量对齐（hex 近似值，仅用于 Tailwind 占位类）。
           实际渲染以 CSS 变量（--bg/--fg/--accent 等）为准。 */
        cream: {
          DEFAULT: 'var(--bg)',
          50: 'var(--surface-2)',
          100: 'var(--surface-2)',
          200: 'var(--surface)',
          300: 'var(--border)'
        },
        stone: {
          DEFAULT: 'var(--fg-2)',
          50: 'var(--surface)',
          100: 'var(--surface-2)',
          300: 'var(--border)',
          400: 'var(--faint)',
          500: 'var(--muted)',
          600: 'var(--fg-2)',
          700: 'var(--fg)'
        },
        sage: {
          DEFAULT: 'var(--accent)',
          50: 'var(--accent-soft)',
          100: 'var(--accent-soft)',
          300: 'var(--accent-line)',
          400: 'var(--accent-line)',
          500: 'var(--accent)',
          600: 'var(--accent)',
          700: 'var(--accent)'
        },
        tan: {
          DEFAULT: 'var(--muted)',
          50: 'var(--surface-2)',
          100: 'var(--border)',
          400: 'var(--muted)',
          500: 'var(--muted)',
          600: 'var(--fg-2)'
        },
        ok: 'var(--ok)',
        warn: 'var(--warn)',
        danger: 'var(--danger)',
        accent: 'var(--accent)'
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"PingFang SC"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        serif: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Display"', '"PingFang SC"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'monospace'],
        brand: ['"Smiley Sans"', '"PingFang SC"', '-apple-system', 'system-ui', 'sans-serif']
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        md: 'var(--radius)',
        sm: 'var(--radius-sm)'
      },
      transitionTimingFunction: {
        organic: 'cubic-bezier(0.2, 0, 0, 1)'
      }
    }
  },
  plugins: []
}
