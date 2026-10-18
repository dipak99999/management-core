import { Router } from "express";
import { z } from "zod";
import { ACTIONS, DOCTYPES, prisma } from "@lumaara/db";
import { perms, requireAuth } from "@lumaara/service-auth";

export const roleRouter = Router();

// Every endpoint in this file requires auth. Individual routes further gate
// on Role/User permissions.
roleRouter.use(requireAuth);

const rolePerms = perms("Role");
const userPerms = perms("User");

// ---------- Role catalog ----------

// Meta endpoint for the Role Permission Manager UI: enumerable doctypes +
// action verbs. Public within the tenant so any authenticated user can render
// role forms.
roleRouter.get("/meta", (_req, res) => {
  res.json({ doctypes: DOCTYPES, actions: ACTIONS });
});

// List all roles for the current tenant, with permission count per role.
roleRouter.get("/", rolePerms.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const roles = await prisma.role.findMany({
    where: { tenantId },
    orderBy: [{ isSystem: "desc" }, { roleName: "asc" }],
    include: {
      _count: { select: { userRoles: true, permissions: true } },
    },
  });
  res.json(roles);
});

// Role detail + its permission grants.
roleRouter.get("/:id", rolePerms.read, async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const role = await prisma.role.findFirst({
    where: { id: req.params.id, tenantId },
    include: {
      permissions: { orderBy: [{ doctype: "asc" }, { action: "asc" }] },
      userRoles: { include: { user: { select: { id: true, email: true, fullName: true } } } },
    },
  });
  if (!role) return res.status(404).json({ error: "Not found" });
  res.json(role);
});

const createRoleSchema = z.object({
  roleName: z.string().min(2).max(60).regex(/^[A-Za-z0-9 _-]+$/),
});

roleRouter.post("/", rolePerms.create, async (req, res) => {
  const parsed = createRoleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const role = await prisma.role.create({
      data: {
        tenantId: req.auth!.tenantId,
        roleName: parsed.data.roleName,
        isSystem: false,
      },
    });
    res.status(201).json(role);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res.status(409).json({ error: "Role name already exists in this tenant" });
    }
    throw e;
  }
});

roleRouter.delete("/:id", rolePerms.delete, async (req, res) => {
  const role = await prisma.role.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!role) return res.status(404).json({ error: "Not found" });
  if (role.isSystem)
    return res.status(400).json({ error: "System roles cannot be deleted" });
  await prisma.role.delete({ where: { id: role.id } });
  res.status(204).send();
});

// ---------- Role permissions ----------

const permGrantSchema = z.object({
  doctype: z.enum(DOCTYPES as unknown as [string, ...string[]]),
  action: z.enum(ACTIONS as unknown as [string, ...string[]]),
});

// Replace a role's entire permission set. Simpler than per-row grant/revoke
// and matches how the Role Permission Manager UI (grid of checkboxes) will
// submit its state.
const bulkPermsSchema = z.object({
  grants: z.array(permGrantSchema),
});

roleRouter.put("/:id/permissions", rolePerms.write, async (req, res) => {
  const parsed = bulkPermsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const role = await prisma.role.findFirst({ where: { id: req.params.id, tenantId } });
  if (!role) return res.status(404).json({ error: "Not found" });

  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (parsed.data.grants.length > 0) {
      await tx.rolePermission.createMany({
        data: parsed.data.grants.map((g) => ({
          tenantId,
          roleId: role.id,
          doctype: g.doctype,
          action: g.action,
        })),
        skipDuplicates: true,
      });
    }
  });

  const updated = await prisma.role.findFirst({
    where: { id: role.id },
    include: { permissions: { orderBy: [{ doctype: "asc" }, { action: "asc" }] } },
  });
  res.json(updated);
});

// ---------- Users + role assignment ----------

roleRouter.get("/users/list", userPerms.read, async (req, res) => {
  const users = await prisma.user.findMany({
    where: { tenantId: req.auth!.tenantId },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      createdAt: true,
      userRoles: { include: { role: { select: { id: true, roleName: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  res.json(users);
});

const assignRolesSchema = z.object({
  roleIds: z.array(z.string().min(1)),
});

// Replace a user's role set with the given list.
roleRouter.put("/users/:userId/roles", userPerms.write, async (req, res) => {
  const parsed = assignRolesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  const user = await prisma.user.findFirst({
    where: { id: req.params.userId, tenantId },
  });
  if (!user) return res.status(404).json({ error: "User not found" });

  // Validate every role belongs to this tenant.
  if (parsed.data.roleIds.length > 0) {
    const count = await prisma.role.count({
      where: { tenantId, id: { in: parsed.data.roleIds } },
    });
    if (count !== parsed.data.roleIds.length)
      return res.status(400).json({ error: "One or more roles not found in this tenant" });
  }

  await prisma.$transaction(async (tx) => {
    await tx.userRole.deleteMany({ where: { userId: user.id } });
    if (parsed.data.roleIds.length > 0) {
      await tx.userRole.createMany({
        data: parsed.data.roleIds.map((roleId) => ({ userId: user.id, roleId })),
        skipDuplicates: true,
      });
    }
  });

  const updated = await prisma.user.findUnique({
    where: { id: user.id },
    include: { userRoles: { include: { role: true } } },
  });
  res.json(updated);
});
