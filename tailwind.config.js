/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        space: {
          950: '#05080f',
          900: '#090e17',
          850: '#0d131f',
          800: '#121b2b',
          750: '#172236',
          700: '#1d2a42',
          600: '#283857',
        },
        // Accent ramp is driven by CSS variables so the Manufacturer OS can re-brand the whole app.
        cyan: {
          200: 'rgb(var(--accent-200) / <alpha-value>)',
          300: 'rgb(var(--accent-300) / <alpha-value>)',
          400: 'rgb(var(--accent-400) / <alpha-value>)',
          500: 'rgb(var(--accent-500) / <alpha-value>)',
          600: 'rgb(var(--accent-600) / <alpha-value>)',
        },
        quantum: {
          cyan: 'rgb(var(--accent) / <alpha-value>)',
          blue: '#38bdf8',
          amber: '#f59e0b',
          crimson: '#ef4444',
          emerald: '#10b981',
          violet: '#a855f7',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'Consolas', 'monospace'],
        orbitron: ['Orbitron', 'sans-serif'],
      },
      boxShadow: {
        'glow-cyan': '0 0 20px -3px rgb(var(--accent) / 0.25)',
        'glow-amber': '0 0 20px -3px rgba(245, 158, 11, 0.25)',
        'glow-crimson': '0 0 20px -3px rgba(239, 68, 68, 0.25)',
        'glow-emerald': '0 0 20px -3px rgba(16, 185, 129, 0.25)',
      },
      backgroundImage: {
        'sc-grid': 'linear-gradient(to right, rgb(var(--accent) / 0.03) 1px, transparent 1px), linear-gradient(to bottom, rgb(var(--accent) / 0.03) 1px, transparent 1px)',
        'hud-radial': 'radial-gradient(circle at 50% 0%, rgb(var(--accent) / 0.08) 0%, transparent 70%)',
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'scanline': 'scanline 8s linear infinite',
      },
      keyframes: {
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(1000%)' },
        },
      },
    },
  },
  plugins: [],
};
