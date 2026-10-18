import { Router } from "express";
import { z } from "zod";
import { prisma, nextName, fireJourneyTrigger, recordTouchpoint } from "@lumaara/db";
import { getLogger, perms } from "@lumaara/service-auth";

const log = getLogger("crm-service");

// Web Forms — public lead-capture forms.
//
// Two mount points on crm-service/index.ts:
//   /web-forms         (JWT — operator CRUD + submissions viewer)
//   /public/web-forms  (no auth — schema, HTML render, submit)
//
// A WebForm's `fieldsJson` is an ordered array like
//   [{ key: "email", label: "Email", type: "email", required: true },
//    { key: "name",  label: "Full name", type: "text",  required: true }, …]
//
// Type set: text · textarea · email · phone · select · checkbox · number
//
// On submit we always create a WebFormSubmission (for the record). If
// `targetType = Lead` we also create a Lead row, wire the standard "SOURCE:
// WebForm <name>" attribution, optionally attach to a static ContactList,
// and optionally enroll into an Email Sequence.

export const webFormRouter = Router();
export const webFormPublicRouter = Router();

const p = perms("WebForm");

// HTML escape for values inlined into the rendered form HTML.
function escapeHtml(s: string | null | undefined): string {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] as string
  ));
}

// ── Schemas ───────────────────────────────────────────────────────────

const FIELD_TYPES = ["text", "textarea", "email", "phone", "select", "checkbox", "number"] as const;

const fieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(FIELD_TYPES).default("text"),
  required: z.boolean().default(false),
  placeholder: z.string().nullable().optional(),
  options: z.array(z.string()).optional(), // for select
});

const upsertSchema = z.object({
  name: z.string().min(1),
  publicSlug: z.string().min(1).regex(/^[a-z0-9-]+$/i, "slug must be alphanumeric + dashes"),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  submitLabel: z.string().default("Submit"),
  successMessage: z.string().default("Thanks — we'll be in touch shortly."),
  redirectUrl: z.string().nullable().optional(),
  targetType: z.enum(["Lead", "Customer"]).default("Lead"),
  addToListId: z.string().nullable().optional(),
  triggerSequenceId: z.string().nullable().optional(),
  fieldsJson: z.array(fieldSchema).min(1),
  isActive: z.boolean().optional(),
});

// ── Operator CRUD ─────────────────────────────────────────────────────

webFormRouter.get("/", p.read, async (req, res) => {
  const rows = await prisma.webForm.findMany({
    where: { tenantId: req.auth!.tenantId },
    orderBy: { updatedAt: "desc" },
  });
  res.json(rows);
});

webFormRouter.get("/:id", p.read, async (req, res) => {
  const row = await prisma.webForm.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

webFormRouter.post("/", p.create, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const row = await prisma.webForm.create({
      data: {
        tenantId: req.auth!.tenantId,
        name: parsed.data.name,
        publicSlug: parsed.data.publicSlug,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        submitLabel: parsed.data.submitLabel,
        successMessage: parsed.data.successMessage,
        redirectUrl: parsed.data.redirectUrl ?? null,
        targetType: parsed.data.targetType,
        addToListId: parsed.data.addToListId ?? null,
        triggerSequenceId: parsed.data.triggerSequenceId ?? null,
        fieldsJson: parsed.data.fieldsJson,
        isActive: parsed.data.isActive ?? true,
      },
    });
    res.status(201).json(row);
  } catch (e) {
    if (e instanceof Error && e.message.includes("Unique constraint"))
      return res.status(409).json({ error: "Name or slug already exists" });
    throw e;
  }
});

webFormRouter.put("/:id", p.write, async (req, res) => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const existing = await prisma.webForm.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  if (!existing) return res.status(404).json({ error: "Not found" });
  const row = await prisma.webForm.update({
    where: { id: existing.id },
    data: {
      name: parsed.data.name,
      publicSlug: parsed.data.publicSlug,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      submitLabel: parsed.data.submitLabel,
      successMessage: parsed.data.successMessage,
      redirectUrl: parsed.data.redirectUrl ?? null,
      targetType: parsed.data.targetType,
      addToListId: parsed.data.addToListId ?? null,
      triggerSequenceId: parsed.data.triggerSequenceId ?? null,
      fieldsJson: parsed.data.fieldsJson,
      isActive: parsed.data.isActive ?? existing.isActive,
    },
  });
  res.json(row);
});

webFormRouter.delete("/:id", p.delete, async (req, res) => {
  await prisma.webForm.deleteMany({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
  });
  res.status(204).end();
});

webFormRouter.get("/:id/submissions", p.read, async (req, res) => {
  const form = await prisma.webForm.findFirst({
    where: { id: req.params.id, tenantId: req.auth!.tenantId },
    select: { id: true },
  });
  if (!form) return res.status(404).json({ error: "Not found" });
  const rows = await prisma.webFormSubmission.findMany({
    where: { webFormId: form.id },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json(rows);
});

// ── Public — schema + render + submit ─────────────────────────────────

webFormPublicRouter.get("/:slug", async (req, res) => {
  const form = await prisma.webForm.findUnique({
    where: { publicSlug: req.params.slug },
    select: {
      id: true, title: true, description: true, submitLabel: true,
      successMessage: true, fieldsJson: true, isActive: true,
    },
  });
  if (!form || !form.isActive) return res.status(404).json({ error: "Not found" });
  res.json(form);
});

webFormPublicRouter.get("/:slug/render", async (req, res) => {
  const form = await prisma.webForm.findUnique({
    where: { publicSlug: req.params.slug },
  });
  if (!form || !form.isActive) return res.status(404).send("<h1>404 — form not found</h1>");

  const fields = form.fieldsJson as Array<{
    key: string; label: string; type: string; required?: boolean; placeholder?: string; options?: string[];
  }>;

  const fieldHtml = fields
    .map((f) => {
      const req = f.required ? "required" : "";
      const ph = f.placeholder ? `placeholder="${escapeHtml(f.placeholder)}"` : "";
      const label = `<label class="lf-label">${escapeHtml(f.label)}${f.required ? '<span class="lf-req">*</span>' : ""}</label>`;
      let input = "";
      if (f.type === "textarea") {
        input = `<textarea name="${f.key}" ${req} ${ph} class="lf-input" rows="4"></textarea>`;
      } else if (f.type === "select") {
        const opts = (f.options ?? []).map((o) => `<option>${escapeHtml(o)}</option>`).join("");
        input = `<select name="${f.key}" ${req} class="lf-input"><option value="">Select…</option>${opts}</select>`;
      } else if (f.type === "checkbox") {
        input = `<label class="lf-check"><input type="checkbox" name="${f.key}" ${req} /> ${escapeHtml(f.label)}</label>`;
      } else {
        input = `<input type="${f.type === "phone" ? "tel" : f.type}" name="${f.key}" ${req} ${ph} class="lf-input" />`;
      }
      return f.type === "checkbox"
        ? `<div class="lf-field">${input}</div>`
        : `<div class="lf-field">${label}${input}</div>`;
    })
    .join("");

  const submitUrl = `${req.protocol}://${req.get("host")}/public/web-forms/${form.publicSlug}/submit`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(form.title)}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 32px 16px; background: #fafaf9; color: #1c1917; }
  .lf-card { max-width: 480px; margin: 0 auto; background: white; border-radius: 16px; box-shadow: 0 12px 40px -12px rgba(28,25,23,.15); padding: 32px; }
  .lf-title { font-size: 22px; font-weight: 600; margin: 0 0 6px; }
  .lf-desc { color: #78716c; font-size: 14px; margin: 0 0 20px; }
  .lf-field { margin-bottom: 14px; }
  .lf-label { display: block; font-size: 12px; font-weight: 600; text-transform: uppercase; color: #57534e; margin-bottom: 4px; letter-spacing: .04em; }
  .lf-req { color: #dc2626; margin-left: 2px; }
  .lf-input { width: 100%; padding: 10px 12px; border: 1px solid #d6d3d1; border-radius: 8px; font-size: 14px; font-family: inherit; outline: none; box-sizing: border-box; }
  .lf-input:focus { border-color: #7C3AED; box-shadow: 0 0 0 3px rgba(124,58,237,.15); }
  .lf-check { display: flex; align-items: center; gap: 8px; font-size: 14px; }
  .lf-btn { display: inline-flex; align-items: center; justify-content: center; width: 100%; padding: 12px; background: linear-gradient(135deg, #7C3AED, #8B5CF6); color: white; border: 0; border-radius: 8px; font-weight: 500; cursor: pointer; margin-top: 8px; font-size: 15px; }
  .lf-btn[disabled] { opacity: .6; cursor: not-allowed; }
  .lf-ok { padding: 20px; background: #dcfce7; border: 1px solid #86efac; border-radius: 8px; color: #14532d; text-align: center; }
  .lf-err { padding: 12px; background: #fee2e2; border: 1px solid #fecaca; border-radius: 8px; color: #991b1b; font-size: 13px; margin-bottom: 12px; }
</style>
</head><body>
<div class="lf-card" id="lf-root">
  <h1 class="lf-title">${escapeHtml(form.title)}</h1>
  ${form.description ? `<p class="lf-desc">${escapeHtml(form.description)}</p>` : ""}
  <div id="lf-error" class="lf-err" style="display:none"></div>
  <form id="lf-form" method="post">${fieldHtml}
    <button class="lf-btn" type="submit">${escapeHtml(form.submitLabel)}</button>
  </form>
</div>
<script>
(function() {
  const form = document.getElementById("lf-form");
  const err = document.getElementById("lf-error");
  const root = document.getElementById("lf-root");
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    err.style.display = "none";
    const btn = form.querySelector("button");
    btn.disabled = true; btn.textContent = "Submitting…";
    const data = {};
    for (const el of form.elements) {
      if (el.name) {
        data[el.name] = el.type === "checkbox" ? el.checked : el.value;
      }
    }
    try {
      const r = await fetch(${JSON.stringify(submitUrl)}, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fields: data,
          referrer: document.referrer || undefined,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Submit failed");
      const j = await r.json();
      if (j.redirectUrl) { window.location = j.redirectUrl; return; }
      root.innerHTML = '<div class="lf-ok">' + ${JSON.stringify(escapeHtml(form.successMessage))} + '</div>';
    } catch (ex) {
      err.textContent = ex && ex.message ? ex.message : "Submit failed";
      err.style.display = "block";
      btn.disabled = false; btn.textContent = ${JSON.stringify(form.submitLabel)};
    }
  });
})();
</script>
</body></html>`);
});

webFormPublicRouter.post("/:slug/submit", async (req, res) => {
  const form = await prisma.webForm.findUnique({
    where: { publicSlug: req.params.slug },
  });
  if (!form || !form.isActive) return res.status(404).json({ error: "Not found" });

  const parsed = z
    .object({
      fields: z.record(z.any()),
      referrer: z.string().nullable().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid" });

  const fieldsSpec = form.fieldsJson as Array<{ key: string; required?: boolean }>;
  for (const f of fieldsSpec) {
    if (f.required && !parsed.data.fields[f.key])
      return res.status(400).json({ error: `Missing ${f.key}` });
  }

  const ipAddress = (req.ip ?? req.header("x-forwarded-for") ?? "").split(",")[0]?.trim() || null;
  const submission = await prisma.webFormSubmission.create({
    data: {
      webFormId: form.id,
      tenantId: form.tenantId,
      fieldsJson: parsed.data.fields,
      ipAddress,
      userAgent: req.header("user-agent") ?? null,
      referrer: parsed.data.referrer ?? null,
    },
  });

  // Attempt Lead creation using standard field-name conventions.
  let createdLeadId: string | null = null;
  if (form.targetType === "Lead") {
    const fields = parsed.data.fields;
    const leadName =
      fields.name || fields.fullName || fields.full_name ||
      [fields.firstName ?? fields.first_name, fields.lastName ?? fields.last_name].filter(Boolean).join(" ") ||
      fields.email || "Web form lead";
    const companyName =
      fields.company || fields.companyName || fields.company_name || null;
    try {
      const leadNameSeq = await nextName(prisma, form.tenantId, "LEAD-");
      const lead = await prisma.lead.create({
        data: {
          tenantId: form.tenantId,
          name: leadNameSeq,
          leadName: String(leadName).slice(0, 200),
          companyName: companyName ? String(companyName).slice(0, 200) : null,
          email: fields.email ? String(fields.email).slice(0, 200) : null,
          mobile: fields.phone || fields.mobile ? String(fields.phone || fields.mobile).slice(0, 40) : null,
          status: "Open",
          source: `WebForm: ${form.name}`,
          remarks: `Submitted via web form "${form.name}" on ${new Date().toISOString().slice(0, 10)}`,
        },
      });
      createdLeadId = lead.id;
      await prisma.webFormSubmission.update({
        where: { id: submission.id },
        data: { createdLeadId: lead.id },
      });

      // Optional list membership.
      if (form.addToListId) {
        await prisma.contactListMember.upsert({
          where: {
            listId_contactType_contactId: {
              listId: form.addToListId,
              contactType: "Lead",
              contactId: lead.id,
            },
          },
          create: {
            listId: form.addToListId,
            contactType: "Lead",
            contactId: lead.id,
          },
          update: {},
        }).catch(() => {});
        const memberCount = await prisma.contactListMember.count({ where: { listId: form.addToListId } });
        await prisma.contactList.update({
          where: { id: form.addToListId },
          data: { memberCount },
        }).catch(() => {});
      }

      // Optional sequence enrollment.
      if (form.triggerSequenceId && lead.email) {
        const seq = await prisma.emailSequence.findFirst({
          where: { id: form.triggerSequenceId, tenantId: form.tenantId, isActive: true },
          include: { steps: { orderBy: { stepOrder: "asc" }, take: 1 } },
        });
        if (seq && seq.steps.length > 0) {
          const nextSendAt = new Date();
          nextSendAt.setUTCDate(nextSendAt.getUTCDate() + seq.steps[0]!.delayDays);
          await prisma.sequenceEnrollment.create({
            data: {
              tenantId: form.tenantId,
              sequenceId: seq.id,
              contactType: "Lead",
              contactId: lead.id,
              emailTo: lead.email,
              nextSendAt,
            },
          }).catch(() => {});
          await prisma.emailSequence.update({
            where: { id: seq.id },
            data: { totalEnrolled: { increment: 1 } },
          }).catch(() => {});
        }
      }

      // Marketing P2 — fire FormSubmit trigger. Match on triggerConfig.formId
      // so a form-specific journey only enrolls its own submissions. Best-effort.
      try {
        await fireJourneyTrigger(prisma, {
          tenantId: form.tenantId,
          triggerType: "FormSubmit",
          match: { formId: form.id },
          contactType: "Lead",
          contactId: lead.id,
          emailTo: lead.email,
          mobileTo: lead.mobile,
        });
      } catch (e) {
        log.warn("fireJourneyTrigger(FormSubmit) failed", {
          formId: form.id,
          leadId: lead.id,
          err: e instanceof Error ? e : new Error(String(e)),
        });
      }

      // Marketing P3 — attribution touchpoint. The submission is a Lead-side
      // event; if that lead later converts to a Customer and buys, the
      // touchpoint's contactId won't match — but that's OK: attribution is
      // primarily meaningful for Customer-side revenue events, and the raw
      // Lead touchpoint still shows in per-source counters even without
      // revenue attribution.
      try {
        await recordTouchpoint(prisma, {
          tenantId: form.tenantId,
          contactType: "Lead",
          contactId: lead.id,
          sourceType: "WebForm",
          sourceId: form.id,
          event: "Submitted",
        });
      } catch (e) {
        log.warn("recordTouchpoint(WebForm/Submitted) failed", {
          formId: form.id,
          leadId: lead.id,
          err: e instanceof Error ? e : new Error(String(e)),
        });
      }
    } catch {
      // Never fail the submission on downstream errors — the WebFormSubmission
      // row is the source of truth and the operator can create the Lead
      // manually from it.
    }
  }

  await prisma.webForm.update({
    where: { id: form.id },
    data: { submissionCount: { increment: 1 } },
  });

  res.json({
    ok: true,
    redirectUrl: form.redirectUrl ?? null,
    createdLeadId,
    successMessage: form.successMessage,
  });
});
