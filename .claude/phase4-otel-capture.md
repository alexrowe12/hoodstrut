# Phase 4: Telemetry Testing Guide

This guide explains how to test the `--telemetry` flag which exports OTEL data to an external collector.

## Quick Start with Jaeger

```bash
# Start Jaeger (all-in-one) with OTLP support
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest

# Run hoodstrut with telemetry
hoodstrut run -p my-profile -t my-task \
  --telemetry http://localhost:4318

# View traces at http://localhost:16686
```

## Testing with Honeycomb

```bash
hoodstrut run -p my-profile -t my-task \
  --telemetry https://api.honeycomb.io:443 \
  --telemetry-headers "x-honeycomb-team=YOUR_API_KEY"
```

## What Gets Exported

When `--telemetry` is enabled, Claude Code exports:

- **Traces**: `claude_code.interaction`, `claude_code.llm_request`, `claude_code.tool` spans
- **Metrics**: Token counters, cost counters, session metrics
- **Log Events**: Prompts, tool results, API requests (if `OTEL_LOG_*` vars enabled)

## Note on Metrics

The `--telemetry` flag is for **observability** (viewing traces/spans in external tools).

**Metrics extraction** (token counts, cost, turns) always uses the Agent SDK response stream, which is more reliable than parsing OTEL data. The SDK's `result` message includes complete metrics regardless of whether `--telemetry` is enabled.
