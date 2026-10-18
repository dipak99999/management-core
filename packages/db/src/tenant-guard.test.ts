import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { withTenantGuardExtension, TENANT_SCOPED_MODELS } from "./tenant-guard";

// Fake client that captures the single $extends spec, exposes a runner that
// invokes the extension's $allOperations handler directly, and surfaces the
// args passed through to the (fake) downstream query. Lets us exercise the
// guard without booting a real Prisma engine.
interface ExtendSpec {
  query?: {
    $allModels?: {
      $allOperations?: (ctx: {
        model: string;
        operation: string;
        args: Record<string, unknown>;
        query: (a: unknown) => Promise<unknown>;
      }) => Promise<unknown>;
    };
  };
}
function fakeClient() {
  const specs: ExtendSpec[] = [];
  const self = {
    $extends: (spec: ExtendSpec) => {
      specs.push(spec);
      return self;
    },
    run: async (params: {
      model?: string;
      action: string;
      args?: Record<string, unknown>;
    }): Promise<{ passed: boolean; passedArgs?: Record<string, unknown> }> => {
      let passedArgs: Record<string, unknown> | undefined;
      const query = async (a: unknown) => {
        passedArgs = a as Record<string, unknown>;
        return { ok: true };
      };
      for (const s of specs) {
        const op = s.query?.$allModels?.$allOperations;
        if (op) {
          await op({
            model: params.model ?? "",
            operation: params.action,
            args: params.args ?? {},
            query,
          });
        }
      }
      return { passed: true, passedArgs };
    },
  };
  return self;
}

describe("tenant-guard", () => {
  let originalEnv: string | undefined;
  beforeEach(() => {
    originalEnv = process.env.TENANT_GUARD_MODE;
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.TENANT_GUARD_MODE;
    else process.env.TENANT_GUARD_MODE = originalEnv;
  });

  it("registers a query extension via $extends", () => {
    const c = fakeClient();
    const extend = vi.spyOn(c, "$extends");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    withTenantGuardExtension(c as any);
    expect(extend).toHaveBeenCalledOnce();
  });

  it("throws in enforce mode when a tenant-scoped model is queried without tenantId", async () => {
    process.env.TENANT_GUARD_MODE = "enforce";
    const c = fakeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    withTenantGuardExtension(c as any);
    await expect(
      c.run({ model: "SalesInvoice", action: "findMany", args: { where: { status: "Draft" } } }),
    ).rejects.toThrow(/tenant-guard/);
  });

  it("passes when tenantId is on the top-level where", async () => {
    process.env.TENANT_GUARD_MODE = "enforce";
    const c = fakeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    withTenantGuardExtension(c as any);
    const r = await c.run({
      model: "SalesInvoice",
      action: "findMany",
      args: { where: { tenantId: "t1", status: "Draft" } },
    });
    expect(r.passed).toBe(true);
  });

  it("passes when tenantId is inside an AND array leg", async () => {
    process.env.TENANT_GUARD_MODE = "enforce";
    const c = fakeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    withTenantGuardExtension(c as any);
    const r = await c.run({
      model: "SalesInvoice",
      action: "findMany",
      args: { where: { AND: [{ tenantId: "t1" }, { status: "Draft" }] } },
    });
    expect(r.passed).toBe(true);
  });

  it("passes when __allowCrossTenant escape hatch is set (and strips it before forwarding)", async () => {
    process.env.TENANT_GUARD_MODE = "enforce";
    const c = fakeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    withTenantGuardExtension(c as any);
    const r = await c.run({
      model: "SalesInvoice",
      action: "findMany",
      args: { where: { status: "Draft" }, __allowCrossTenant: true },
    });
    expect(r.passed).toBe(true);
    expect(r.passedArgs?.__allowCrossTenant).toBeUndefined();
  });

  it("ignores non-tenant-scoped models", async () => {
    process.env.TENANT_GUARD_MODE = "enforce";
    const c = fakeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    withTenantGuardExtension(c as any);
    // Tenant is the tenant table itself — must not be in the guarded set.
    expect(TENANT_SCOPED_MODELS.has("Tenant")).toBe(false);
    const r = await c.run({
      model: "Tenant",
      action: "findMany",
      args: { where: { name: "Acme" } },
    });
    expect(r.passed).toBe(true);
  });

  it("ignores single-row ops (findUnique, update, delete)", async () => {
    process.env.TENANT_GUARD_MODE = "enforce";
    const c = fakeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    withTenantGuardExtension(c as any);
    // findUnique with no tenantId should NOT throw — we deliberately don't
    // guard unique-key ops (leak surface requires guessing an exact cuid).
    const r = await c.run({
      model: "SalesInvoice",
      action: "findUnique",
      args: { where: { id: "cuid-xyz" } },
    });
    expect(r.passed).toBe(true);
  });

  it("warn mode logs to stderr but doesn't throw", async () => {
    process.env.TENANT_GUARD_MODE = "warn";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const c = fakeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    withTenantGuardExtension(c as any);
    const r = await c.run({
      model: "SalesInvoice",
      action: "findMany",
      args: { where: { status: "Draft" } },
    });
    expect(r.passed).toBe(true);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toMatch(/tenant-guard/);
    warn.mockRestore();
  });

  it("off mode bypasses entirely (no warn, no throw)", async () => {
    process.env.TENANT_GUARD_MODE = "off";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const c = fakeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    withTenantGuardExtension(c as any);
    const r = await c.run({
      model: "SalesInvoice",
      action: "findMany",
      args: { where: { status: "Draft" } },
    });
    expect(r.passed).toBe(true);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
