// Quality Inspection — pure helpers for the two decisions the QI route
// consistently gets wrong:
//   1. `overallStatus` was client-controlled → an inspector could submit
//      readings marked Rejected but `overallStatus = "Accepted"`, then the
//      PR/DN guard would happily wave the item through. `deriveOverallStatus`
//      makes the derivation authoritative on the server.
//   2. Templates carry a canonical parameter list; when a QI is created from
//      a template with no readings supplied, we should seed one reading row
//      per template parameter so the inspector has a checklist ready to
//      fill instead of an empty grid. `mergeReadingsFromTemplate` handles
//      this + preserves any partial readings the caller sent.

export type QIStatus = "Accepted" | "Rejected";

export interface QIReadingLike {
  parameter: string;
  acceptanceCriteria?: string | null;
  reading?: string | null;
  status: string;               // "Accepted" | "Rejected"
}

export interface QITemplateParamLike {
  parameter: string;
  acceptanceCriteria?: string | null;
  sortOrder?: number;
}

/**
 * Overall = "Rejected" if ANY reading is Rejected. Otherwise "Accepted".
 *
 * Empty readings → "Accepted" (matches the API's default before we had a
 * derivation rule — inspection-with-no-readings is still a valid, if
 * unusual, doc; e.g. visual-only sign-off).
 *
 * Case-insensitive on the reading's `status` string — the enum was widened
 * to a string in Prisma over time and legacy rows could contain lowercase
 * or trimmed variants.
 */
export function deriveOverallStatus(readings: QIReadingLike[]): QIStatus {
  for (const r of readings) {
    if (String(r.status ?? "").trim().toLowerCase() === "rejected") return "Rejected";
  }
  return "Accepted";
}

/**
 * Merge caller-supplied readings with a template's parameter list.
 *
 * Rules:
 *   - Every template parameter appears once in the output, in sortOrder.
 *   - When the caller supplied a reading with the same `parameter` name,
 *     that reading's `reading` + `status` are preserved; the template's
 *     `acceptanceCriteria` is stamped (source of truth is the template).
 *   - Caller-only parameters (not in the template) are appended after the
 *     template parameters, in the order they were supplied.
 *   - Default status for a fresh template row is "Accepted" — matches
 *     ERPNext's "assume pass until inspector marks otherwise" UX.
 */
export function mergeReadingsFromTemplate(
  templateParams: QITemplateParamLike[],
  supplied: QIReadingLike[],
): QIReadingLike[] {
  const byName = new Map(supplied.map((r) => [r.parameter, r]));
  const seen = new Set<string>();
  const sortedTemplate = [...templateParams].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );

  const out: QIReadingLike[] = [];
  for (const p of sortedTemplate) {
    seen.add(p.parameter);
    const existing = byName.get(p.parameter);
    out.push({
      parameter: p.parameter,
      acceptanceCriteria: p.acceptanceCriteria ?? null,
      reading: existing?.reading ?? null,
      status:
        existing?.status && normalizeQIStatus(existing.status) === "Rejected"
          ? "Rejected"
          : (existing?.status ?? "Accepted"),
    });
  }
  for (const r of supplied) {
    if (seen.has(r.parameter)) continue;
    out.push({
      parameter: r.parameter,
      acceptanceCriteria: r.acceptanceCriteria ?? null,
      reading: r.reading ?? null,
      status: normalizeQIStatus(r.status),
    });
  }
  return out;
}

function normalizeQIStatus(s: string): QIStatus {
  return String(s).trim().toLowerCase() === "rejected" ? "Rejected" : "Accepted";
}
