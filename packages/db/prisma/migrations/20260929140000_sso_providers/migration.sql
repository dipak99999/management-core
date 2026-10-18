-- Per-tenant OIDC SSO configuration. The app is the RELYING PARTY here —
-- separate from OAuthClient which is the AUTHORIZATION SERVER for third
-- parties. See schema.prisma § SsoProvider for the intent + threat model.

CREATE TABLE "sso_providers" (
  "id"                  TEXT NOT NULL PRIMARY KEY,
  "tenantId"            TEXT NOT NULL,
  "provider"            TEXT NOT NULL,
  "issuer"              TEXT NOT NULL,
  "clientId"            TEXT NOT NULL,
  "clientSecretEnc"     JSONB NOT NULL,
  "allowedEmailDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "autoProvision"       BOOLEAN NOT NULL DEFAULT true,
  "defaultRole"         TEXT NOT NULL DEFAULT 'user',
  "isActive"            BOOLEAN NOT NULL DEFAULT true,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sso_providers_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "sso_providers_tenantId_provider_key"
    UNIQUE ("tenantId", "provider")
);
CREATE INDEX "sso_providers_tenantId_idx" ON "sso_providers"("tenantId");

CREATE TABLE "sso_states" (
  "id"            TEXT NOT NULL PRIMARY KEY,
  "ssoProviderId" TEXT NOT NULL,
  "state"         TEXT NOT NULL UNIQUE,
  "nonce"         TEXT NOT NULL,
  "codeVerifier"  TEXT NOT NULL,
  "redirectTo"    TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sso_states_ssoProviderId_fkey"
    FOREIGN KEY ("ssoProviderId") REFERENCES "sso_providers"("id") ON DELETE CASCADE
);
CREATE INDEX "sso_states_expiresAt_idx" ON "sso_states"("expiresAt");
