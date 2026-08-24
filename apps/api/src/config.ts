import { z } from "zod";

const configSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    DATABASE_URL: z.url(),
    JWT_SECRET: z.string().min(32),
    INTERNAL_SERVICE_TOKEN_SECRET: z.string().min(32),
    AUTH_MODE: z.enum(["development", "oidc"]).default("development"),
  })
  .superRefine((config, context) => {
    if (config.NODE_ENV === "production" && config.AUTH_MODE === "development") {
      context.addIssue({
        code: "custom",
        path: ["AUTH_MODE"],
        message: "AUTH_MODE=development is forbidden when NODE_ENV=production",
      });
    }
  });

const outboxDispatcherConfigSchema = z
  .object({
    OUTBOX_DATABASE_URL: z.url(),
    OUTBOX_DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(10).default(2),
    OUTBOX_PUBLISH_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
    OUTBOX_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
    OUTBOX_IDLE_IN_TRANSACTION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(200)
      .max(120_000)
      .default(10_000),
  })
  .superRefine((config, context) => {
    if (new URL(config.OUTBOX_DATABASE_URL).username !== "geo_os_outbox_dispatcher") {
      context.addIssue({
        code: "custom",
        path: ["OUTBOX_DATABASE_URL"],
        message: "OUTBOX_DATABASE_URL must use the geo_os_outbox_dispatcher login",
      });
    }
    if (config.OUTBOX_IDLE_IN_TRANSACTION_TIMEOUT_MS <= config.OUTBOX_PUBLISH_TIMEOUT_MS) {
      context.addIssue({
        code: "custom",
        path: ["OUTBOX_IDLE_IN_TRANSACTION_TIMEOUT_MS"],
        message: "OUTBOX_IDLE_IN_TRANSACTION_TIMEOUT_MS must exceed OUTBOX_PUBLISH_TIMEOUT_MS",
      });
    }
  });

export type ApiConfig = z.infer<typeof configSchema>;
export type OutboxDispatcherConfig = z.infer<typeof outboxDispatcherConfigSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  return configSchema.parse(environment);
}

export function loadOutboxDispatcherConfig(
  environment: NodeJS.ProcessEnv = process.env,
): OutboxDispatcherConfig {
  return outboxDispatcherConfigSchema.parse(environment);
}
