// Thin re-export shim — canonical implementation now lives in @lumaara/db
// so multiple services can share it. Kept here for backward compat with
// existing imports in this service's routes.

export {
  postGLEntries,
  cancelGLEntries,
  requireTenantDefaults,
  accountForPaymentMode,
} from "@lumaara/db";
export type { GLLine, PostGLParams, TenantDefaults, VoucherType } from "@lumaara/db";
