import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/renderer/index.html", "./src/renderer/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "var(--color-bg-primary)",
          secondary: "var(--color-bg-secondary)",
          tertiary: "var(--color-bg-tertiary)"
        },
        surface: {
          0: "var(--color-surface-0)",
          1: "var(--color-surface-1)",
          2: "var(--color-surface-2)"
        },
        text: {
          primary: "var(--color-text-primary)",
          secondary: "var(--color-text-secondary)",
          muted: "var(--color-text-muted)"
        },
        border: "var(--color-border)",
        accent: "var(--color-accent)",
        danger: "var(--color-danger)",
        warning: "var(--color-warning)",
        success: "var(--color-success)",
        info: "var(--color-info)"
      },
      borderRadius: {
        hcbSm: "var(--radius-sm)",
        hcbMd: "var(--radius-md)",
        hcbLg: "var(--radius-lg)"
      },
      fontFamily: {
        sans: "var(--font-family)",
        mono: "var(--font-family-mono)"
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        normal: "var(--duration-normal)"
      },
      transitionTimingFunction: {
        hcb: "var(--easing-default)"
      }
    }
  },
  plugins: []
};

export default config;
