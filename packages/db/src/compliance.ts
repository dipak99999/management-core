import { PrismaClient, Prisma } from "@prisma/client";
import { encryptSecrets } from "./secrets-crypto";

// O3: PII scrub helpers. Anonymization is stable — repeated calls produce
// the same anonymized shape without cascading. We keep the row (so historical
// invoices still resolve) and null the PII columns.
//
// Callers: the DSR erasure processor + the retention runner.

const REDACT = "[REDACTED]";

// Encrypted archive of the pre-anonymization snapshot. Written before we null
// PII columns so a legal-hold restore is possible. Cipher key = MASTER_SECRET_KEY.
async function archiveBeforeAnonymize(
  tx: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  subjectType: string,
  subjectId: string,
  snapshot: Record<string, unknown>,
  fieldsChanged: string[],
  dsrId?: string | null,
  createdBy?: string | null,
): Promise<void> {
  if (fieldsChanged.length === 0) return; // nothing to redact, no archive needed
  const cipher = encryptSecrets(snapshot);
  await tx.anonymizationArchive.create({
    data: {
      tenantId,
      subjectType,
      subjectId,
      dsrId: dsrId ?? null,
      cipher: cipher as unknown as Prisma.InputJsonValue,
      fieldsChanged,
      createdBy: createdBy ?? null,
    },
  });
}

export interface AnonResult {
  subjectType: string;
  subjectId: string;
  fieldsChanged: string[];
}

export async function anonymizeCustomer(
  tx: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  customerId: string,
  opts: { dsrId?: string | null; createdBy?: string | null } = {},
): Promise<AnonResult> {
  const row = await tx.customer.findFirst({
    where: { id: customerId, tenantId },
  });
  if (!row) throw new Error("Customer not found");
  const fields: string[] = [];
  const data: Prisma.CustomerUpdateInput = {};
  if (row.email) {
    data.email = null;
    fields.push("email");
  }
  if (row.mobile) {
    data.mobile = null;
    fields.push("mobile");
  }
  if (row.gstin) {
    data.gstin = null;
    fields.push("gstin");
  }
  if (row.customerName && row.customerName !== REDACT) {
    data.customerName = REDACT;
    fields.push("customerName");
  }
  const contacts = await tx.contact.findMany({
    where: { tenantId, linkedDoctype: "Customer", linkedId: customerId },
  });
  const addresses = await tx.address.findMany({
    where: { tenantId, linkedDoctype: "Customer", linkedId: customerId },
  });
  await archiveBeforeAnonymize(
    tx,
    tenantId,
    "Customer",
    customerId,
    { customer: row, contacts, addresses },
    fields,
    opts.dsrId,
    opts.createdBy,
  );
  await tx.customer.update({ where: { id: customerId }, data });
  await tx.contact.updateMany({
    where: { tenantId, linkedDoctype: "Customer", linkedId: customerId },
    data: { email: null, mobile: null, firstName: REDACT, lastName: null },
  });
  await tx.address.updateMany({
    where: { tenantId, linkedDoctype: "Customer", linkedId: customerId },
    data: { addressLine1: REDACT, addressLine2: null, city: null, state: null, pincode: null },
  });
  return { subjectType: "Customer", subjectId: customerId, fieldsChanged: fields };
}

export async function anonymizeSupplier(
  tx: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  supplierId: string,
  opts: { dsrId?: string | null; createdBy?: string | null } = {},
): Promise<AnonResult> {
  const row = await tx.supplier.findFirst({
    where: { id: supplierId, tenantId },
  });
  if (!row) throw new Error("Supplier not found");
  const fields: string[] = [];
  const data: Prisma.SupplierUpdateInput = {};
  if (row.email) {
    data.email = null;
    fields.push("email");
  }
  if (row.mobile) {
    data.mobile = null;
    fields.push("mobile");
  }
  if (row.gstin) {
    data.gstin = null;
    fields.push("gstin");
  }
  if (row.supplierName && row.supplierName !== REDACT) {
    data.supplierName = REDACT;
    fields.push("supplierName");
  }
  const contacts = await tx.contact.findMany({
    where: { tenantId, linkedDoctype: "Supplier", linkedId: supplierId },
  });
  const addresses = await tx.address.findMany({
    where: { tenantId, linkedDoctype: "Supplier", linkedId: supplierId },
  });
  await archiveBeforeAnonymize(
    tx,
    tenantId,
    "Supplier",
    supplierId,
    { supplier: row, contacts, addresses },
    fields,
    opts.dsrId,
    opts.createdBy,
  );
  await tx.supplier.update({ where: { id: supplierId }, data });
  await tx.contact.updateMany({
    where: { tenantId, linkedDoctype: "Supplier", linkedId: supplierId },
    data: { email: null, mobile: null, firstName: REDACT, lastName: null },
  });
  await tx.address.updateMany({
    where: { tenantId, linkedDoctype: "Supplier", linkedId: supplierId },
    data: { addressLine1: REDACT, addressLine2: null, city: null, state: null, pincode: null },
  });
  return { subjectType: "Supplier", subjectId: supplierId, fieldsChanged: fields };
}

export async function anonymizeEmployee(
  tx: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  employeeId: string,
  opts: { dsrId?: string | null; createdBy?: string | null } = {},
): Promise<AnonResult> {
  const row = await tx.employee.findFirst({
    where: { id: employeeId, tenantId },
  });
  if (!row) throw new Error("Employee not found");
  const fields: string[] = [];
  const data: Prisma.EmployeeUpdateInput = {};
  if (row.email) {
    data.email = null;
    fields.push("email");
  }
  if (row.mobile) {
    data.mobile = null;
    fields.push("mobile");
  }
  if (row.bankAccountNo) {
    data.bankAccountNo = null;
    fields.push("bankAccountNo");
  }
  if (row.employeeName && row.employeeName !== REDACT) {
    data.employeeName = REDACT;
    fields.push("employeeName");
  }
  // Flip status to Left so this employee stops appearing in active-headcount
  // reports post-erasure.
  if (row.status !== "Left") {
    data.status = "Left";
    fields.push("status");
  }
  await archiveBeforeAnonymize(
    tx,
    tenantId,
    "Employee",
    employeeId,
    { employee: row },
    fields,
    opts.dsrId,
    opts.createdBy,
  );
  await tx.employee.update({ where: { id: employeeId }, data });
  return { subjectType: "Employee", subjectId: employeeId, fieldsChanged: fields };
}

// O2: Data export. Returns a single JSON object containing every row we
// hold for the subject (customer + related SIs, PEs, contacts, addresses,
// quotes, portal user, tickets). Caller writes it to disk / uploads.
export async function exportCustomerData(
  tx: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  customerId: string,
): Promise<Record<string, unknown>> {
  const [customer, invoices, payments, quotations, addresses, contacts, portalUser, tickets] =
    await Promise.all([
      tx.customer.findFirst({ where: { id: customerId, tenantId } }),
      tx.salesInvoice.findMany({ where: { tenantId, customerId } }),
      tx.paymentEntry.findMany({
        where: { tenantId, partyType: "Customer", partyId: customerId },
      }),
      tx.quotation.findMany({ where: { tenantId, customerId } }),
      tx.address.findMany({
        where: { tenantId, linkedDoctype: "Customer", linkedId: customerId },
      }),
      tx.contact.findMany({
        where: { tenantId, linkedDoctype: "Customer", linkedId: customerId },
      }),
      tx.portalUser.findFirst({
        where: { tenantId, partyType: "Customer", partyId: customerId },
      }),
      tx.portalTicket.findMany({
        where: { tenantId, partyType: "Customer", partyId: customerId },
        include: { replies: true },
      }),
    ]);
  return {
    exportedAt: new Date().toISOString(),
    subjectType: "Customer",
    subjectId: customerId,
    customer,
    invoices,
    payments,
    quotations,
    addresses,
    contacts,
    portalUser,
    tickets,
  };
}

export async function exportSupplierData(
  tx: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  supplierId: string,
): Promise<Record<string, unknown>> {
  const [supplier, bills, payments, purchaseOrders, addresses, contacts, portalUser] =
    await Promise.all([
      tx.supplier.findFirst({ where: { id: supplierId, tenantId } }),
      tx.purchaseInvoice.findMany({ where: { tenantId, supplierId } }),
      tx.paymentEntry.findMany({
        where: { tenantId, partyType: "Supplier", partyId: supplierId },
      }),
      tx.purchaseOrder.findMany({ where: { tenantId, supplierId } }),
      tx.address.findMany({
        where: { tenantId, linkedDoctype: "Supplier", linkedId: supplierId },
      }),
      tx.contact.findMany({
        where: { tenantId, linkedDoctype: "Supplier", linkedId: supplierId },
      }),
      tx.portalUser.findFirst({
        where: { tenantId, partyType: "Supplier", partyId: supplierId },
      }),
    ]);
  return {
    exportedAt: new Date().toISOString(),
    subjectType: "Supplier",
    subjectId: supplierId,
    supplier,
    bills,
    payments,
    purchaseOrders,
    addresses,
    contacts,
    portalUser,
  };
}

export async function exportEmployeeData(
  tx: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  employeeId: string,
): Promise<Record<string, unknown>> {
  const [
    employee,
    attendance,
    salarySlips,
    leaveApplications,
    leaveAllocations,
    expenseClaims,
    loans,
    advances,
    appraisals,
    skills,
    certifications,
  ] = await Promise.all([
    tx.employee.findFirst({ where: { id: employeeId, tenantId } }),
    tx.attendance.findMany({ where: { tenantId, employeeId } }),
    tx.salarySlip.findMany({ where: { tenantId, employeeId } }),
    tx.leaveApplication.findMany({ where: { tenantId, employeeId } }),
    tx.leaveAllocation.findMany({ where: { tenantId, employeeId } }),
    tx.expenseClaim.findMany({ where: { tenantId, employeeId } }),
    tx.loan.findMany({ where: { tenantId, employeeId } }),
    tx.employeeAdvance.findMany({ where: { tenantId, employeeId } }),
    tx.appraisal.findMany({ where: { tenantId, employeeId } }),
    tx.employeeSkill.findMany({ where: { tenantId, employeeId } }),
    tx.employeeCertification.findMany({ where: { tenantId, employeeId } }),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    subjectType: "Employee",
    subjectId: employeeId,
    employee,
    attendance,
    salarySlips,
    leaveApplications,
    leaveAllocations,
    expenseClaims,
    loans,
    advances,
    appraisals,
    skills,
    certifications,
  };
}
