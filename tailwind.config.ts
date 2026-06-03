import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx,js,jsx}',
    './components/**/*.{ts,tsx,js,jsx}',
    './helper/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'neon-red': '#00ff41',
        'dark-bg':  '#0a0a0a',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'subtle-shimmer': 'subtle-shimmer 4s ease-in-out infinite',
        'pulse-slow':     'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in':        'fade-in 0.5s ease-out',
        'slide-up':       'slide-up 0.4s ease-out',
        'border-beam':    'border-beam 3s linear infinite',
        'glow-pulse':     'glow-pulse 2.5s ease-in-out infinite',
        'dot-ping':       'dot-ping 1.8s ease-in-out infinite',
        'count-slide':    'count-slide 0.6s cubic-bezier(0.22,1,0.36,1) both',
      },
      keyframes: {
        'subtle-shimmer': {
          '0%, 100%': { opacity: '0.5' },
          '50%':       { opacity: '0.8' },
        },
        'fade-in': {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'border-beam': {
          '0%':   { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '200% 50%' },
        },
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 8px rgba(0,255,65,0.15), 0 0 24px rgba(0,255,65,0.06)' },
          '50%':      { boxShadow: '0 0 18px rgba(0,255,65,0.40), 0 0 48px rgba(0,255,65,0.18)' },
        },
        'dot-ping': {
          '0%':        { transform: 'scale(1)',   opacity: '1' },
          '60%, 100%': { transform: 'scale(2.4)', opacity: '0' },
        },
        'count-slide': {
          '0%':   { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};

export default config;
