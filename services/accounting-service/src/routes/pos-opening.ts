import { Router } from "express";
import { z } from "zod";
import { Prisma, prisma, nextName } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const posOpeningRouter = Router();

const p = perms("POSOpeningEntry");

// Payment-method balances declared by the cashier at session open. Only
// `mode` values that exist on the chosen POSProfile.paymentMethods are
// accepted (checked in the handler). Non-Cash modes should be 0 in practice
// (the drawer holds cash, not cards) but we keep the schema uniform so the
// reconciliation math in POSClosingEntry never has to special-case a mode.
const openingBalanceSchema = z.object({
  mode: z.string().min(1),
  amount: z.coerce.number().nonnegative(),
});

const createSchema = z.object({
  posProfileId: z.string().min(1),
  openingBalances: z.array(openingBalanceSchema).min(1),
  notes: z.string().optional().nullable(),
});

// Strict session enforcement: at most one Open POSOpeningEntry per (tenant,
// user) at any time. Cashiers must close the previous session before opening
// a new one — mirrors ERPNext and prevents ledger drift when someone forgets
// they left a session running.
async function findActiveSessionForUser(
  tenantId: string,
  userId: string,
): Promise<{ id: string; name: string; posProfileId: string } | null> {
  const row = await prisma.pOSOpeningEntry.findFirst({
    where: { tenantId, userId, status: "Open" },
    select: { id: true, name: true, posProfileId: true },
  });
  return row;
}

// Public helper: lets pos-invoices route confirm a checkout is happening
// under an active session before creating the SI + PE.
export async function requireActiveSession(
  tenantId: string,
  userId: string,
  posProfileId: string,
): Promise<{ id: string; name: string }> {
  const active = await prisma.pOSOpeningEntry.findFirst({
    where: { tenantId, userId, posProfileId, status: "Open" },
    select: { id: true, name: true },
  });
  if (!active) {
    throw new Error(
      "No active POS session for this user + profile. Open a session before checkout.",
    );
  }
  return active;
}

posOpeningRouter.get("/", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const rows = await prisma.pOSOpeningEntry.findMany({
    where: {
      tenantId,
      ...(req.query.status ? { status: String(req.query.status) } : {}),
      ...(req.query.mine === "1" ? { userId: req.auth!.userId } : {}),
    },
    include: {
      posProfile: { select: { name: true, title: true } },
      user: { select: { fullName: true, email: true } },
    },
    orderBy: { openTime: "desc" },
    take: 100,
  });
  res.json(rows);
});

// Cashier's active session lookup. UI polls this on load to decide whether
// to show the "Open a session" form or drop straight into the cashier grid.
posOpeningRouter.get("/mine/active", p.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const userId = req.auth!.userId;
  const active = await prisma.pOSOpeningEntry.findFirst({
    where: { tenantId, userId, status: "Open" },
    include: {
      posProfile: {
        include: {
          warehouse: { select: { warehouseName: true } },
          priceList: { select: { name: true, currency: true } },
          defaultCustomer: { select: { customerName: true } },
        },
      },
    },
    orderBy: { openTime: "desc" },
  });
  res.json(active);
});

posOpeningRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.pOSOpeningEntry.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      posProfile: true,
      user: { select: { fullName: true, email: true } },
      closing: true,
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

posOpeningRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;
  const userId = req.auth!.userId;

  // At most one active session per user. Force close of the previous.
  const existing = await findActiveSessionForUser(tenantId, userId);
  if (existing) {
    return res.status(400).json({
      error: `You already have an open session (${existing.name}). Close it first.`,
      activeSessionId: existing.id,
    });
  }

  const profile = await prisma.pOSProfile.findFirst({
    where: { id: parsed.data.posProfileId, tenantId, disabled: false },
    select: { id: true, paymentMethods: true },
  });
  if (!profile) return res.status(400).json({ error: "Invalid or disabled posProfileId" });

  const allowedModes = new Set(
    ((profile.paymentMethods as unknown as { mode: string }[]) ?? []).map((m) => m.mode),
  );
  for (const b of parsed.data.openingBalances) {
    if (!allowedModes.has(b.mode)) {
      return res
        .status(400)
        .json({ error: `openingBalances mode "${b.mode}" not enabled on this profile` });
    }
  }

  // If a mode allowed on the profile isn't in the payload, seed it at 0 so
  // the reconciliation at close can still line up its rows.
  const balances = Array.from(allowedModes).map((mode) => {
    const found = parsed.data.openingBalances.find((b) => b.mode === mode);
    return { mode, amount: found ? found.amount : 0 };
  });

  const name = await nextName(prisma, tenantId, "POS-OPEN-");
  const row = await prisma.pOSOpeningEntry.create({
    data: {
      tenantId,
      name,
      posProfileId: profile.id,
      userId,
      status: "Open",
      openingBalances: balances as unknown as Prisma.InputJsonValue,
      notes: parsed.data.notes ?? null,
    },
    include: {
      posProfile: true,
    },
  });
  res.status(201).json(row);
});
