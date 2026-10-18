import { prisma, seedTenantDefaults } from "../src";
import bcrypt from "bcryptjs";
import { MODULE_REGISTRY } from "@lumaara/shared-types";

// Idempotent tenant seed. Creates two tenants:
//   * acme / admin@acme.test / admin123 — original dev demo
//   * demo / demo@lumaara.local / demo1234 — matches Playwright global-setup
//     so the E2E suite can run against a fresh DB in CI without extra config.
// Both go through seedTenantDefaults which sets up the chart of accounts,
// currencies, and roles (SystemManager gets the admin permission set).
//
// PRODUCTION GUARD: refuses to run when NODE_ENV=production unless the
// operator sets SEED_ALLOW_PRODUCTION=1 explicitly. This prevents an
// accidental `pnpm seed` on a live database from creating two admin
// backdoors with weak passwords (admin123 / demo1234). Real prod tenants
// are created via /auth/signup — never via this script.

function guardProduction(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.SEED_ALLOW_PRODUCTION === "1") {
    // eslint-disable-next-line no-console
    console.warn(
      "[seed] SEED_ALLOW_PRODUCTION=1 in production — proceeding. You are creating weak-passworded admin users.",
    );
    return;
  }
  throw new Error(
    "Refusing to seed in production. Set SEED_ALLOW_PRODUCTION=1 to override — but you almost certainly shouldn't. Create real tenants via /auth/signup.",
  );
}

async function ensureTenant(slug: string, name: string, email: string, password: string) {
  const existing = await prisma.tenant.findUnique({ where: { slug } });
  const tenant =
    existing ??
    (await prisma.$transaction(async (tx) => {
      const t = await tx.tenant.create({ data: { name, slug } });
      await seedTenantDefaults(tx, t.id);
      return t;
    }));

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email } },
    update: {},
    create: {
      tenantId: tenant.id,
      email,
      passwordHash,
      fullName: `${name} Admin`,
      role: "admin",
    },
  });
  console.log(`Seeded ${slug}: ${email} / ${password}`);
}

// Cross-tenant super admin (manages plans + subscriptions for every tenant
// via /admin/super/*). Lives in its own `platform` tenant so it never mixes
// with a business tenant's data, and the header shows "Lumaara Platform"
// instead of a customer name. isSuperAdmin bypasses plan gating, so the
// platform tenant needs no subscription plan.
async function ensureSuperAdmin(tenantSlug: string, email: string, password: string) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: tenantSlug } });
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email } },
    update: { isSuperAdmin: true },
    create: {
      tenantId: tenant.id,
      email,
      passwordHash,
      fullName: "Super Admin",
      role: "admin",
      isSuperAdmin: true,
    },
  });
  console.log(`Seeded super admin (${tenantSlug}): ${email} / ${password}`);
}

// Every module is gated by the tenant's active subscription plan
// (requireModule). Without one, the whole UI shows "plan doesn't include X".
// Give seeded tenants an all-modules plan, derived from the registry so it
// stays complete as modules are added. Re-running refreshes the plan's
// module list; an existing active subscription is left alone.
async function ensureAllModulesPlan(tenantSlug: string) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: tenantSlug } });
  const allowedModules = MODULE_REGISTRY.map((m) => m.key);
  const allowedSubmodules = MODULE_REGISTRY.flatMap((m) => m.submodules.map((s) => s.key));
  const plan = await prisma.subscriptionPlan.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: "Enterprise (All modules)" } },
    update: { allowedModules, allowedSubmodules },
    create: {
      tenantId: tenant.id,
      name: "Enterprise (All modules)",
      tier: "enterprise",
      allowedModules,
      allowedSubmodules,
      isDefault: true,
    },
  });
  const active = await prisma.tenantSubscription.findFirst({
    where: { tenantId: tenant.id, isActive: true },
  });
  if (!active) {
    await prisma.tenantSubscription.create({
      data: { tenantId: tenant.id, planId: plan.id, isActive: true },
    });
  }
  console.log(
    `Seeded plan (${tenantSlug}): ${plan.name} — ${allowedModules.length} modules, ${allowedSubmodules.length} submodules${active ? " (kept existing active subscription)" : ""}`,
  );
}

async function main() {
  guardProduction();
  await ensureTenant("acme", "Acme Inc", "admin@acme.test", "admin123");
  await ensureTenant("demo", "Demo Co", "demo@lumaara.local", "demo1234");
  await ensureTenant("platform", "Lumaara Platform", "superadmin@lumaara.local", "superadmin123");
  await ensureSuperAdmin("platform", "superadmin@lumaara.local", "superadmin123");
  await ensureAllModulesPlan("acme");
  await ensureAllModulesPlan("demo");
}

main().finally(() => prisma.$disconnect());
