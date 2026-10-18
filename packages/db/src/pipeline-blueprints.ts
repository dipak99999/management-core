// Pipeline Blueprints — pure transition validator.
//
// Given a blueprint (stages with requiredFields + allowedNext), a
// record before-image, and a proposed target status, decide whether
// the transition is legal AND every mandatory field on the SOURCE
// stage is populated on the record (we check the source-stage's
// required fields — "you must fill X to leave this stage", per
// Zoho Blueprints semantics).
//
// v1 supports dot-path lookups against the record + record.customData
// (any level of nesting). Missing / null / "" all count as unset.

export interface BlueprintStage {
  stageKey: string;
  requiredFields: string[]; // dot-paths
  allowedNext: string[];
}

export interface BlueprintValidationResult {
  ok: boolean;
  error?: string;
  missingFields: string[];
}

// Resolve dot path against an object. `customData.foo.bar` walks
// record.customData.foo.bar. Returns undefined for any missing segment.
function getPath(record: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = record;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function isUnset(v: unknown): boolean {
  return v == null || v === "";
}

export function validateStageTransition(
  stages: BlueprintStage[],
  currentStatus: string,
  targetStatus: string,
  record: Record<string, unknown>,
): BlueprintValidationResult {
  // Same-state edits (rename, remarks) are always ok — blueprints
  // guard state changes, not field edits.
  if (currentStatus === targetStatus) return { ok: true, missingFields: [] };

  const fromStage = stages.find((s) => s.stageKey === currentStatus);
  if (!fromStage) {
    // Record's current status isn't in the blueprint — treat as legacy
    // and allow the transition (soft off-ramp).
    return { ok: true, missingFields: [] };
  }
  // Terminal check: empty allowedNext means terminal — nothing exits here.
  if (!fromStage.allowedNext.includes(targetStatus)) {
    return {
      ok: false,
      error: `Cannot transition from ${currentStatus} to ${targetStatus}. Allowed: ${fromStage.allowedNext.join(", ") || "(none)"}`,
      missingFields: [],
    };
  }
  // Required-field check — every dot-path in the FROM stage must be
  // populated before the record can leave.
  const missing = fromStage.requiredFields.filter((path) => isUnset(getPath(record, path)));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Cannot leave ${currentStatus}: ${missing.join(", ")} must be set`,
      missingFields: missing,
    };
  }
  return { ok: true, missingFields: [] };
}

// Convenience: pull the active blueprint's stages for a (tenant, doctype).
// Returns [] if no active blueprint. Kept as a plain fn (not a Prisma
// helper) so tests can inject a stub.
export interface BlueprintLookupDb {
  pipelineBlueprint: {
    findFirst(args: {
      where: { tenantId: string; doctype: string; active: boolean };
      include: { stages: true };
    }): Promise<{
      stages: Array<{
        stageKey: string;
        requiredFields: unknown;
        allowedNext: unknown;
      }>;
    } | null>;
  };
}

export async function loadActiveBlueprintStages(
  db: BlueprintLookupDb,
  tenantId: string,
  doctype: string,
): Promise<BlueprintStage[]> {
  const bp = await db.pipelineBlueprint.findFirst({
    where: { tenantId, doctype, active: true },
    include: { stages: true },
  });
  if (!bp) return [];
  return bp.stages.map((s) => ({
    stageKey: s.stageKey,
    requiredFields: Array.isArray(s.requiredFields) ? (s.requiredFields as string[]) : [],
    allowedNext: Array.isArray(s.allowedNext) ? (s.allowedNext as string[]) : [],
  }));
}
