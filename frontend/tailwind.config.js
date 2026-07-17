/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        // 暗色赛博工业风调色板
        ink: {
          950: "#0A0E14",   // 主背景 - 深炭黑
          900: "#0F141C",   // 卡片背景
          800: "#1A1F2E",   // 网格灰 / 边框
          700: "#252B3D",   // 悬停态
          600: "#3A4258",   // 分隔线
        },
        neon: {
          cyan: "#00E5FF",     // 主色 - 霓虹青
          amber: "#FFB627",    // 警示色 - 琥珀橙
          green: "#10F5A0",    // 成功绿
          rose: "#FF4D6D",     // 危险红
          violet: "#A855F7",   // 辅助紫
        },
        muted: {
          DEFAULT: "#9CA3AF",  // 文字灰
          dim: "#6B7280",      // 次级文字
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', "Consolas", "monospace"],
        sans: ['"HarmonyOS Sans SC"', '"PingFang SC"', '"Microsoft YaHei"', "system-ui", "sans-serif"],
      },
      boxShadow: {
        'neon-cyan': '0 0 12px rgba(0, 229, 255, 0.4), 0 0 24px rgba(0, 229, 255, 0.15)',
        'neon-amber': '0 0 12px rgba(255, 182, 39, 0.4), 0 0 24px rgba(255, 182, 39, 0.15)',
        'neon-green': '0 0 12px rgba(16, 245, 160, 0.4), 0 0 24px rgba(16, 245, 160, 0.15)',
        'glass': '0 8px 32px rgba(0, 0, 0, 0.37)',
      },
      backgroundImage: {
        'grid-pattern': "linear-gradient(rgba(26,31,46,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(26,31,46,0.4) 1px, transparent 1px)",
        'radial-glow': "radial-gradient(circle at bottom right, rgba(0,229,255,0.08), transparent 60%)",
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'flow': 'flow 2s linear infinite',
        'blink': 'blink 1s step-end infinite',
      },
      keyframes: {
        flow: {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '200% 50%' },
        },
        blink: {
          '0%, 50%': { opacity: '1' },
          '51%, 100%': { opacity: '0' },
        },
      },
    },
  },
  plugins: [],
};
