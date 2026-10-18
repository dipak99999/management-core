import type { NextFunction, Request, Response } from "express";

// Express middleware that walks the parsed JSON body and coerces empty
// strings to null. Runs after `express.json()`, before any route handler.
//
// Why: HTML forms send `""` for empty text inputs, but zod's
// `.string().email()` / `.string().min(1)` etc reject empty strings. Manually
// converting on every form's onSubmit would be 30+ places; converting
// server-side once fixes them all.
//
// Behavior:
//   ""            → null
//   "  "          → null   (whitespace-only counts as empty)
//   " something " → "something"   (trims value on the way in)
//   Nested objects + arrays are walked recursively.
//   Non-string values pass through untouched.
//
// A route that wants to *distinguish* "not sent" (undefined) from "sent as
// empty" (null) can still do so — zod's `.optional().nullable()` handles both.
export function normalizeBody(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (req.body && typeof req.body === "object") {
    req.body = normalize(req.body);
  }
  next();
}

function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = normalize(v);
    }
    return out;
  }
  return value;
}
