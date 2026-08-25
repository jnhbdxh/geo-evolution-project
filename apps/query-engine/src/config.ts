import { z } from "zod";

const officialDoubaoUrl = "https://www.doubao.com/chat/";
const redisUrlSchema = z
  .url()
  .refine(
    (value) => ["redis:", "rediss:"].includes(new URL(value).protocol),
    "REDIS_URL must use redis:// or rediss://",
  );

const configSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DOUBAO_ENTRY_URL: z.url().default(officialDoubaoUrl),
    DOUBAO_STORAGE_STATE_PATH: z.string().trim().min(1),
    QUERY_ENGINE_HEADLESS: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    QUERY_ENGINE_BROWSER_EXECUTABLE_PATH: z.string().trim().min(1).optional(),
    DOUBAO_INTERACTIVE_VERIFICATION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(0)
      .max(300_000)
      .default(0),
    ALLOW_REAL_AI_TESTS: z.literal("true"),
  })
  .superRefine((config, context) => {
    if (config.NODE_ENV === "production" && config.DOUBAO_ENTRY_URL !== officialDoubaoUrl) {
      context.addIssue({
        code: "custom",
        path: ["DOUBAO_ENTRY_URL"],
        message: `Production Doubao Web execution must use ${officialDoubaoUrl}`,
      });
    }
    if (config.NODE_ENV === "production" && config.DOUBAO_INTERACTIVE_VERIFICATION_TIMEOUT_MS > 0) {
      context.addIssue({
        code: "custom",
        path: ["DOUBAO_INTERACTIVE_VERIFICATION_TIMEOUT_MS"],
        message: "Production execution cannot wait for interactive human verification",
      });
    }
  });

export type QueryEngineConfig = z.infer<typeof configSchema>;

const workerConfigSchema = z.object({
  CORE_API_BASE_URL: z.url(),
  QUERY_ENGINE_WORKER_TOKEN: z.string().min(32),
  QUERY_ENGINE_IDENTITY_ID: z.string().trim().min(1).max(200),
  REDIS_URL: redisUrlSchema,
  QUERY_EXECUTION_QUEUE_NAME: z.string().trim().min(1).max(100).default("geo-os-query-executions"),
});

export type QueryEngineWorkerConfig = z.infer<typeof workerConfigSchema>;

export function loadQueryEngineConfig(
  environment: NodeJS.ProcessEnv = process.env,
): QueryEngineConfig {
  return configSchema.parse(environment);
}

export function loadQueryEngineWorkerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): QueryEngineWorkerConfig {
  return workerConfigSchema.parse(environment);
}
