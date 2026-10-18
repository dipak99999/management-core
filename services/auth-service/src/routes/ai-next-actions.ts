import { Router } from "express";
import { prisma } from "@lumaara/db";
import { requireAuth } from "@lumaara/service-auth";

export const aiNextActionsRouter = Router();
aiNextActionsRouter.use(requireAuth);

/**
 * POST /ai/next-actions
 *
 * Deterministic rule-based next-best-actions for a doctype. Faster and
 * cheaper than an LLM call for the common case — the AI chip component
 * doesn't need creativity, it needs correct hints.
 *
 * The AI budget is reserved for /ai/draft and /ai-chat. This endpoint
 * reads the current doc state and returns 1–3 contextual suggestions.
 */

aiNextActionsRouter.post("/", async (req, res) => {
  const { doctype, docId } = req.body as { doctype?: string; docId?: string };
  if (!doctype || !docId) return res.status(400).json({ error: "doctype + docId required" });
  const tenantId = req.auth!.tenantId;

  interface Chip {
    id: string;
    label: string;
    description?: string;
    danger?: boolean;
    href?: string;
    endpoint?: { method: "POST" | "PUT" | "DELETE"; path: string; body?: unknown };
  }

  const chips: Chip[] = [];

  switch (doctype) {
    case "SalesInvoice": {
      const inv = await prisma.salesInvoice.findFirst({
        where: { id: docId, tenantId },
        select: {
          id: true,
          status: true,
          grandTotal: true,
          dueDate: true,
          outstandingAmt: true,
        },
      });
      if (!inv) return res.json([]);
      if (inv.status === "Draft") {
        chips.push({
          id: "submit",
          label: "Submit invoice",
          description: "Posts the GL entries and makes it available to customers.",
          endpoint: { method: "POST", path: `/sales-invoices/${inv.id}/submit`, body: {} },
        });
      }
      if (
        inv.status === "Submitted" &&
        inv.outstandingAmt &&
        Number(inv.outstandingAmt) > 0 &&
        inv.dueDate &&
        new Date(inv.dueDate) < new Date()
      ) {
        chips.push({
          id: "remind",
          label: "Send payment reminder",
          description: "Overdue + still outstanding — email the customer.",
          endpoint: {
            method: "POST",
            path: `/sales-invoices/${inv.id}/remind`,
            body: {},
          },
        });
      }
      if (inv.status === "Submitted" && Number(inv.outstandingAmt ?? 0) > 0) {
        chips.push({
          id: "record-payment",
          label: "Record payment",
          description: "Open the Payment entry form linked to this invoice.",
          href: `/accounting/payments/new?against=${inv.id}`,
        });
      }
      break;
    }
    case "PickList": {
      const pl = await prisma.pickList.findFirst({
        where: { id: docId, tenantId },
        select: { id: true, status: true, items: { select: { qty: true, pickedQty: true } } },
      });
      if (!pl) return res.json([]);
      if (pl.status === "Draft") {
        chips.push({
          id: "submit",
          label: "Submit pick list",
          description: "Locks DN lines so another list can't double-pick them.",
          endpoint: { method: "POST", path: `/pick-lists/${pl.id}/submit`, body: {} },
        });
      }
      if (pl.status === "Submitted") {
        const done = pl.items.every((i) => Number(i.pickedQty) >= Number(i.qty));
        if (done) {
          chips.push({
            id: "complete",
            label: "Mark complete",
            description: "Everything's picked — flip the list to Completed.",
            endpoint: {
              method: "POST",
              path: `/pick-lists/${pl.id}/mark-picked`,
              body: { picks: pl.items.map(() => ({})) },
            },
          });
        }
      }
      break;
    }
    case "Lead": {
      const l = await prisma.lead.findFirst({
        where: { id: docId, tenantId },
        select: { id: true, status: true, convertedCustomerId: true, mobile: true, email: true },
      });
      if (!l) return res.json([]);
      if (l.status === "Open" || l.status === "Interested") {
        chips.push({
          id: "convert",
          label: "Convert to customer",
          description: "Creates a Customer and marks the lead Converted.",
          endpoint: { method: "POST", path: `/leads/${l.id}/convert`, body: {} },
        });
      }
      if (l.email && l.status !== "Converted" && l.status !== "Lost") {
        chips.push({
          id: "email",
          label: "Email the lead",
          href: `mailto:${encodeURIComponent(l.email)}`,
        });
      }
      break;
    }
    case "Quotation": {
      const q = await prisma.quotation.findFirst({
        where: { id: docId, tenantId },
        select: { id: true, status: true },
      });
      if (!q) return res.json([]);
      if (q.status === "Draft") {
        chips.push({
          id: "submit",
          label: "Send quotation",
          description: "Marks Submitted and makes it visible to the customer.",
          endpoint: { method: "POST", path: `/quotations/${q.id}/submit`, body: {} },
        });
      }
      if (q.status === "Submitted") {
        chips.push({
          id: "convert",
          label: "Convert to sales order",
          endpoint: {
            method: "POST",
            path: `/quotations/${q.id}/convert-to-sales-order`,
            body: {},
          },
        });
        chips.push({
          id: "mark-lost",
          label: "Mark lost",
          danger: true,
          endpoint: {
            method: "POST",
            path: `/quotations/${q.id}/mark-lost`,
            body: { lostReason: "unspecified" },
          },
        });
      }
      break;
    }
    case "DeliveryTrip": {
      const t = await prisma.deliveryTrip.findFirst({
        where: { id: docId, tenantId },
        select: { id: true, status: true },
      });
      if (!t) return res.json([]);
      if (t.status === "Scheduled") {
        chips.push({
          id: "start",
          label: "Start trip",
          endpoint: { method: "POST", path: `/delivery-trips/${t.id}/start`, body: {} },
        });
      }
      break;
    }
    default:
      break;
  }

  res.json(chips);
});
