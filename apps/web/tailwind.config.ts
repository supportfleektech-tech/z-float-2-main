import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "var(--zf-primary)",
          strong: "var(--zf-primary-strong)",
          soft: "var(--zf-primary-soft)",
        },
        ink: "var(--zf-ink)",
        surface: "var(--zf-surface)",
        card: "var(--zf-card)",
        borderline: "var(--zf-border)",
        success: "var(--zf-success)",
        warning: "var(--zf-warning)",
        danger: "var(--zf-danger)",
        muted: "#5B6B83",
      },
      borderRadius: { card: "16px", control: "10px" },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
