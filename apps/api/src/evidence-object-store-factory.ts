import { z } from "zod";

import {
  CosEvidenceObjectStore,
  type CosEvidenceObjectStoreConfig,
} from "./cos-evidence-object-store.js";
import {
  MinioEvidenceObjectStore,
  type EvidenceObjectStore,
  type MinioEvidenceObjectStoreConfig,
} from "./evidence-object-store.js";

export type EvidenceObjectStoreProviderConfig =
  | ({ readonly provider: "minio" } & MinioEvidenceObjectStoreConfig)
  | ({ readonly provider: "cos" } & CosEvidenceObjectStoreConfig);

const providerSchema = z.enum(["minio", "cos"]);
const bucketSchema = z.string().trim().min(1);

export function loadEvidenceObjectStoreConfig(
  environment: NodeJS.ProcessEnv = process.env,
): EvidenceObjectStoreProviderConfig {
  const provider = providerSchema.parse(environment.OBJECT_STORAGE_PROVIDER);
  const nodeEnvironment = z
    .enum(["development", "test", "production"])
    .default("development")
    .parse(environment.NODE_ENV);
  if (nodeEnvironment === "production" && provider !== "cos") {
    throw new Error("OBJECT_STORAGE_PROVIDER=cos is required when NODE_ENV=production");
  }

  if (provider === "minio") {
    const parsed = z
      .strictObject({
        endpoint: z.url(),
        accessKey: z.string().min(1),
        secretKey: z.string().min(1),
        bucket: bucketSchema,
      })
      .parse({
        endpoint: environment.OBJECT_STORAGE_ENDPOINT,
        accessKey: environment.OBJECT_STORAGE_ACCESS_KEY,
        secretKey: environment.OBJECT_STORAGE_SECRET_KEY,
        bucket: environment.OBJECT_STORAGE_BUCKET,
      });
    return { provider, ...parsed };
  }

  const parsed = z
    .strictObject({
      secretId: z.string().min(1),
      secretKey: z.string().min(1),
      sessionToken: z.string().min(1).optional(),
      region: z.string().trim().min(1),
      bucket: bucketSchema.regex(/^[a-z0-9][a-z0-9-]*-\d+$/u, {
        message: "COS bucket must include its APPID suffix, for example geo-os-evidence-1250000000",
      }),
    })
    .parse({
      secretId: environment.COS_SECRET_ID,
      secretKey: environment.COS_SECRET_KEY,
      sessionToken: environment.COS_SESSION_TOKEN,
      region: environment.COS_REGION,
      bucket: environment.OBJECT_STORAGE_BUCKET,
    });
  const { sessionToken, ...required } = parsed;
  return { provider, ...required, ...(sessionToken ? { sessionToken } : {}) };
}

export function createEvidenceObjectStore(
  config: EvidenceObjectStoreProviderConfig,
): EvidenceObjectStore {
  if (config.provider === "minio") return new MinioEvidenceObjectStore(config);
  return new CosEvidenceObjectStore(config);
}
