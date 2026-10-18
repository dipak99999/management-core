// Rotate MASTER_SECRET_KEY safely in-place.
//
// Every TenantIntegration.secrets blob is AES-256-GCM encrypted with a key
// derived from MASTER_SECRET_KEY (see packages/db/src/secrets-crypto.ts).
// Rotating the env var by itself bricks every integration: the old
// ciphertexts can't be decrypted with the new key.
//
// This script does the rotation atomically:
//   1. Read the OLD key from OLD_MASTER_SECRET_KEY (env, one-time).
//   2. Read the NEW key from MASTER_SECRET_KEY (env, the new value).
//   3. For every TenantIntegration row: decrypt with OLD, re-encrypt with NEW,
//      write back inside a transaction.
//   4. Print a summary. On any per-row error, abort and roll back — no
//      partial state.
//
// Usage:
//   OLD_MASTER_SECRET_KEY=<old-hex-or-base64> \
//   MASTER_SECRET_KEY=<new-hex-or-base64>     \
//     pnpm --filter @lumaara/db tsx scripts/rotate-master-key.ts
//
// The runtime uses the NEW key (from MASTER_SECRET_KEY), which is why we
// have to load the OLD key separately and swap it in for the decrypt half
// of each row.
//
// Ops runbook: see docs/RUNBOOKS.md § "MASTER_SECRET_KEY rotation".

import { prisma } from "../src/index";
import { encryptSecrets } from "../src/secrets-crypto";
import {
  createCipheriv,
  createDecipheriv,
  scryptSync,
} from "node:crypto";

const ALG = "aes-256-gcm" as const;
const KEY_LEN = 32;
const TAG_LEN = 16;

function loadKey(raw: string): Buffer {
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  if (/^[A-Za-z0-9_-]{43}={0,2}$/.test(raw)) return Buffer.from(raw, "base64url");
  return scryptSync(raw, "lumaara-secrets-salt", KEY_LEN);
}

interface EncryptedBlob {
  enc: true;
  alg: typeof ALG;
  iv: string;
  tag: string;
  ct: string;
}

function decryptWithKey(stored: unknown, key: Buffer): Record<string, unknown> | null {
  if (!stored || typeof stored !== "object") return null;
  const s = stored as EncryptedBlob;
  if (!("enc" in s) || s.enc !== true) return null;
  const iv = Buffer.from(s.iv, "base64");
  const tag = Buffer.from(s.tag, "base64");
  const ct = Buffer.from(s.ct, "base64");
  if (tag.length !== TAG_LEN) throw new Error(`Bad auth tag length ${tag.length}`);
  const dec = createDecipheriv(ALG, key, iv);
  dec.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([dec.update(ct), dec.final()]).toString("utf8"),
  ) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const oldRaw = process.env.OLD_MASTER_SECRET_KEY;
  const newRaw = process.env.MASTER_SECRET_KEY;
  if (!oldRaw || !newRaw) {
    // eslint-disable-next-line no-console
    console.error(
      "Usage: OLD_MASTER_SECRET_KEY=<old> MASTER_SECRET_KEY=<new> tsx scripts/rotate-master-key.ts",
    );
    process.exit(2);
  }
  if (oldRaw === newRaw) {
    // eslint-disable-next-line no-console
    console.error("OLD and NEW keys are identical — nothing to do");
    process.exit(1);
  }

  const oldKey = loadKey(oldRaw);

  const rows = await prisma.tenantIntegration.findMany({
    select: { id: true, tenantId: true, provider: true, secrets: true },
  });
  // eslint-disable-next-line no-console
  console.log(`[rotate] scanning ${rows.length} TenantIntegration rows`);

  let rotated = 0;
  let skippedUnencrypted = 0;
  const failed: { id: string; provider: string; error: string }[] = [];

  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      try {
        const plain = decryptWithKey(row.secrets, oldKey);
        if (plain == null) {
          skippedUnencrypted += 1;
          continue;
        }
        const reenc = encryptSecrets(plain); // uses current MASTER_SECRET_KEY = new
        await tx.tenantIntegration.update({
          where: { id: row.id },
          data: { secrets: reenc as unknown as object },
        });
        rotated += 1;
      } catch (e) {
        failed.push({
          id: row.id,
          provider: row.provider,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    if (failed.length > 0) {
      throw new Error(
        `rotation aborted — ${failed.length} rows failed: ${JSON.stringify(failed)}`,
      );
    }
  });

  // eslint-disable-next-line no-console
  console.log(
    `[rotate] done. rotated=${rotated} skipped_unencrypted=${skippedUnencrypted} failed=${failed.length}`,
  );
  process.exit(0);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error("[rotate] fatal:", e);
  process.exit(1);
});
