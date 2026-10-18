// Shared port map for every e2e spec.
//
// Two canonical port layouts the suite runs against:
//
//   HARNESS mode — what CI boots via scripts/start-all-services.sh +
//     scripts/start-all-frontends.sh. Services on 4101-4106, frontends on
//     3100-3107. Shell == 3100.
//
//   DEV mode — what `pnpm dev` boots on a laptop. Services on 4001-4006,
//     frontends on 4556 (shell) + 3001-3007 (modules + portal).
//
// Historically every spec hardcoded the HARNESS numbers, which meant the
// suite silently refused to run against a laptop dev stack. This module
// auto-detects: if port 3100 is listening we're in HARNESS, else DEV.
// Every env var can also be set explicitly to override detection.
//
// Specs should import from this file instead of hardcoding `localhost:xxxx`.

import { execSync } from "node:child_process";

function portOpen(port: number): boolean {
  try {
    execSync(`bash -c 'exec 3<>/dev/tcp/localhost/${port}' 2>/dev/null`, {
      stdio: "ignore",
      timeout: 500,
    });
    return true;
  } catch {
    return false;
  }
}

const HARNESS = portOpen(3100);

const env = process.env;

export const PORTS = {
  // Frontends
  shell: env.E2E_SHELL_PORT ?? (HARNESS ? "3100" : "4556"),
  accountingWeb: env.E2E_ACC_WEB_PORT ?? (HARNESS ? "3101" : "3001"),
  buyingWeb: env.E2E_BUY_WEB_PORT ?? (HARNESS ? "3102" : "3002"),
  stockWeb: env.E2E_STOCK_WEB_PORT ?? (HARNESS ? "3103" : "3003"),
  crmWeb: env.E2E_CRM_WEB_PORT ?? (HARNESS ? "3104" : "3004"),
  hrWeb: env.E2E_HR_WEB_PORT ?? (HARNESS ? "3105" : "3005"),
  projectsWeb: env.E2E_PROJ_WEB_PORT ?? (HARNESS ? "3106" : "3006"),
  portalWeb: env.E2E_PORTAL_PORT ?? (HARNESS ? "3107" : "3007"),
  // Services
  authSvc: env.E2E_AUTH_SVC_PORT ?? (HARNESS ? "4101" : "4001"),
  accSvc: env.E2E_ACC_SVC_PORT ?? (HARNESS ? "4102" : "4002"),
  stockSvc: env.E2E_STOCK_SVC_PORT ?? (HARNESS ? "4103" : "4003"),
  crmSvc: env.E2E_CRM_SVC_PORT ?? (HARNESS ? "4104" : "4004"),
  hrSvc: env.E2E_HR_SVC_PORT ?? (HARNESS ? "4105" : "4005"),
  projSvc: env.E2E_PROJ_SVC_PORT ?? (HARNESS ? "4106" : "4006"),
} as const;

export const URLS = {
  shell: `http://localhost:${PORTS.shell}`,
  accountingWeb: `http://localhost:${PORTS.accountingWeb}`,
  buyingWeb: `http://localhost:${PORTS.buyingWeb}`,
  stockWeb: `http://localhost:${PORTS.stockWeb}`,
  crmWeb: `http://localhost:${PORTS.crmWeb}`,
  hrWeb: `http://localhost:${PORTS.hrWeb}`,
  projectsWeb: `http://localhost:${PORTS.projectsWeb}`,
  portalWeb: `http://localhost:${PORTS.portalWeb}`,
  authSvc: `http://localhost:${PORTS.authSvc}`,
  accSvc: `http://localhost:${PORTS.accSvc}`,
  stockSvc: `http://localhost:${PORTS.stockSvc}`,
  crmSvc: `http://localhost:${PORTS.crmSvc}`,
  hrSvc: `http://localhost:${PORTS.hrSvc}`,
  projSvc: `http://localhost:${PORTS.projSvc}`,
} as const;

export const MODE: "harness" | "dev" = HARNESS ? "harness" : "dev";
