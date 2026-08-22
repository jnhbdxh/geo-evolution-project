import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { domainEventEnvelopeSchema } from "./index.js";

describe("DomainEventEnvelope", () => {
  it("accepts the formal snake_case wire schema", () => {
    const envelope = domainEventEnvelopeSchema.parse({
      event_id: randomUUID(),
      event_type: "ProjectCreated",
      tenant_id: randomUUID(),
      aggregate_type: "Project",
      aggregate_id: randomUUID(),
      schema_version: 1,
      occurred_at: new Date().toISOString(),
      trace_id: randomUUID(),
      data: { project_id: randomUUID() },
    });

    expect(envelope.schema_version).toBe(1);
  });

  it("rejects camelCase envelope aliases", () => {
    expect(() =>
      domainEventEnvelopeSchema.parse({
        eventId: randomUUID(),
        eventType: "ProjectCreated",
        tenantId: randomUUID(),
        aggregateType: "Project",
        aggregateId: randomUUID(),
        schemaVersion: 1,
        occurredAt: new Date().toISOString(),
        traceId: randomUUID(),
        data: {},
      }),
    ).toThrow();
  });
});
