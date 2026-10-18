import { createHash } from "node:crypto";

// Password policy shared across every password-write site (signup, reset,
// portal-accept, change-password). Configured via env so ops can tighten
// or relax without a code change:
//
//   PASSWORD_MIN_LENGTH      (default 10)
//   PASSWORD_REQUIRE_UPPER   (default 1 — set 0 to disable)
//   PASSWORD_REQUIRE_LOWER   (default 1)
//   PASSWORD_REQUIRE_DIGIT   (default 1)
//   PASSWORD_REQUIRE_SYMBOL  (default 0 — user's non-ASCII passphrases pass)
//   PASSWORD_HIBP_CHECK      (default 0 — set 1 to enable HaveIBeenPwned
//                             k-anonymity lookup; requires outbound HTTPS to
//                             api.pwnedpasswords.com. Failing open on
//                             network errors is acceptable — the shape check
//                             above is the primary defence.)
//   PASSWORD_HIBP_THRESHOLD  (default 1 — reject if seen ≥ N times in
//                             breach corpus)

function envInt(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : def;
}

function envBool(name: string, def: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) return def;
  return raw === "1" || raw.toLowerCase() === "true";
}

// bcrypt work factor used by every password/secret hash in the stack.
// Default 12 (OWASP 2024 guidance, ~250-500ms per hash on modern hardware).
// Raising this is DOS-mitigating on signup/login — leave it unless you've
// measured that your bcrypt-per-request budget is tight. Lower to 10 for
// test/CI speed via BCRYPT_COST=10.
export const BCRYPT_COST = envInt("BCRYPT_COST", 12);

export interface PasswordPolicyViolation {
  code:
    | "TOO_SHORT"
    | "NO_UPPER"
    | "NO_LOWER"
    | "NO_DIGIT"
    | "NO_SYMBOL"
    | "BREACHED";
  message: string;
}

export function validatePasswordShape(password: string): PasswordPolicyViolation[] {
  const minLen = envInt("PASSWORD_MIN_LENGTH", 10);
  const reqUpper = envBool("PASSWORD_REQUIRE_UPPER", true);
  const reqLower = envBool("PASSWORD_REQUIRE_LOWER", true);
  const reqDigit = envBool("PASSWORD_REQUIRE_DIGIT", true);
  const reqSymbol = envBool("PASSWORD_REQUIRE_SYMBOL", false);

  const out: PasswordPolicyViolation[] = [];
  if (password.length < minLen)
    out.push({ code: "TOO_SHORT", message: `Password must be at least ${minLen} characters` });
  if (reqUpper && !/[A-Z]/.test(password))
    out.push({ code: "NO_UPPER", message: "Password must contain an uppercase letter" });
  if (reqLower && !/[a-z]/.test(password))
    out.push({ code: "NO_LOWER", message: "Password must contain a lowercase letter" });
  if (reqDigit && !/\d/.test(password))
    out.push({ code: "NO_DIGIT", message: "Password must contain a digit" });
  if (reqSymbol && !/[^A-Za-z0-9]/.test(password))
    out.push({ code: "NO_SYMBOL", message: "Password must contain a symbol" });
  return out;
}

// HaveIBeenPwned k-anonymity API: send first 5 chars of SHA-1 hash, get
// back a list of hash-suffix:count pairs, look for our full hash. The API
// never sees the full hash, so it's safe to call on real passwords.
//
// Fails open on network / API errors — we log but don't reject. Shape
// validation above is the primary defence; HIBP is a bonus catch.
export async function isPasswordBreached(
  password: string,
  threshold: number,
): Promise<boolean> {
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
    });
    if (!res.ok) return false;
    const text = await res.text();
    for (const line of text.split(/\r?\n/)) {
      const [hashSuffix, countStr] = line.split(":");
      if (hashSuffix === suffix) {
        const count = Number.parseInt(countStr ?? "0", 10);
        if (count >= threshold) return true;
      }
    }
    return false;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        level: "warn",
        kind: "hibp.check.failed",
        error: err instanceof Error ? err.message : String(err),
        time: new Date().toISOString(),
      }),
    );
    return false;
  }
}

// Full policy check. Returns null on pass, an array of violations on fail.
// Callers should 400 with `{ error: "Password too weak", violations }`.
export async function checkPasswordPolicy(
  password: string,
): Promise<PasswordPolicyViolation[] | null> {
  const violations = validatePasswordShape(password);
  if (violations.length > 0) return violations;

  if (envBool("PASSWORD_HIBP_CHECK", false)) {
    const threshold = envInt("PASSWORD_HIBP_THRESHOLD", 1);
    if (await isPasswordBreached(password, threshold)) {
      return [
        {
          code: "BREACHED",
          message: "Password appears in a known breach — pick a different one",
        },
      ];
    }
  }

  return null;
}
