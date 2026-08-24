import { createHash } from "node:crypto";

import { Client as MinioClient } from "minio";

import type { DomainCommandContext } from "@geo-os/contracts";

import { conflict, notFound } from "./errors.js";

export interface MinioEvidenceObjectStoreConfig {
  readonly endpoint: string;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly bucket: string;
}

export interface EvidenceObjectScope {
  readonly tenantId: string;
  readonly projectId: string;
  readonly executionRunId: string;
}

export interface EvidenceObjectReference {
  readonly storageBucket: string;
  readonly storageKey: string;
  readonly byteSize: number;
  readonly sha256: string;
}

export interface PutEvidenceObjectInput extends EvidenceObjectScope {
  readonly idempotencyKey: string;
  readonly artifactKind: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
  readonly declaredSha256: string;
}

export interface EvidenceObjectStore {
  putVerifiedObject(input: PutEvidenceObjectInput): Promise<EvidenceObjectReference>;
  verifyObject(
    context: DomainCommandContext,
    reference: EvidenceObjectReference,
  ): Promise<EvidenceObjectReference>;
  removeVerifiedObject(
    context: DomainCommandContext,
    reference: EvidenceObjectReference,
  ): Promise<void>;
}

export class MinioEvidenceObjectStore implements EvidenceObjectStore {
  private readonly client: MinioClient;

  public constructor(private readonly config: MinioEvidenceObjectStoreConfig) {
    const endpoint = parseEndpoint(config.endpoint);
    this.client = new MinioClient({
      endPoint: endpoint.hostname,
      port: endpoint.port,
      useSSL: endpoint.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
      pathStyle: true,
    });
  }

  public async putVerifiedObject(input: PutEvidenceObjectInput): Promise<EvidenceObjectReference> {
    const computedSha256 = sha256Bytes(input.bytes);
    if (computedSha256 !== input.declaredSha256) {
      throw conflict("Capture bytes SHA-256 does not match the declared SHA-256");
    }
    await this.ensurePrivateBucket();
    const storageKey = buildCaptureStorageKey(input);
    const reference = {
      storageBucket: this.config.bucket,
      storageKey,
      byteSize: input.bytes.byteLength,
      sha256: computedSha256,
    };

    const existing = await this.tryVerifyStoredObject(reference);
    if (existing) return existing;

    const bytes = Buffer.from(input.bytes);
    await this.client.putObject(this.config.bucket, storageKey, bytes, bytes.byteLength, {
      "Content-Type": input.mediaType,
      "X-Amz-Meta-Sha256": computedSha256,
    });
    return this.verifyStoredObject(reference);
  }

  public async verifyObject(
    context: DomainCommandContext,
    reference: EvidenceObjectReference,
  ): Promise<EvidenceObjectReference> {
    assertTenantObjectReference(
      context.tenantId,
      reference.storageBucket,
      reference.storageKey,
      this.config.bucket,
    );
    return this.verifyStoredObject(reference);
  }

  public async removeVerifiedObject(
    context: DomainCommandContext,
    reference: EvidenceObjectReference,
  ): Promise<void> {
    assertTenantObjectReference(
      context.tenantId,
      reference.storageBucket,
      reference.storageKey,
      this.config.bucket,
    );
    const existing = await this.tryVerifyStoredObject(reference);
    if (!existing) return;
    await this.client.removeObject(reference.storageBucket, reference.storageKey);
  }

  private async ensurePrivateBucket(): Promise<void> {
    if (!(await this.client.bucketExists(this.config.bucket))) {
      try {
        await this.client.makeBucket(this.config.bucket);
      } catch (error) {
        if (!isBucketAlreadyOwned(error)) throw error;
      }
    }
    await this.requireNoBucketPolicy();
  }

  private async requireNoBucketPolicy(): Promise<void> {
    try {
      await this.client.getBucketPolicy(this.config.bucket);
      throw conflict("Capture evidence bucket must not expose a bucket policy");
    } catch (error) {
      if (isMissingBucketPolicy(error)) return;
      throw error;
    }
  }

  private async tryVerifyStoredObject(
    reference: EvidenceObjectReference,
  ): Promise<EvidenceObjectReference | null> {
    try {
      return await this.verifyStoredObject(reference);
    } catch (error) {
      if (isMissingObject(error)) return null;
      throw error;
    }
  }

  private async verifyStoredObject(
    reference: EvidenceObjectReference,
  ): Promise<EvidenceObjectReference> {
    const stat = await this.client.statObject(reference.storageBucket, reference.storageKey);
    if (stat.size !== reference.byteSize) {
      throw conflict("Stored Capture object byte size does not match its immutable manifest");
    }
    const stream = await this.client.getObject(reference.storageBucket, reference.storageKey);
    const actual = await hashReadable(stream as AsyncIterable<Buffer | string>);
    if (actual.byteSize !== reference.byteSize || actual.sha256 !== reference.sha256) {
      throw conflict("Stored Capture object bytes do not match their immutable manifest");
    }
    return reference;
  }
}

export function buildCaptureStorageKey(input: {
  readonly tenantId: string;
  readonly projectId: string;
  readonly executionRunId: string;
  readonly artifactKind: string;
  readonly idempotencyKey: string;
  readonly declaredSha256: string;
}): string {
  const idempotencyDigest = createHash("sha256").update(input.idempotencyKey, "utf8").digest("hex");
  return [
    "tenants",
    input.tenantId,
    "projects",
    input.projectId,
    "executions",
    input.executionRunId,
    "captures",
    input.artifactKind.toLowerCase(),
    `${idempotencyDigest}-${input.declaredSha256}`,
  ].join("/");
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function hashReadable(
  readable: AsyncIterable<Buffer | string>,
): Promise<{ readonly byteSize: number; readonly sha256: string }> {
  const hash = createHash("sha256");
  let byteSize = 0;
  for await (const chunk of readable) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteSize += bytes.byteLength;
    hash.update(bytes);
  }
  return { byteSize, sha256: hash.digest("hex") };
}

export function assertTenantObjectReference(
  tenantId: string,
  bucket: string,
  storageKey: string,
  expectedBucket: string,
): void {
  if (bucket !== expectedBucket || !storageKey.startsWith(`tenants/${tenantId}/`)) {
    throw notFound("CaptureArtifact not found");
  }
}

function parseEndpoint(endpoint: string): {
  readonly hostname: string;
  readonly port: number;
  readonly useSSL: boolean;
} {
  const url = new URL(endpoint);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.pathname !== "/") {
    throw new Error("Object storage endpoint must be an HTTP(S) origin without a path");
  }
  return {
    hostname: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
    useSSL: url.protocol === "https:",
  };
}

function isMissingObject(error: unknown): boolean {
  const code = errorCode(error);
  return code === "NoSuchKey" || code === "NotFound" || code === "NoSuchObject";
}

function isBucketAlreadyOwned(error: unknown): boolean {
  const code = errorCode(error);
  return code === "BucketAlreadyOwnedByYou" || code === "BucketAlreadyExists";
}

function isMissingBucketPolicy(error: unknown): boolean {
  const code = errorCode(error);
  return code === "NoSuchBucketPolicy" || code === "NoSuchPolicy";
}

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : null;
}
