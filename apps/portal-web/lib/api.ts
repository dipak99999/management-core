"use client";

// Portal API client. Two backing services:
//   AUTH (:4001)  → /portal-auth/* (login/accept/forgot/me/change-password)
//   ACC  (:4002)  → /portal/*      (summary/invoices/statement/quotations/…)
//
// Session lives in localStorage under `lumaara.portal` and contains
// { token, user: {…} } — mirrors the staff shell but scoped to a party.

const AUTH = process.env.NEXT_PUBLIC_AUTH_SERVICE_URL ?? "/api/auth-svc";
const ACC = process.env.NEXT_PUBLIC_ACCOUNTING_SERVICE_URL ?? "/api/accounting";
// CRM hosts the public CMS reads (/public/web-pages, /public/blog-posts).
// Public — no auth header sent.
const CRM = process.env.NEXT_PUBLIC_CRM_SERVICE_URL ?? "/api/crm";

export interface PortalSession {
  token: string;
  user: {
    id: string;
    email: string;
    displayName: string | null;
    partyType: "Customer" | "Supplier";
    partyId: string;
    tenantId: string;
  };
}

export function loadSession(): PortalSession | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("lumaara.portal");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PortalSession;
  } catch {
    return null;
  }
}

export function saveSession(s: PortalSession): void {
  localStorage.setItem("lumaara.portal", JSON.stringify(s));
}

export function clearSession(): void {
  localStorage.removeItem("lumaara.portal");
}

function token(): string {
  return loadSession()?.token ?? "";
}

async function req<T>(base: string, method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token() ? { authorization: `Bearer ${token()}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 204) return undefined as T;
  const text = await r.text();
  // Guard against HTML/text error pages from upstream — raw JSON.parse
  // throws "Unexpected token 'I'" ("Internal Server Error") and buries
  // the real status.
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch {
      throw new Error(
        `${r.status} ${r.statusText}: ${text.slice(0, 120).replace(/\s+/g, " ")}`,
      );
    }
  }
  if (!r.ok) {
    throw new Error(
      (data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : null) ?? `${r.status} ${r.statusText}`,
    );
  }
  return data as T;
}

export const authApi = {
  get: <T,>(p: string) => req<T>(AUTH, "GET", p),
  post: <T,>(p: string, body: unknown) => req<T>(AUTH, "POST", p, body),
};

export const accApi = {
  get: <T,>(p: string) => req<T>(ACC, "GET", p),
  post: <T,>(p: string, body: unknown) => req<T>(ACC, "POST", p, body),
};

// Public CMS reads. Returns null when the requested resource doesn't exist
// or is unpublished, so pages can render 404 cleanly instead of throwing.
async function publicGet<T>(path: string): Promise<T | null> {
  const r = await fetch(`${CRM}${path}`, {
    headers: { "content-type": "application/json" },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return (await r.json()) as T;
}

export interface PublicWebPage {
  slug: string;
  title: string;
  description: string | null;
  bodyHtml: string;
  headHtml: string | null;
  publishedAt: string | null;
}

export interface PublicBlogPostSummary {
  id: string;
  publicSlug: string;
  title: string;
  excerpt: string | null;
  authorName: string | null;
  category: string | null;
  featuredImage: string | null;
  publishedAt: string | null;
}

export interface PublicBlogPost {
  slug: string;
  title: string;
  excerpt: string | null;
  bodyHtml: string;
  authorName: string | null;
  category: string | null;
  featuredImage: string | null;
  publishedAt: string | null;
}

export const cmsApi = {
  getPage: (slug: string) => publicGet<PublicWebPage>(`/public/web-pages/${encodeURIComponent(slug)}`),
  listPosts: (category?: string) =>
    publicGet<PublicBlogPostSummary[]>(
      `/public/blog-posts${category ? `?category=${encodeURIComponent(category)}` : ""}`,
    ),
  getPost: (slug: string) => publicGet<PublicBlogPost>(`/public/blog-posts/${encodeURIComponent(slug)}`),
};

// ── Public storefront (e-commerce) ───────────────────────────────────────

export interface ShopSummary {
  id: string;   // WebsiteItem DB id — used as the cart key
  slug: string;
  itemCode: string;
  name: string;
  shortDescription: string | null;
  imageUrl: string | null;
  price: number;
}

export interface ShopVariant {
  itemId: string;
  itemCode: string;
  itemName: string;
  price: number;
  attributes: Record<string, string>;
}

export interface ShopItem extends ShopSummary {
  itemId: string;
  descriptionHtml: string;
  galleryUrls: string[];
  // Variant Items — non-empty when the underlying Item is a variant
  // template. The storefront resolves the customer's attribute picks
  // to one of these and adds its itemId to the cart line as
  // variantItemId (alongside the template's websiteItemId).
  isVariantTemplate: boolean;
  variants: ShopVariant[];
}

export interface CheckoutResponse {
  orderNumber: string;
  orderId: string;
  grandTotal: number;
  currency: string;
  message: string;
}

async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${CRM}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  // Guard against HTML/text error pages from upstream — raw JSON.parse
  // throws "Unexpected token 'I'" ("Internal Server Error") and buries
  // the real status.
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch {
      throw new Error(
        `${r.status} ${r.statusText}: ${text.slice(0, 120).replace(/\s+/g, " ")}`,
      );
    }
  }
  if (!r.ok) {
    throw new Error(
      (data && typeof data === "object" && "error" in data
        ? typeof (data as { error: unknown }).error === "string"
          ? String((data as { error: unknown }).error)
          : JSON.stringify((data as { error: unknown }).error)
        : null) ?? `${r.status} ${r.statusText}`,
    );
  }
  return data as T;
}

// ── Public booking (Meeting Scheduler) ──────────────────────────────
// Backed by /public/bookings on crm-service. tenantId is in the URL
// because there's no session context.

export interface PublicMeetingType {
  slug: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  locationType: "Video" | "Phone" | "InPerson" | "Custom";
  colorHex: string | null;
}

export interface BookingSlot {
  startsAt: string;
  endsAt: string;
}

export interface BookingConfirmation {
  id: string;
  startsAt: string;
  endsAt: string;
  cancellationToken: string;
  meetingUrl: string | null;
  redirectUrl: string | null;
}

export const bookingApi = {
  getType: (tenantId: string, slug: string) =>
    publicGet<PublicMeetingType>(
      `/public/bookings/${encodeURIComponent(tenantId)}/${encodeURIComponent(slug)}`,
    ),
  listSlots: (tenantId: string, slug: string, from: Date, to: Date) =>
    publicGet<{ slots: BookingSlot[] }>(
      `/public/bookings/${encodeURIComponent(tenantId)}/${encodeURIComponent(slug)}/slots?from=${from.toISOString()}&to=${to.toISOString()}`,
    ),
  book: (
    tenantId: string,
    slug: string,
    body: {
      startsAt: string;
      inviteeName: string;
      inviteeEmail: string;
      inviteePhone?: string | null;
      inviteeNotes?: string | null;
      inviteeTimezone?: string | null;
    },
  ) =>
    publicPost<BookingConfirmation>(
      `/public/bookings/${encodeURIComponent(tenantId)}/${encodeURIComponent(slug)}/book`,
      body,
    ),
  cancel: (token: string, reason?: string) =>
    publicPost<{ ok: boolean; id?: string; status?: string }>(
      `/public/bookings/cancel/${encodeURIComponent(token)}`,
      { reason: reason ?? null },
    ),
};

export const shopApi = {
  list: () => publicGet<ShopSummary[]>("/public/shop"),
  get: (slug: string) => publicGet<ShopItem>(`/public/shop/${encodeURIComponent(slug)}`),
  checkout: (body: {
    items: { websiteItemId: string; variantItemId?: string; qty: number }[];
    customerName: string;
    email: string;
    mobile?: string;
    addressLine1?: string;
    city?: string;
    postalCode?: string;
    remarks?: string;
    couponCode?: string;
  }) => publicPost<CheckoutResponse>("/public/checkout", body),
  // D4: preview a coupon against the current cart. Returns discount summary
  // when the code is valid, throws (400) with a `reason` when it isn't.
  previewCoupon: (body: {
    items: { websiteItemId: string; variantItemId?: string; qty: number }[];
    code: string;
  }) =>
    publicPost<{
      code: string;
      ruleTitle: string;
      baseTotal: number;
      newTotal: number;
      discountAmount: number;
    }>("/public/checkout/preview-coupon", body),
};

// ── Cart (client-side) ───────────────────────────────────────────────────
// Stored in localStorage as JSON: { items: [{websiteItemId, qty}], updatedAt }.
// A user's cart survives across page loads; there's no server-side Cart
// model. Every mutation touches storage synchronously; the cart page reads
// once on mount and subscribes to a `lumaara.cart` storage event so the
// count stays in sync across tabs.

const CART_KEY = "lumaara.cart";
export interface LocalCartLine {
  websiteItemId: string;
  qty: number;
  // Set when the WebsiteItem points at a variant template. The checkout
  // route uses this id (not the template's) to look up price + itemCode.
  variantItemId?: string;
  // Cached at add-time so the cart page can render "Red · S" without an
  // extra round-trip to fetch the variant Item. Doesn't need to be
  // authoritative — checkout re-reads price from the variant Item itself.
  variantLabel?: string;
}

export function loadCart(): LocalCartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { items?: LocalCartLine[] };
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

export function saveCart(items: LocalCartLine[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    CART_KEY,
    JSON.stringify({ items, updatedAt: new Date().toISOString() }),
  );
  // Notify current tab (storage event only fires on *other* tabs).
  window.dispatchEvent(new Event("lumaara.cart.updated"));
}

export function clearCart(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(CART_KEY);
  window.dispatchEvent(new Event("lumaara.cart.updated"));
}
