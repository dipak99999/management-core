// Re-export from @lumaara/shared-types so the source of truth stays in
// one place (browser-safe, no Prisma deps). Kept here for backward compat
// with any existing `import ... from "@lumaara/db"` callsites — the
// catalog was originally hosted in this package.
export {
  INTEGRATION_CATALOG,
  catalogFor,
} from "@lumaara/shared-types";
export type {
  ProviderSlug,
  ProviderSpec,
  SecretField,
} from "@lumaara/shared-types";
