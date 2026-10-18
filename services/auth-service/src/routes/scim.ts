// SCIM 2.0 provisioning surface (RFC 7643 + RFC 7644).
//
// Mounted at /scim/v2. Authentication is by a dedicated ScimToken (NOT
// a JWT) stored in the DB — identity providers (Okta, Azure AD, Google
// Workspace, JumpCloud) paste the raw token into their SCIM connector
// screen and we identify the tenant by the token hash.
//
// Scope: v1 implements the Users resource (list, get, create, replace,
// patch, delete) + ServiceProviderConfig + ResourceTypes + Schemas.
// Groups are deferred — most IdPs can live without role sync by using
// SCIM's "active" flag to deactivate users individually. Add Groups
// when the first customer asks for group→role mapping.
//
// RFC compliance notes:
//   - Create → 201 with Location header, full resource body
//   - PATCH operations supported: "replace", "add", "remove"
//   - PATCH path: dotted (name.givenName) + bracketed emails[type eq "work"]
//   - Soft delete via active=false is preferred; hard delete returns 204
//   - List pagination: ?startIndex=1&count=100 (1-indexed per spec)
//   - Error envelope: schemas[], detail, status
//
// SCIM "username" ⇔ Lumaara User.email (same lifecycle, same uniqueness).

import { Router, type Request, type Response, type NextFunction } from "express";
import { createHash } from "node:crypto";
import { prisma } from "@lumaara/db";

export const scimRouter = Router();

// Patch request type-narrowing helpers
interface ScimPatchOp {
  op: "add" | "replace" | "remove" | "Add" | "Replace" | "Remove";
  path?: string;
  value?: unknown;
}

interface ScimAuthContext {
  tenantId: string;
  tokenId: string;
  defaultRole: string;
}
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      scim?: ScimAuthContext;
    }
  }
}

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

// SCIM content-type is application/scim+json by spec. Many IdPs also send
// application/json; accept both to avoid provider interop bugs. Response
// Content-Type is set per-handler via res.type().
function scimError(res: Response, status: number, detail: string, scimType?: string) {
  res.status(status).type("application/scim+json").json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    detail,
    status: String(status),
    ...(scimType ? { scimType } : {}),
  });
}

// Bearer-token auth. Fast-path: sha256 the raw token, look it up, cache
// the tenantId on req.scim. Keep this cheap — SCIM providers burst a lot
// of calls during initial sync.
async function requireScimAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    return scimError(res, 401, "Missing Bearer token");
  }
  const raw = header.slice(7);
  const row = await prisma.scimToken.findUnique({
    where: { tokenHash: sha256(raw) },
    select: { id: true, tenantId: true, revokedAt: true, defaultRole: true },
  });
  if (!row || row.revokedAt) {
    return scimError(res, 401, "Invalid or revoked SCIM token");
  }
  req.scim = {
    tenantId: row.tenantId,
    tokenId: row.id,
    defaultRole: row.defaultRole,
  };
  // Best-effort touch — don't block the SCIM request on a stat update.
  void prisma.scimToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  next();
}

scimRouter.use(requireScimAuth);

// ── User <-> SCIM representation ──────────────────────────────────────

interface ScimUser {
  schemas: string[];
  id: string;
  externalId?: string | null;
  userName: string;
  name: {
    formatted?: string;
    givenName?: string;
    familyName?: string;
  };
  displayName?: string;
  emails: Array<{ value: string; primary: boolean; type?: string }>;
  active: boolean;
  meta: {
    resourceType: "User";
    created: string;
    lastModified: string;
    location: string;
  };
}

type UserRow = {
  id: string;
  email: string;
  fullName: string;
  active: boolean;
  externalId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toScimUser(u: UserRow, base: string): ScimUser {
  const parts = (u.fullName ?? "").trim().split(/\s+/);
  const given = parts.length > 1 ? parts[0] : u.fullName ?? "";
  const family = parts.length > 1 ? parts.slice(1).join(" ") : "";
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: u.id,
    externalId: u.externalId ?? undefined,
    userName: u.email,
    name: { formatted: u.fullName, givenName: given, familyName: family },
    displayName: u.fullName,
    emails: [{ value: u.email, primary: true, type: "work" }],
    active: u.active,
    meta: {
      resourceType: "User",
      created: u.createdAt.toISOString(),
      lastModified: u.updatedAt.toISOString(),
      location: `${base}/Users/${u.id}`,
    },
  };
}

function baseUrl(req: Request): string {
  const proto = (req.header("x-forwarded-proto") ?? "http").split(",")[0].trim();
  const host = req.header("x-forwarded-host") ?? req.header("host") ?? "localhost";
  return `${proto}://${host}/scim/v2`;
}

// Extract email + name from a SCIM payload. IdPs vary: Okta sends
// name.givenName/familyName, Azure sends name.formatted + displayName.
// Fall back through a sensible chain so we accept all three.
interface ScimUserInput {
  userName?: unknown;
  emails?: unknown;
  name?: unknown;
  displayName?: unknown;
  externalId?: unknown;
  active?: unknown;
  password?: unknown;
}
function extractEmail(body: ScimUserInput): string | null {
  if (typeof body.userName === "string" && body.userName.includes("@")) return body.userName;
  if (Array.isArray(body.emails)) {
    const primary = body.emails.find(
      (e) => typeof (e as { primary?: unknown }).primary !== "undefined" && (e as { primary?: unknown }).primary === true,
    ) as { value?: unknown } | undefined;
    if (primary && typeof primary.value === "string") return primary.value;
    const first = body.emails[0] as { value?: unknown } | undefined;
    if (first && typeof first.value === "string") return first.value;
  }
  return null;
}
function extractFullName(body: ScimUserInput): string | null {
  const n = body.name as Record<string, unknown> | undefined;
  if (n && typeof n.formatted === "string" && n.formatted.trim()) return n.formatted.trim();
  if (n && (typeof n.givenName === "string" || typeof n.familyName === "string")) {
    return `${(n.givenName as string | undefined) ?? ""} ${(n.familyName as string | undefined) ?? ""}`.trim() || null;
  }
  if (typeof body.displayName === "string" && body.displayName.trim()) return body.displayName.trim();
  return null;
}

// ── Service-provider metadata (spec-mandated discovery endpoints) ─────

// Max operations per /Bulk call. Deliberately conservative — large bulks
// become transaction + fd pressure. IdPs typically batch 100 at a time.
const BULK_MAX_OPS = 100;
// Max payload the parser will accept. express.json already caps overall
// request body size (25mb); this is the SCIM-advertised limit for the
// IdP's benefit.
const BULK_MAX_BYTES = 1_000_000; // 1 MB

scimRouter.get("/ServiceProviderConfig", (_req, res) => {
  res.type("application/scim+json").json({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    patch: { supported: true },
    bulk: { supported: true, maxOperations: BULK_MAX_OPS, maxPayloadSize: BULK_MAX_BYTES },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "OAuth Bearer Token",
        description: "Bearer token issued per-tenant in Settings → SCIM Tokens",
      },
    ],
  });
});

scimRouter.get("/ResourceTypes", (req, res) => {
  const base = baseUrl(req);
  res.type("application/scim+json").json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: 2,
    Resources: [
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
        id: "User",
        name: "User",
        endpoint: "/Users",
        description: "Lumaara workspace user",
        schema: "urn:ietf:params:scim:schemas:core:2.0:User",
        meta: { location: `${base}/ResourceTypes/User`, resourceType: "ResourceType" },
      },
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
        id: "Group",
        name: "Group",
        endpoint: "/Groups",
        description: "Lumaara role (user group) — members are tenant users",
        schema: "urn:ietf:params:scim:schemas:core:2.0:Group",
        meta: { location: `${base}/ResourceTypes/Group`, resourceType: "ResourceType" },
      },
    ],
  });
});

scimRouter.get("/Schemas", (_req, res) => {
  res.type("application/scim+json").json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: 1,
    Resources: [
      {
        id: "urn:ietf:params:scim:schemas:core:2.0:User",
        name: "User",
        description: "Core User",
        attributes: [
          { name: "userName",    type: "string",  required: true, uniqueness: "server" },
          { name: "name",        type: "complex", required: false },
          { name: "displayName", type: "string",  required: false },
          { name: "emails",      type: "complex", multiValued: true, required: true },
          { name: "active",      type: "boolean", required: false },
          { name: "externalId",  type: "string",  required: false },
        ],
      },
    ],
  });
});

// ── Users ─────────────────────────────────────────────────────────────

// SCIM filter — RFC 7644 Section 3.4.2.2.
//
// Supported operators (per spec):
//   eq ne co sw ew pr gt ge lt le
// Supported logic:
//   and or (no grouping with parens — IdPs don't actually use parens in
//   provisioning filters; we parse left-to-right)
//
// Attribute mapping is tenant-safe: only the attributes we whitelist
// below can be filtered, so no `password eq "..."` style exfiltration.

type FilterLeaf = {
  attr: keyof typeof FILTER_ATTR_MAP;
  op: "eq" | "ne" | "co" | "sw" | "ew" | "pr" | "gt" | "ge" | "lt" | "le";
  value?: string;
};
type FilterExpr = { logic: "and" | "or"; terms: Array<FilterLeaf | FilterExpr> } | FilterLeaf;

const FILTER_ATTR_MAP = {
  username:   "email",
  externalid: "externalId",
  active:     "active",
  displayname:"fullName",
  "emails.value": "email",
} as const;

// Tokenise + build a left-to-right expression tree (no precedence beyond
// strict left-to-right because IdPs don't send grouped filters).
function tokenise(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (c === '"') {
      const end = src.indexOf('"', i + 1);
      if (end === -1) throw new Error("Unterminated string");
      out.push(src.slice(i, end + 1));
      i = end + 1;
      continue;
    }
    // Word: letters, digits, dot
    let j = i;
    while (j < src.length && /[A-Za-z0-9._]/.test(src[j])) j++;
    if (j === i) throw new Error(`Unexpected char at ${i}`);
    out.push(src.slice(i, j));
    i = j;
  }
  return out;
}

function parseFilter(src: string | undefined): FilterExpr | null {
  if (!src) return { logic: "and", terms: [] };
  let toks: string[];
  try { toks = tokenise(src); } catch { return null; }
  if (toks.length === 0) return { logic: "and", terms: [] };

  // Build leaves + join words (and/or) between them.
  const leaves: Array<{ leaf: FilterLeaf; logic?: "and" | "or" }> = [];
  let i = 0;
  while (i < toks.length) {
    const attr = toks[i]?.toLowerCase();
    if (!(attr in FILTER_ATTR_MAP)) return null; // reject unknown attribute
    const op = toks[i + 1]?.toLowerCase();
    if (op === "pr") {
      leaves.push({ leaf: { attr: attr as keyof typeof FILTER_ATTR_MAP, op: "pr" } });
      i += 2;
    } else {
      const valTok = toks[i + 2];
      if (!op || !valTok) return null;
      if (!["eq","ne","co","sw","ew","gt","ge","lt","le"].includes(op)) return null;
      // value is "..." (string literal) — strip quotes
      const value = valTok.startsWith('"') ? valTok.slice(1, -1) : valTok;
      leaves.push({ leaf: { attr: attr as keyof typeof FILTER_ATTR_MAP, op: op as FilterLeaf["op"], value } });
      i += 3;
    }
    // Expect "and"/"or" or EOF
    if (i < toks.length) {
      const next = toks[i]?.toLowerCase();
      if (next !== "and" && next !== "or") return null;
      leaves[leaves.length - 1].logic = next as "and" | "or";
      i += 1;
    }
  }

  // If all joins are the same ("and" or "or"), collapse into one node.
  // Mixed and+or defaults to left-associative AND tree (matches most IdP
  // provisioning filter shapes).
  if (leaves.length === 1) return leaves[0].leaf;
  const joins = leaves.slice(0, -1).map((l) => l.logic ?? "and");
  const anyOr = joins.includes("or");
  return {
    logic: anyOr ? "or" : "and",
    terms: leaves.map((l) => l.leaf),
  };
}

function leafToPrisma(leaf: FilterLeaf): Record<string, unknown> | null {
  const col = FILTER_ATTR_MAP[leaf.attr];
  const v = leaf.value;
  // Boolean coercion for `active`
  const typed: unknown = col === "active" && typeof v === "string"
    ? v === "true"
    : v;
  switch (leaf.op) {
    case "eq": return { [col]: typed };
    case "ne": return { [col]: { not: typed } };
    case "co": return { [col]: { contains: v, mode: "insensitive" } };
    case "sw": return { [col]: { startsWith: v, mode: "insensitive" } };
    case "ew": return { [col]: { endsWith: v, mode: "insensitive" } };
    case "pr": return { [col]: { not: null } };
    case "gt": return { [col]: { gt: typed } };
    case "ge": return { [col]: { gte: typed } };
    case "lt": return { [col]: { lt: typed } };
    case "le": return { [col]: { lte: typed } };
  }
}

function exprToPrisma(expr: FilterExpr): Record<string, unknown> {
  if ("attr" in expr) return leafToPrisma(expr) ?? {};
  const terms = expr.terms.map((t) => "attr" in t ? leafToPrisma(t) ?? {} : exprToPrisma(t));
  return expr.logic === "or" ? { OR: terms } : { AND: terms };
}

scimRouter.get("/Users", async (req, res) => {
  const tenantId = req.scim!.tenantId;
  const startIndex = Math.max(1, parseInt(String(req.query.startIndex ?? "1"), 10) || 1);
  const count = Math.min(200, Math.max(0, parseInt(String(req.query.count ?? "100"), 10) || 100));
  const filter = typeof req.query.filter === "string" ? req.query.filter : undefined;

  const parsed = parseFilter(filter);
  if (parsed === null) {
    return scimError(res, 400, `Unsupported filter: ${filter}`, "invalidFilter");
  }
  const filterWhere = exprToPrisma(parsed);
  const where: Record<string, unknown> = { tenantId, ...filterWhere };

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: startIndex - 1,
      take: count,
      select: { id: true, email: true, fullName: true, active: true, externalId: true, createdAt: true, updatedAt: true },
    }),
  ]);

  const base = baseUrl(req);
  res.type("application/scim+json").json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: total,
    startIndex,
    itemsPerPage: rows.length,
    Resources: rows.map((r) => toScimUser(r, base)),
  });
});

scimRouter.get("/Users/:id", async (req, res) => {
  const tenantId = req.scim!.tenantId;
  const u = await prisma.user.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true, email: true, fullName: true, active: true, externalId: true, createdAt: true, updatedAt: true },
  });
  if (!u) return scimError(res, 404, "User not found");
  res.type("application/scim+json").json(toScimUser(u, baseUrl(req)));
});

scimRouter.post("/Users", async (req, res) => {
  const tenantId = req.scim!.tenantId;
  const body = (req.body ?? {}) as ScimUserInput;
  const email = extractEmail(body);
  if (!email) return scimError(res, 400, "userName or primary emails[] required", "invalidValue");
  const fullName = extractFullName(body) ?? email.split("@")[0];
  const externalId = typeof body.externalId === "string" ? body.externalId : null;
  const active = typeof body.active === "boolean" ? body.active : true;

  // Conflict check — SCIM 409 is the right response for duplicate userName.
  const existing = await prisma.user.findFirst({
    where: { tenantId, email },
    select: { id: true },
  });
  if (existing) return scimError(res, 409, `User with userName ${email} already exists`, "uniqueness");

  // Password is intentionally random — IdP-provisioned users log in via
  // SSO (or ask-for-reset) and never see the field.
  const randomPwd = createHash("sha256").update(`${Date.now()}-${Math.random()}`).digest("hex");
  const created = await prisma.user.create({
    data: {
      tenantId,
      email,
      fullName,
      role: req.scim!.defaultRole,
      passwordHash: randomPwd, // placeholder — overwritten on first password reset
      active,
      externalId,
      deactivatedAt: active ? null : new Date(),
    },
    select: { id: true, email: true, fullName: true, active: true, externalId: true, createdAt: true, updatedAt: true },
  });
  const base = baseUrl(req);
  res
    .status(201)
    .type("application/scim+json")
    .set("Location", `${base}/Users/${created.id}`)
    .json(toScimUser(created, base));
});

scimRouter.put("/Users/:id", async (req, res) => {
  const tenantId = req.scim!.tenantId;
  const existing = await prisma.user.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return scimError(res, 404, "User not found");

  const body = (req.body ?? {}) as ScimUserInput;
  const email = extractEmail(body);
  if (!email) return scimError(res, 400, "userName or primary emails[] required", "invalidValue");
  const fullName = extractFullName(body) ?? existing.fullName;
  const externalId = typeof body.externalId === "string" ? body.externalId : null;
  const active = typeof body.active === "boolean" ? body.active : existing.active;

  const updated = await prisma.user.update({
    where: { id: existing.id },
    data: {
      email,
      fullName,
      externalId,
      active,
      deactivatedAt: active ? null : existing.deactivatedAt ?? new Date(),
    },
    select: { id: true, email: true, fullName: true, active: true, externalId: true, createdAt: true, updatedAt: true },
  });
  res.type("application/scim+json").json(toScimUser(updated, baseUrl(req)));
});

// SCIM PATCH is more common than PUT — IdPs issue a PATCH per attribute
// change (Okta's deactivation flow is a single PATCH: active=false).
scimRouter.patch("/Users/:id", async (req, res) => {
  const tenantId = req.scim!.tenantId;
  const existing = await prisma.user.findFirst({
    where: { id: req.params.id, tenantId },
  });
  if (!existing) return scimError(res, 404, "User not found");

  const ops = Array.isArray((req.body as { Operations?: unknown })?.Operations)
    ? ((req.body as { Operations: ScimPatchOp[] }).Operations)
    : [];
  if (ops.length === 0) return scimError(res, 400, "Missing Operations", "invalidValue");

  // Build an update payload by walking the operations in order.
  const patch: Record<string, unknown> = {};
  for (const raw of ops) {
    const op = String(raw.op ?? "").toLowerCase();
    if (op !== "replace" && op !== "add" && op !== "remove") continue;
    // No path = whole-resource replace (Azure AD pattern).
    if (!raw.path) {
      if (raw.value && typeof raw.value === "object") {
        const v = raw.value as ScimUserInput;
        const emailFromBody = extractEmail(v);
        if (emailFromBody) patch.email = emailFromBody;
        const name = extractFullName(v);
        if (name) patch.fullName = name;
        if (typeof v.active === "boolean") patch.active = v.active;
        if (typeof v.externalId === "string") patch.externalId = v.externalId;
      }
      continue;
    }
    // Dotted path replace. Only the attributes we store.
    const path = raw.path.toLowerCase();
    if (path === "active" && typeof raw.value === "boolean") {
      patch.active = raw.value;
    } else if (path === "username" && typeof raw.value === "string") {
      patch.email = raw.value;
    } else if (path === "displayname" && typeof raw.value === "string") {
      patch.fullName = raw.value;
    } else if (path === "externalid" && (typeof raw.value === "string" || raw.value === null)) {
      patch.externalId = raw.value;
    } else if (path === "name.formatted" && typeof raw.value === "string") {
      patch.fullName = raw.value;
    }
    // Silently ignore unknown paths — SCIM clients send a lot of
    // vendor-specific attributes we don't model, and 400-ing on each
    // would break the sync for the attributes we do care about.
  }

  if (patch.active === false && typeof patch.deactivatedAt === "undefined") {
    patch.deactivatedAt = existing.deactivatedAt ?? new Date();
  }
  if (patch.active === true) patch.deactivatedAt = null;

  if (Object.keys(patch).length === 0) {
    // Nothing to do — return the row unchanged.
    return res.type("application/scim+json").json(toScimUser(existing, baseUrl(req)));
  }
  const updated = await prisma.user.update({
    where: { id: existing.id },
    data: patch,
    select: { id: true, email: true, fullName: true, active: true, externalId: true, createdAt: true, updatedAt: true },
  });
  res.type("application/scim+json").json(toScimUser(updated, baseUrl(req)));
});

// Hard delete. SCIM clients commonly deactivate (PATCH active=false)
// instead; delete should be rare. We cascade through the Prisma relation
// so sessions/tokens for the deleted user are cleaned up.
scimRouter.delete("/Users/:id", async (req, res) => {
  const tenantId = req.scim!.tenantId;
  const existing = await prisma.user.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true },
  });
  if (!existing) return scimError(res, 404, "User not found");
  await prisma.user.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// ── Groups ────────────────────────────────────────────────────────────
//
// SCIM Group ⇔ Lumaara Role. A group's members are the users with that
// role (via UserRole). System roles (SystemManager + the seeded set)
// are read-only — delete is rejected with 403.

interface ScimGroup {
  schemas: string[];
  id: string;
  displayName: string;
  members: Array<{ value: string; display?: string; $ref?: string }>;
  meta: {
    resourceType: "Group";
    created: string;
    lastModified: string;
    location: string;
  };
}

type RoleWithMembers = {
  id: string;
  roleName: string;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
  userRoles: Array<{ user: { id: string; fullName: string | null } }>;
};

function toScimGroup(r: RoleWithMembers, base: string): ScimGroup {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    id: r.id,
    displayName: r.roleName,
    members: r.userRoles.map((ur) => ({
      value: ur.user.id,
      display: ur.user.fullName ?? undefined,
      $ref: `${base}/Users/${ur.user.id}`,
    })),
    meta: {
      resourceType: "Group",
      created: r.createdAt.toISOString(),
      lastModified: r.updatedAt.toISOString(),
      location: `${base}/Groups/${r.id}`,
    },
  };
}

// Reused for Groups filter — same parser/compiler, but with a different
// attribute map.
const GROUP_FILTER_ATTR_MAP = {
  displayname: "roleName",
} as const;

function parseGroupFilter(src: string | undefined): FilterExpr | null {
  if (!src) return { logic: "and", terms: [] };
  let toks: string[];
  try { toks = tokenise(src); } catch { return null; }
  if (toks.length === 0) return { logic: "and", terms: [] };
  // Build leaves specific to Group attrs
  const leaves: Array<{ leaf: FilterLeaf; logic?: "and" | "or" }> = [];
  let i = 0;
  while (i < toks.length) {
    const attr = toks[i]?.toLowerCase();
    if (!(attr in GROUP_FILTER_ATTR_MAP)) return null;
    const op = toks[i + 1]?.toLowerCase();
    if (op === "pr") {
      leaves.push({ leaf: { attr: attr as keyof typeof FILTER_ATTR_MAP, op: "pr" } });
      i += 2;
    } else {
      const valTok = toks[i + 2];
      if (!op || !valTok) return null;
      if (!["eq","ne","co","sw","ew"].includes(op)) return null;
      const value = valTok.startsWith('"') ? valTok.slice(1, -1) : valTok;
      leaves.push({ leaf: { attr: attr as keyof typeof FILTER_ATTR_MAP, op: op as FilterLeaf["op"], value } });
      i += 3;
    }
    if (i < toks.length) {
      const next = toks[i]?.toLowerCase();
      if (next !== "and" && next !== "or") return null;
      leaves[leaves.length - 1].logic = next as "and" | "or";
      i += 1;
    }
  }
  if (leaves.length === 1) return leaves[0].leaf;
  const anyOr = leaves.slice(0, -1).some((l) => l.logic === "or");
  return { logic: anyOr ? "or" : "and", terms: leaves.map((l) => l.leaf) };
}

// Convert a Group leaf (uses displayName→roleName) through the same compiler.
function groupLeafToPrisma(leaf: FilterLeaf): Record<string, unknown> | null {
  const col = GROUP_FILTER_ATTR_MAP[leaf.attr as keyof typeof GROUP_FILTER_ATTR_MAP];
  if (!col) return null;
  const v = leaf.value;
  switch (leaf.op) {
    case "eq": return { [col]: v };
    case "ne": return { [col]: { not: v } };
    case "co": return { [col]: { contains: v, mode: "insensitive" } };
    case "sw": return { [col]: { startsWith: v, mode: "insensitive" } };
    case "ew": return { [col]: { endsWith: v, mode: "insensitive" } };
    case "pr": return { [col]: { not: null } };
    default: return null;
  }
}
function groupExprToPrisma(expr: FilterExpr): Record<string, unknown> {
  if ("attr" in expr) return groupLeafToPrisma(expr) ?? {};
  const terms = expr.terms.map((t) => "attr" in t ? groupLeafToPrisma(t) ?? {} : groupExprToPrisma(t));
  return expr.logic === "or" ? { OR: terms } : { AND: terms };
}

scimRouter.get("/Groups", async (req, res) => {
  const tenantId = req.scim!.tenantId;
  const startIndex = Math.max(1, parseInt(String(req.query.startIndex ?? "1"), 10) || 1);
  const count = Math.min(200, Math.max(0, parseInt(String(req.query.count ?? "100"), 10) || 100));
  const filter = typeof req.query.filter === "string" ? req.query.filter : undefined;

  const parsed = parseGroupFilter(filter);
  if (parsed === null) return scimError(res, 400, `Unsupported filter: ${filter}`, "invalidFilter");
  const where: Record<string, unknown> = { tenantId, ...groupExprToPrisma(parsed) };

  const [total, rows] = await Promise.all([
    prisma.role.count({ where }),
    prisma.role.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: startIndex - 1,
      take: count,
      select: {
        id: true, roleName: true, isSystem: true, createdAt: true, updatedAt: true,
        userRoles: { select: { user: { select: { id: true, fullName: true } } } },
      },
    }),
  ]);

  const base = baseUrl(req);
  res.type("application/scim+json").json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: total,
    startIndex,
    itemsPerPage: rows.length,
    Resources: rows.map((r) => toScimGroup(r, base)),
  });
});

scimRouter.get("/Groups/:id", async (req, res) => {
  const tenantId = req.scim!.tenantId;
  const r = await prisma.role.findFirst({
    where: { id: req.params.id, tenantId },
    select: {
      id: true, roleName: true, isSystem: true, createdAt: true, updatedAt: true,
      userRoles: { select: { user: { select: { id: true, fullName: true } } } },
    },
  });
  if (!r) return scimError(res, 404, "Group not found");
  res.type("application/scim+json").json(toScimGroup(r, baseUrl(req)));
});

interface ScimGroupInput {
  displayName?: unknown;
  members?: unknown;
}

function extractMemberIds(members: unknown): string[] {
  if (!Array.isArray(members)) return [];
  return (members as Array<{ value?: unknown }>)
    .map((m) => (typeof m?.value === "string" ? m.value : null))
    .filter((x): x is string => !!x);
}

scimRouter.post("/Groups", async (req, res) => {
  const tenantId = req.scim!.tenantId;
  const body = (req.body ?? {}) as ScimGroupInput;
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (!displayName) return scimError(res, 400, "displayName required", "invalidValue");

  const existing = await prisma.role.findFirst({ where: { tenantId, roleName: displayName } });
  if (existing) return scimError(res, 409, `Group with displayName ${displayName} already exists`, "uniqueness");

  const memberIds = extractMemberIds(body.members);
  // Validate every member belongs to the tenant before linking.
  if (memberIds.length > 0) {
    const found = await prisma.user.count({ where: { id: { in: memberIds }, tenantId } });
    if (found !== memberIds.length) {
      return scimError(res, 400, "One or more members do not belong to this tenant", "invalidValue");
    }
  }

  const created = await prisma.role.create({
    data: {
      tenantId, roleName: displayName,
      isSystem: false,
      userRoles: memberIds.length > 0
        ? { create: memberIds.map((uid) => ({ userId: uid })) }
        : undefined,
    },
    select: {
      id: true, roleName: true, isSystem: true, createdAt: true, updatedAt: true,
      userRoles: { select: { user: { select: { id: true, fullName: true } } } },
    },
  });
  const base = baseUrl(req);
  res.status(201).type("application/scim+json").set("Location", `${base}/Groups/${created.id}`).json(toScimGroup(created, base));
});

scimRouter.put("/Groups/:id", async (req, res) => {
  const tenantId = req.scim!.tenantId;
  const existing = await prisma.role.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return scimError(res, 404, "Group not found");
  if (existing.isSystem) return scimError(res, 403, "Cannot modify system-managed group", "mutability");

  const body = (req.body ?? {}) as ScimGroupInput;
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : existing.roleName;
  const memberIds = extractMemberIds(body.members);
  if (memberIds.length > 0) {
    const found = await prisma.user.count({ where: { id: { in: memberIds }, tenantId } });
    if (found !== memberIds.length) {
      return scimError(res, 400, "One or more members do not belong to this tenant", "invalidValue");
    }
  }
  const updated = await prisma.$transaction(async (tx) => {
    await tx.role.update({ where: { id: existing.id }, data: { roleName: displayName } });
    await tx.userRole.deleteMany({ where: { roleId: existing.id } });
    if (memberIds.length > 0) {
      await tx.userRole.createMany({
        data: memberIds.map((uid) => ({ userId: uid, roleId: existing.id })),
        skipDuplicates: true,
      });
    }
    return tx.role.findUnique({
      where: { id: existing.id },
      select: {
        id: true, roleName: true, isSystem: true, createdAt: true, updatedAt: true,
        userRoles: { select: { user: { select: { id: true, fullName: true } } } },
      },
    });
  });
  res.type("application/scim+json").json(toScimGroup(updated!, baseUrl(req)));
});

// PATCH /Groups/:id — Okta's typical "add members" / "remove members" flow.
// Supported operations:
//   { op:"add",     path:"members", value:[{value:userId}, ...] }
//   { op:"remove",  path:"members", value:[{value:userId}, ...] }  (bulk)
//   { op:"remove",  path:"members[value eq \"<id>\"]" }           (single)
//   { op:"replace", path:"members", value:[...] }                 (full replace)
//   { op:"replace", path:"displayName", value:"New name" }
scimRouter.patch("/Groups/:id", async (req, res) => {
  const tenantId = req.scim!.tenantId;
  const existing = await prisma.role.findFirst({ where: { id: req.params.id, tenantId } });
  if (!existing) return scimError(res, 404, "Group not found");
  if (existing.isSystem) return scimError(res, 403, "Cannot modify system-managed group", "mutability");

  const ops = Array.isArray((req.body as { Operations?: unknown })?.Operations)
    ? ((req.body as { Operations: ScimPatchOp[] }).Operations)
    : [];
  if (ops.length === 0) return scimError(res, 400, "Missing Operations", "invalidValue");

  await prisma.$transaction(async (tx) => {
    for (const raw of ops) {
      const op = String(raw.op ?? "").toLowerCase();
      const path = (raw.path ?? "").toLowerCase();
      // displayName change
      if ((op === "replace" || op === "add") && path === "displayname" && typeof raw.value === "string") {
        await tx.role.update({ where: { id: existing.id }, data: { roleName: raw.value.trim() } });
        continue;
      }
      // members ops
      if (path.startsWith("members")) {
        // bracketed path: members[value eq "<id>"]
        const bracket = /^members\[value\s+eq\s+"([^"]+)"\]$/.exec(path);
        if (op === "remove" && bracket) {
          await tx.userRole.deleteMany({ where: { roleId: existing.id, userId: bracket[1] } });
          continue;
        }
        const ids = extractMemberIds(raw.value);
        // Validate tenant ownership of every id before touching.
        if (ids.length > 0) {
          const found = await tx.user.count({ where: { id: { in: ids }, tenantId } });
          if (found !== ids.length) throw new Error("one or more members do not belong to tenant");
        }
        if (op === "add") {
          if (ids.length > 0) {
            await tx.userRole.createMany({
              data: ids.map((uid) => ({ userId: uid, roleId: existing.id })),
              skipDuplicates: true,
            });
          }
        } else if (op === "remove") {
          if (ids.length > 0) {
            await tx.userRole.deleteMany({ where: { roleId: existing.id, userId: { in: ids } } });
          }
        } else if (op === "replace") {
          await tx.userRole.deleteMany({ where: { roleId: existing.id } });
          if (ids.length > 0) {
            await tx.userRole.createMany({
              data: ids.map((uid) => ({ userId: uid, roleId: existing.id })),
              skipDuplicates: true,
            });
          }
        }
      }
      // Unknown paths silently ignored (same contract as user PATCH).
    }
  }).catch((e: Error) => {
    return scimError(res, 400, e.message, "invalidValue");
  });

  const refreshed = await prisma.role.findUnique({
    where: { id: existing.id },
    select: {
      id: true, roleName: true, isSystem: true, createdAt: true, updatedAt: true,
      userRoles: { select: { user: { select: { id: true, fullName: true } } } },
    },
  });
  res.type("application/scim+json").json(toScimGroup(refreshed!, baseUrl(req)));
});

scimRouter.delete("/Groups/:id", async (req, res) => {
  const tenantId = req.scim!.tenantId;
  const existing = await prisma.role.findFirst({
    where: { id: req.params.id, tenantId },
    select: { id: true, isSystem: true },
  });
  if (!existing) return scimError(res, 404, "Group not found");
  if (existing.isSystem) return scimError(res, 403, "Cannot delete system-managed group", "mutability");
  await prisma.role.delete({ where: { id: existing.id } });
  res.status(204).send();
});

// ── Bulk ──────────────────────────────────────────────────────────────
//
// RFC 7644 Section 3.7. The IdP sends up to BULK_MAX_OPS sub-requests
// in a single HTTP call; we execute them in-order and return a parallel
// BulkResponse. Each sub-request carries a `bulkId` the IdP uses to
// correlate results.
//
// For simplicity + safety we run each sub-request through the regular
// handlers via an internal fetch to self rather than refactoring every
// handler for programmatic invocation. That costs a round-trip per op
// but keeps the auth + validation path identical.

interface BulkOp {
  bulkId?: string;
  method?: string;
  path?: string;
  data?: unknown;
}

interface BulkResult {
  bulkId?: string;
  method: string;
  location?: string;
  status: string;
  response?: unknown;
}

async function dispatchBulk(
  authHeader: string,
  base: string,
  op: BulkOp,
): Promise<BulkResult> {
  const method = (op.method ?? "").toUpperCase();
  const path = typeof op.path === "string" ? op.path : "";
  if (!method || !path) {
    return {
      bulkId: op.bulkId,
      method,
      status: "400",
      response: { detail: "Missing method or path", status: "400" },
    };
  }
  const url = `${base}${path}`;
  const r = await fetch(url, {
    method,
    headers: {
      "content-type": "application/scim+json",
      authorization: authHeader,
    },
    body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(op.data ?? {}),
  });
  const body = r.status === 204 ? null : await r.json().catch(() => null);
  return {
    bulkId: op.bulkId,
    method,
    location: r.headers.get("location") ?? undefined,
    status: String(r.status),
    response: body ?? undefined,
  };
}

scimRouter.post("/Bulk", async (req, res) => {
  const body = (req.body ?? {}) as { Operations?: unknown; failOnErrors?: unknown };
  const ops: BulkOp[] = Array.isArray(body.Operations) ? (body.Operations as BulkOp[]) : [];
  if (ops.length === 0) return scimError(res, 400, "Missing Operations", "invalidValue");
  if (ops.length > BULK_MAX_OPS) {
    return scimError(res, 400, `Too many operations (max ${BULK_MAX_OPS})`, "tooMany");
  }
  const failOnErrors = typeof body.failOnErrors === "number" ? body.failOnErrors : 0;

  const base = baseUrl(req);
  const authHeader = req.header("authorization") ?? "";
  const results: BulkResult[] = [];
  let errorCount = 0;
  for (const op of ops) {
    const r = await dispatchBulk(authHeader, base, op);
    results.push(r);
    const code = parseInt(r.status, 10);
    if (code >= 400) {
      errorCount++;
      if (failOnErrors > 0 && errorCount >= failOnErrors) break;
    }
  }
  res.type("application/scim+json").json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:BulkResponse"],
    Operations: results,
  });
});
