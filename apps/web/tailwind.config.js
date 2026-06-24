/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
    darkMode: 'class',
    theme: {
        extend: {
            fontSize: {
                'xs':   ['0.75rem',   { lineHeight: '1rem' }],
                'sm':   ['0.8125rem', { lineHeight: '1.25rem' }],
                'base': ['0.875rem',  { lineHeight: '1.375rem' }],
                'lg':   ['1rem',      { lineHeight: '1.5rem' }],
                'xl':   ['1.125rem',  { lineHeight: '1.625rem' }],
                '2xl':  ['1.375rem',  { lineHeight: '1.75rem' }],
                '3xl':  ['1.75rem',   { lineHeight: '2.125rem' }],
            },
            colors: {
                surface: { DEFAULT: '#ffffff', secondary: '#f8fafc', raised: '#f1f5f9', overlay: '#e2e8f0' },
                sidebar: { DEFAULT: '#ffffff', hover: '#f1f5f9', active: '#e2e8f0', text: '#64748b', 'text-active': '#0f172a', muted: '#94a3b8' },
                accent:  { DEFAULT: '#3b82f6', hover: '#2563eb', light: '#eff6ff', glow: 'rgba(59, 130, 246, 0.12)' },
                success: { DEFAULT: '#10b981', light: '#ecfdf5' },
                warning: { DEFAULT: '#f59e0b', light: '#fffbeb' },
                danger:  { DEFAULT: '#ef4444', light: '#fef2f2' },
                info:    { DEFAULT: '#3b82f6', light: '#eff6ff' },
            },
            fontFamily: {
                sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
                mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
            },
            borderRadius: {
                'sm': '6px',
                'md': '8px',
                'lg': '12px',
                'xl': '16px',
            },
            boxShadow: {
                'xs':    '0 1px 2px rgba(0,0,0,0.04)',
                'sm':    '0 1px 3px rgba(0,0,0,0.06)',
                'md':    '0 2px 8px rgba(0,0,0,0.06)',
                'lg':    '0 4px 16px rgba(0,0,0,0.08)',
                'focus': '0 0 0 3px rgba(59, 130, 246, 0.12)',
            },
            animation: {
                'pulse-glow':   'pulse-glow 2s ease-in-out infinite',
                'slide-up':     'slide-up 0.25s ease-out',
                'fade-in':      'fade-in 0.2s ease-out',
                'float':        'float 7s ease-in-out infinite',
                'drift':        'drift 14s ease-in-out infinite',
                'shimmer':      'shimmer 1.4s linear infinite',
                'gradient-pan': 'gradient-pan 8s ease infinite',
            },
            keyframes: {
                'pulse-glow': { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.4' } },
                'slide-up':   { '0%': { transform: 'translateY(8px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
                'fade-in':    { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
                'float':      { '0%, 100%': { transform: 'translateY(0) translateX(0)' }, '50%': { transform: 'translateY(-14px) translateX(6px)' } },
                'drift':      { '0%, 100%': { transform: 'translate(0,0) scale(1)' }, '33%': { transform: 'translate(12px,-8px) scale(1.04)' }, '66%': { transform: 'translate(-8px,10px) scale(0.98)' } },
                'shimmer':    { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
                'gradient-pan': { '0%, 100%': { backgroundPosition: '0% 50%' }, '50%': { backgroundPosition: '100% 50%' } },
            },
        },
    },
    plugins: [],
};
