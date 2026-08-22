import { describe, expect, it } from "vitest";

import type { TenantContext } from "@geo-os/contracts";

import { CosEvidenceObjectStore, type CosObjectClient } from "./cos-evidence-object-store.js";
import {
  createEvidenceObjectStore,
  loadEvidenceObjectStoreConfig,
} from "./evidence-object-store-factory.js";
import {
  MinioEvidenceObjectStore,
  sha256Bytes,
  type PutEvidenceObjectInput,
} from "./evidence-object-store.js";

const tenantId = "11111111-1111-4111-8111-111111111111";
const otherTenantId = "22222222-2222-4222-8222-222222222222";
const context: TenantContext = {
  tenantId,
  userIdentityId: "33333333-3333-4333-8333-333333333333",
  membershipId: "44444444-4444-4444-8444-444444444444",
  roles: ["TENANT_MEMBER"],
};

describe("evidence object-store provider configuration", () => {
  it("selects MinIO for local development and COS for production", () => {
    const minio = loadEvidenceObjectStoreConfig({
      NODE_ENV: "development",
      OBJECT_STORAGE_PROVIDER: "minio",
      OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000",
      OBJECT_STORAGE_ACCESS_KEY: "local-access",
      OBJECT_STORAGE_SECRET_KEY: "local-secret",
      OBJECT_STORAGE_BUCKET: "geo-os-evidence",
    });
    expect(createEvidenceObjectStore(minio)).toBeInstanceOf(MinioEvidenceObjectStore);

    const cos = loadEvidenceObjectStoreConfig({
      NODE_ENV: "production",
      OBJECT_STORAGE_PROVIDER: "cos",
      OBJECT_STORAGE_BUCKET: "geo-os-evidence-1250000000",
      COS_REGION: "ap-guangzhou",
      COS_SECRET_ID: "production-secret-id",
      COS_SECRET_KEY: "production-secret-key",
    });
    expect(createEvidenceObjectStore(cos)).toBeInstanceOf(CosEvidenceObjectStore);
  });

  it("rejects MinIO in production and rejects a COS bucket without its APPID suffix", () => {
    expect(() =>
      loadEvidenceObjectStoreConfig({
        NODE_ENV: "production",
        OBJECT_STORAGE_PROVIDER: "minio",
      }),
    ).toThrow("OBJECT_STORAGE_PROVIDER=cos is required when NODE_ENV=production");

    expect(() =>
      loadEvidenceObjectStoreConfig({
        NODE_ENV: "production",
        OBJECT_STORAGE_PROVIDER: "cos",
        OBJECT_STORAGE_BUCKET: "geo-os-evidence",
        COS_REGION: "ap-guangzhou",
        COS_SECRET_ID: "production-secret-id",
        COS_SECRET_KEY: "production-secret-key",
      }),
    ).toThrow("COS bucket must include its APPID suffix");
  });
});

describe("COS evidence object-store contract", () => {
  it("uses the provider-neutral key, private ACL and real-byte verification", async () => {
    const fake = createFakeCosClient();
    const store = createCosStore(fake.client);
    const input = captureInput(Buffer.from("verified COS evidence", "utf8"));

    const first = await store.putVerifiedObject(input);
    const replay = await store.putVerifiedObject(input);

    expect(replay).toEqual(first);
    expect(fake.puts).toBe(1);
    expect(fake.lastAcl).toBe("private");
    expect(first.storageKey).toMatch(
      new RegExp(`^tenants/${tenantId}/projects/.+/executions/.+/captures/raw_response/`, "u"),
    );
    await expect(store.verifyObject(context, first)).resolves.toEqual(first);

    fake.objects.set(first.storageKey, Buffer.from("tampered", "utf8"));
    await expect(store.verifyObject(context, first)).rejects.toThrow(
      "Stored Capture object bytes do not match their immutable manifest",
    );
  });

  it("rejects cross-Tenant references before COS lookup and removes verified objects", async () => {
    const fake = createFakeCosClient();
    const store = createCosStore(fake.client);
    const reference = await store.putVerifiedObject(captureInput(Buffer.from("tenant evidence")));
    const getsBefore = fake.gets;

    await expect(
      store.verifyObject({ ...context, tenantId: otherTenantId }, reference),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fake.gets).toBe(getsBefore);

    await store.removeVerifiedObject(context, reference);
    expect(fake.objects.has(reference.storageKey)).toBe(false);
  });
});

function createCosStore(client: CosObjectClient): CosEvidenceObjectStore {
  return new CosEvidenceObjectStore(
    {
      bucket: "geo-os-evidence-1250000000",
      region: "ap-guangzhou",
      secretId: "unused-by-fake",
      secretKey: "unused-by-fake",
    },
    client,
  );
}

function captureInput(bytes: Buffer): PutEvidenceObjectInput {
  return {
    tenantId,
    projectId: "55555555-5555-4555-8555-555555555555",
    executionRunId: "66666666-6666-4666-8666-666666666666",
    idempotencyKey: "cos-capture-command",
    artifactKind: "RAW_RESPONSE",
    mediaType: "application/json",
    bytes,
    declaredSha256: sha256Bytes(bytes),
  };
}

function createFakeCosClient(): {
  readonly client: CosObjectClient;
  readonly objects: Map<string, Buffer>;
  readonly puts: number;
  readonly gets: number;
  readonly lastAcl: string | null;
} {
  const objects = new Map<string, Buffer>();
  let puts = 0;
  let gets = 0;
  let lastAcl: string | null = null;
  const result = {
    client: {
      putObject: async (input) => {
        puts += 1;
        lastAcl = input.ACL ?? null;
        if (!Buffer.isBuffer(input.Body)) throw new Error("Test COS client requires a Buffer body");
        objects.set(input.Key, Buffer.from(input.Body));
        return {};
      },
      getObject: async (input) => {
        gets += 1;
        const body = objects.get(input.Key);
        if (!body)
          throw Object.assign(new Error("missing"), { code: "NoSuchKey", statusCode: 404 });
        return { Body: Buffer.from(body) };
      },
      deleteObject: async (input) => {
        objects.delete(input.Key);
        return {};
      },
    },
    objects,
    get puts() {
      return puts;
    },
    get gets() {
      return gets;
    },
    get lastAcl() {
      return lastAcl;
    },
  } satisfies {
    readonly client: CosObjectClient;
    readonly objects: Map<string, Buffer>;
    readonly puts: number;
    readonly gets: number;
    readonly lastAcl: string | null;
  };
  return result;
}
