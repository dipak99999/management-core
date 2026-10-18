import { Router } from "express";
import { z } from "zod";
import {
  CUSTOM_FIELD_DOCTYPES,
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_LINK_TARGETS,
  Prisma,
  prisma,
} from "@lumaara/db";
import { perms, requireAuth } from "@lumaara/service-auth";

export const customFieldRouter = Router();

customFieldRouter.use(requireAuth);

const p = perms("CustomField");

// Public within the tenant: any authed user can read the field meta (needed to
// render forms). Only CustomField:create/write/delete perms are locked down —
// SystemManager by default.
customFieldRouter.get("/", async (req, res) => {
  const doctype = typeof req.query.doctype === "string" ? req.query.doctype : undefined;
  const rows = await prisma.customField.findMany({
    where: {
      tenantId: req.auth!.tenantId,
      ...(doctype ? { doctype } : {}),
    },
    orderBy: [{ doctype: "asc" }, { sortOrder: "asc" }],
  });
  res.json(rows);
});

// Meta helper for form-building: enumerable doctypes + field types + Link
// target choices (I1). The frontend uses this to render the field-type
// picker + populate the "link to doctype" dropdown for Link fields.
customFieldRouter.get("/meta", (_req, res) => {
  res.json({
    doctypes: CUSTOM_FIELD_DOCTYPES,
    fieldTypes: CUSTOM_FIELD_TYPES,
    linkTargets: CUSTOM_FIELD_LINK_TARGETS,
  });
});

// snake_case validator for fieldName — keeps JSONB keys sane.
const SNAKE = /^[a-z][a-z0-9_]{0,39}$/;

const createSchema = z.object({
  doctype: z.enum(CUSTOM_FIELD_DOCTYPES as unknown as [string, ...string[]]),
  fieldName: z
    .string()
    .regex(SNAKE, "fieldName must be snake_case, start with a letter, ≤ 40 chars"),
  label: z.string().min(1).max(80),
  fieldType: z.enum(CUSTOM_FIELD_TYPES as unknown as [string, ...string[]]),
  options: z.record(z.unknown()).optional().nullable(),
  isRequired: z.boolean().default(false),
  sortOrder: z.coerce.number().int().default(0),
  helpText: z.string().max(200).optional().nullable(),
  // I4
  regexPattern: z.string().optional().nullable(),
  isUnique: z.boolean().default(false),
  readOnly: z.boolean().default(false),
  hiddenIf: z.string().optional().nullable(),
});

customFieldRouter.post("/", p.create, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const tenantId = req.auth!.tenantId;

  // Per-type option shape checks.
  if (parsed.data.fieldType === "Select") {
    const opts = (parsed.data.options ?? {}) as { choices?: unknown };
    if (!Array.isArray(opts.choices) || opts.choices.length === 0)
      return res.status(400).json({ error: "Select fields need options.choices: string[]" });
  }
  if (parsed.data.fieldType === "Link") {
    const opts = (parsed.data.options ?? {}) as { linkDoctype?: unknown };
    if (typeof opts.linkDoctype !== "string" ||
        !(CUSTOM_FIELD_LINK_TARGETS as readonly string[]).includes(opts.linkDoctype))
      return res.status(400).json({
        error: `Link fields need options.linkDoctype from: ${CUSTOM_FIELD_LINK_TARGETS.join(", ")}`,
      });
  }
  if (parsed.data.fieldType === "Table") {
    const opts = (parsed.data.options ?? {}) as { subFields?: unknown };
    if (!Array.isArray(opts.subFields) || opts.subFields.length === 0)
      return res.status(400).json({ error: "Table fields need options.subFields[]" });
  }

  try {
    const row = await prisma.customField.create({
      data: {
        tenantId,
        doctype: parsed.data.doctype,
        fieldName: parsed.data.fieldName,
        label: parsed.data.label,
        fieldType: parsed.data.fieldType,
        options: (parsed.data.options ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
        isRequired: parsed.data.isRequired,
        sortOrder: parsed.data.sortOrder,
        helpText: parsed.data.helpText ?? null,
        regexPattern: parsed.data.regexPattern ?? null,
        isUnique: parsed.data.isUnique,
        readOnly: parsed.data.readOnly,
        hiddenIf: parsed.data.hiddenIf ?? null,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return res
        .status(409)
        .json({ error: "A custom field with this name already exists for this doctype" });
    }
    throw e;
  }
});

const updateSchema = createSchema.partial().omit({ doctype: true, fieldName: true });

customFieldRouter.put("/:id", p.write, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.customField.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.customField.update({
    where: { id: existing.id },
    data: {
      ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
      ...(parsed.data.fieldType !== undefined ? { fieldType: parsed.data.fieldType } : {}),
      ...(parsed.data.options !== undefined
        ? {
            options: (parsed.data.options ?? undefined) as
              | Prisma.InputJsonValue
              | undefined,
          }
        : {}),
      ...(parsed.data.isRequired !== undefined ? { isRequired: parsed.data.isRequired } : {}),
      ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
      ...(parsed.data.helpText !== undefined ? { helpText: parsed.data.helpText } : {}),
      ...(parsed.data.regexPattern !== undefined
        ? { regexPattern: parsed.data.regexPattern }
        : {}),
      ...(parsed.data.isUnique !== undefined ? { isUnique: parsed.data.isUnique } : {}),
      ...(parsed.data.readOnly !== undefined ? { readOnly: parsed.data.readOnly } : {}),
      ...(parsed.data.hiddenIf !== undefined ? { hiddenIf: parsed.data.hiddenIf } : {}),
    },
  });
  res.json(row);
});

customFieldRouter.delete("/:id", p.delete, async (req, res) => {
  const existing = await prisma.customField.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  await prisma.customField.delete({ where: { id: existing.id } });
  res.status(204).send();
});
