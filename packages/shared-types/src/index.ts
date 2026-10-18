export interface JwtClaims {
  userId: string;
  tenantId: string;
  email: string;
  // Legacy free-form role — kept in JWT for backward compat. Real access
  // control now uses `roles` (array of Role names from RolePermission).
  role: string;
  roles: string[];
  // Session tracking ID (turn 47/A10). Present on JWTs issued after A10;
  // absent on legacy tokens — requireAuth skips session lookup when absent
  // so old tokens keep working until they expire.
  jti?: string;
  // Populated by jsonwebtoken at sign time. requireAuth compares against
  // User.tokenEpoch so a stolen JWT dies on the next password change.
  iat?: number;
}

export interface AuthContext {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
  roles: string[];
}

export interface CustomerDto {
  id: string;
  customerName: string;
  customerType: "Company" | "Individual";
  customerGroup?: string | null;
  territory?: string | null;
  email?: string | null;
  mobile?: string | null;
  gstin?: string | null;
  createdAt: string;
}

export interface SalesInvoiceItemDto {
  id?: string;
  itemId: string;
  qty: number;
  rate: number;
  amount: number;
  description?: string | null;
}

export interface SalesInvoiceDto {
  id: string;
  name: string;
  customerId: string;
  customerName?: string;
  postingDate: string;
  dueDate?: string | null;
  currency: string;
  netTotal: number;
  totalTaxes: number;
  grandTotal: number;
  outstandingAmt: number;
  status: "Draft" | "Submitted" | "Paid" | "Cancelled";
  items: SalesInvoiceItemDto[];
}

// Re-export the integration catalog so any package (browser or server)
// can consume it without pulling in Prisma / Node built-ins. See
// packages/shared-types/src/integration-catalog.ts for the data.
export {
  INTEGRATION_CATALOG,
  catalogFor,
  type ProviderSlug,
  type ProviderSpec,
  type SecretField,
} from "./integration-catalog";

// Module registry (5 top-level buckets) + subscription gating helpers.
export {
  MODULES,
  MODULE_REGISTRY,
  submoduleForPath,
  planAllows,
  type ModuleKey,
  type ModuleDef,
  type SubmoduleDef,
} from "./modules";
