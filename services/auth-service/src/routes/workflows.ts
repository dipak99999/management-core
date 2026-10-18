import { Router } from "express";
import { z } from "zod";
import {
  WORKFLOW_DOCTYPES,
  applyWorkflowTransition,
  availableActions,
  prisma,
} from "@lumaara/db";
import { perms, requireAuth } from "@lumaara/service-auth";

export const workflowRouter = Router();

// Every endpoint requires auth. Individual routes further gate on Workflow perms.
workflowRouter.use(requireAuth);

const wfPerms = perms("Workflow");

// ---------- Meta ----------

// Enumerable list of doctypes that can be gated by a workflow. Used by the
// workflow editor form to render the doctype dropdown.
workflowRouter.get("/meta", (_req, res) => {
  res.json({ doctypes: WORKFLOW_DOCTYPES });
});

// ---------- Workflow CRUD ----------

workflowRouter.get("/", wfPerms.read, async (req, res) => {
  const workflows = await prisma.workflow.findMany({
    where: { tenantId: req.auth!.tenantId },
    include: {
      _count: { select: { states: true, transitions: true } },
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  res.json(workflows);
});

workflowRouter.get("/:id", wfPerms.read, async (req, res) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    include: {
      states: { orderBy: { sortOrder: "asc" } },
      transitions: true,
    },
  });
  if (!workflow) return res.status(404).json({ error: "Not found" });
  res.json(workflow);
});

const createSchema = z.object({
  name: z.string().min(2).max(60),
  doctype: z.enum(WORKFLOW_DOCTYPES as unknown as [string, ...string[]]),
});

workflowRouter.post("/", wfPerms.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const workflow = await prisma.workflow.create({
      data: {
        tenantId: req.auth!.tenantId,
        name: parsed.data.name,
        doctype: parsed.data.doctype,
        isActive: false,
      },
    });
    res.status(201).json(workflow);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "Workflow name already exists in this tenant" });
    }
    throw e;
  }
});

const updateSchema = z.object({
  name: z.string().min(2).max(60).optional(),
  isActive: z.boolean().optional(),
});

// Update workflow meta (name, isActive). Enforces "at most one active
// workflow per doctype" — activating this one deactivates any other active
// workflow on the same doctype.
workflowRouter.put("/:id", wfPerms.write, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const existing = await prisma.workflow.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });

  const updated = await prisma.$transaction(async (tx) => {
    if (parsed.data.isActive === true && !existing.isActive) {
      await tx.workflow.updateMany({
        where: { tenantId, doctype: existing.doctype, isActive: true, NOT: { id: existing.id } },
        data: { isActive: false },
      });
    }
    return tx.workflow.update({
      where: { id: existing.id },
      data: parsed.data,
    });
  });
  res.json(updated);
});

workflowRouter.delete("/:id", wfPerms.delete, async (req, res) => {
  const workflow = await prisma.workflow.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!workflow) return res.status(404).json({ error: "Not found" });
  await prisma.workflow.delete({ where: { id: workflow.id } });
  res.status(204).send();
});

// ---------- States (bulk replace) ----------

const stateSchema = z.object({
  stateName: z.string().min(1).max(60),
  docStatus: z.coerce.number().int().min(0).max(2).default(0),
  style: z.string().max(80).optional().nullable(),
  sortOrder: z.coerce.number().int().default(0),
});

const bulkStatesSchema = z.object({
  states: z.array(stateSchema),
});

workflowRouter.put("/:id/states", wfPerms.write, async (req, res) => {
  const parsed = bulkStatesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const workflow = await prisma.workflow.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!workflow) return res.status(404).json({ error: "Not found" });

  const names = new Set(parsed.data.states.map((s) => s.stateName));
  if (names.size !== parsed.data.states.length)
    return res.status(400).json({ error: "Duplicate state names" });

  await prisma.$transaction(async (tx) => {
    await tx.workflowState.deleteMany({ where: { workflowId: workflow.id } });
    if (parsed.data.states.length > 0) {
      await tx.workflowState.createMany({
        data: parsed.data.states.map((s) => ({ ...s, workflowId: workflow.id })),
      });
    }
    // Drop any transitions that reference states we no longer have.
    await tx.workflowTransition.deleteMany({
      where: {
        workflowId: workflow.id,
        OR: [
          { fromState: { notIn: [...names] } },
          { toState: { notIn: [...names] } },
        ],
      },
    });
  });

  const updated = await prisma.workflow.findFirst({
    where: { id: workflow.id },
    include: {
      states: { orderBy: { sortOrder: "asc" } },
      transitions: true,
    },
  });
  res.json(updated);
});

// ---------- Transitions (bulk replace) ----------

const transitionSchema = z.object({
  fromState: z.string().min(1),
  actionLabel: z.string().min(1).max(60),
  toState: z.string().min(1),
  allowedRoles: z.array(z.string()).default([]),
});

const bulkTransitionsSchema = z.object({
  transitions: z.array(transitionSchema),
});

workflowRouter.put("/:id/transitions", wfPerms.write, async (req, res) => {
  const parsed = bulkTransitionsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const workflow = await prisma.workflow.findFirst({
    where: { id: req.params.id, tenantId },
    include: { states: true },
  });
  if (!workflow) return res.status(404).json({ error: "Not found" });

  const stateNames = new Set(workflow.states.map((s) => s.stateName));
  for (const t of parsed.data.transitions) {
    if (!stateNames.has(t.fromState))
      return res.status(400).json({ error: `Unknown fromState: ${t.fromState}` });
    if (!stateNames.has(t.toState))
      return res.status(400).json({ error: `Unknown toState: ${t.toState}` });
  }

  await prisma.$transaction(async (tx) => {
    await tx.workflowTransition.deleteMany({ where: { workflowId: workflow.id } });
    if (parsed.data.transitions.length > 0) {
      await tx.workflowTransition.createMany({
        data: parsed.data.transitions.map((t) => ({ ...t, workflowId: workflow.id })),
      });
    }
  });

  const updated = await prisma.workflow.findFirst({
    where: { id: workflow.id },
    include: {
      states: { orderBy: { sortOrder: "asc" } },
      transitions: true,
    },
  });
  res.json(updated);
});

// ---------- Runtime: available actions + apply ----------
//
// These endpoints are called by every service's detail pages (via the shell
// or directly). They only require the user to be authenticated — the apply
// endpoint enforces the workflow's own role gating.

workflowRouter.get("/for/:doctype/:docId/actions", async (req, res) => {
  const { doctype, docId } = req.params;
  try {
    const result = await availableActions(prisma, {
      tenantId: req.auth!.tenantId,
      doctype,
      docId,
      userRoles: req.auth!.roles,
      isSystemManager:
        req.auth!.roles.includes("SystemManager") || req.auth!.role === "admin",
    });
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

const applySchema = z.object({
  doctype: z.string(),
  docId: z.string(),
  action: z.string(),
});

workflowRouter.post("/apply", async (req, res) => {
  const parsed = applySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const result = await applyWorkflowTransition(prisma, {
      tenantId: req.auth!.tenantId,
      doctype: parsed.data.doctype,
      docId: parsed.data.docId,
      action: parsed.data.action,
      userRoles: req.auth!.roles,
      isSystemManager:
        req.auth!.roles.includes("SystemManager") || req.auth!.role === "admin",
    });
    res.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    res.status(msg === "Document not found" ? 404 : 400).json({ error: msg });
  }
});
