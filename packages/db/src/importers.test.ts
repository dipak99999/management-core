import { describe, expect, it, vi } from "vitest";
import { IMPORTABLE_DOCTYPES, IMPORTERS, runImport } from "./importers";

describe("IMPORTERS registry", () => {
  it("exposes template columns for each importable doctype", () => {
    for (const dt of IMPORTABLE_DOCTYPES) {
      const def = IMPORTERS[dt];
      expect(def, `missing importer for ${dt}`).toBeDefined();
      expect(def.template.length).toBeGreaterThan(0);
      // Every declared supported key must correspond to a template column.
      for (const k of def.supportedKeys) {
        expect(def.template.find((c) => c.key === k), `${dt}: supportedKey ${k} not in template`).toBeDefined();
      }
    }
  });

  it("covers the master + CRM master data doctypes plus transactional docs (with line items)", () => {
    expect(IMPORTABLE_DOCTYPES.sort()).toEqual(
      [
        "Customer",
        "Employee",
        "Item",
        "Lead",
        "Opportunity",
        "PaymentEntry",
        "PurchaseInvoice",
        "Quotation",
        "SalesInvoice",
        "SalesOrder",
        "Supplier",
        "Warehouse",
      ].sort(),
    );
  });
});

describe("runImport", () => {
  it("dry-run reports required-field errors without touching Prisma", async () => {
    const prisma = { customer: { create: vi.fn(), findFirst: vi.fn() } } as unknown as Parameters<typeof runImport>[0];
    // Two columns so a row with an empty required cell isn't stripped as a
    // "trailing empty row" by parseCsv (that guard fires when the last row
    // has exactly one empty cell).
    const csv = "customerName,email\n,alice@example.com";
    const r = await runImport(prisma, "t1", "Customer", csv, {
      mode: "create",
      commit: false,
    });
    expect(r.totalRows).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.rowResults[0].error).toMatch(/required/i);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma as any).customer.create).not.toHaveBeenCalled();
  });

  it("dry-run marks valid rows as would-succeed", async () => {
    const prisma = { customer: { create: vi.fn() } } as unknown as Parameters<typeof runImport>[0];
    const csv = "customerName\nAlice";
    const r = await runImport(prisma, "t1", "Customer", csv, {
      mode: "create",
      commit: false,
    });
    expect(r.succeeded).toBe(1);
    expect(r.rowResults[0].action).toBe("created");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((prisma as any).customer.create).not.toHaveBeenCalled();
  });

  it("commit=true calls the delegate", async () => {
    const create = vi.fn().mockResolvedValue({ id: "cust-1" });
    const prisma = { customer: { create } } as unknown as Parameters<typeof runImport>[0];
    const csv = "customerName\nAlice";
    const r = await runImport(prisma, "t1", "Customer", csv, {
      mode: "create",
      commit: true,
    });
    expect(create).toHaveBeenCalledOnce();
    expect(r.succeeded).toBe(1);
    expect(r.rowResults[0].targetId).toBe("cust-1");
  });

  it("rejects an unknown doctype", async () => {
    await expect(
      runImport({} as never, "t1", "Nope", "a,b\n1,2", {
        mode: "create",
        commit: false,
      }),
    ).rejects.toThrow(/not importable/);
  });

  it("rejects an unsupported keyField on upsert", async () => {
    await expect(
      runImport({} as never, "t1", "Customer", "customerName\nA", {
        mode: "upsert",
        keyField: "nope",
        commit: false,
      }),
    ).rejects.toThrow(/not supported/);
  });
});

// Line-item grouping — verified against the SalesInvoice importer.
// Commit=false so we don't touch Prisma; grouping happens in runImport.
describe("runImport line-item grouping", () => {
  it("dry-run: two invoices, one with two lines, treated as two groups", async () => {
    const csv =
      [
        "name,customerName,itemCode,qty,rate",
        "SINV-A,Acme,ITM-1,2,100",
        ",,ITM-2,1,50", // continuation (blank name)
        "SINV-B,Beta,ITM-1,3,20",
      ].join("\n");
    const r = await runImport({} as never, "t1", "SalesInvoice", csv, {
      mode: "create",
      commit: false,
    });
    expect(r.totalRows).toBe(3);
    // Two groups → two result rows (parent rows only).
    expect(r.rowResults).toHaveLength(2);
    expect(r.rowResults[0].rowNumber).toBe(1);
    expect(r.rowResults[1].rowNumber).toBe(3);
    expect(r.succeeded).toBe(2);
  });

  it("groups by same non-blank parent-key too (forgiving mode)", async () => {
    const csv =
      [
        "name,customerName,itemCode,qty,rate",
        "SINV-A,Acme,ITM-1,2,100",
        "SINV-A,Acme,ITM-2,1,50", // same name repeated — treated as one group
      ].join("\n");
    const r = await runImport({} as never, "t1", "SalesInvoice", csv, {
      mode: "create",
      commit: false,
    });
    expect(r.rowResults).toHaveLength(1);
    expect(r.succeeded).toBe(1);
  });

  it("first-row-blank-parent errors out on that row and continues", async () => {
    const csv =
      [
        "name,customerName,itemCode,qty,rate",
        ",,ITM-1,1,10", // orphan continuation — no parent yet
        "SINV-A,Acme,ITM-1,2,100",
      ].join("\n");
    const r = await runImport({} as never, "t1", "SalesInvoice", csv, {
      mode: "create",
      commit: false,
    });
    expect(r.failed).toBe(1);
    expect(r.succeeded).toBe(1);
    expect(r.rowResults[0].error).toMatch(/blank.*continue/);
  });

  it("commit=true: creates SI with items nested; line qty coerced to number", async () => {
    const customer = { findFirst: vi.fn().mockResolvedValue({ id: "c1" }) };
    const item = {
      findFirst: vi
        .fn()
        .mockResolvedValueOnce({ id: "i1" })
        .mockResolvedValueOnce({ id: "i2" }),
    };
    const salesInvoiceCreate = vi.fn().mockResolvedValue({ id: "si1" });
    const prisma = {
      customer,
      item,
      salesInvoice: { create: salesInvoiceCreate, findFirst: vi.fn() },
    } as unknown as Parameters<typeof runImport>[0];
    const csv =
      [
        "name,customerName,itemCode,qty,rate",
        "SINV-A,Acme,ITM-1,2,100",
        ",,ITM-2,3,50",
      ].join("\n");
    const r = await runImport(prisma, "t1", "SalesInvoice", csv, {
      mode: "create",
      commit: true,
    });
    expect(r.succeeded).toBe(1);
    expect(salesInvoiceCreate).toHaveBeenCalledOnce();
    const arg = salesInvoiceCreate.mock.calls[0][0];
    const createdLines = arg.data.items.create;
    expect(createdLines).toHaveLength(2);
    expect(createdLines[0].itemId).toBe("i1");
    expect(createdLines[1].itemId).toBe("i2");
    // qty and rate coerced to Decimal from CSV strings; amount computed.
    expect(String(createdLines[0].qty)).toBe("2");
    expect(String(createdLines[0].amount)).toBe("200");
    expect(String(createdLines[1].amount)).toBe("150");
  });

  it("PaymentEntry: resolves refName → invoice id per allocation line", async () => {
    const customer = { findFirst: vi.fn().mockResolvedValue({ id: "c1" }) };
    const salesInvoiceFindFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: "sinv-1-id" })
      .mockResolvedValueOnce({ id: "sinv-2-id" });
    const peCreate = vi.fn().mockResolvedValue({ id: "pe1" });
    const prisma = {
      customer,
      salesInvoice: { findFirst: salesInvoiceFindFirst },
      paymentEntry: { create: peCreate, findFirst: vi.fn() },
    } as unknown as Parameters<typeof runImport>[0];
    const csv =
      [
        "name,paymentType,partyType,partyName,paidAmount,refDoctype,refName,allocated",
        "PE-A,Receive,Customer,Acme,150,SalesInvoice,SINV-1,100",
        ",,,,,SalesInvoice,SINV-2,50",
      ].join("\n");
    const r = await runImport(prisma, "t1", "PaymentEntry", csv, {
      mode: "create",
      commit: true,
    });
    expect(r.succeeded).toBe(1);
    const arg = peCreate.mock.calls[0][0];
    const refs = arg.data.references.create;
    expect(refs).toHaveLength(2);
    expect(refs[0].referenceId).toBe("sinv-1-id");
    expect(refs[1].referenceId).toBe("sinv-2-id");
    expect(String(refs[0].allocatedAmount)).toBe("100");
  });
});
