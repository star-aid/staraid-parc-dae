import type { Config } from "tailwindcss";

// Socle visuel du dashboard : neutres slate, rouge STAR aid en accent unique,
// couleurs de statut réservées à la sémantique (conforme / vigilance / critique).
const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        brand: {
          DEFAULT: "#AF2125",   // rouge STAR aid (logo)
          hover:   "#961D21",
          light:   "#E5484D",   // accent sur fond sombre
          soft:    "#FDF2F2",   // fond teinté
          ring:    "#F3C4C6",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],      // 11px — libellés, métadonnées
        "13":  ["0.8125rem", { lineHeight: "1.25rem" }],   // 13px — texte dense (tableaux, nav)
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(15 23 42 / 0.04)",
        pop:  "0 8px 24px -8px rgb(15 23 42 / 0.18), 0 0 0 1px rgb(15 23 42 / 0.06)",
      },
      borderColor: {
        DEFAULT: "rgb(226 232 240)", // slate-200
      },
    },
  },
  plugins: [],
};
export default config;
