// Shared ESLint flat config for every @lumaara/*-web Next.js app.
//
// Each app's eslint.config.mjs is just:
//
//   import config from "@lumaara/eslint-config-web";
//   export default config;
//
// Rule choices are codified here so a cross-cutting lint policy change
// (new rule enabled, old rule turned off) is a one-liner — not an 8-way
// edit across apps that always drift out of sync.
//
// Rule policy:
//
//   • Rules that fire on legitimate microfrontend patterns are OFF.
//     The staff-apps are microfrontends behind a Shell host; cross-app
//     navigation uses window.location, cross-module links are plain <a>.
//     These aren't bugs we want to nudge toward "the Next.js way" —
//     they're deliberate architecture.
//
//   • React Compiler strictness rules are OFF. The team hasn't adopted
//     the Compiler; these rules flag non-bugs that would need an
//     end-to-end refactor pass to fix. Flipped back on in a dedicated
//     Compiler-adoption effort.
//
//   • Real-bug rules (exhaustive-deps, no-unused-vars) stay as "warn".
//     These are the ones the CI ratchet caps per app so new offenders
//     fail the build.

import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  // next.config.js is CJS (`require()` is correct there); the service
  // worker is auto-generated. Nothing in these needs linting.
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "**/*.d.ts",
      "next.config.js",
      "public/sw.js",
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Curly-quotes/apostrophes in copy — not worth the escape noise.
      "react/no-unescaped-entities": "off",

      // Standard underscore-prefix opt-out for intentionally-unused
      // vars/args. `_foo` reads as "I know; I need to keep the shape
      // but don't want to use it". Without this the rule flags every
      // "destructure the prop but ignore it" and "catch (e)" sort of
      // case, which bloats the warning count with low-signal entries.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],

      // Microfrontend navigation: window.location.href is deliberate for
      // cross-app jumps (Next's router.push can't cross module boundaries).
      "@next/next/no-location-assign-relative-destination": "off",
      // `<Link>` doesn't cross microfrontend boundaries — plain `<a>` is
      // the correct choice for cross-app navigation.
      "@next/next/no-html-link-for-pages": "off",

      // React 19 experimental: fires on legit sync-after-fetch patterns
      // (populate form from API, sync DOM class from localStorage).
      // Too noisy to be useful signal; disabled across the staff apps.
      "react-hooks/set-state-in-effect": "off",

      // React Compiler strictness family — these flag code the Compiler
      // can't auto-memoize, NOT runtime bugs. Turn on when the team
      // adopts the Compiler and sweep the backlog in one go.
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/use-memo": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/static-components": "off",
      "react-hooks/immutability": "off",
    },
  },
];

export default config;
