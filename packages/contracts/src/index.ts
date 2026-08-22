import { z } from "zod";

export const accessScopes = [
  "PLATFORM_PRIVATE",
  "TENANT_ROOT",
  "TENANT_OWNED",
  "GLOBAL_IDENTITY_WITH_TENANT_CONTEXT",
] as const;

export const recordSemantics = ["MUTABLE_ENTITY", "PROJECT_FACT", "RELEASED_ARTIFACT"] as const;

export const platformRoles = ["PLATFORM_ADMIN"] as const;
export const tenantRoles = ["TENANT_ADMIN", "TENANT_MEMBER"] as const;

export const tenantStatuses = ["ACTIVE", "SUSPENDED", "DEACTIVATED"] as const;
export const entityStatuses = ["ACTIVE", "DEACTIVATED"] as const;
export const releaseStatuses = ["DRAFT", "PUBLISHED", "DEPRECATED"] as const;
export const executionResponseOutcomeKinds = [
  "ANSWER",
  "PARTIAL_ANSWER",
  "REFUSAL",
  "PARTIAL_REFUSAL",
  "NO_INFORMATION",
  "OTHER_VISIBLE_RESPONSE",
] as const;
export const captureArtifactKinds = [
  "RAW_RESPONSE",
  "SCREENSHOT",
  "STRUCTURED_RESPONSE",
  "TRACE",
] as const;
export const observationRepresentations = ["TEXT", "STRUCTURED", "MIXED"] as const;
export const observationCorrelationStatuses = ["CONFIRMED", "PROBABLE", "UNCERTAIN"] as const;
export const observationExistenceBasisKinds = [
  "VISIBLE_TEXT_RESPONSE",
  "VISIBLE_STRUCTURED_RESPONSE",
  "VISIBLE_REFUSAL",
  "VISIBLE_NO_INFORMATION",
  "VISIBLE_PARTIAL_RESPONSE",
  "OTHER_VISIBLE_RESPONSE",
] as const;

export type AccessScope = (typeof accessScopes)[number];
export type RecordSemantics = (typeof recordSemantics)[number];
export type PlatformRole = (typeof platformRoles)[number];
export type TenantRole = (typeof tenantRoles)[number];
export type TenantStatus = (typeof tenantStatuses)[number];
export type EntityStatus = (typeof entityStatuses)[number];
export type ReleaseStatus = (typeof releaseStatuses)[number];

export const uuidSchema = z.uuid();
export const nonEmptyNameSchema = z.string().trim().min(1).max(200);
export const slugSchema = z
  .string()
  .trim()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "Use lowercase letters, numbers, and hyphens");

export const createTenantSchema = z.strictObject({
  slug: slugSchema,
  name: nonEmptyNameSchema,
  initialAdminUserIdentityId: uuidSchema,
});

export const createCustomerSchema = z.strictObject({
  name: nonEmptyNameSchema,
});

export const createBrandSchema = z.strictObject({
  customerId: uuidSchema,
  name: nonEmptyNameSchema,
});

export const createProjectSchema = z.strictObject({
  brandId: uuidSchema,
  name: nonEmptyNameSchema,
});

export const createMembershipSchema = z.strictObject({
  userIdentityId: uuidSchema,
  roles: z
    .array(z.enum(tenantRoles))
    .min(1)
    .max(2)
    .refine((roles) => new Set(roles).size === roles.length, "Roles must be unique"),
});

export const deactivateEntitySchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
});

export const replacePolicyBindingSchema = z.strictObject({
  policyReleaseId: uuidSchema,
  reason: z.string().trim().min(1).max(500),
});

export const replaceIndustryBindingSchema = z.strictObject({
  industryPolicyReleaseId: uuidSchema.nullable(),
  reason: z.string().trim().min(1).max(500),
});

const executionContextValueSchema = z.record(z.string(), z.unknown());
const executionRuntimeNameSchema = z.string().trim().min(1).max(200);

export const createExecutionRunSchema = z.strictObject({
  sampleSlotId: uuidSchema,
  retryOfExecutionRunId: uuidSchema.optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export const startExecutionRunSchema = z.strictObject({
  actualPlatform: executionRuntimeNameSchema,
  actualModel: executionRuntimeNameSchema,
  actualSurface: executionRuntimeNameSchema,
  executionContextSnapshot: executionContextValueSchema,
});

export const completeExecutionRunSchema = z.strictObject({
  responseOutcomeKind: z.enum(executionResponseOutcomeKinds).nullable().optional(),
});

export const failExecutionRunSchema = z.strictObject({
  responseOutcomeKind: z.enum(executionResponseOutcomeKinds).nullable().optional(),
  operationalError: executionContextValueSchema,
});

export const cancelExecutionRunSchema = z.strictObject({
  operationalError: executionContextValueSchema.optional(),
});

export const captureArtifactMetadataSchema = z.strictObject({
  executionRunId: uuidSchema,
  idempotencyKey: z.string().trim().min(1).max(200),
  artifactKind: z.enum(captureArtifactKinds),
  mediaType: z.string().trim().min(1).max(200),
  capturedAt: z.iso.datetime({ offset: true }),
  declaredSha256: z.string().regex(/^[0-9a-f]{64}$/u),
});

export const observationExistenceBasisSchema = z.strictObject({
  kind: z.enum(observationExistenceBasisKinds),
  questionSubmittedAt: z.iso.datetime({ offset: true }),
  detectorVersion: z.string().trim().min(1).max(100),
  conversationMarker: z.string().trim().min(1).max(500).optional(),
  responseMarker: z.string().trim().min(1).max(500).optional(),
  evidenceArtifactIds: z
    .array(uuidSchema)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, "Evidence Artifact IDs must be unique")
    .optional(),
});

export const createObservationCandidateSchema = z.strictObject({
  executionRunId: uuidSchema,
  responseOutcomeKind: z.enum(executionResponseOutcomeKinds),
  representation: z.enum(observationRepresentations),
  correlationStatus: z.enum(observationCorrelationStatuses),
  targetSurfaceReached: z.literal(true),
  targetQuestionSubmitted: z.literal(true),
  visibleResponseOutcomeObserved: z.literal(true),
  lifecycleAssociated: z.literal(true),
  existenceBasis: observationExistenceBasisSchema,
  responseStartedAt: z.iso.datetime({ offset: true }),
  responseLastSeenAt: z.iso.datetime({ offset: true }),
});

export const finalizeObservationSchema = z
  .strictObject({
    observationCandidateId: uuidSchema,
    representation: z.enum(observationRepresentations),
    rawAnswerText: z.string().min(1).max(1_000_000).optional(),
    rawAnswerArtifactId: uuidSchema.optional(),
    captureArtifactIds: z
      .array(uuidSchema)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, "Capture Artifact IDs must be unique"),
    responseLastSeenAt: z.iso.datetime({ offset: true }),
    rawObservationVersion: z.literal(1).default(1),
  })
  .superRefine((value, context) => {
    if (value.rawAnswerText === undefined && value.rawAnswerArtifactId === undefined) {
      context.addIssue({
        code: "custom",
        message: "Raw answer text or a raw-answer CaptureArtifact is required",
        path: ["rawAnswerText"],
      });
    }
    if (
      value.rawAnswerArtifactId !== undefined &&
      !value.captureArtifactIds.includes(value.rawAnswerArtifactId)
    ) {
      context.addIssue({
        code: "custom",
        message: "Capture Manifest must include the raw-answer CaptureArtifact",
        path: ["captureArtifactIds"],
      });
    }
  });

export const domainEventEnvelopeSchema = z.strictObject({
  event_id: uuidSchema,
  event_type: z.string().trim().min(1).max(200),
  tenant_id: uuidSchema.nullable(),
  aggregate_type: z.string().trim().min(1).max(200),
  aggregate_id: uuidSchema,
  schema_version: z.number().int().positive(),
  occurred_at: z.iso.datetime({ offset: true }),
  trace_id: uuidSchema,
  data: z.record(z.string(), z.unknown()),
});

export interface AuthenticatedIdentity {
  readonly userIdentityId: string;
}

export interface TenantContext {
  readonly tenantId: string;
  readonly membershipId: string;
  readonly userIdentityId: string;
  readonly roles: readonly TenantRole[];
}

export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly traceId: string;
    readonly details?: unknown;
  };
}

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type CreateBrandInput = z.infer<typeof createBrandSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreateMembershipInput = z.infer<typeof createMembershipSchema>;
export type DeactivateEntityInput = z.infer<typeof deactivateEntitySchema>;
export type ReplacePolicyBindingInput = z.infer<typeof replacePolicyBindingSchema>;
export type ReplaceIndustryBindingInput = z.infer<typeof replaceIndustryBindingSchema>;
export type CreateExecutionRunInput = z.infer<typeof createExecutionRunSchema>;
export type StartExecutionRunInput = z.infer<typeof startExecutionRunSchema>;
export type CompleteExecutionRunInput = z.infer<typeof completeExecutionRunSchema>;
export type FailExecutionRunInput = z.infer<typeof failExecutionRunSchema>;
export type CancelExecutionRunInput = z.infer<typeof cancelExecutionRunSchema>;
export type CaptureArtifactMetadataInput = z.infer<typeof captureArtifactMetadataSchema>;
export type CreateObservationCandidateInput = z.infer<typeof createObservationCandidateSchema>;
export type FinalizeObservationInput = z.infer<typeof finalizeObservationSchema>;
export type ExecutionResponseOutcomeKind = (typeof executionResponseOutcomeKinds)[number];
export type CaptureArtifactKind = (typeof captureArtifactKinds)[number];
export type ObservationRepresentation = (typeof observationRepresentations)[number];
export type ObservationCorrelationStatus = (typeof observationCorrelationStatuses)[number];
export type ObservationExistenceBasisKind = (typeof observationExistenceBasisKinds)[number];
export type DomainEventEnvelope = z.infer<typeof domainEventEnvelopeSchema>;
