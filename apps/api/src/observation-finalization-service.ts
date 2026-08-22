import {
  finalizeObservationSchema,
  type FinalizeObservationInput,
  type TenantContext,
} from "@geo-os/contracts";

import type { EvidenceObjectStore } from "./evidence-object-store.js";
import type { ObservationRepository, RawObservationRow } from "./observation-repository.js";

type ObservationFinalizationRepository = Pick<
  ObservationRepository,
  "resolveObservationFinalizationEvidence" | "finalizeObservation"
>;

export class ObservationFinalizationService {
  public constructor(
    private readonly repository: ObservationFinalizationRepository,
    private readonly objectStore: EvidenceObjectStore,
  ) {}

  public async finalize(
    context: TenantContext,
    input: FinalizeObservationInput,
    traceId: string,
  ): Promise<RawObservationRow> {
    const parsed = finalizeObservationSchema.parse(input);
    const command: FinalizeObservationInput = {
      ...parsed,
      captureArtifactIds: [...parsed.captureArtifactIds].sort(),
    };
    const evidence = await this.repository.resolveObservationFinalizationEvidence(context, command);
    for (const artifact of evidence.artifacts) {
      await this.objectStore.verifyObject(context, {
        storageBucket: artifact.storage_bucket,
        storageKey: artifact.storage_key,
        byteSize: Number(artifact.byte_size),
        sha256: artifact.sha256,
      });
    }
    return this.repository.finalizeObservation(context, command, traceId);
  }
}
