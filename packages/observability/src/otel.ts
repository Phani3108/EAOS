/**
 * @agentos/observability — OpenTelemetry Bridge
 *
 * Initialises the OTel Node SDK and provides a bridge that converts
 * AgentTracer spans into OTel spans exported via OTLP.
 *
 * Usage:
 *   import { initOTel, shutdownOTel } from '@agentos/observability/otel';
 *   await initOTel('gateway');
 *   // ... app logic ...
 *   await shutdownOTel();
 */

let sdk: unknown;
let tracer: unknown;

/**
 * Initialise OpenTelemetry SDK with OTLP exporter.
 * @param serviceName The logical service name (e.g. 'gateway', 'memory')
 */
export async function initOTel(serviceName: string): Promise<void> {
    if (process.env.OTEL_SDK_DISABLED === 'true' || !process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
    try {
        // Dynamic imports — packages are optional; if missing we log & skip
        const otelApi = await import('@opentelemetry/api');
        const { NodeSDK } = await import('@opentelemetry/sdk-node');
        const { OTLPTraceExporter } = await import(
            '@opentelemetry/exporter-trace-otlp-http'
        );
        const { OTLPMetricExporter } = await import(
            '@opentelemetry/exporter-metrics-otlp-http'
        );
        const { PeriodicExportingMetricReader } = await import(
            '@opentelemetry/sdk-metrics'
        );
        const { resourceFromAttributes } = await import('@opentelemetry/resources');
        const { ATTR_SERVICE_NAME } = await import(
            '@opentelemetry/semantic-conventions'
        );

        const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, '');

        const resource = resourceFromAttributes({
            [ATTR_SERVICE_NAME]: serviceName,
        });

        const traceExporter = new OTLPTraceExporter({
            url: `${endpoint}/v1/traces`,
        });

        const metricExporter = new OTLPMetricExporter({
            url: `${endpoint}/v1/metrics`,
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const metricReader: any = new PeriodicExportingMetricReader({
                exporter: metricExporter,
                exportIntervalMillis: 15_000,
            });

        const nodeSdk = new NodeSDK({
            resource,
            traceExporter,
            metricReader,
        });

        nodeSdk.start();
        sdk = nodeSdk;

        tracer = otelApi.trace.getTracer(serviceName, '0.1.0');

        console.log(
            `[otel] OpenTelemetry initialised for service="${serviceName}" → ${endpoint}`,
        );
    } catch (err: unknown) {
        const msg =
            err instanceof Error ? err.message : String(err);
        console.warn(
            `[otel] OpenTelemetry packages not available — telemetry disabled (${msg})`,
        );
    }
}

/**
 * Returns the OTel tracer if initialised, undefined otherwise.
 */
export function getOTelTracer(): unknown {
    return tracer;
}

/**
 * Bridge an AgentTracer ExecutionTrace to OpenTelemetry spans.
 * Call this after `endTrace()` to export completed traces.
 */
export async function bridgeTraceToOTel(
    trace: import('./tracer.js').ExecutionTrace,
): Promise<void> {
    if (!tracer) return;

    try {
        const otelApi = await import('@opentelemetry/api');
        const otelTracer = tracer as import('@opentelemetry/api').Tracer;

        // Build a map of spanId -> OTel span
        const otelSpans = new Map<string, import('@opentelemetry/api').Span>();

        // Sort spans by start time so parents are created first
        const sorted = [...trace.spans].sort(
            (a, b) => a.startTime.getTime() - b.startTime.getTime(),
        );

        for (const agentSpan of sorted) {
            const parentOtel = agentSpan.parentSpanId
                ? otelSpans.get(agentSpan.parentSpanId)
                : undefined;

            const ctx = parentOtel
                ? otelApi.trace.setSpan(otelApi.context.active(), parentOtel)
                : otelApi.context.active();

            const otelSpan = otelTracer.startSpan(
                agentSpan.name,
                {
                    startTime: agentSpan.startTime,
                    attributes: {
                        'agentos.span.kind': agentSpan.kind,
                        'agentos.trace.id': agentSpan.traceId,
                        'agentos.trace.goal': trace.goal,
                        ...(Object.fromEntries(
                            Object.entries(agentSpan.attributes).filter(
                                ([, v]) =>
                                    typeof v === 'string' ||
                                    typeof v === 'number' ||
                                    typeof v === 'boolean',
                            ),
                        ) as Record<string, string | number | boolean>),
                    },
                },
                ctx,
            );

            // Replay events
            for (const ev of agentSpan.events) {
                otelSpan.addEvent(ev.name, ev.attributes as Record<string, string | number | boolean>, ev.timestamp);
            }

            // End with correct status & time
            if (agentSpan.status === 'failed') {
                otelSpan.setStatus({
                    code: otelApi.SpanStatusCode.ERROR,
                    message: (agentSpan.attributes.error as string) ?? 'failed',
                });
            }

            if (agentSpan.endTime) {
                otelSpan.end(agentSpan.endTime);
            }

            otelSpans.set(agentSpan.spanId, otelSpan);
        }
    } catch {
        // Silently ignore bridge failures — telemetry is non-critical
    }
}

/**
 * Gracefully shut down the OTel SDK, flushing pending exports.
 */
export async function shutdownOTel(): Promise<void> {
    if (!sdk) return;
    try {
        await (sdk as { shutdown(): Promise<void> }).shutdown();
        console.log('[otel] OpenTelemetry shut down');
    } catch {
        // best-effort
    }
}
