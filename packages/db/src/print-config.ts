import { PrismaClient } from "@prisma/client";

// H1 + H2: helper to resolve which Letterhead + PrintFormat apply to a given
// print request. Precedence:
//   1. explicit id in the request (?letterheadId= / ?formatId=)
//   2. per-doctype default
//   3. tenant-wide default
//   4. null

export interface ResolvedLetterhead {
  id: string;
  name: string;
  logoBase64: string | null;
  addressText: string | null;
  footerText: string | null;
}

export interface ResolvedPrintFormat {
  id: string;
  name: string;
  doctype: string;
  headerText: string | null;
  footerText: string | null;
  thankYouNote: string | null;
  termsText: string | null;
  showItemDescription: boolean;
  showTaxBreakdown: boolean;
  showRemarks: boolean;
  paperSize: string;
  orientation: string;
}

export async function resolveLetterhead(
  prisma: PrismaClient,
  tenantId: string,
  doctype: string,
  explicitId?: string | null,
): Promise<ResolvedLetterhead | null> {
  if (explicitId) {
    const row = await prisma.letterhead.findFirst({
      where: { id: explicitId, tenantId },
    });
    if (row) return pickLh(row);
  }
  // doctype-specific first
  const doctypeMatch = await prisma.letterhead.findFirst({
    where: { tenantId, appliesToDoctypes: { has: doctype } },
    orderBy: { updatedAt: "desc" },
  });
  if (doctypeMatch) return pickLh(doctypeMatch);
  // tenant default
  const def = await prisma.letterhead.findFirst({
    where: { tenantId, isDefault: true },
  });
  return def ? pickLh(def) : null;
}

export async function resolvePrintFormat(
  prisma: PrismaClient,
  tenantId: string,
  doctype: string,
  explicitId?: string | null,
): Promise<ResolvedPrintFormat | null> {
  if (explicitId) {
    const row = await prisma.printFormat.findFirst({
      where: { id: explicitId, tenantId, doctype },
    });
    if (row) return pickPf(row);
  }
  const def = await prisma.printFormat.findFirst({
    where: { tenantId, doctype, isDefault: true },
  });
  return def ? pickPf(def) : null;
}

function pickLh(row: {
  id: string;
  name: string;
  logoBase64: string | null;
  addressText: string | null;
  footerText: string | null;
}): ResolvedLetterhead {
  return {
    id: row.id,
    name: row.name,
    logoBase64: row.logoBase64,
    addressText: row.addressText,
    footerText: row.footerText,
  };
}

function pickPf(row: {
  id: string;
  name: string;
  doctype: string;
  headerText: string | null;
  footerText: string | null;
  thankYouNote: string | null;
  termsText: string | null;
  showItemDescription: boolean;
  showTaxBreakdown: boolean;
  showRemarks: boolean;
  paperSize: string;
  orientation: string;
}): ResolvedPrintFormat {
  return {
    id: row.id,
    name: row.name,
    doctype: row.doctype,
    headerText: row.headerText,
    footerText: row.footerText,
    thankYouNote: row.thankYouNote,
    termsText: row.termsText,
    showItemDescription: row.showItemDescription,
    showTaxBreakdown: row.showTaxBreakdown,
    showRemarks: row.showRemarks,
    paperSize: row.paperSize,
    orientation: row.orientation,
  };
}
