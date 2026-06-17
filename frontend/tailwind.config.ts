import plugin from "tailwindcss/plugin";
import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        tlhn: {
          void: "#07080c",
          night: "#0d1018",
          panel: "#11131d",
          ash: "#8d95a8",
          bone: "#f2f5f8",
          static: "#2a2f3d",
        },
        hater: {
          50: "#fff1f3",
          100: "#ffe0e4",
          300: "#ff8392",
          500: "#ff3048",
          600: "#e0162f",
          700: "#b80d23",
          900: "#5d0915",
        },
        lover: {
          50: "#eff7ff",
          100: "#d9edff",
          300: "#78c6ff",
          500: "#2f8fff",
          600: "#176be8",
          700: "#1455bb",
          900: "#0d2f66",
        },
      },
      fontFamily: {
        terminal: [
          '"Share Tech Mono"',
          '"IBM Plex Mono"',
          '"Courier New"',
          "ui-monospace",
          "monospace",
        ],
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "sans-serif",
        ],
      },
      backgroundImage: {
        "tlhn-grunge":
          "radial-gradient(circle at 18% 20%, rgba(255, 48, 72, 0.2), transparent 28%), radial-gradient(circle at 82% 72%, rgba(47, 143, 255, 0.2), transparent 30%), linear-gradient(135deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 12px), linear-gradient(180deg, #07080c, #10131c 52%, #07080c)",
        scanlines:
          "repeating-linear-gradient(180deg, rgba(255,255,255,0.055) 0 1px, transparent 1px 4px)",
      },
      boxShadow: {
        "neon-hater":
          "0 0 18px rgba(255, 48, 72, 0.45), 0 0 42px rgba(255, 48, 72, 0.18)",
        "neon-lover":
          "0 0 18px rgba(47, 143, 255, 0.45), 0 0 42px rgba(47, 143, 255, 0.18)",
        "panel-glitch":
          "inset 0 0 0 1px rgba(242, 245, 248, 0.08), 0 18px 80px rgba(0, 0, 0, 0.5)",
      },
    },
  },
  plugins: [
    plugin(({ addUtilities }) => {
      addUtilities({
        ".text-glow-hater": {
          textShadow:
            "0 0 10px rgba(255, 48, 72, 0.9), 0 0 28px rgba(255, 48, 72, 0.55)",
        },
        ".text-glow-lover": {
          textShadow:
            "0 0 10px rgba(47, 143, 255, 0.9), 0 0 28px rgba(47, 143, 255, 0.55)",
        },
        ".text-glow-terminal": {
          textShadow: "0 0 12px rgba(242, 245, 248, 0.5)",
        },
      });
    }),
  ],
} satisfies Config;
