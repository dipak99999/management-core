// Embedding refresh tick.
//
// Runs every N minutes. For every tenant, walks its stale=true
// Embedding rows (bounded per tick), calls the tenant's configured
// embedding provider, and writes the vector back.
//
// Provider resolution: the tenant sets a TenantIntegration with
// provider="EmbeddingProvider" whose secrets bag matches
// embeddingProviderFromSecrets(). Missing / stub → tick skips (no
// vectors generated but rows remain stale for the next tick with real
// creds).

import {
  contentHash,
  decryptSecrets,
  embeddingProviderFromSecrets,
  prisma,
} from "@lumaara/db";

export interface EmbeddingRefreshResult {
  tenantsScanned: number;
  rowsEmbedded: number;
  rowsSkipped: number;
  errors: number;
}

const MAX_PER_TENANT_PER_TICK = 100; // hard cap to keep the tick short

export async function runEmbeddingRefreshTick(): Promise<EmbeddingRefreshResult> {
  const staleGrouped = await prisma.embedding.groupBy({
    by: ["tenantId"],
    where: { stale: true },
    _count: { _all: true },
  });

  let embedded = 0;
  let skipped = 0;
  let errors = 0;

  for (const group of staleGrouped) {
    const tenantId = group.tenantId;
    const integration = await prisma.tenantIntegration.findFirst({
      where: { tenantId, provider: "EmbeddingProvider", isActive: true },
    });
    if (!integration) {
      // No embedding config — leave rows stale; next tick after config lands.
      skipped += group._count._all;
      continue;
    }
    let provider;
    try {
      const secrets = decryptSecrets(integration.secrets) as Record<string, unknown>;
      provider = embeddingProviderFromSecrets(secrets);
    } catch {
      errors++;
      continue;
    }
    const rows = await prisma.embedding.findMany({
      where: { tenantId, stale: true },
      orderBy: { updatedAt: "asc" },
      take: MAX_PER_TENANT_PER_TICK,
    });
    for (const row of rows) {
      try {
        const nowHash = contentHash(row.content);
        if (nowHash === row.contentHash && row.vectorLength > 0) {
          // Content hasn't changed since a previous embed — just clear stale.
          await prisma.embedding.update({
            where: { id: row.id },
            data: { stale: false },
          });
          skipped++;
          continue;
        }
        const result = await provider.embed(row.content);
        await prisma.embedding.update({
          where: { id: row.id },
          data: {
            vector: result.vector,
            vectorLength: result.vector.length,
            provider: result.provider,
            model: result.model,
            contentHash: nowHash,
            stale: false,
            embeddedAt: new Date(),
          },
        });
        embedded++;
      } catch {
        errors++;
      }
    }
  }

  return {
    tenantsScanned: staleGrouped.length,
    rowsEmbedded: embedded,
    rowsSkipped: skipped,
    errors,
  };
}
