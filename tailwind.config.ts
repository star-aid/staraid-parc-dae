import type { Config } from "tailwindcss";

// ─────────────────────────────────────────────────────────────────────────────
//  DESIGN SYSTEM — TOKENS
//  Source de vérité des couleurs, tailles de texte, rayons et ombres du
//  dashboard Parc DAE, alignée sur le design system de prospection-app.
//  Chaque token devient une classe utilitaire : `brand` → bg-brand / text-brand
//  (avec opacité : bg-brand/10), `body` → text-body, `card` → rounded-card…
//
//  Règle : les composants n'utilisent jamais de couleur brute (#ad2022,
//  slate-500…) ni de taille arbitraire : uniquement ces tokens. Seules les
//  couleurs de DONNÉES (statuts DAE dans les graphiques et la carte, séries de
//  la courbe des interventions) restent en dur dans leurs composants.
//  Guide : docs/design-system.md
// ─────────────────────────────────────────────────────────────────────────────
const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Marque : l'action principale et le repère de marque (header) ──
        brand: {
          DEFAULT:    "#ad2022",
          hover:      "#8f1a1c",
          active:     "#761517",
          soft:       "#fbeeee",   // fond « sélectionné » / mis en avant
          foreground: "#ffffff",   // texte sur fond brand
        },
        // ── Surfaces : fond de page froid, cartes blanches ──────────────
        surface: {
          DEFAULT: "#ffffff",      // cartes, panneaux, champs
          muted:   "#f4f5f8",      // fond de page, pieds de tableau
          sunken:  "#e9ebf1",      // survol, pastilles neutres, zones en retrait
          overlay: "rgb(15 18 25 / 0.45)", // voile derrière tiroirs et dialogues
        },
        // ── Barre latérale sombre (encre froide), tokens dédiés ─────────
        sidebar: {
          DEFAULT:    "#1e212b",
          raised:     "#262a36",   // survol
          active:     "#303542",   // entrée courante
          border:     "#2d323f",
          fg:         "#eceef2",
          "fg-muted": "#a3a9b8",
          "fg-faint": "#6d7383",
        },
        // ── Bordures légères : la profondeur vient des ombres ───────────
        border: {
          DEFAULT: "#e2e4ea",
          subtle:  "#edeef3",
          strong:  "#c2c6d0",
        },
        // ── Texte : échelle contrastée, refroidie ───────────────────────
        fg: {
          DEFAULT:   "#171921",    // titres, valeurs
          secondary: "#414552",    // libellés, boutons secondaires
          muted:     "#575c6b",    // méta, descriptions
          faint:     "#767c8c",    // icônes inactives, placeholders
        },
        // ── Sémantiques : mêmes teintes que les statuts DAE ─────────────
        danger:  { DEFAULT: "#dc2626", hover: "#b91c1c", soft: "#fef2f2", border: "#fecaca" },
        success: { DEFAULT: "#059669", hover: "#047857", soft: "#ecfdf5", border: "#a7f3d0" },
        warning: { DEFAULT: "#d97706", hover: "#b45309", soft: "#fffbeb", border: "#fde68a" },
        info:    { DEFAULT: "#0284c7", hover: "#0369a1", soft: "#f0f9ff", border: "#bae6fd" },
        // ── Accents de section (teintes désaturées, repères, pas des cris) ──
        accent: {
          blue:            "#4878b4",
          "blue-strong":   "#35608f",
          "blue-soft":     "#eef3f9",
          indigo:          "#5c66b8",
          "indigo-strong": "#474f96",
          "indigo-soft":   "#eff0f9",
          amber:           "#b08a1e",
          "amber-strong":  "#8a6c15",
          "amber-soft":    "#faf5e3",
          violet:          "#7c66b5",
          "violet-strong": "#614e93",
          "violet-soft":   "#f3f0fa",
          orange:          "#d3792f",
          "orange-strong": "#ad5f20",
          "orange-soft":   "#fbf1e6",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      // Quatre tailles « interface » sous text-sm (14px) ; au-dessus, l'échelle standard.
      fontSize: {
        "2xs":   ["0.625rem",  { lineHeight: "0.875rem" }], // 10px — compteurs en médaillon
        label:   ["0.6875rem", { lineHeight: "1rem" }],     // 11px — titres de section, libellés de champ
        caption: ["0.75rem",   { lineHeight: "1rem" }],     // 12px — méta, aide, boutons compacts
        body:    ["0.8125rem", { lineHeight: "1.25rem" }],  // 13px — texte courant, lignes de tableau
      },
      // Trois rayons : contrôle (boutons, champs), carte, panneau (dialogues, tiroirs).
      borderRadius: {
        control: "0.5rem",
        card:    "0.75rem",
        panel:   "1rem",
      },
      // Ombres à teinte d'encre froide, jamais de noir pur.
      boxShadow: {
        card:  "0 1px 2px rgb(18 22 33 / 0.05), 0 2px 8px rgb(18 22 33 / 0.04)",
        float: "0 8px 24px rgb(15 18 25 / 0.10)",
        panel: "0 20px 60px rgb(15 18 25 / 0.22)",
      },
      borderColor: {
        DEFAULT: "#e2e4ea",
      },
      ringOffsetColor: {
        surface: "#ffffff",
      },
    },
  },
  plugins: [],
};
export default config;
