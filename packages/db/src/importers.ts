import { PrismaClient, Prisma } from "@prisma/client";
import { csvIterator, parseCsv, type CsvColumnSpec, coerceCell } from "./csv";
import { parseXlsxToRows } from "./xlsx";

// J3 + J4: Doctype-import registry. Each entry:
//   template  — column spec for the sample CSV download (+ key hints)
//   perform   — per-row upsert into Prisma. Receives the parsed cells
//               (already type-coerced against `template`) plus the mode +
//               keyField from the ImportJob. Returns action + targetId.
//
// Importers here are intentionally minimal; they cover the common master
// data doctypes. Extend by adding entries to IMPORTERS.

export interface ImporterContext {
  prisma: PrismaClient | Prisma.TransactionClient;
  tenantId: string;
  mode: "create" | "upsert" | "update";
  keyField?: string;
  cells: Record<string, unknown>;
  raw: string[]; // untyped copy of the parent row
  // Line rows for the group. Always present — empty for header-only
  // importers or for parent rows that contributed no line fields.
  lines: Record<string, unknown>[];
}

export interface ImporterResult {
  action: "created" | "updated" | "skipped";
  targetId: string;
}

export interface ImporterDef {
  doctype: string;
  template: CsvColumnSpec[];
  supportedKeys: string[]; // legal keyField values for upsert/update
  perform: (ctx: ImporterContext) => Promise<ImporterResult>;
  // Optional line-item support. When both are set, rows are grouped by
  // `parentKey` value: contiguous rows sharing the same parent-key value
  // form one group, and rows with a blank parent-key belong to the current
  // open group. Line fields are collected across every row in the group.
  parentKey?: string;
  lineFields?: CsvColumnSpec[];
}

const CUSTOMER: ImporterDef = {
  doctype: "Customer",
  supportedKeys: ["customerName", "email", "gstin"],
  template: [
    { key: "customerName", label: "Customer Name", type: "string", required: true },
    { key: "customerType", label: "Customer Type", type: "string" },
    { key: "email", label: "Email", type: "string" },
    { key: "mobile", label: "Mobile", type: "string" },
    { key: "gstin", label: "GSTIN", type: "string" },
    { key: "creditLimit", label: "Credit Limit", type: "number" },
  ],
  async perform({ prisma, tenantId, mode, keyField, cells }) {
    const data = {
      customerName: cells.customerName as string,
      customerType: (cells.customerType as string) ?? "Individual",
      email: (cells.email as string) ?? null,
      mobile: (cells.mobile as string) ?? null,
      gstin: (cells.gstin as string) ?? null,
      creditLimit: cells.creditLimit != null ? new Prisma.Decimal(cells.creditLimit as number) : undefined,
    };
    if (mode === "create") {
      const row = await prisma.customer.create({ data: { tenantId, ...data } });
      return { action: "created", targetId: row.id };
    }
    if (!keyField) throw new Error("keyField required for upsert/update");
    const keyVal = cells[keyField];
    if (keyVal == null || keyVal === "")
      throw new Error(`key column "${keyField}" is empty`);
    const existing = await prisma.customer.findFirst({
      where: { tenantId, [keyField]: keyVal },
    });
    if (existing) {
      const row = await prisma.customer.update({ where: { id: existing.id }, data });
      return { action: "updated", targetId: row.id };
    }
    if (mode === "update") return { action: "skipped", targetId: "" };
    const row = await prisma.customer.create({ data: { tenantId, ...data } });
    return { action: "created", targetId: row.id };
  },
};

const SUPPLIER: ImporterDef = {
  doctype: "Supplier",
  supportedKeys: ["supplierName", "email", "gstin"],
  template: [
    { key: "supplierName", label: "Supplier Name", type: "string", required: true },
    { key: "supplierType", label: "Supplier Type", type: "string" },
    { key: "email", label: "Email", type: "string" },
    { key: "mobile", label: "Mobile", type: "string" },
    { key: "gstin", label: "GSTIN", type: "string" },
  ],
  async perform({ prisma, tenantId, mode, keyField, cells }) {
    const data = {
      supplierName: cells.supplierName as string,
      supplierType: (cells.supplierType as string) ?? "Company",
      email: (cells.email as string) ?? null,
      mobile: (cells.mobile as string) ?? null,
      gstin: (cells.gstin as string) ?? null,
    };
    if (mode === "create") {
      const row = await prisma.supplier.create({ data: { tenantId, ...data } });
      return { action: "created", targetId: row.id };
    }
    if (!keyField) throw new Error("keyField required for upsert/update");
    const keyVal = cells[keyField];
    if (keyVal == null || keyVal === "")
      throw new Error(`key column "${keyField}" is empty`);
    const existing = await prisma.supplier.findFirst({
      where: { tenantId, [keyField]: keyVal },
    });
    if (existing) {
      const row = await prisma.supplier.update({ where: { id: existing.id }, data });
      return { action: "updated", targetId: row.id };
    }
    if (mode === "update") return { action: "skipped", targetId: "" };
    const row = await prisma.supplier.create({ data: { tenantId, ...data } });
    return { action: "created", targetId: row.id };
  },
};

const ITEM: ImporterDef = {
  doctype: "Item",
  supportedKeys: ["itemCode"],
  template: [
    { key: "itemCode", label: "Item Code", type: "string", required: true },
    { key: "itemName", label: "Item Name", type: "string", required: true },
    { key: "description", label: "Description", type: "string" },
    { key: "uom", label: "UOM", type: "string" },
    { key: "standardRate", label: "Standard Rate", type: "number" },
    { key: "isStockItem", label: "Is Stock Item", type: "boolean" },
    { key: "itemGroup", label: "Item Group", type: "string" },
  ],
  async perform({ prisma, tenantId, mode, keyField, cells }) {
    const data = {
      itemCode: cells.itemCode as string,
      itemName: cells.itemName as string,
      description: (cells.description as string) ?? null,
      uom: (cells.uom as string) ?? "Unit",
      standardRate:
        cells.standardRate != null
          ? new Prisma.Decimal(cells.standardRate as number)
          : undefined,
      isStockItem: (cells.isStockItem as boolean | null) ?? true,
      itemGroup: (cells.itemGroup as string) ?? null,
    };
    if (mode === "create") {
      const row = await prisma.item.create({ data: { tenantId, ...data } });
      return { action: "created", targetId: row.id };
    }
    const key = keyField ?? "itemCode";
    const keyVal = cells[key];
    if (keyVal == null || keyVal === "")
      throw new Error(`key column "${key}" is empty`);
    const existing = await prisma.item.findFirst({
      where: { tenantId, [key]: keyVal },
    });
    if (existing) {
      const row = await prisma.item.update({ where: { id: existing.id }, data });
      return { action: "updated", targetId: row.id };
    }
    if (mode === "update") return { action: "skipped", targetId: "" };
    const row = await prisma.item.create({ data: { tenantId, ...data } });
    return { action: "created", targetId: row.id };
  },
};

const EMPLOYEE: ImporterDef = {
  doctype: "Employee",
  supportedKeys: ["employeeCode", "email"],
  template: [
    { key: "employeeCode", label: "Employee Code", type: "string" },
    { key: "employeeName", label: "Employee Name", type: "string", required: true },
    { key: "email", label: "Email", type: "string" },
    { key: "mobile", label: "Mobile", type: "string" },
    { key: "designation", label: "Designation", type: "string" },
    { key: "department", label: "Department", type: "string" },
    { key: "dateOfJoining", label: "Date of Joining", type: "date" },
    { key: "baseSalary", label: "Base Salary", type: "number" },
  ],
  async perform({ prisma, tenantId, mode, keyField, cells }) {
    const data = {
      employeeName: cells.employeeName as string,
      email: (cells.email as string) ?? null,
      mobile: (cells.mobile as string) ?? null,
      designation: (cells.designation as string) ?? null,
      department: (cells.department as string) ?? null,
      dateOfJoining: (cells.dateOfJoining as Date) ?? null,
      baseSalary:
        cells.baseSalary != null
          ? new Prisma.Decimal(cells.baseSalary as number)
          : undefined,
    };
    if (mode === "create") {
      // Auto-code if none provided.
      const employeeCode =
        (cells.employeeCode as string) ??
        `EMP-${Date.now().toString(36).slice(-6).toUpperCase()}`;
      const row = await prisma.employee.create({
        data: { tenantId, employeeCode, ...data },
      });
      return { action: "created", targetId: row.id };
    }
    if (!keyField) throw new Error("keyField required for upsert/update");
    const keyVal = cells[keyField];
    if (keyVal == null || keyVal === "")
      throw new Error(`key column "${keyField}" is empty`);
    const existing = await prisma.employee.findFirst({
      where: { tenantId, [keyField]: keyVal },
    });
    if (existing) {
      const row = await prisma.employee.update({ where: { id: existing.id }, data });
      return { action: "updated", targetId: row.id };
    }
    if (mode === "update") return { action: "skipped", targetId: "" };
    const employeeCode =
      (cells.employeeCode as string) ??
      `EMP-${Date.now().toString(36).slice(-6).toUpperCase()}`;
    const row = await prisma.employee.create({
      data: { tenantId, employeeCode, ...data },
    });
    return { action: "created", targetId: row.id };
  },
};

const LEAD: ImporterDef = {
  doctype: "Lead",
  supportedKeys: ["leadName", "email"],
  template: [
    { key: "leadName", label: "Lead Name", type: "string", required: true },
    { key: "companyName", label: "Company", type: "string" },
    { key: "email", label: "Email", type: "string" },
    { key: "mobile", label: "Mobile", type: "string" },
    { key: "status", label: "Status", type: "string" },
    { key: "source", label: "Source", type: "string" },
  ],
  async perform({ prisma, tenantId, mode, keyField, cells }) {
    const data = {
      leadName: cells.leadName as string,
      companyName: (cells.companyName as string) ?? null,
      email: (cells.email as string) ?? null,
      mobile: (cells.mobile as string) ?? null,
      status: (cells.status as string) ?? "Open",
      source: (cells.source as string) ?? null,
    };
    if (mode === "create") {
      const name = `LEAD-${Date.now().toString(36).slice(-6).toUpperCase()}`;
      const row = await prisma.lead.create({ data: { tenantId, name, ...data } });
      return { action: "created", targetId: row.id };
    }
    if (!keyField) throw new Error("keyField required for upsert/update");
    const keyVal = cells[keyField];
    if (keyVal == null || keyVal === "")
      throw new Error(`key column "${keyField}" is empty`);
    const existing = await prisma.lead.findFirst({
      where: { tenantId, [keyField]: keyVal },
    });
    if (existing) {
      const row = await prisma.lead.update({ where: { id: existing.id }, data });
      return { action: "updated", targetId: row.id };
    }
    if (mode === "update") return { action: "skipped", targetId: "" };
    const name = `LEAD-${Date.now().toString(36).slice(-6).toUpperCase()}`;
    const row = await prisma.lead.create({ data: { tenantId, name, ...data } });
    return { action: "created", targetId: row.id };
  },
};

const OPPORTUNITY: ImporterDef = {
  doctype: "Opportunity",
  supportedKeys: ["name"],
  template: [
    { key: "name", label: "Name", type: "string", required: true },
    { key: "partyType", label: "Party Type", type: "string" },
    { key: "customerName", label: "Customer Name", type: "string" },
    { key: "leadName", label: "Lead Name", type: "string" },
    { key: "expectedAmount", label: "Expected Amount", type: "number" },
    { key: "expectedCloseDate", label: "Expected Close Date", type: "date" },
    { key: "status", label: "Status", type: "string" },
    { key: "source", label: "Source", type: "string" },
  ],
  async perform({ prisma, tenantId, mode, keyField, cells }) {
    let customerId: string | null = null;
    let leadId: string | null = null;
    const customerName = cells.customerName as string | undefined;
    const leadName = cells.leadName as string | undefined;
    if (customerName) {
      const customer = await prisma.customer.findFirst({
        where: { tenantId, customerName },
      });
      if (!customer)
        throw new Error(`customer "${customerName}" not found`);
      customerId = customer.id;
    }
    if (leadName) {
      const lead = await prisma.lead.findFirst({
        where: { tenantId, leadName },
      });
      if (!lead) throw new Error(`lead "${leadName}" not found`);
      leadId = lead.id;
    }
    const partyType =
      (cells.partyType as string) ?? (customerId ? "Customer" : "Lead");
    const data = {
      partyType,
      customerId,
      leadId,
      expectedAmount:
        cells.expectedAmount != null
          ? new Prisma.Decimal(cells.expectedAmount as number)
          : undefined,
      expectedCloseDate: (cells.expectedCloseDate as Date) ?? null,
      status: (cells.status as string) ?? "Open",
      source: (cells.source as string) ?? null,
    };
    if (mode === "create") {
      const row = await prisma.opportunity.create({
        data: { tenantId, name: cells.name as string, ...data },
      });
      return { action: "created", targetId: row.id };
    }
    if (!keyField) throw new Error("keyField required for upsert/update");
    const keyVal = cells[keyField];
    if (keyVal == null || keyVal === "")
      throw new Error(`key column "${keyField}" is empty`);
    const existing = await prisma.opportunity.findFirst({
      where: { tenantId, [keyField]: keyVal },
    });
    if (existing) {
      const row = await prisma.opportunity.update({
        where: { id: existing.id },
        data,
      });
      return { action: "updated", targetId: row.id };
    }
    if (mode === "update") return { action: "skipped", targetId: "" };
    const row = await prisma.opportunity.create({
      data: { tenantId, name: cells.name as string, ...data },
    });
    return { action: "created", targetId: row.id };
  },
};

const WAREHOUSE: ImporterDef = {
  doctype: "Warehouse",
  supportedKeys: ["warehouseName"],
  template: [
    { key: "warehouseName", label: "Warehouse Name", type: "string", required: true },
    { key: "isGroup", label: "Is Group", type: "boolean" },
    { key: "parentWarehouseName", label: "Parent Warehouse", type: "string" },
  ],
  async perform({ prisma, tenantId, mode, keyField, cells }) {
    let parentId: string | null = null;
    const parentWarehouseName = cells.parentWarehouseName as string | undefined;
    if (parentWarehouseName) {
      const parent = await prisma.warehouse.findFirst({
        where: { tenantId, warehouseName: parentWarehouseName },
      });
      if (!parent)
        throw new Error(`parent warehouse "${parentWarehouseName}" not found`);
      parentId = parent.id;
    }
    const data = {
      warehouseName: cells.warehouseName as string,
      isGroup: (cells.isGroup as boolean | null) ?? false,
      parentId,
    };
    if (mode === "create") {
      const row = await prisma.warehouse.create({ data: { tenantId, ...data } });
      return { action: "created", targetId: row.id };
    }
    if (!keyField) throw new Error("keyField required for upsert/update");
    const keyVal = cells[keyField];
    if (keyVal == null || keyVal === "")
      throw new Error(`key column "${keyField}" is empty`);
    const existing = await prisma.warehouse.findFirst({
      where: { tenantId, [keyField]: keyVal },
    });
    if (existing) {
      const row = await prisma.warehouse.update({ where: { id: existing.id }, data });
      return { action: "updated", targetId: row.id };
    }
    if (mode === "update") return { action: "skipped", targetId: "" };
    const row = await prisma.warehouse.create({ data: { tenantId, ...data } });
    return { action: "created", targetId: row.id };
  },
};

export interface ImportRunResult {
  totalRows: number;
  succeeded: number;
  failed: number;
  rowResults: {
    rowNumber: number;
    status: "Succeeded" | "Failed";
    action?: ImporterResult["action"];
    targetId?: string;
    error?: string;
    raw: Record<string, string>;
  }[];
}

// Format-agnostic entry point. Accepts either a CSV string or an .xlsx
// buffer; xlsx is normalized to the same string[][] grid by the sheetjs
// adapter so the rest of the pipeline is identical.
export async function runImportFromBuffer(
  prisma: PrismaClient,
  tenantId: string,
  doctype: string,
  data: string | Buffer,
  opts: {
    format: "csv" | "xlsx";
    mode: "create" | "upsert" | "update";
    keyField?: string;
    commit: boolean;
    columnMap?: Record<string, string>;
  },
): Promise<ImportRunResult> {
  if (opts.format === "xlsx") {
    if (typeof data === "string")
      throw new Error("xlsx import requires a Buffer, got string");
    const rows = parseXlsxToRows(data);
    // Re-serialize to CSV using the toCsvRow escaper so runImport's csv path
    // handles it. Avoids a parallel iterator implementation.
    const csvText = rows
      .map((r) =>
        r
          .map((c) => {
            const s = c ?? "";
            return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(","),
      )
      .join("\n");
    return runImport(prisma, tenantId, doctype, csvText, {
      mode: opts.mode,
      keyField: opts.keyField,
      commit: opts.commit,
      columnMap: opts.columnMap,
    });
  }
  const csvText = typeof data === "string" ? data : data.toString("utf-8");
  return runImport(prisma, tenantId, doctype, csvText, {
    mode: opts.mode,
    keyField: opts.keyField,
    commit: opts.commit,
    columnMap: opts.columnMap,
  });
}

// Transactional importers below create Draft rows only (header-only — line
// items aren't part of the CSV shape). Users submit from the UI after import.
// Names may be omitted; when blank the importer generates one via the shared
// prefix (QTN-/SO-/SINV-/PINV-/PE-) with a random suffix.

async function resolveCustomerId(
  prisma: ImporterContext["prisma"],
  tenantId: string,
  customerName: string,
): Promise<string> {
  const c = await prisma.customer.findFirst({
    where: { tenantId, customerName },
  });
  if (!c) throw new Error(`customer "${customerName}" not found`);
  return c.id;
}
async function resolveSupplierId(
  prisma: ImporterContext["prisma"],
  tenantId: string,
  supplierName: string,
): Promise<string> {
  const s = await prisma.supplier.findFirst({
    where: { tenantId, supplierName },
  });
  if (!s) throw new Error(`supplier "${supplierName}" not found`);
  return s.id;
}
async function resolveItemId(
  prisma: ImporterContext["prisma"],
  tenantId: string,
  itemCode: string,
): Promise<string> {
  const i = await prisma.item.findFirst({
    where: { tenantId, itemCode },
  });
  if (!i) throw new Error(`item "${itemCode}" not found`);
  return i.id;
}
function autoName(prefix: string): string {
  return `${prefix}${Date.now().toString(36).slice(-6).toUpperCase()}`;
}

// Shared column spec for line rows on the 4 transactional templates. Line
// rows carry itemCode + qty + rate (+ optional description). Amount is
// derived as qty * rate — never trust an imported "amount" column since the
// downstream perform recomputes it.
const TXN_LINE_FIELDS: CsvColumnSpec[] = [
  { key: "itemCode", label: "Item Code", type: "string" },
  { key: "qty", label: "Qty", type: "number" },
  { key: "rate", label: "Rate", type: "number" },
  { key: "description", label: "Line Description", type: "string" },
];

// Materialize the {itemId, qty, rate, amount, description} shape prisma
// expects from a batch of coerced line rows. Also resolves itemCode → itemId
// so the caller doesn't need to think about it.
async function buildTxnLineRows(
  prisma: ImporterContext["prisma"],
  tenantId: string,
  lines: Record<string, unknown>[],
): Promise<
  {
    itemId: string;
    qty: Prisma.Decimal;
    rate: Prisma.Decimal;
    amount: Prisma.Decimal;
    description: string | null;
  }[]
> {
  const out: Awaited<ReturnType<typeof buildTxnLineRows>> = [];
  for (const l of lines) {
    const itemCode = l.itemCode as string | undefined;
    const qty = l.qty as number | undefined;
    const rate = l.rate as number | undefined;
    if (!itemCode) throw new Error("line row missing itemCode");
    if (qty == null) throw new Error(`line ${itemCode}: qty required`);
    if (rate == null) throw new Error(`line ${itemCode}: rate required`);
    const itemId = await resolveItemId(prisma, tenantId, itemCode);
    out.push({
      itemId,
      qty: new Prisma.Decimal(qty),
      rate: new Prisma.Decimal(rate),
      amount: new Prisma.Decimal(qty * rate),
      description: (l.description as string) ?? null,
    });
  }
  return out;
}

const QUOTATION: ImporterDef = {
  doctype: "Quotation",
  supportedKeys: ["name"],
  parentKey: "name",
  lineFields: TXN_LINE_FIELDS,
  template: [
    { key: "name", label: "Name", type: "string" },
    { key: "customerName", label: "Customer Name", type: "string", required: true },
    { key: "quotationDate", label: "Quotation Date", type: "date" },
    { key: "validTill", label: "Valid Till", type: "date" },
    { key: "currency", label: "Currency", type: "string" },
    { key: "remarks", label: "Remarks", type: "string" },
  ],
  async perform({ prisma, tenantId, mode, keyField, cells, lines }) {
    const customerId = await resolveCustomerId(
      prisma,
      tenantId,
      cells.customerName as string,
    );
    const data = {
      partyType: "Customer",
      customerId,
      quotationDate: (cells.quotationDate as Date) ?? new Date(),
      validTill: (cells.validTill as Date) ?? null,
      currency: (cells.currency as string) ?? "INR",
      remarks: (cells.remarks as string) ?? null,
      status: "Draft",
    };
    const name = (cells.name as string) ?? autoName("QTN-");
    const lineRows = await buildTxnLineRows(prisma, tenantId, lines);

    if (mode === "create") {
      const row = await prisma.quotation.create({
        data: {
          tenantId,
          name,
          ...data,
          items: lineRows.length ? { create: lineRows } : undefined,
        },
      });
      return { action: "created", targetId: row.id };
    }
    const kf = keyField ?? "name";
    const kv = cells[kf];
    if (kv == null || kv === "") throw new Error(`key column "${kf}" is empty`);
    const existing = await prisma.quotation.findFirst({
      where: { tenantId, [kf]: kv },
    });
    if (existing) {
      // Bulk-replace lines on upsert/update — simpler + matches user intent
      // (re-importing a doc means the file is authoritative).
      const row = await (prisma as PrismaClient).$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.quotationItem.deleteMany({ where: { quotationId: existing.id } });
        return tx.quotation.update({
          where: { id: existing.id },
          data: {
            ...data,
            items: lineRows.length ? { create: lineRows } : undefined,
          },
        });
      });
      return { action: "updated", targetId: row.id };
    }
    if (mode === "update") return { action: "skipped", targetId: "" };
    const row = await prisma.quotation.create({
      data: {
        tenantId,
        name,
        ...data,
        items: lineRows.length ? { create: lineRows } : undefined,
      },
    });
    return { action: "created", targetId: row.id };
  },
};

const SALES_ORDER: ImporterDef = {
  doctype: "SalesOrder",
  supportedKeys: ["name"],
  parentKey: "name",
  lineFields: TXN_LINE_FIELDS,
  template: [
    { key: "name", label: "Name", type: "string" },
    { key: "customerName", label: "Customer Name", type: "string", required: true },
    { key: "orderDate", label: "Order Date", type: "date" },
    { key: "deliveryDate", label: "Delivery Date", type: "date" },
    { key: "currency", label: "Currency", type: "string" },
    { key: "remarks", label: "Remarks", type: "string" },
  ],
  async perform({ prisma, tenantId, mode, keyField, cells, lines }) {
    const customerId = await resolveCustomerId(
      prisma,
      tenantId,
      cells.customerName as string,
    );
    const data = {
      customerId,
      orderDate: (cells.orderDate as Date) ?? new Date(),
      deliveryDate: (cells.deliveryDate as Date) ?? null,
      currency: (cells.currency as string) ?? "INR",
      remarks: (cells.remarks as string) ?? null,
      status: "Draft",
    };
    const name = (cells.name as string) ?? autoName("SO-");
    const lineRows = await buildTxnLineRows(prisma, tenantId, lines);

    if (mode === "create") {
      const row = await prisma.salesOrder.create({
        data: {
          tenantId,
          name,
          ...data,
          items: lineRows.length ? { create: lineRows } : undefined,
        },
      });
      return { action: "created", targetId: row.id };
    }
    const kf = keyField ?? "name";
    const kv = cells[kf];
    if (kv == null || kv === "") throw new Error(`key column "${kf}" is empty`);
    const existing = await prisma.salesOrder.findFirst({
      where: { tenantId, [kf]: kv },
    });
    if (existing) {
      const row = await (prisma as PrismaClient).$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.salesOrderItem.deleteMany({ where: { salesOrderId: existing.id } });
        return tx.salesOrder.update({
          where: { id: existing.id },
          data: {
            ...data,
            items: lineRows.length ? { create: lineRows } : undefined,
          },
        });
      });
      return { action: "updated", targetId: row.id };
    }
    if (mode === "update") return { action: "skipped", targetId: "" };
    const row = await prisma.salesOrder.create({
      data: {
        tenantId,
        name,
        ...data,
        items: lineRows.length ? { create: lineRows } : undefined,
      },
    });
    return { action: "created", targetId: row.id };
  },
};

const SALES_INVOICE: ImporterDef = {
  doctype: "SalesInvoice",
  supportedKeys: ["name"],
  parentKey: "name",
  lineFields: TXN_LINE_FIELDS,
  template: [
    { key: "name", label: "Name", type: "string" },
    { key: "customerName", label: "Customer Name", type: "string", required: true },
    { key: "postingDate", label: "Posting Date", type: "date" },
    { key: "dueDate", label: "Due Date", type: "date" },
    { key: "currency", label: "Currency", type: "string" },
    { key: "remarks", label: "Remarks", type: "string" },
  ],
  async perform({ prisma, tenantId, mode, keyField, cells, lines }) {
    const customerId = await resolveCustomerId(
      prisma,
      tenantId,
      cells.customerName as string,
    );
    const data = {
      customerId,
      postingDate: (cells.postingDate as Date) ?? new Date(),
      dueDate: (cells.dueDate as Date) ?? null,
      currency: (cells.currency as string) ?? "INR",
      remarks: (cells.remarks as string) ?? null,
      status: "Draft",
    };
    const name = (cells.name as string) ?? autoName("SINV-");
    const lineRows = await buildTxnLineRows(prisma, tenantId, lines);

    if (mode === "create") {
      const row = await prisma.salesInvoice.create({
        data: {
          tenantId,
          name,
          ...data,
          items: lineRows.length ? { create: lineRows } : undefined,
        },
      });
      return { action: "created", targetId: row.id };
    }
    const kf = keyField ?? "name";
    const kv = cells[kf];
    if (kv == null || kv === "") throw new Error(`key column "${kf}" is empty`);
    const existing = await prisma.salesInvoice.findFirst({
      where: { tenantId, [kf]: kv },
    });
    if (existing) {
      const row = await (prisma as PrismaClient).$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.salesInvoiceItem.deleteMany({
          where: { salesInvoiceId: existing.id },
        });
        return tx.salesInvoice.update({
          where: { id: existing.id },
          data: {
            ...data,
            items: lineRows.length ? { create: lineRows } : undefined,
          },
        });
      });
      return { action: "updated", targetId: row.id };
    }
    if (mode === "update") return { action: "skipped", targetId: "" };
    const row = await prisma.salesInvoice.create({
      data: {
        tenantId,
        name,
        ...data,
        items: lineRows.length ? { create: lineRows } : undefined,
      },
    });
    return { action: "created", targetId: row.id };
  },
};

const PURCHASE_INVOICE: ImporterDef = {
  doctype: "PurchaseInvoice",
  supportedKeys: ["name", "supplierInvoiceNo"],
  parentKey: "name",
  lineFields: TXN_LINE_FIELDS,
  template: [
    { key: "name", label: "Name", type: "string" },
    { key: "supplierName", label: "Supplier Name", type: "string", required: true },
    { key: "supplierInvoiceNo", label: "Supplier Bill No", type: "string" },
    { key: "postingDate", label: "Posting Date", type: "date" },
    { key: "dueDate", label: "Due Date", type: "date" },
    { key: "currency", label: "Currency", type: "string" },
    { key: "remarks", label: "Remarks", type: "string" },
  ],
  async perform({ prisma, tenantId, mode, keyField, cells, lines }) {
    const supplierId = await resolveSupplierId(
      prisma,
      tenantId,
      cells.supplierName as string,
    );
    const data = {
      supplierId,
      supplierInvoiceNo: (cells.supplierInvoiceNo as string) ?? null,
      postingDate: (cells.postingDate as Date) ?? new Date(),
      dueDate: (cells.dueDate as Date) ?? null,
      currency: (cells.currency as string) ?? "INR",
      remarks: (cells.remarks as string) ?? null,
      status: "Draft",
    };
    const name = (cells.name as string) ?? autoName("PINV-");
    const lineRows = await buildTxnLineRows(prisma, tenantId, lines);

    if (mode === "create") {
      const row = await prisma.purchaseInvoice.create({
        data: {
          tenantId,
          name,
          ...data,
          items: lineRows.length ? { create: lineRows } : undefined,
        },
      });
      return { action: "created", targetId: row.id };
    }
    const kf = keyField ?? "name";
    const kv = cells[kf];
    if (kv == null || kv === "") throw new Error(`key column "${kf}" is empty`);
    const existing = await prisma.purchaseInvoice.findFirst({
      where: { tenantId, [kf]: kv },
    });
    if (existing) {
      const row = await (prisma as PrismaClient).$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.purchaseInvoiceItem.deleteMany({
          where: { purchaseInvoiceId: existing.id },
        });
        return tx.purchaseInvoice.update({
          where: { id: existing.id },
          data: {
            ...data,
            items: lineRows.length ? { create: lineRows } : undefined,
          },
        });
      });
      return { action: "updated", targetId: row.id };
    }
    if (mode === "update") return { action: "skipped", targetId: "" };
    const row = await prisma.purchaseInvoice.create({
      data: {
        tenantId,
        name,
        ...data,
        items: lineRows.length ? { create: lineRows } : undefined,
      },
    });
    return { action: "created", targetId: row.id };
  },
};

// PaymentEntry line rows represent invoice allocations (PaymentEntryReference).
// Users list one line per invoice being allocated against, keyed by the
// invoice's `name` column (e.g., SINV-0001 / PINV-0042). The importer
// resolves each name to its id.
const PE_LINE_FIELDS: CsvColumnSpec[] = [
  { key: "refDoctype", label: "Reference Doctype", type: "string" },
  { key: "refName", label: "Reference Name", type: "string" },
  { key: "allocated", label: "Allocated Amount", type: "number" },
];

async function buildPeReferenceRows(
  prisma: ImporterContext["prisma"],
  tenantId: string,
  lines: Record<string, unknown>[],
): Promise<
  {
    referenceDoctype: string;
    referenceId: string;
    allocatedAmount: Prisma.Decimal;
  }[]
> {
  const out: Awaited<ReturnType<typeof buildPeReferenceRows>> = [];
  for (const l of lines) {
    const doctype = l.refDoctype as string | undefined;
    const refName = l.refName as string | undefined;
    const allocated = l.allocated as number | undefined;
    if (!doctype) throw new Error("reference row missing refDoctype");
    if (!refName) throw new Error("reference row missing refName");
    if (allocated == null)
      throw new Error(`reference ${refName}: allocated required`);
    if (doctype !== "SalesInvoice" && doctype !== "PurchaseInvoice") {
      throw new Error(
        `refDoctype "${doctype}" must be SalesInvoice or PurchaseInvoice`,
      );
    }
    const inv =
      doctype === "SalesInvoice"
        ? await prisma.salesInvoice.findFirst({ where: { tenantId, name: refName } })
        : await prisma.purchaseInvoice.findFirst({
            where: { tenantId, name: refName },
          });
    if (!inv) throw new Error(`${doctype} "${refName}" not found`);
    out.push({
      referenceDoctype: doctype,
      referenceId: inv.id,
      allocatedAmount: new Prisma.Decimal(allocated),
    });
  }
  return out;
}

const PAYMENT_ENTRY: ImporterDef = {
  doctype: "PaymentEntry",
  supportedKeys: ["name"],
  parentKey: "name",
  lineFields: PE_LINE_FIELDS,
  template: [
    { key: "name", label: "Name", type: "string" },
    { key: "paymentType", label: "Payment Type", type: "string", required: true },
    { key: "partyType", label: "Party Type", type: "string", required: true },
    { key: "partyName", label: "Party Name", type: "string", required: true },
    { key: "postingDate", label: "Posting Date", type: "date" },
    { key: "paidAmount", label: "Paid Amount", type: "number", required: true },
    { key: "currency", label: "Currency", type: "string" },
    { key: "modeOfPayment", label: "Mode of Payment", type: "string" },
    { key: "remarks", label: "Remarks", type: "string" },
  ],
  async perform({ prisma, tenantId, mode, keyField, cells, lines }) {
    const paymentType = cells.paymentType as string;
    if (paymentType !== "Receive" && paymentType !== "Pay")
      throw new Error(`paymentType must be Receive or Pay, got "${paymentType}"`);
    const partyType = cells.partyType as string;
    if (partyType !== "Customer" && partyType !== "Supplier")
      throw new Error(`partyType must be Customer or Supplier, got "${partyType}"`);
    const partyName = cells.partyName as string;
    const partyId =
      partyType === "Customer"
        ? await resolveCustomerId(prisma, tenantId, partyName)
        : await resolveSupplierId(prisma, tenantId, partyName);
    const paidAmount = cells.paidAmount as number;
    const data = {
      paymentType,
      partyType,
      partyId,
      postingDate: (cells.postingDate as Date) ?? new Date(),
      paidAmount: new Prisma.Decimal(paidAmount),
      currency: (cells.currency as string) ?? "INR",
      modeOfPayment: (cells.modeOfPayment as string) ?? "Cash",
      remarks: (cells.remarks as string) ?? null,
      status: "Draft",
    };
    const name = (cells.name as string) ?? autoName("PE-");
    const refRows = await buildPeReferenceRows(prisma, tenantId, lines);

    if (mode === "create") {
      const row = await prisma.paymentEntry.create({
        data: {
          tenantId,
          name,
          ...data,
          references: refRows.length ? { create: refRows } : undefined,
        },
      });
      return { action: "created", targetId: row.id };
    }
    const kf = keyField ?? "name";
    const kv = cells[kf];
    if (kv == null || kv === "") throw new Error(`key column "${kf}" is empty`);
    const existing = await prisma.paymentEntry.findFirst({
      where: { tenantId, [kf]: kv },
    });
    if (existing) {
      const row = await (prisma as PrismaClient).$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.paymentEntryReference.deleteMany({
          where: { paymentEntryId: existing.id },
        });
        return tx.paymentEntry.update({
          where: { id: existing.id },
          data: {
            ...data,
            references: refRows.length ? { create: refRows } : undefined,
          },
        });
      });
      return { action: "updated", targetId: row.id };
    }
    if (mode === "update") return { action: "skipped", targetId: "" };
    const row = await prisma.paymentEntry.create({
      data: {
        tenantId,
        name,
        ...data,
        references: refRows.length ? { create: refRows } : undefined,
      },
    });
    return { action: "created", targetId: row.id };
  },
};

export const IMPORTERS: Record<string, ImporterDef> = {
  Customer: CUSTOMER,
  Supplier: SUPPLIER,
  Item: ITEM,
  Employee: EMPLOYEE,
  Lead: LEAD,
  Opportunity: OPPORTUNITY,
  Warehouse: WAREHOUSE,
  Quotation: QUOTATION,
  SalesOrder: SALES_ORDER,
  SalesInvoice: SALES_INVOICE,
  PurchaseInvoice: PURCHASE_INVOICE,
  PaymentEntry: PAYMENT_ENTRY,
};

export const IMPORTABLE_DOCTYPES = Object.keys(IMPORTERS);

// Runs an import in-process. `commit=false` yields dry-run rowResults with
// no writes. Rows that throw during coerce/perform are captured and don't
// halt the batch. Returns aggregated counts.
//
// `columnMap` lets callers alias the source header names to the importer's
// template keys — the wizard UI produces this after the user matches columns.
// Format is `{ srcHeader → templateKey }`. Any src header not in the map is
// tried against the template as-is.
export async function runImport(
  prisma: PrismaClient,
  tenantId: string,
  doctype: string,
  csvText: string,
  opts: {
    mode: "create" | "upsert" | "update";
    keyField?: string;
    commit: boolean;
    columnMap?: Record<string, string>;
  },
): Promise<ImportRunResult> {
  const def = IMPORTERS[doctype];
  if (!def) throw new Error(`Doctype "${doctype}" is not importable`);
  if (opts.mode !== "create" && opts.keyField) {
    if (!def.supportedKeys.includes(opts.keyField))
      throw new Error(
        `keyField "${opts.keyField}" not supported for ${doctype} (allowed: ${def.supportedKeys.join(", ")})`,
      );
  }

  const parsed = parseCsv(csvText);
  const columnMap = opts.columnMap;
  if (columnMap && parsed.length > 0) {
    parsed[0] = parsed[0].map((h) => {
      const k = h.trim();
      return columnMap[k] ?? k;
    });
  }
  const { header, iter } = csvIterator(parsed);
  const parentSpecByKey = new Map(def.template.map((c) => [c.key, c] as const));
  const lineSpecByKey = new Map(
    (def.lineFields ?? []).map((c) => [c.key, c] as const),
  );
  const allSpecByKey = new Map<string, CsvColumnSpec>([
    ...parentSpecByKey,
    ...lineSpecByKey,
  ]);

  const rowResults: Awaited<ReturnType<typeof runImport>>["rowResults"] = [];
  let succeeded = 0;
  let failed = 0;

  // Group rows into (parent, lines[]) tuples. Header-only importers (no
  // lineFields / no parentKey) produce one group per row. Line-item
  // importers group contiguous rows sharing the same parent-key value; a
  // blank parent-key cell continues the current open group.
  interface Group {
    parentRowNumber: number;
    parentRaw: Record<string, string>;
    parentCells: Record<string, unknown>;
    lineRows: {
      rowNumber: number;
      raw: Record<string, string>;
      cells: Record<string, unknown>;
    }[];
    // Set when parent-row parsing threw. We still report the group but skip perform.
    parseError?: string;
  }
  const groups: Group[] = [];
  let currentParentKey: string | null = null;
  const hasLineMode = !!(def.parentKey && def.lineFields);

  for (const row of iter) {
    const raw: Record<string, string> = {};
    header.forEach((h) => {
      raw[h] = row.cell(h);
    });

    const anyLineFieldFilled =
      hasLineMode &&
      (def.lineFields ?? []).some((lf) => (row.cell(lf.key) ?? "").trim() !== "");

    const parentKeyValue = hasLineMode ? row.cell(def.parentKey!).trim() : "";

    // Decide whether this row starts a new group or continues the previous one.
    let startsNewGroup = true;
    if (hasLineMode) {
      if (parentKeyValue === "") {
        // Blank parent-key: continuation row for the current group. Only
        // valid when a group already exists.
        if (groups.length > 0) {
          startsNewGroup = false;
        } else {
          // No previous group — treat as an error row.
          failed += 1;
          rowResults.push({
            rowNumber: row.rowNumber,
            status: "Failed",
            error: `first row has blank "${def.parentKey}" — cannot continue a non-existent group`,
            raw,
          });
          continue;
        }
      } else if (
        currentParentKey !== null &&
        parentKeyValue === currentParentKey
      ) {
        // Same parent-key as the open group: append (forgiving mode for
        // users who repeat the parent value on every row).
        startsNewGroup = false;
      }
    }

    if (startsNewGroup) {
      // Coerce parent-level fields.
      let parentCells: Record<string, unknown> = {};
      let parseError: string | undefined;
      try {
        for (const spec of def.template) {
          if (row.index(spec.key) === undefined) {
            if (spec.required) throw new Error(`missing column "${spec.key}"`);
            continue;
          }
          parentCells[spec.key] = coerceCell(spec, row.cell(spec.key));
        }
        // Extra unmapped columns kept as raw strings.
        for (const h of header) {
          if (!(h in parentCells) && !allSpecByKey.has(h)) {
            parentCells[h] = row.cell(h);
          }
        }
      } catch (e) {
        parseError = e instanceof Error ? e.message : String(e);
      }
      const group: Group = {
        parentRowNumber: row.rowNumber,
        parentRaw: raw,
        parentCells,
        lineRows: [],
        parseError,
      };
      groups.push(group);
      currentParentKey = hasLineMode ? parentKeyValue : null;
    }

    // If this row carries any line-field data, coerce + attach to the
    // current group. Applies to both starter rows and continuation rows.
    if (hasLineMode && anyLineFieldFilled) {
      const group = groups[groups.length - 1];
      try {
        const lineCells: Record<string, unknown> = {};
        for (const spec of def.lineFields!) {
          if (row.index(spec.key) === undefined) {
            if (spec.required) throw new Error(`missing column "${spec.key}"`);
            continue;
          }
          lineCells[spec.key] = coerceCell(spec, row.cell(spec.key));
        }
        group.lineRows.push({
          rowNumber: row.rowNumber,
          raw,
          cells: lineCells,
        });
      } catch (e) {
        // Line-parse errors are attached to the group's parseError so the
        // whole group fails atomically. Simpler than partial writes.
        group.parseError = (group.parseError ? `${group.parseError}; ` : "") +
          `line row ${row.rowNumber}: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  }

  // Now execute per-group perform.
  for (const g of groups) {
    if (g.parseError) {
      failed += 1;
      rowResults.push({
        rowNumber: g.parentRowNumber,
        status: "Failed",
        error: g.parseError,
        raw: g.parentRaw,
      });
      continue;
    }

    if (!opts.commit) {
      // Dry-run: no writes. Reported as would-succeed.
      succeeded += 1;
      rowResults.push({
        rowNumber: g.parentRowNumber,
        status: "Succeeded",
        action: "created",
        raw: g.parentRaw,
      });
      continue;
    }

    try {
      const result = await def.perform({
        prisma,
        tenantId,
        mode: opts.mode,
        keyField: opts.keyField,
        cells: g.parentCells,
        raw: [], // parent-row raw retained via g.parentRaw
        lines: g.lineRows.map((l) => l.cells),
      });
      succeeded += 1;
      rowResults.push({
        rowNumber: g.parentRowNumber,
        status: "Succeeded",
        action: result.action,
        targetId: result.targetId,
        raw: g.parentRaw,
      });
    } catch (e) {
      failed += 1;
      rowResults.push({
        rowNumber: g.parentRowNumber,
        status: "Failed",
        error: e instanceof Error ? e.message : String(e),
        raw: g.parentRaw,
      });
    }
  }

  return { totalRows: iter.length, succeeded, failed, rowResults };
}
