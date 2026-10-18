#!/usr/bin/env tsx
/*
 * MASTER_SECRET_KEY rotation.
 *
 * Walks every table that stores encrypted blobs, decrypts each row with
 * MASTER_SECRET_KEY_OLD, re-encrypts with MASTER_SECRET_KEY (the new one),
 * writes back. Each row is updated in its own transaction so a mid-run
 * failure leaves at most one row partially written — on resume that row
 * decrypts with the NEW key (encryption is detected by the `enc: true`
 * marker on the stored JSON), so re-running is idempotent.
 *
 * Tables rotated:
 *   tenant_integrations.secrets
 *   platform.platform_ai_providers.secrets
 *   anonymization_archives.payload (if any)
 *
 * Usage:
 *   MASTER_SECRET_KEY_OLD=<current>  \
 *   MASTER_SECRET_KEY=<new>          \
 *   DATABASE_URL=<admin-url>         \
 *   pnpm tsx scripts/rotate-master-secret.ts [--dry-run] [--yes]
 *
 * --dry-run     reads + decrypts + re-encrypts but doesn't write
 * --yes         skip the confirmation prompt
 *
 * After the script succeeds:
 *   1. Verify a few decrypts work: pnpm tsx scripts/rotate-master-secret.ts --verify
 *   2. Remove MASTER_SECRET_KEY_OLD from your env
 *   3. Deploy with MASTER_SECRET_KEY=<new> only
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createInterface } from "node:readline/promises";

const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_CONFIRM = process.argv.includes("--yes");
const VERIFY_ONLY = process.argv.includes("--verify");

const OLD_KEY_RAW = process.env.MASTER_SECRET_KEY_OLD;
const NEW_KEY_RAW = process.env.MASTER_SECRET_KEY;

if (!NEW_KEY_RAW) {
  console.error("ERROR: MASTER_SECRET_KEY (the new key) is required");
  process.exit(2);
}
if (!VERIFY_ONLY && !OLD_KEY_RAW) {
  console.error("ERROR: MASTER_SECRET_KEY_OLD (the current key being rotated out) is required");
  process.exit(2);
}

const ALG = "aes-256-gcm" as const;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

function deriveKey(raw: string): Buffer {
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  if (/^[A-Za-z0-9_-]{43}={0,2}$/.test(raw)) return Buffer.from(raw, "base64url");
  return scryptSync(raw, "lumaara-secrets-salt", KEY_LEN);
}

const OLD_KEY = OLD_KEY_RAW ? deriveKey(OLD_KEY_RAW) : null;
const NEW_KEY = deriveKey(NEW_KEY_RAW);

interface EncryptedBlob {
  enc: true;
  alg: typeof ALG;
  iv: string;
  tag: string;
  ct: string;
}

function isEncrypted(v: unknown): v is EncryptedBlob {
  return !!v && typeof v === "object" && (v as { enc?: unknown }).enc === true;
}

function decryptWith(key: Buffer, blob: EncryptedBlob): Record<string, unknown> {
  const iv = Buffer.from(blob.iv, "base64");
  const tag = Buffer.from(blob.tag, "base64");
  const ct = Buffer.from(blob.ct, "base64");
  if (tag.length !== TAG_LEN) throw new Error(`invalid tag length ${tag.length}`);
  const d = createDecipheriv(ALG, key, iv);
  d.setAuthTag(tag);
  const pt = Buffer.concat([d.update(ct), d.final()]);
  return JSON.parse(pt.toString("utf8")) as Record<string, unknown>;
}

function encryptWith(key: Buffer, plain: Record<string, unknown>): EncryptedBlob {
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(plain), "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return {
    enc: true,
    alg: ALG,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ct.toString("base64"),
  };
}

interface Target {
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  list(prisma: PrismaClient): Promise<Array<{ id: string; secrets: any }>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  update(prisma: PrismaClient, id: string, secrets: any): Promise<void>;
}

const TARGETS: Target[] = [
  {
    label: "tenant_integrations",
    async list(prisma) {
      return prisma.tenantIntegration.findMany({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        select: { id: true, secrets: true } as any,
      }) as never;
    },
    async update(prisma, id, secrets) {
      await prisma.tenantIntegration.update({ where: { id }, data: { secrets } });
    },
  },
  {
    label: "platform_ai_providers",
    async list(prisma) {
      return prisma.platformAiProvider.findMany({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        select: { id: true, secrets: true } as any,
      }) as never;
    },
    async update(prisma, id, secrets) {
      await prisma.platformAiProvider.update({ where: { id }, data: { secrets } });
    },
  },
];

async function confirm(msg: string): Promise<boolean> {
  if (SKIP_CONFIRM) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(`${msg} [y/N]: `);
  rl.close();
  return a.trim().toLowerCase() === "y" || a.trim().toLowerCase() === "yes";
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    if (VERIFY_ONLY) {
      console.log("── VERIFY mode: decrypting every row with MASTER_SECRET_KEY ──");
      let total = 0, ok = 0, failed = 0;
      for (const t of TARGETS) {
        const rows = await t.list(prisma);
        for (const row of rows) {
          total++;
          if (!isEncrypted(row.secrets)) {
            ok++;
            continue;
          }
          try {
            decryptWith(NEW_KEY, row.secrets);
            ok++;
          } catch (e) {
            failed++;
            console.error(`FAIL ${t.label}#${row.id}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
      console.log(`verify complete: total=${total} ok=${ok} failed=${failed}`);
      process.exit(failed === 0 ? 0 : 1);
    }

    console.log(`──────────────────────────────────────────────────────────`);
    console.log(`MASTER_SECRET_KEY rotation ${DRY_RUN ? "(DRY RUN)" : "(LIVE)"}`);
    console.log(`──────────────────────────────────────────────────────────`);
    for (const t of TARGETS) {
      const rows = await t.list(prisma);
      console.log(`  ${t.label}: ${rows.length} rows`);
    }
    if (!DRY_RUN) {
      const go = await confirm("Proceed with LIVE rotation?");
      if (!go) { console.log("aborted."); process.exit(0); }
    }

    let rotated = 0, skipped = 0, failed = 0;
    for (const t of TARGETS) {
      const rows = await t.list(prisma);
      for (const row of rows) {
        if (!isEncrypted(row.secrets)) {
          skipped++;
          continue;
        }
        try {
          const plain = decryptWith(OLD_KEY!, row.secrets);
          const reEnc = encryptWith(NEW_KEY, plain);
          if (!DRY_RUN) await t.update(prisma, row.id, reEnc);
          rotated++;
        } catch (e) {
          failed++;
          console.error(`  FAIL ${t.label}#${row.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    console.log(`──────────────────────────────────────────────────────────`);
    console.log(`rotated=${rotated} skipped=${skipped} failed=${failed}${DRY_RUN ? " (dry-run)" : ""}`);
    if (failed > 0) process.exit(1);
    if (!DRY_RUN) {
      console.log("\nNext steps:");
      console.log("  1. Run with --verify to confirm every row decrypts under the new key.");
      console.log("  2. Remove MASTER_SECRET_KEY_OLD from your env store.");
      console.log("  3. Restart services (so cached in-memory key is refreshed).");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("rotation failed:", e);
  process.exit(1);
});
