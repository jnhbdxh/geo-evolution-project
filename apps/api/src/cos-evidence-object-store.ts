import COS from "cos-nodejs-sdk-v5";

import type { DomainCommandContext } from "@geo-os/contracts";

import {
  assertTenantObjectReference,
  buildCaptureStorageKey,
  sha256Bytes,
  type EvidenceObjectReference,
  type EvidenceObjectStore,
  type PutEvidenceObjectInput,
} from "./evidence-object-store.js";
import { conflict } from "./errors.js";

export interface CosEvidenceObjectStoreConfig {
  readonly secretId: string;
  readonly secretKey: string;
  readonly sessionToken?: string;
  readonly region: string;
  readonly bucket: string;
}

export interface CosObjectClient {
  putObject(input: COS.PutObjectParams): Promise<unknown>;
  getObject(input: COS.GetObjectParams): Promise<{ readonly Body: Buffer }>;
  deleteObject(input: COS.DeleteObjectParams): Promise<unknown>;
}

export class CosEvidenceObjectStore implements EvidenceObjectStore {
  private readonly client: CosObjectClient;

  public constructor(
    private readonly config: CosEvidenceObjectStoreConfig,
    client?: CosObjectClient,
  ) {
    this.client = client ?? createCosClient(config);
  }

  public async putVerifiedObject(input: PutEvidenceObjectInput): Promise<EvidenceObjectReference> {
    const computedSha256 = sha256Bytes(input.bytes);
    if (computedSha256 !== input.declaredSha256) {
      throw conflict("Capture bytes SHA-256 does not match the declared SHA-256");
    }
    const reference: EvidenceObjectReference = {
      storageBucket: this.config.bucket,
      storageKey: buildCaptureStorageKey(input),
      byteSize: input.bytes.byteLength,
      sha256: computedSha256,
    };

    const existing = await this.tryVerifyStoredObject(reference);
    if (existing) return existing;

    const bytes = Buffer.from(input.bytes);
    await this.client.putObject({
      Bucket: this.config.bucket,
      Region: this.config.region,
      Key: reference.storageKey,
      Body: bytes,
      ContentLength: bytes.byteLength,
      ContentType: input.mediaType,
      ACL: "private",
      "x-cos-meta-sha256": computedSha256,
    });
    return this.verifyStoredObject(reference);
  }

  public async verifyObject(
    context: DomainCommandContext,
    reference: EvidenceObjectReference,
  ): Promise<EvidenceObjectReference> {
    this.assertTenantReference(context, reference);
    return this.verifyStoredObject(reference);
  }

  public async removeVerifiedObject(
    context: DomainCommandContext,
    reference: EvidenceObjectReference,
  ): Promise<void> {
    this.assertTenantReference(context, reference);
    const existing = await this.tryVerifyStoredObject(reference);
    if (!existing) return;
    await this.client.deleteObject(this.objectRequest(reference));
  }

  private async tryVerifyStoredObject(
    reference: EvidenceObjectReference,
  ): Promise<EvidenceObjectReference | null> {
    try {
      return await this.verifyStoredObject(reference);
    } catch (error) {
      if (isMissingCosObject(error)) return null;
      throw error;
    }
  }

  private async verifyStoredObject(
    reference: EvidenceObjectReference,
  ): Promise<EvidenceObjectReference> {
    const result = await this.client.getObject(this.objectRequest(reference));
    const bytes = Buffer.from(result.Body);
    if (bytes.byteLength !== reference.byteSize || sha256Bytes(bytes) !== reference.sha256) {
      throw conflict("Stored Capture object bytes do not match their immutable manifest");
    }
    return reference;
  }

  private objectRequest(reference: EvidenceObjectReference): COS.GetObjectParams {
    return {
      Bucket: reference.storageBucket,
      Region: this.config.region,
      Key: reference.storageKey,
    };
  }

  private assertTenantReference(
    context: DomainCommandContext,
    reference: EvidenceObjectReference,
  ): void {
    assertTenantObjectReference(
      context.tenantId,
      reference.storageBucket,
      reference.storageKey,
      this.config.bucket,
    );
  }
}

function createCosClient(config: CosEvidenceObjectStoreConfig): CosObjectClient {
  const client = new COS({
    SecretId: config.secretId,
    SecretKey: config.secretKey,
    ...(config.sessionToken ? { SecurityToken: config.sessionToken } : {}),
  });
  return {
    putObject: (input) => client.putObject(input),
    getObject: (input) => client.getObject(input),
    deleteObject: (input) => client.deleteObject(input),
  };
}

function isMissingCosObject(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { readonly code?: unknown; readonly statusCode?: unknown };
  return candidate.code === "NoSuchKey" || candidate.statusCode === 404;
}
