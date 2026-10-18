import type { Config } from "tailwindcss";

// Lumaara design tokens — matched to the reference screenshots.
//
// Palette:
//   canvas   — warm cream that fills every page background
//   ink      — deep navy-black used for primary text + active nav pill
//   gold     — the LUMAARA brand mark tone, used for section headers,
//              active tab underlines and the amber left-indicator on the
//              active nav item
//   accent-* — muted tinted card washes (cream / sage / lavender)
//   success  — LIVE dot + Online·Synced pill
//   brew     — the burnt-orange used for the "Brew" ask-anything wordmark
//
// Typography:
//   sans   — Inter (body + labels)
//   serif  — Playfair Display for the LUMAARA wordmark
//
// The old `brand` alias stays as a violet-free re-export so pages that
// still say `bg-brand-100` don't shatter — it just maps to the new
// gold ramp.
const gold = {
  50: "#FBF6EB",
  100: "#F5EBD1",
  200: "#EAD3A2",
  300: "#DDBB77",
  400: "#D0A657",
  500: "#C09040",
  600: "#A97930",
  700: "#8C6127",
  800: "#6E4A1F",
  900: "#503618",
};

// Semantic tokens reference CSS variables defined in globals.css at
// :root (light) and html.dark (dark). Tailwind's `rgb(var() / <alpha>)`
// syntax lets utilities like `bg-canvas/80` or `border-ink/10` keep
// working transparently across modes. Hex values stay here as the
// *fallback* when the var isn't defined (never in practice — globals.css
// always loads — but defensive).
const ink = {
  DEFAULT: "rgb(var(--ink) / <alpha-value>)",
  soft: "rgb(var(--ink-soft) / <alpha-value>)",
  muted: "rgb(var(--ink-muted) / <alpha-value>)",
  faint: "rgb(var(--ink-faint) / <alpha-value>)",
};

const canvas = {
  DEFAULT: "rgb(var(--canvas) / <alpha-value>)",
  raised: "rgb(var(--canvas-raised) / <alpha-value>)",
  sunken: "rgb(var(--canvas-sunken) / <alpha-value>)",
  warm: "rgb(var(--canvas-warm) / <alpha-value>)",
};

export default {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Canonical Lumaara palette
        canvas,
        ink,
        gold,
        brew: {
          DEFAULT: "#E86A2B",
          soft: "#F9E4D8",
        },
        success: {
          DEFAULT: "#4A9E5C",
          soft: "#DCEEDF",
        },
        // Muted card washes seen in dashboard KPI grid
        wash: {
          cream: "#F7EEDA",
          sage: "#E6EEDF",
          mist: "#E4E8EE",
          rose: "#F1E1DD",
          lilac: "#E9E4EE",
        },
        // Alias so legacy `bg-brand-*` / `text-brand-*` calls still work
        brand: gold,
        // Alias so `bg-surface`/`bg-surface-raised`/`bg-surface-sunken` still work
        surface: canvas,
      },
      boxShadow: {
        card: "0 1px 2px 0 rgba(15,20,32,0.04), 0 1px 3px 0 rgba(15,20,32,0.03)",
        raised: "0 8px 24px -12px rgba(15,20,32,0.18)",
        pill: "0 6px 14px -8px rgba(15,20,32,0.35)",
      },
      backgroundImage: {
        "brand-soft": "linear-gradient(135deg, #FBF7EE 0%, #F5EBD1 100%)",
        "brand-gradient": "linear-gradient(135deg, #C09040 0%, #DDBB77 100%)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(16px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "slide-in-bottom": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        "fade-in": "fade-in 160ms ease-out",
        "slide-in-right": "slide-in-right 220ms cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-in-bottom": "slide-in-bottom 180ms cubic-bezier(0.16, 1, 0.3, 1)",
        "pulse-dot": "pulse-dot 1.6s ease-in-out infinite",
        shimmer: "shimmer 1.6s linear infinite",
      },
      fontFamily: {
        sans: [
          "InterVariable",
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "system-ui",
          "sans-serif",
        ],
        serif: [
          "Playfair Display",
          "Georgia",
          "Cambria",
          "Times New Roman",
          "serif",
        ],
      },
      letterSpacing: {
        wider: "0.06em",
        widest: "0.14em",
      },
      borderRadius: {
        pill: "9999px",
      },
      // Extend Tailwind's opacity scale so `border-ink/8`, `border-ink/12`,
      // etc. compile. Without this, only the default {5, 10, 20, 25, 30, ...}
      // steps are legal.
      opacity: {
        6: "0.06",
        8: "0.08",
        12: "0.12",
        15: "0.15",
      },
    },
  },
  plugins: [],
} satisfies Config;
