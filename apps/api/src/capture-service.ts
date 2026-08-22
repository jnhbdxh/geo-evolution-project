import {
  captureArtifactMetadataSchema,
  type CaptureArtifactMetadataInput,
  type TenantContext,
} from "@geo-os/contracts";

import type { CaptureArtifactRow, CaptureRepository } from "./capture-repository.js";
import type { EvidenceObjectStore } from "./evidence-object-store.js";
import { sha256Bytes } from "./evidence-object-store.js";
import { conflict } from "./errors.js";

export interface CaptureBytesCommand extends CaptureArtifactMetadataInput {
  readonly bytes: Uint8Array;
}

export class CaptureService {
  public constructor(
    private readonly repository: CaptureRepository,
    private readonly objectStore: EvidenceObjectStore,
  ) {}

  public async captureBytes(
    context: TenantContext,
    command: CaptureBytesCommand,
    traceId: string,
  ): Promise<CaptureArtifactRow> {
    const metadata = captureArtifactMetadataSchema.parse({
      executionRunId: command.executionRunId,
      idempotencyKey: command.idempotencyKey,
      artifactKind: command.artifactKind,
      mediaType: command.mediaType,
      capturedAt: command.capturedAt,
      declaredSha256: command.declaredSha256,
    });
    const bytes = Buffer.from(command.bytes);
    const computedSha256 = sha256Bytes(bytes);
    if (computedSha256 !== metadata.declaredSha256) {
      throw conflict("Capture bytes SHA-256 does not match the declared SHA-256");
    }

    const target = await this.repository.resolveCaptureTarget(context, metadata.executionRunId);
    const reference = await this.objectStore.putVerifiedObject({
      tenantId: context.tenantId,
      projectId: target.projectId,
      executionRunId: metadata.executionRunId,
      idempotencyKey: metadata.idempotencyKey,
      artifactKind: metadata.artifactKind,
      mediaType: metadata.mediaType,
      bytes,
      declaredSha256: metadata.declaredSha256,
    });
    return this.repository.registerCaptureArtifact(
      context,
      {
        executionRunId: metadata.executionRunId,
        idempotencyKey: metadata.idempotencyKey,
        artifactKind: metadata.artifactKind,
        storageBucket: reference.storageBucket,
        storageKey: reference.storageKey,
        mediaType: metadata.mediaType,
        byteSize: reference.byteSize,
        sha256: reference.sha256,
        capturedAt: new Date(metadata.capturedAt),
      },
      traceId,
    );
  }
}
