// Side-effect module. Imported FIRST in src/index.ts so the env is set
// before any downstream module (service-auth, @lumaara/db, tenant-guard)
// reads it at import time. tsx/esbuild hoists imports to the top of the
// file so inline env assignments between imports don't actually run
// before the imports — this file is the escape hatch.
//
// Scheduler IS the designated cross-tenant worker: every scheduled job
// (reorder, loyalty expiry, email sequences, payment reminders, error-
// rate alerts, embedding refresh, etc.) scans across all tenants by
// design. The tenant-guard middleware was built for user-facing routes
// where a missing `tenantId` filter means a data leak — here it just
// generates constant false-positive warnings and would 500 every job
// in enforce mode. Default off UNLESS the operator explicitly set a
// mode for one-off diagnostics.
if (process.env.TENANT_GUARD_MODE === undefined) {
  process.env.TENANT_GUARD_MODE = "off";
}
