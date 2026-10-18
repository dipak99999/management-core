/* eslint-disable no-console */
import { PrismaClient, Prisma } from "@prisma/client";
import { hash } from "bcryptjs";
import { seedTenantDefaults } from "../src/seed-tenant";
import { seedNamingSeriesCounter } from "../src/naming";

// M10: dev seed. Idempotently creates a demo tenant with an admin user + a
// couple of customers, suppliers, items, and a sample sales invoice. Safe to
// re-run — checks by slug/email.
//
// Usage: pnpm --filter @lumaara/db seed:demo [tenant-slug]   (default: demo)

const prisma = new PrismaClient();

// Admin logins for the tenants prisma/seed.ts creates; any other slug gets
// admin@<slug>.local.
const KNOWN_ADMINS: Record<string, { email: string; password: string }> = {
  demo: { email: "demo@lumaara.local", password: "demo1234" },
  acme: { email: "admin@acme.test", password: "admin123" },
};

async function main() {
  const slug = process.argv[2] ?? "demo";
  const { email: adminEmail, password: adminPassword } =
    KNOWN_ADMINS[slug] ?? { email: `admin@${slug}.local`, password: "admin1234" };

  console.log(`→ Creating tenant '${slug}'…`);
  let tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: { name: slug === "demo" ? "Demo Company" : slug, slug },
    });
    await seedTenantDefaults(prisma, tenant.id);
    console.log("  ✓ tenant + defaults");
  } else {
    console.log("  (tenant already exists)");
  }
  // Idempotent — also covers tenants created by prisma/seed.ts.
  await seedNamingSeriesCounter(prisma, tenant.id, "SINV-", 0);
  await seedNamingSeriesCounter(prisma, tenant.id, "PE-", 0);
  await seedNamingSeriesCounter(prisma, tenant.id, "CUST-", 0);
  await seedNamingSeriesCounter(prisma, tenant.id, "SUPP-", 0);

  console.log("→ Ensuring admin user…");
  const existingUser = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: adminEmail } },
  });
  if (!existingUser) {
    await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: adminEmail,
        passwordHash: await hash(adminPassword, 10),
        role: "admin",
        fullName: "Demo Admin",
        // Demo seed pre-verifies so ops can log in without an SMTP round-trip.
        emailVerifiedAt: new Date(),
      },
    });
    console.log(`  ✓ ${adminEmail} / ${adminPassword}`);
  } else if (!existingUser.emailVerifiedAt) {
    await prisma.user.update({
      where: { id: existingUser.id },
      data: { emailVerifiedAt: new Date() },
    });
    console.log("  (admin user already exists — marked verified)");
  } else {
    console.log("  (admin user already exists)");
  }

  console.log("→ Seeding sample masters…");
  const [c1, c2] = await Promise.all([
    upsertCustomer(tenant.id, "Acme Corp", "billing@acme.example"),
    upsertCustomer(tenant.id, "Globex Ltd", "ap@globex.example"),
  ]);
  await Promise.all([
    upsertSupplier(tenant.id, "Widgets Wholesale", "sales@widgets.example"),
    upsertSupplier(tenant.id, "Cloud Compute Inc", "billing@cloud.example"),
  ]);
  const [i1, i2] = await Promise.all([
    upsertItem(tenant.id, "SKU-001", "Wireless Headphones", 149.99),
    upsertItem(tenant.id, "SKU-002", "USB-C Cable 2m", 12.5),
  ]);
  console.log("  ✓ 2 customers, 2 suppliers, 2 items");

  console.log("→ Sample sales invoice…");
  const invCount = await prisma.salesInvoice.count({ where: { tenantId: tenant.id } });
  if (invCount === 0) {
    await prisma.salesInvoice.create({
      data: {
        tenantId: tenant.id,
        name: "SINV-DEMO-001",
        customerId: c1.id,
        currency: "INR",
        netTotal: new Prisma.Decimal(149.99 * 2 + 12.5 * 3),
        grandTotal: new Prisma.Decimal(149.99 * 2 + 12.5 * 3),
        outstandingAmt: new Prisma.Decimal(149.99 * 2 + 12.5 * 3),
        status: "Draft",
        items: {
          create: [
            {
              itemId: i1.id,
              qty: 2,
              rate: new Prisma.Decimal(149.99),
              amount: new Prisma.Decimal(149.99 * 2),
            },
            {
              itemId: i2.id,
              qty: 3,
              rate: new Prisma.Decimal(12.5),
              amount: new Prisma.Decimal(12.5 * 3),
            },
          ],
        },
      },
    });
    console.log(`  ✓ SINV-DEMO-001 for ${c1.customerName}`);
  } else {
    console.log("  (invoices already exist)");
  }

  void c2;

  // Look up the freshly-created admin user so seed rows that need an owner
  // (Dashboard, ImportJob) can attach.
  const adminUser = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: adminEmail } },
  });

  // Fetch a supplier + item so downstream fixtures can attach without an
  // extra round-trip. Both are already seeded above.
  const supplier = await prisma.supplier.findFirst({ where: { tenantId: tenant.id } });
  const item = await prisma.item.findFirst({ where: { tenantId: tenant.id } });

  // Full demo-data expansion — one row per doctype so the Playwright
  // dynamic-route smoke test can find something to detail. Each call is
  // wrapped so a schema drift in one model doesn't halt the rest.
  console.log("→ Expanding demo fixtures (35 doctypes)…");
  await seedIfMissing("Campaign", () =>
    prisma.campaign.create({
      data: {
        tenantId: tenant.id,
        name: "Summer 2026 Launch",
        description: "Cross-channel product launch campaign",
        startDate: new Date("2026-06-01"),
        endDate: new Date("2026-08-31"),
        budget: new Prisma.Decimal(250000),
        expectedRevenue: new Prisma.Decimal(1000000),
        status: "Active",
      },
    }),
  );
  await seedIfMissing("Opportunity", () =>
    prisma.opportunity.create({
      data: {
        tenantId: tenant.id,
        name: "OPP-DEMO-001",
        partyType: "Customer",
        customerId: c1.id,
        expectedAmount: new Prisma.Decimal(75000),
        expectedCloseDate: new Date("2026-09-30"),
        status: "Open",
        source: "Website",
      },
    }),
  );
  await seedIfMissing("Quotation", () =>
    prisma.quotation.create({
      data: {
        tenantId: tenant.id,
        name: "QTN-DEMO-001",
        partyType: "Customer",
        customerId: c1.id,
        currency: "INR",
        netTotal: new Prisma.Decimal(50000),
        grandTotal: new Prisma.Decimal(59000),
        totalTaxes: new Prisma.Decimal(9000),
        status: "Submitted",
      },
    }),
  );
  await seedIfMissing("SalesOrder", () =>
    prisma.salesOrder.create({
      data: {
        tenantId: tenant.id,
        name: "SO-DEMO-001",
        customerId: c1.id,
        deliveryDate: new Date("2026-09-15"),
        currency: "INR",
        netTotal: new Prisma.Decimal(50000),
        grandTotal: new Prisma.Decimal(59000),
        totalTaxes: new Prisma.Decimal(9000),
        status: "Submitted",
      },
    }),
  );

  const employee = await seedIfMissing("Employee", () =>
    prisma.employee.create({
      data: {
        tenantId: tenant.id,
        employeeCode: "EMP-DEMO-001",
        employeeName: "Priya Sharma",
        email: "priya@lumaara.local",
        designation: "Senior Engineer",
        department: "Engineering",
        dateOfJoining: new Date("2024-04-01"),
        baseSalary: new Prisma.Decimal(120000),
      },
    }),
  );

  await seedIfMissing("HolidayList", () =>
    prisma.holidayList.create({
      data: {
        tenantId: tenant.id,
        name: "India 2026",
        fromDate: new Date("2026-01-01"),
        toDate: new Date("2026-12-31"),
        weeklyOffDay: "0",
      },
    }),
  );
  await seedIfMissing("JobOpening", () =>
    prisma.jobOpening.create({
      data: {
        tenantId: tenant.id,
        name: "JOB-DEMO-001",
        title: "Full-Stack Engineer",
        department: "Engineering",
        designation: "Engineer",
        location: "Remote / Bengaluru",
        employmentType: "Full-time",
        publishedAt: new Date(),
        status: "Open",
      },
    }),
  );
  await seedIfMissing("JobApplicant", () =>
    prisma.jobApplicant.create({
      data: {
        tenantId: tenant.id,
        name: "JAPP-DEMO-001",
        applicantName: "Rohan Iyer",
        email: "rohan.applicant@example.com",
        source: "LinkedIn",
        status: "Shortlisted",
      },
    }),
  );
  await seedIfMissing("TrainingEvent", () =>
    prisma.trainingEvent.create({
      data: {
        tenantId: tenant.id,
        name: "TRN-DEMO-001",
        subject: "React 19 Advanced Patterns",
        startAt: new Date("2026-09-10T10:00:00Z"),
        endAt: new Date("2026-09-10T17:00:00Z"),
        location: "HQ Training Room",
        trainerName: "External Facilitator",
        status: "Scheduled",
      },
    }),
  );
  if (employee) {
    await seedIfMissing("SalarySlip", () =>
      prisma.salarySlip.create({
        data: {
          tenantId: tenant.id,
          name: "SS-DEMO-001",
          employeeId: employee.id,
          startDate: new Date("2026-08-01"),
          endDate: new Date("2026-08-31"),
          grossPay: new Prisma.Decimal(120000),
          totalDeduction: new Prisma.Decimal(15000),
          netPay: new Prisma.Decimal(105000),
          status: "Submitted",
        },
      }),
    );
    await seedIfMissing("Appraisal", () =>
      prisma.appraisal.create({
        data: {
          tenantId: tenant.id,
          name: "APP-DEMO-001",
          employeeId: employee.id,
          periodStart: new Date("2026-01-01"),
          periodEnd: new Date("2026-06-30"),
          status: "Draft",
          finalScore: new Prisma.Decimal(0),
        },
      }),
    );
    await seedIfMissing("EmployeeAdvance", () =>
      prisma.employeeAdvance.create({
        data: {
          tenantId: tenant.id,
          name: "EA-DEMO-001",
          employeeId: employee.id,
          purpose: "Client travel — Q3",
          advanceAmount: new Prisma.Decimal(25000),
          status: "Approved",
        },
      }),
    );
    await seedIfMissing("EmployeeChecklist", () =>
      prisma.employeeChecklist.create({
        data: {
          tenantId: tenant.id,
          name: "ONB-DEMO-001",
          type: "Onboarding",
          employeeId: employee.id,
          targetDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          status: "InProgress",
        },
      }),
    );
  }
  await seedIfMissing("PayrollEntry", () =>
    prisma.payrollEntry.create({
      data: {
        tenantId: tenant.id,
        name: "PYE-DEMO-001",
        startDate: new Date("2026-08-01"),
        endDate: new Date("2026-08-31"),
        status: "Draft",
      },
    }),
  );

  await seedIfMissing("Project", () =>
    prisma.project.create({
      data: {
        tenantId: tenant.id,
        name: "PROJ-DEMO-001",
        projectName: "Website Rebuild",
        customerId: c1.id,
        startDate: new Date("2026-07-01"),
        endDate: new Date("2026-12-31"),
        status: "Open",
        billingType: "Hourly",
        estimatedCost: new Prisma.Decimal(500000),
      },
    }),
  );

  await seedIfMissing("JournalEntry", () =>
    prisma.journalEntry.create({
      data: {
        tenantId: tenant.id,
        name: "JV-DEMO-001",
        currency: "INR",
        remarks: "Opening balance adjustment",
        status: "Draft",
      },
    }),
  );

  await seedIfMissing("StockEntry", () =>
    prisma.stockEntry.create({
      data: {
        tenantId: tenant.id,
        name: "STE-DEMO-001",
        entryType: "Material Receipt",
        remarks: "Opening stock receipt",
        status: "Draft",
      },
    }),
  );
  await seedIfMissing("MaterialRequest", () =>
    prisma.materialRequest.create({
      data: {
        tenantId: tenant.id,
        name: "MR-DEMO-001",
        materialRequestType: "Purchase",
        status: "Draft",
      },
    }),
  );
  await seedIfMissing("ProductionPlan", () =>
    prisma.productionPlan.create({
      data: {
        tenantId: tenant.id,
        name: "PP-DEMO-001",
        status: "Draft",
      },
    }),
  );
  await seedIfMissing("StockReconciliation", () =>
    prisma.stockReconciliation.create({
      data: {
        tenantId: tenant.id,
        name: "SR-DEMO-001",
        purpose: "Stock Reconciliation",
        status: "Draft",
      },
    }),
  );
  await seedIfMissing("DeliveryNote", () =>
    prisma.deliveryNote.create({
      data: {
        tenantId: tenant.id,
        name: "DN-DEMO-001",
        customerId: c1.id,
        remarks: "Demo delivery",
        status: "Draft",
      },
    }),
  );

  if (supplier) {
    await seedIfMissing("PurchaseOrder", () =>
      prisma.purchaseOrder.create({
        data: {
          tenantId: tenant.id,
          name: "PO-DEMO-001",
          supplierId: supplier.id,
          currency: "INR",
          status: "Draft",
        },
      }),
    );
    await seedIfMissing("PurchaseInvoice", () =>
      prisma.purchaseInvoice.create({
        data: {
          tenantId: tenant.id,
          name: "PINV-DEMO-001",
          supplierId: supplier.id,
          currency: "INR",
          status: "Draft",
        },
      }),
    );
    await seedIfMissing("PurchaseReceipt", () =>
      prisma.purchaseReceipt.create({
        data: {
          tenantId: tenant.id,
          name: "PR-DEMO-001",
          supplierId: supplier.id,
          status: "Draft",
        },
      }),
    );
  }

  await seedIfMissing("Broadcast", () =>
    prisma.broadcast.create({
      data: {
        tenantId: tenant.id,
        name: "BR-DEMO-001",
        subject: "Welcome to Lumaara",
        body: "Thanks for signing up — here's what you can do next…",
        audience: "Customers",
        status: "Draft",
      },
    }),
  );

  if (adminUser) {
    await seedIfMissing("Dashboard", () =>
      prisma.dashboard.create({
        data: {
          tenantId: tenant.id,
          name: "Executive Overview",
          description: "Top-level KPIs for leadership",
          ownerUserId: adminUser.id,
          isShared: true,
        },
      }),
    );
    await seedIfMissing("ImportJob", () =>
      prisma.importJob.create({
        data: {
          tenantId: tenant.id,
          name: "IMP-DEMO-001",
          doctype: "Customer",
          ownerUserId: adminUser.id,
          fileName: "customers-sample.csv",
          mode: "create",
          dryRun: true,
          status: "Draft",
        },
      }),
    );
  }

  // Extra lead so the CRM list has more than one row for filter demos.
  await seedIfMissing("Lead", () =>
    prisma.lead.create({
      data: {
        tenantId: tenant.id,
        name: "LEAD-DEMO-001",
        leadName: "Ananya Rao",
        companyName: "Rao Consulting",
        email: "ananya@prospect.example",
        status: "Open",
        source: "Website",
      },
    }),
  );

  console.log("\nDone. Log in at http://localhost:3100/login:");
  console.log(`  email:    ${adminEmail}`);
  console.log(`  password: ${adminPassword}`);
  console.log(`  tenant:   ${slug}`);
}

// Idempotent-with-a-catch helper. Runs `create`, logs success, returns the
// created row on success or `null` on either (a) schema drift (create throws)
// or (b) unique-constraint conflict (row already there). Callers can rely on
// the return value for follow-up fixtures that need the parent's id.
async function seedIfMissing<T>(
  label: string,
  create: () => Promise<T>,
): Promise<T | null> {
  try {
    const row = await create();
    console.log(`  ✓ ${label}`);
    return row;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "P2002") {
      console.log(`  (${label} already exists)`);
    } else {
      console.warn(`  ! ${label} skipped: ${(e as Error).message.split("\n")[0]}`);
    }
    return null;
  }
}

async function upsertCustomer(
  tenantId: string,
  name: string,
  email: string,
): Promise<{ id: string; customerName: string }> {
  const existing = await prisma.customer.findFirst({
    where: { tenantId, customerName: name },
  });
  if (existing) return existing;
  return prisma.customer.create({
    data: {
      tenantId,
      customerName: name,
      customerType: "Company",
      email,
    },
  });
}

async function upsertSupplier(
  tenantId: string,
  name: string,
  email: string,
): Promise<{ id: string }> {
  const existing = await prisma.supplier.findFirst({
    where: { tenantId, supplierName: name },
  });
  if (existing) return existing;
  return prisma.supplier.create({
    data: {
      tenantId,
      supplierName: name,
      supplierType: "Company",
      email,
    },
  });
}

async function upsertItem(
  tenantId: string,
  code: string,
  name: string,
  rate: number,
): Promise<{ id: string }> {
  const existing = await prisma.item.findFirst({
    where: { tenantId, itemCode: code },
  });
  if (existing) return existing;
  return prisma.item.create({
    data: {
      tenantId,
      itemCode: code,
      itemName: name,
      stockUom: "Unit",
      standardRate: new Prisma.Decimal(rate),
      isStockItem: true,
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
