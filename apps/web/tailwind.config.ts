import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "#0F5BFF", strong: "#083DAF", soft: "#EAF1FF" },
        ink: "#0B1220",
        surface: "#F7F9FC",
        borderline: "#E7ECF3",
        success: "#149447",
        warning: "#B7791F",
        danger: "#C53030",
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
