// Consolidated agent bootstrap seed. One command per tenant:
//   pnpm --filter @lumaara/db exec tsx scripts/seed-agent-defaults.ts <tenantSlug>
//
// What it seeds:
//   1. `default` AgentPolicy   — permissive fallback for free-form prompts.
//   2. Reference agent policies (TicketTriage, ARChaser, MonthClose, PurchaseSuggester).
//   3. `LLMRouter` TenantIntegration row pointing at the stub so agents can
//      run out of the box; admin can rotate to a real provider from
//      /admin/integrations without a redeploy.
//
// Idempotent — safe to run repeatedly. Each row uses `upsert`.

import { PrismaClient } from "@prisma/client";
import { encryptSecrets, seedReferenceAgents } from "../src";

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error(
      "Usage: pnpm --filter @lumaara/db exec tsx scripts/seed-agent-defaults.ts <tenantSlug>",
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const tenant = await prisma.tenant.findFirst({ where: { slug } });
    if (!tenant) {
      console.error(`Tenant not found: ${slug}`);
      process.exit(2);
    }

    // 1. Default policy — permissive so a first-time user can just chat.
    //    Every real production tenant should tighten these limits + set a
    //    per-agent policy alongside.
    await prisma.agentPolicy.upsert({
      where: { tenantId_key: { tenantId: tenant.id, key: "default" } },
      create: {
        tenantId: tenant.id,
        key: "default",
        maxStepsPerTask: 25,
        maxCostUsdPerTask: 0.5,
        humanApprovalMode: "Draft",
        allowedDoctypes: [],
        toolAllowlist: [],
        toolDenylist: [],
      },
      update: {},
    });

    // 2. Reference agents (canned recipes wired to the MCP catalog).
    const seeded = await seedReferenceAgents(prisma, tenant.id);
    console.log(`  reference agents seeded: ${seeded.length}`);

    // 3. Default LLMRouter integration — starts on the stub so agents run
    //    out of the box. Admin picks a real provider from /admin/integrations.
    await prisma.tenantIntegration.upsert({
      where: {
        tenantId_provider_name: {
          tenantId: tenant.id,
          provider: "LLMRouter",
          name: "default",
        },
      },
      create: {
        tenantId: tenant.id,
        provider: "LLMRouter",
        name: "default",
        isActive: true,
        isDefault: true,
        config: {},
        secrets: encryptSecrets({ defaultProvider: "stub" }),
      },
      update: {},
    });

    console.log(`✓ agent defaults seeded for tenant '${slug}' (${tenant.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("agent seed failed:", e);
  process.exit(1);
});
