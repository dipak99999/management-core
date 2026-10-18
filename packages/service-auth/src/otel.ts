// OpenTelemetry bootstrap. Called at the top of each service's index.ts
// BEFORE the service imports anything else it wants instrumented (express,
// prisma, ioredis, etc). No-op when OTEL_EXPORTER_OTLP_ENDPOINT is unset —
// keeps local dev + tests dependency-free.
//
// Env vars (all optional, all standard OTEL names):
//   OTEL_EXPORTER_OTLP_ENDPOINT  → base URL of an OTLP/HTTP collector,
//                                  e.g. http://localhost:4318. When unset,
//                                  initOtel is a no-op.
//   OTEL_SERVICE_NAME           → override the serviceName arg.
//   OTEL_EXPORTER_OTLP_HEADERS  → e.g. "authorization=Bearer …" for hosted
//                                  collectors that require auth.
//   OTEL_LOG_LEVEL              → error | warn | info | debug (default: warn).
//
// What gets instrumented:
//   * HTTP server + client (via @opentelemetry/auto-instrumentations-node)
//   * Express routers
//   * ioredis client (BullMQ queue traffic)
//   * Prisma queries (spans for each SQL call)
//   * Node fs / dns / net (chatty — filtered out below)
//
// Not instrumented: BullMQ per-job spans (would need @opentelemetry/instrumentation-bullmq,
// which isn't in the auto bundle yet — parent HTTP span still connects
// enqueue → worker via traceparent propagation).

let sdkStarted = false;

// Synchronous so callers don't need top-level await. Uses require() rather
// than dynamic import() so the OTEL deps don't load at all when the env var
// is unset — keeps cold start clean for local dev.
export function initOtel(defaultServiceName: string): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return; // Feature-flagged: unset endpoint = OTEL disabled.
  if (sdkStarted) return; // Idempotent — safe to call more than once.
  sdkStarted = true;

  const serviceName = process.env.OTEL_SERVICE_NAME ?? defaultServiceName;

  try {
    // Use require() rather than import() so the OTEL deps stay untouched
    // when the env var is unset (a service that never sees the endpoint
    // set never even resolves these packages).
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { NodeSDK } = require("@opentelemetry/sdk-node");
    const { getNodeAutoInstrumentations } = require(
      "@opentelemetry/auto-instrumentations-node",
    );
    const { OTLPTraceExporter } = require(
      "@opentelemetry/exporter-trace-otlp-http",
    );
    const { OTLPMetricExporter } = require(
      "@opentelemetry/exporter-metrics-otlp-http",
    );
    const { PeriodicExportingMetricReader } = require(
      "@opentelemetry/sdk-metrics",
    );
    const { resourceFromAttributes } = require("@opentelemetry/resources");
    const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = require(
      "@opentelemetry/semantic-conventions",
    );
    /* eslint-enable @typescript-eslint/no-require-imports */

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: serviceName,
        [ATTR_SERVICE_VERSION]: process.env.APP_VERSION ?? "dev",
      }),
      traceExporter: new OTLPTraceExporter({
        url: `${endpoint.replace(/\/$/, "")}/v1/traces`,
      }),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: `${endpoint.replace(/\/$/, "")}/v1/metrics`,
        }),
        exportIntervalMillis: 30_000,
      }),
      instrumentations: [
        getNodeAutoInstrumentations({
          // Filesystem + DNS spans are ambient noise for a web service.
          "@opentelemetry/instrumentation-fs": { enabled: false },
          "@opentelemetry/instrumentation-dns": { enabled: false },
          "@opentelemetry/instrumentation-net": { enabled: false },
        }),
      ],
    });

    sdk.start();

    // Best-effort shutdown so in-flight spans + metric points get flushed
    // when the container exits.
    const shutdown = async () => {
      try {
        await sdk.shutdown();
      } catch {
        // swallow
      }
    };
    process.once("SIGTERM", () => void shutdown());
    process.once("SIGINT", () => void shutdown());

    // eslint-disable-next-line no-console
    console.log(
      `[otel] initialized: service=${serviceName} endpoint=${endpoint}`,
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      "[otel] init failed — continuing without OTEL:",
      e instanceof Error ? e.message : String(e),
    );
  }
}
