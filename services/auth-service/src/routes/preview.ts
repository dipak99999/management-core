import { Router } from "express";
import { prisma } from "@lumaara/db";
import { requireAuth } from "@lumaara/service-auth";

export const previewRouter = Router();

previewRouter.use(requireAuth);

interface PreviewRow {
  label: string;
  value: string | number | null;
}

interface PreviewResp {
  title: string;
  subtitle?: string;
  rows?: PreviewRow[];
  href?: string;
}

/**
 * Hover-preview for any supported doctype. Returns title + a few key
 * fields so the shared <DocPreview> popover doesn't have to full-navigate.
 *
 * New doctypes: add a branch to the switch. Keep queries minimal — this
 * endpoint fires on hover, so latency matters.
 */
previewRouter.get("/:doctype/:id", async (req, res) => {
  const { doctype, id } = req.params;
  const tenantId = req.auth!.tenantId;

  async function build(): Promise<PreviewResp | null> {
    switch (doctype) {
      case "Customer": {
        const c = await prisma.customer.findFirst({
          where: { id, tenantId },
          select: {
            id: true,
            customerName: true,
            customerType: true,
            customerGroup: true,
            territory: true,
          },
        });
        if (!c) return null;
        return {
          title: c.customerName,
          subtitle: c.customerGroup ?? undefined,
          rows: [
            { label: "Type", value: c.customerType },
            ...(c.territory ? [{ label: "Territory", value: c.territory }] : []),
          ],
          href: `/sales/customers/${c.id}`,
        };
      }
      case "Item": {
        const it = await prisma.item.findFirst({
          where: { id, tenantId },
          select: { id: true, itemName: true, itemCode: true, stockUom: true, isStockItem: true },
        });
        if (!it) return null;
        return {
          title: it.itemName,
          subtitle: it.itemCode,
          rows: [
            { label: "UOM", value: it.stockUom },
            { label: "Stock item", value: it.isStockItem ? "Yes" : "No" },
          ],
          href: `/stock/items/${it.id}`,
        };
      }
      case "SalesInvoice": {
        const inv = await prisma.salesInvoice.findFirst({
          where: { id, tenantId },
          select: {
            id: true,
            name: true,
            status: true,
            postingDate: true,
            grandTotal: true,
            customer: { select: { customerName: true } },
          },
        });
        if (!inv) return null;
        return {
          title: inv.name,
          subtitle: inv.customer?.customerName,
          rows: [
            { label: "Status", value: inv.status },
            { label: "Date", value: inv.postingDate.toISOString().slice(0, 10) },
            { label: "Total", value: inv.grandTotal.toString() },
          ],
          href: `/accounting/sales-invoices/${inv.id}`,
        };
      }
      case "DeliveryNote": {
        const dn = await prisma.deliveryNote.findFirst({
          where: { id, tenantId },
          select: {
            id: true,
            name: true,
            status: true,
            postingDate: true,
            customer: { select: { customerName: true } },
          },
        });
        if (!dn) return null;
        return {
          title: dn.name,
          subtitle: dn.customer?.customerName,
          rows: [
            { label: "Status", value: dn.status },
            { label: "Date", value: dn.postingDate.toISOString().slice(0, 10) },
          ],
          href: `/stock/delivery-notes/${dn.id}`,
        };
      }
      case "PickList": {
        const pl = await prisma.pickList.findFirst({
          where: { id, tenantId },
          select: {
            id: true,
            name: true,
            status: true,
            purpose: true,
            postingDate: true,
            _count: { select: { items: true } },
          },
        });
        if (!pl) return null;
        return {
          title: pl.name,
          subtitle: pl.purpose,
          rows: [
            { label: "Status", value: pl.status },
            { label: "Items", value: pl._count.items },
            { label: "Date", value: pl.postingDate.toISOString().slice(0, 10) },
          ],
          href: `/stock/pick-lists/${pl.id}`,
        };
      }
      case "Supplier": {
        const s = await prisma.supplier.findFirst({
          where: { id, tenantId },
          select: {
            id: true, supplierName: true, supplierType: true, supplierGroup: true, email: true,
          },
        });
        if (!s) return null;
        return {
          title: s.supplierName,
          subtitle: s.supplierGroup ?? undefined,
          rows: [
            { label: "Type", value: s.supplierType },
            ...(s.email ? [{ label: "Email", value: s.email }] : []),
          ],
          href: `/buying/suppliers/${s.id}`,
        };
      }
      case "PurchaseOrder": {
        const po = await prisma.purchaseOrder.findFirst({
          where: { id, tenantId },
          select: {
            id: true, name: true, status: true, transactionDate: true,
            supplier: { select: { supplierName: true } },
          },
        });
        if (!po) return null;
        return {
          title: po.name,
          subtitle: po.supplier?.supplierName,
          rows: [
            { label: "Status", value: po.status },
            { label: "Date", value: po.transactionDate.toISOString().slice(0, 10) },
          ],
          href: `/buying/purchase-orders/${po.id}`,
        };
      }
      case "PurchaseInvoice": {
        const pi = await prisma.purchaseInvoice.findFirst({
          where: { id, tenantId },
          select: {
            id: true, name: true, status: true, postingDate: true, grandTotal: true,
            supplier: { select: { supplierName: true } },
          },
        });
        if (!pi) return null;
        return {
          title: pi.name,
          subtitle: pi.supplier?.supplierName,
          rows: [
            { label: "Status", value: pi.status },
            { label: "Date", value: pi.postingDate.toISOString().slice(0, 10) },
            { label: "Total", value: pi.grandTotal.toString() },
          ],
          href: `/accounting/purchase-invoices/${pi.id}`,
        };
      }
      case "Lead": {
        const l = await prisma.lead.findFirst({
          where: { id, tenantId },
          select: {
            id: true, name: true, leadName: true, companyName: true, status: true, email: true,
          },
        });
        if (!l) return null;
        return {
          title: l.leadName,
          subtitle: l.companyName ?? l.name,
          rows: [
            { label: "Status", value: l.status },
            ...(l.email ? [{ label: "Email", value: l.email }] : []),
          ],
          href: `/crm/leads/${l.id}`,
        };
      }
      case "Opportunity": {
        const o = await prisma.opportunity.findFirst({
          where: { id, tenantId },
          select: {
            id: true, name: true, status: true, expectedCloseDate: true,
          },
        });
        if (!o) return null;
        return {
          title: o.name,
          rows: [
            { label: "Status", value: o.status },
            ...(o.expectedCloseDate
              ? [{ label: "Close by", value: o.expectedCloseDate.toISOString().slice(0, 10) }]
              : []),
          ],
          href: `/crm/opportunities/${o.id}`,
        };
      }
      case "Quotation": {
        const q = await prisma.quotation.findFirst({
          where: { id, tenantId },
          select: {
            id: true, name: true, status: true, quotationDate: true, grandTotal: true,
          },
        });
        if (!q) return null;
        return {
          title: q.name,
          rows: [
            { label: "Status", value: q.status },
            { label: "Date", value: q.quotationDate.toISOString().slice(0, 10) },
            { label: "Total", value: q.grandTotal.toString() },
          ],
          href: `/crm/quotations/${q.id}`,
        };
      }
      case "Employee": {
        const e = await prisma.employee.findFirst({
          where: { id, tenantId },
          select: {
            id: true, employeeName: true, employeeCode: true, email: true, mobile: true,
            status: true,
          },
        });
        if (!e) return null;
        return {
          title: e.employeeName,
          subtitle: e.employeeCode,
          rows: [
            { label: "Status", value: e.status },
            ...(e.email ? [{ label: "Email", value: e.email }] : []),
          ],
          href: `/hr/employees/${e.id}`,
        };
      }
      case "Project": {
        const p = await prisma.project.findFirst({
          where: { id, tenantId },
          select: {
            id: true, name: true, projectName: true, status: true, endDate: true,
          },
        });
        if (!p) return null;
        return {
          title: p.projectName,
          subtitle: p.name,
          rows: [
            { label: "Status", value: p.status },
            ...(p.endDate
              ? [{ label: "Due", value: p.endDate.toISOString().slice(0, 10) }]
              : []),
          ],
          href: `/projects/projects/${p.id}`,
        };
      }
      case "Task": {
        const t = await prisma.task.findFirst({
          where: { id, tenantId },
          select: {
            id: true, subject: true, status: true, endDate: true, projectId: true,
          },
        });
        if (!t) return null;
        const proj = t.projectId
          ? await prisma.project.findFirst({
              where: { id: t.projectId, tenantId },
              select: { projectName: true },
            })
          : null;
        return {
          title: t.subject,
          subtitle: proj?.projectName,
          rows: [
            { label: "Status", value: t.status },
            ...(t.endDate
              ? [{ label: "Due", value: t.endDate.toISOString().slice(0, 10) }]
              : []),
          ],
          href: `/projects/tasks/${t.id}`,
        };
      }
      case "WorkOrder": {
        const w = await prisma.workOrder.findFirst({
          where: { id, tenantId },
          select: {
            id: true, name: true, status: true, qty: true, producedQty: true,
          },
        });
        if (!w) return null;
        return {
          title: w.name,
          rows: [
            { label: "Status", value: w.status },
            { label: "Qty", value: w.qty.toString() },
            { label: "Produced", value: w.producedQty.toString() },
          ],
          href: `/stock/work-orders/${w.id}`,
        };
      }
      case "Warehouse": {
        const wh = await prisma.warehouse.findFirst({
          where: { id, tenantId },
          select: {
            id: true, warehouseName: true, isGroup: true, disabled: true,
          },
        });
        if (!wh) return null;
        return {
          title: wh.warehouseName,
          rows: [
            { label: "Group", value: wh.isGroup ? "Yes" : "No" },
            { label: "Status", value: wh.disabled ? "Disabled" : "Active" },
          ],
          href: `/stock/warehouses/${wh.id}`,
        };
      }
      case "StockEntry": {
        const se = await prisma.stockEntry.findFirst({
          where: { id, tenantId },
          select: {
            id: true, name: true, entryType: true, status: true, postingDate: true,
          },
        });
        if (!se) return null;
        return {
          title: se.name,
          subtitle: se.entryType,
          rows: [
            { label: "Status", value: se.status },
            { label: "Date", value: se.postingDate.toISOString().slice(0, 10) },
          ],
          href: `/stock/stock-entries/${se.id}`,
        };
      }
      case "BOM": {
        const b = await prisma.bOM.findFirst({
          where: { id, tenantId },
          select: {
            id: true, name: true, isActive: true, isDefault: true, qty: true,
          },
        });
        if (!b) return null;
        return {
          title: b.name,
          rows: [
            { label: "Qty", value: b.qty.toString() },
            { label: "Status", value: b.isActive ? "Active" : "Inactive" },
            ...(b.isDefault ? [{ label: "Default", value: "Yes" }] : []),
          ],
          href: `/stock/boms/${b.id}`,
        };
      }
      case "CostCenter": {
        const cc = await prisma.costCenter.findFirst({
          where: { id, tenantId },
          select: {
            id: true, name: true, isGroup: true, disabled: true,
          },
        });
        if (!cc) return null;
        return {
          title: cc.name,
          rows: [
            { label: "Group", value: cc.isGroup ? "Yes" : "No" },
            { label: "Status", value: cc.disabled ? "Disabled" : "Active" },
          ],
          href: `/accounting/cost-centers/${cc.id}`,
        };
      }
      case "Payment":
      case "PaymentEntry": {
        const pe = await prisma.paymentEntry.findFirst({
          where: { id, tenantId },
          select: {
            id: true, name: true, status: true, paymentType: true, postingDate: true,
            paidAmount: true, currency: true,
          },
        });
        if (!pe) return null;
        return {
          title: pe.name,
          subtitle: pe.paymentType,
          rows: [
            { label: "Status", value: pe.status },
            { label: "Amount", value: `${pe.paidAmount.toString()} ${pe.currency}` },
            { label: "Date", value: pe.postingDate.toISOString().slice(0, 10) },
          ],
          href: `/accounting/payments/${pe.id}`,
        };
      }
      case "JournalEntry": {
        const je = await prisma.journalEntry.findFirst({
          where: { id, tenantId },
          select: {
            id: true, name: true, status: true, postingDate: true, currency: true,
          },
        });
        if (!je) return null;
        return {
          title: je.name,
          rows: [
            { label: "Status", value: je.status },
            { label: "Date", value: je.postingDate.toISOString().slice(0, 10) },
            { label: "Currency", value: je.currency },
          ],
          href: `/accounting/journal-entries/${je.id}`,
        };
      }
      case "PurchaseReceipt": {
        const pr = await prisma.purchaseReceipt.findFirst({
          where: { id, tenantId },
          select: {
            id: true, name: true, status: true, postingDate: true,
            supplier: { select: { supplierName: true } },
          },
        });
        if (!pr) return null;
        return {
          title: pr.name,
          subtitle: pr.supplier?.supplierName,
          rows: [
            { label: "Status", value: pr.status },
            { label: "Date", value: pr.postingDate.toISOString().slice(0, 10) },
          ],
          href: `/stock/purchase-receipts/${pr.id}`,
        };
      }
      case "SalarySlip": {
        const ss = await prisma.salarySlip.findFirst({
          where: { id, tenantId },
          select: {
            id: true, name: true, status: true, startDate: true, endDate: true, netPay: true,
            employee: { select: { employeeName: true } },
          },
        });
        if (!ss) return null;
        return {
          title: ss.name,
          subtitle: ss.employee?.employeeName,
          rows: [
            { label: "Status", value: ss.status },
            { label: "Net pay", value: ss.netPay.toString() },
            {
              label: "Period",
              value: `${ss.startDate.toISOString().slice(0, 10)} → ${ss.endDate.toISOString().slice(0, 10)}`,
            },
          ],
          href: `/hr/salary-slips/${ss.id}`,
        };
      }
      case "LeaveApplication": {
        const la = await prisma.leaveApplication.findFirst({
          where: { id, tenantId },
          select: {
            id: true, status: true, fromDate: true, toDate: true,
            employee: { select: { employeeName: true } },
          },
        });
        if (!la) return null;
        return {
          title: la.employee?.employeeName ?? "Leave",
          subtitle: `${la.fromDate.toISOString().slice(0, 10)} → ${la.toDate.toISOString().slice(0, 10)}`,
          rows: [{ label: "Status", value: la.status }],
          href: `/hr/leave-applications/${la.id}`,
        };
      }
      case "Campaign": {
        const c = await prisma.campaign.findFirst({
          where: { id, tenantId },
          select: {
            id: true, name: true, status: true, startDate: true, endDate: true,
          },
        });
        if (!c) return null;
        return {
          title: c.name,
          rows: [
            { label: "Status", value: c.status },
            ...(c.startDate
              ? [{ label: "Starts", value: c.startDate.toISOString().slice(0, 10) }]
              : []),
            ...(c.endDate
              ? [{ label: "Ends", value: c.endDate.toISOString().slice(0, 10) }]
              : []),
          ],
          href: `/crm/campaigns/${c.id}`,
        };
      }
      case "MaterialRequest": {
        const mr = await prisma.materialRequest.findFirst({
          where: { id, tenantId },
          select: { id: true, name: true, status: true, transactionDate: true, materialRequestType: true },
        });
        if (!mr) return null;
        return {
          title: mr.name,
          subtitle: mr.materialRequestType,
          rows: [
            { label: "Status", value: mr.status },
            { label: "Date", value: mr.transactionDate.toISOString().slice(0, 10) },
          ],
          href: `/stock/material-requests/${mr.id}`,
        };
      }
      case "Appraisal": {
        const a = await prisma.appraisal.findFirst({
          where: { id, tenantId },
          select: {
            id: true, name: true, status: true, periodStart: true, periodEnd: true,
            employee: { select: { employeeName: true } },
          },
        });
        if (!a) return null;
        return {
          title: a.name,
          subtitle: a.employee?.employeeName,
          rows: [
            { label: "Status", value: a.status },
            {
              label: "Period",
              value: `${a.periodStart.toISOString().slice(0, 10)} → ${a.periodEnd.toISOString().slice(0, 10)}`,
            },
          ],
          href: `/hr/appraisals/${a.id}`,
        };
      }
      case "ExpenseClaim": {
        const ec = await prisma.expenseClaim.findFirst({
          where: { id, tenantId },
          select: {
            id: true, name: true, status: true, postingDate: true, totalAmount: true,
            employee: { select: { employeeName: true } },
          },
        });
        if (!ec) return null;
        return {
          title: ec.name,
          subtitle: ec.employee?.employeeName,
          rows: [
            { label: "Status", value: ec.status },
            { label: "Amount", value: ec.totalAmount.toString() },
            { label: "Date", value: ec.postingDate.toISOString().slice(0, 10) },
          ],
          href: `/hr/expense-claims/${ec.id}`,
        };
      }
      case "JobOpening": {
        const jo = await prisma.jobOpening.findFirst({
          where: { id, tenantId },
          select: { id: true, name: true, status: true, designation: true },
        });
        if (!jo) return null;
        return {
          title: jo.name,
          subtitle: jo.designation ?? undefined,
          rows: [{ label: "Status", value: jo.status }],
          href: `/hr/job-openings/${jo.id}`,
        };
      }
      case "Sprint": {
        // Sprint is workspace-scoped, not tenant-scoped — filter via
        // the AgileWorkspace's tenantId relation.
        const sp = await prisma.sprint.findFirst({
          where: { id, workspace: { tenantId } },
          select: {
            id: true, name: true, status: true, startDate: true, endDate: true,
          },
        });
        if (!sp) return null;
        return {
          title: sp.name,
          rows: [
            { label: "Status", value: sp.status },
            ...(sp.startDate
              ? [{ label: "Starts", value: sp.startDate.toISOString().slice(0, 10) }]
              : []),
            ...(sp.endDate
              ? [{ label: "Ends", value: sp.endDate.toISOString().slice(0, 10) }]
              : []),
          ],
          href: `/projects/sprints/${sp.id}`,
        };
      }
      case "HolidayList": {
        const hl = await prisma.holidayList.findFirst({
          where: { id, tenantId },
          select: { id: true, name: true, fromDate: true, toDate: true },
        });
        if (!hl) return null;
        return {
          title: hl.name,
          rows: [
            {
              label: "Range",
              value: `${hl.fromDate.toISOString().slice(0, 10)} → ${hl.toDate.toISOString().slice(0, 10)}`,
            },
          ],
          href: `/hr/holiday-lists/${hl.id}`,
        };
      }
      case "StockReconciliation": {
        const sr = await prisma.stockReconciliation.findFirst({
          where: { id, tenantId },
          select: { id: true, name: true, status: true, postingDate: true },
        });
        if (!sr) return null;
        return {
          title: sr.name,
          rows: [
            { label: "Status", value: sr.status },
            { label: "Date", value: sr.postingDate.toISOString().slice(0, 10) },
          ],
          href: `/stock/stock-reconciliations/${sr.id}`,
        };
      }
      case "SalesOrder": {
        const so = await prisma.salesOrder.findFirst({
          where: { id, tenantId },
          select: {
            id: true, name: true, status: true, orderDate: true,
            customer: { select: { customerName: true } },
          },
        });
        if (!so) return null;
        return {
          title: so.name,
          subtitle: so.customer?.customerName,
          rows: [
            { label: "Status", value: so.status },
            { label: "Date", value: so.orderDate.toISOString().slice(0, 10) },
          ],
          href: `/crm/sales-orders/${so.id}`,
        };
      }
      case "Timesheet": {
        const ts = await prisma.timesheet.findFirst({
          where: { id, tenantId },
          select: {
            id: true, name: true, status: true, totalHours: true, weekStartDate: true,
            employee: { select: { employeeName: true } },
          },
        });
        if (!ts) return null;
        return {
          title: ts.name,
          subtitle: ts.employee?.employeeName,
          rows: [
            { label: "Status", value: ts.status },
            { label: "Week", value: ts.weekStartDate.toISOString().slice(0, 10) },
            { label: "Hours", value: ts.totalHours.toString() },
          ],
          href: `/projects/timesheets/${ts.id}`,
        };
      }
      case "Attendance": {
        const a = await prisma.attendance.findFirst({
          where: { id, tenantId },
          select: {
            id: true, status: true, date: true,
            employee: { select: { employeeName: true, employeeCode: true } },
          },
        });
        if (!a) return null;
        return {
          title: a.employee?.employeeName ?? "Attendance",
          subtitle: a.date.toISOString().slice(0, 10),
          rows: [
            { label: "Status", value: a.status },
            ...(a.employee?.employeeCode ? [{ label: "Code", value: a.employee.employeeCode }] : []),
          ],
          href: `/hr/attendance/${a.id}`,
        };
      }
      case "Loan": {
        const l = await prisma.loan.findFirst({
          where: { id, tenantId },
          select: {
            id: true, name: true, status: true, principal: true,
            employee: { select: { employeeName: true } },
          },
        });
        if (!l) return null;
        return {
          title: l.name,
          subtitle: l.employee?.employeeName,
          rows: [
            { label: "Status", value: l.status },
            { label: "Principal", value: l.principal.toString() },
          ],
          href: `/hr/loans/${l.id}`,
        };
      }
      case "EmployeeAdvance": {
        const ea = await prisma.employeeAdvance.findFirst({
          where: { id, tenantId },
          select: {
            id: true, name: true, status: true, postingDate: true, purpose: true,
            employee: { select: { employeeName: true } },
          },
        });
        if (!ea) return null;
        return {
          title: ea.name,
          subtitle: ea.employee?.employeeName,
          rows: [
            { label: "Status", value: ea.status },
            { label: "Purpose", value: ea.purpose },
            { label: "Date", value: ea.postingDate.toISOString().slice(0, 10) },
          ],
          href: `/hr/employee-advances/${ea.id}`,
        };
      }
      case "OvertimeRequest": {
        const or = await prisma.overtimeRequest.findFirst({
          where: { id, tenantId },
          select: {
            id: true, name: true, status: true, otDate: true, hours: true,
            employee: { select: { employeeName: true } },
          },
        });
        if (!or) return null;
        return {
          title: or.name,
          subtitle: or.employee?.employeeName,
          rows: [
            { label: "Status", value: or.status },
            { label: "Date", value: or.otDate.toISOString().slice(0, 10) },
            { label: "Hours", value: or.hours.toString() },
          ],
          href: `/hr/overtime-requests/${or.id}`,
        };
      }
      case "Milestone": {
        const m = await prisma.milestone.findFirst({
          where: { id, tenantId },
          select: {
            id: true, name: true, dueDate: true,
            project: { select: { projectName: true } },
          },
        });
        if (!m) return null;
        return {
          title: m.name,
          subtitle: m.project?.projectName,
          rows: m.dueDate
            ? [{ label: "Due", value: m.dueDate.toISOString().slice(0, 10) }]
            : [],
          href: `/projects/milestones/${m.id}`,
        };
      }
      case "Issue": {
        const iss = await prisma.issue.findFirst({
          where: { id, tenantId },
          select: { id: true, name: true, title: true, status: true },
        });
        if (!iss) return null;
        return {
          title: iss.title,
          subtitle: iss.name,
          rows: [{ label: "Status", value: iss.status }],
          href: `/projects/issues/${iss.id}`,
        };
      }
      case "EmailMessage": {
        const em = await prisma.emailMessage.findFirst({
          where: { id, tenantId },
          select: { id: true, subject: true, status: true, toEmail: true, createdAt: true },
        });
        if (!em) return null;
        return {
          title: em.subject,
          subtitle: em.toEmail,
          rows: [
            { label: "Status", value: em.status },
            { label: "Sent", value: em.createdAt.toISOString().slice(0, 10) },
          ],
          href: `/admin/emails/${em.id}`,
        };
      }
      default:
        return null;
    }
  }

  const data = await build();
  if (!data) return res.status(404).json({ error: "Not found" });
  res.json(data);
});
