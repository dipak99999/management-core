"use client";

// Swagger UI rendered off the public OpenAPI spec at /api/accounting/openapi.json.
// Loaded from CDN to avoid pulling swagger-ui-react (heavy React tree) into
// the shell bundle. The spec itself lives in packages/db/src/openapi-spec.ts
// and is generated from STATIC_MCP_CATALOG.

import { useEffect, useState } from "react";
import { AppShell, Icon } from "../../../components/app-shell";
import { SHELL_NAV } from "../../../components/shell-nav";
import { PageHeader } from "../../../components/ui";

const SPEC_URL = "/api/accounting/openapi.json";

// The Swagger UI JS + CSS live on a CDN so we don't ship them from
// node_modules. Loading them via <script>/<link> injection keeps the page's
// initial bundle small and avoids the "swagger-ui-react has type errors
// with React 19" mess.
const CSS = "https://unpkg.com/swagger-ui-dist@5/swagger-ui.css";
const JS_BUNDLE = "https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js";
const JS_PRESET =
  "https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js";

declare global {
  interface Window {
    SwaggerUIBundle?: (config: unknown) => unknown;
    SwaggerUIStandalonePreset?: unknown;
  }
}

export default function ApiDocsPage() {
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // Load CSS once.
    if (!document.querySelector(`link[href="${CSS}"]`)) {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = CSS;
      document.head.appendChild(l);
    }
    // Load Swagger UI bundle + preset in sequence, then boot.
    Promise.all([loadScript(JS_BUNDLE), loadScript(JS_PRESET)])
      .then(() => {
        if (!window.SwaggerUIBundle) throw new Error("SwaggerUIBundle missing");
        window.SwaggerUIBundle({
          url: SPEC_URL,
          dom_id: "#swagger-ui",
          deepLinking: true,
          tryItOutEnabled: true,
          persistAuthorization: true,
          presets: [
            (window.SwaggerUIBundle as unknown as { presets: { apis: unknown } }).presets.apis,
            window.SwaggerUIStandalonePreset,
          ],
        });
        setReady(true);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <AppShell moduleName="Home" nav={SHELL_NAV}>
      <PageHeader
        icon={Icon.book}
        eyebrow="Developer"
        title="API Reference"
        subtitle="Every action Lumaara exposes as HTTP is also an MCP tool. This spec is generated from the same catalog so external tools stay in sync with the agent runtime. Bearer JWT or long-lived API tokens both work."
        breadcrumb={[{ label: "Admin", href: "/admin" }, { label: "API Reference" }]}
        actions={
          <a
            href={SPEC_URL}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary"
          >
            Raw JSON ↗
          </a>
        }
      />

      {err && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load Swagger UI: {err}
        </div>
      )}

      {!ready && !err && (
        <div className="p-8 text-center text-ink-muted">Loading API reference…</div>
      )}

      <div id="swagger-ui" className="bg-white rounded-2xl border border-ink/8 p-2" />
    </AppShell>
  );
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`script load failed: ${src}`));
    document.head.appendChild(s);
  });
}
