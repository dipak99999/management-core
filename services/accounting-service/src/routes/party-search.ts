import { Router } from "express";
import { prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

// D15: unified party search across Customer + Supplier + Lead. Matches
// name/email/mobile/GSTIN with a case-insensitive `contains`. Returns a
// single ranked list capped at 30 results. Gated on Customer read (any
// party CRUD role can search).

export const partySearchRouter = Router();

const p = perms("Customer");

partySearchRouter.get("/", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (q.length < 2) return res.json([]);
  const [customers, suppliers, leads] = await Promise.all([
    prisma.customer.findMany({
      where: {
        tenantId,
        OR: [
          { customerName: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { mobile: { contains: q } },
          { gstin: { contains: q } },
        ],
      },
      select: { id: true, customerName: true, email: true, mobile: true },
      take: 15,
    }),
    prisma.supplier.findMany({
      where: {
        tenantId,
        OR: [
          { supplierName: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { mobile: { contains: q } },
          { gstin: { contains: q } },
        ],
      },
      select: { id: true, supplierName: true, email: true, mobile: true },
      take: 15,
    }),
    prisma.lead.findMany({
      where: {
        tenantId,
        OR: [
          { leadName: { contains: q, mode: "insensitive" } },
          { companyName: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { mobile: { contains: q } },
        ],
      },
      select: {
        id: true,
        name: true,
        leadName: true,
        companyName: true,
        email: true,
        mobile: true,
        status: true,
      },
      take: 15,
    }),
  ]);
  const results = [
    ...customers.map((c) => ({
      partyType: "Customer" as const,
      id: c.id,
      label: c.customerName,
      email: c.email,
      mobile: c.mobile,
      href: `/accounting/customers/${c.id}`,
    })),
    ...suppliers.map((s) => ({
      partyType: "Supplier" as const,
      id: s.id,
      label: s.supplierName,
      email: s.email,
      mobile: s.mobile,
      href: `/buying/suppliers/${s.id}`,
    })),
    ...leads.map((l) => ({
      partyType: "Lead" as const,
      id: l.id,
      label: l.companyName ? `${l.leadName} (${l.companyName})` : l.leadName,
      email: l.email,
      mobile: l.mobile,
      href: `/crm/leads/${l.id}`,
      status: l.status,
    })),
  ];
  res.json(results.slice(0, 30));
});
