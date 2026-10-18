import { Router } from "express";
import { z } from "zod";
import { Prisma, evaluateComponents, nextName, prisma } from "@lumaara/db";
import { perms } from "@lumaara/service-auth";

export const salaryStructureRouter = Router();

const p = perms("SalaryStructure");

const componentSchema = z.object({
  componentName: z.string().min(1).max(60),
  type: z.enum(["Earning", "Deduction"]),
  amount: z.coerce.number().nonnegative().default(0),
  // Optional formula referencing prior components: "{Basic} * 0.1".
  formula: z.string().max(200).optional().nullable(),
  sortOrder: z.coerce.number().int().default(0),
});

const createSchema = z.object({
  name: z.string().min(2).max(80),
  isActive: z.boolean().default(true),
  description: z.string().optional().nullable(),
  components: z.array(componentSchema).min(1),
});

salaryStructureRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.salaryStructure.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      _count: { select: { components: true, employees: true } },
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  res.json(rows);
});

salaryStructureRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.salaryStructure.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      components: { orderBy: { sortOrder: "asc" } },
      employees: { select: { id: true, employeeCode: true, employeeName: true } },
    },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

salaryStructureRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.salaryStructure.create({
      data: {
        tenantId: req.auth!.tenantId,
        name: parsed.data.name,
        isActive: parsed.data.isActive,
        description: parsed.data.description ?? null,
        components: {
          create: parsed.data.components.map((c, i) => ({
            componentName: c.componentName,
            type: c.type,
            amount: c.amount,
            formula: c.formula ?? null,
            sortOrder: c.sortOrder || i,
          })),
        },
      },
      include: { components: { orderBy: { sortOrder: "asc" } } },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "Salary structure name already exists" });
    }
    throw e;
  }
});

// Bulk-replace components. Follows the same pattern as other bulk editors.
salaryStructureRouter.put("/:id", p.write, async (req, res) => {
  const parsed = createSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.salaryStructure.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const updated = await prisma.$transaction(async (tx) => {
    if (parsed.data.components) {
      await tx.salaryStructureComponent.deleteMany({
        where: { salaryStructureId: existing.id },
      });
      await tx.salaryStructureComponent.createMany({
        data: parsed.data.components.map((c, i) => ({
          salaryStructureId: existing.id,
          componentName: c.componentName,
          type: c.type,
          amount: c.amount,
          formula: c.formula ?? null,
          sortOrder: c.sortOrder || i,
        })),
      });
    }
    return tx.salaryStructure.update({
      where: { id: existing.id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
        ...(parsed.data.description !== undefined
          ? { description: parsed.data.description }
          : {}),
      },
      include: { components: { orderBy: { sortOrder: "asc" } } },
    });
  });
  res.json(updated);
});

salaryStructureRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.salaryStructure.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: { _count: { select: { employees: true } } },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing._count.employees > 0)
    return res.status(400).json({
      error: `Cannot delete: assigned to ${existing._count.employees} employee(s)`,
    });
  await prisma.salaryStructure.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// Generate a Draft SalarySlip for a single employee using either their assigned
// structure or an override structure. Sits alongside the existing bulk-generate
// on the salarySlip router.
const generateSchema = z.object({
  employeeId: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  structureId: z.string().optional(),
});

salaryStructureRouter.post(
  "/generate-slip",
  perms("SalarySlip").create,
  async (req, res) => {
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const tenantId = req.auth!.tenantId;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const emp = await tx.employee.findFirst({
          where: { id: parsed.data.employeeId, tenantId },
        });
        if (!emp) throw new Error("Invalid employee");

        const structureId = parsed.data.structureId ?? emp.salaryStructureId;
        if (!structureId)
          throw new Error(
            "No salary structure — assign one on the employee or pass structureId",
          );

        const struct = await tx.salaryStructure.findFirst({
          where: { id: structureId, tenantId, isActive: true },
          include: { components: { orderBy: { sortOrder: "asc" } } },
        });
        if (!struct) throw new Error("Invalid or inactive salary structure");

        const start = new Date(parsed.data.startDate);
        const end = new Date(parsed.data.endDate);

        // Overlap guard: no two slips per (employee, period).
        const overlap = await tx.salarySlip.findFirst({
          where: {
            tenantId,
            employeeId: emp.id,
            startDate: { lte: end },
            endDate: { gte: start },
          },
          select: { id: true, name: true },
        });
        if (overlap)
          throw new Error(
            `Employee already has a slip (${overlap.name}) overlapping this period`,
          );

        // Evaluate components in sortOrder so formulas can reference earlier
        // (already-computed) components by name.
        const evaluated = evaluateComponents(
          struct.components.map((c) => ({
            componentName: c.componentName,
            type: c.type as "Earning" | "Deduction",
            amount: Number(c.amount),
            formula: c.formula,
          })),
        );

        // Loan EMI auto-deduct — same mechanism as bulk-generate. For
        // every Disbursed loan, inject a "Loan Repayment · <loanName>"
        // deduction sized to the earliest unpaid installment on or
        // before slip.endDate. Slip submit picks these up and marks
        // the installment paid.
        const activeLoans = await tx.loan.findMany({
          where: { tenantId, employeeId: emp.id, status: "Disbursed" },
          include: {
            schedule: {
              where: { isPaid: false, dueDate: { lte: end } },
              orderBy: { installmentNo: "asc" },
              take: 1,
            },
          },
        });
        for (const loan of activeLoans) {
          const inst = loan.schedule[0];
          if (!inst) continue;
          evaluated.push({
            componentName: `Loan Repayment · ${loan.name}`,
            type: "Deduction",
            amount: Number(inst.totalAmount),
          });
        }

        const grossPay = evaluated
          .filter((c) => c.type === "Earning")
          .reduce((s, c) => s.add(c.amount), new Prisma.Decimal(0));
        const totalDeduction = evaluated
          .filter((c) => c.type === "Deduction")
          .reduce((s, c) => s.add(c.amount), new Prisma.Decimal(0));
        const netPay = grossPay.sub(totalDeduction);

        const name = await nextName(tx, tenantId, "SS-");

        const slip = await tx.salarySlip.create({
          data: {
            tenantId,
            name,
            employeeId: emp.id,
            startDate: start,
            endDate: end,
            grossPay,
            totalDeduction,
            netPay,
            status: "Draft",
            components: {
              create: evaluated.map((c) => ({
                componentName: c.componentName,
                type: c.type,
                amount: c.amount,
              })),
            },
          },
          include: { components: true },
        });
        return { salarySlip: slip };
      });
      res.status(201).json(result);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
    }
  },
);
