// Side-effect module. Imported FIRST (before anything that reads
// DATABASE_URL at module load — i.e. @prisma/client via ./index) so
// tests that mutate data run against the dedicated lumaara_test DB
// instead of whatever operators have in .env. Preserves escape hatch
// LUMAARA_RESOLVER_TEST_USE_DEV_DB=1 for the rare case where you
// genuinely want to point at dev.
if (!process.env.LUMAARA_RESOLVER_TEST_USE_DEV_DB) {
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ??
    "postgresql://postgres:postgres@localhost:5432/lumaara_test?schema=public";
}
