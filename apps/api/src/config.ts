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
    QUERY_ENGINE_WORKER_TOKEN: z.string().min(32),
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
    if (
      new Set([
        config.JWT_SECRET,
        config.INTERNAL_SERVICE_TOKEN_SECRET,
        config.QUERY_ENGINE_WORKER_TOKEN,
      ]).size !== 3
    ) {
      context.addIssue({
        code: "custom",
        path: ["QUERY_ENGINE_WORKER_TOKEN"],
        message: "User, signing, and Query Engine Worker credentials must be distinct",
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
    REDIS_URL: z.url().refine((value) => ["redis:", "rediss:"].includes(new URL(value).protocol), {
      message: "REDIS_URL must use redis:// or rediss://",
    }),
    OUTBOX_QUEUE_NAME: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[A-Za-z0-9_-]+$/u, "OUTBOX_QUEUE_NAME must contain only letters, digits, _ or -")
      .default("geo-os-domain-events"),
    QUERY_EXECUTION_QUEUE_NAME: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(
        /^[A-Za-z0-9_-]+$/u,
        "QUERY_EXECUTION_QUEUE_NAME must contain only letters, digits, _ or -",
      )
      .default("geo-os-query-executions"),
    OUTBOX_REDIS_STARTUP_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
    OUTBOX_REDIS_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(3_000),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(10).max(60_000).default(250),
    OUTBOX_ERROR_DELAY_MS: z.coerce.number().int().min(100).max(60_000).default(1_000),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(8),
    OUTBOX_BASE_RETRY_DELAY_MS: z.coerce.number().int().min(100).max(3_600_000).default(1_000),
    OUTBOX_MAX_RETRY_DELAY_MS: z.coerce.number().int().min(100).max(86_400_000).default(300_000),
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
    if (config.OUTBOX_REDIS_COMMAND_TIMEOUT_MS > config.OUTBOX_PUBLISH_TIMEOUT_MS) {
      context.addIssue({
        code: "custom",
        path: ["OUTBOX_REDIS_COMMAND_TIMEOUT_MS"],
        message: "OUTBOX_REDIS_COMMAND_TIMEOUT_MS must not exceed OUTBOX_PUBLISH_TIMEOUT_MS",
      });
    }
    if (config.OUTBOX_MAX_RETRY_DELAY_MS < config.OUTBOX_BASE_RETRY_DELAY_MS) {
      context.addIssue({
        code: "custom",
        path: ["OUTBOX_MAX_RETRY_DELAY_MS"],
        message: "OUTBOX_MAX_RETRY_DELAY_MS must not be lower than OUTBOX_BASE_RETRY_DELAY_MS",
      });
    }
    if (config.QUERY_EXECUTION_QUEUE_NAME === config.OUTBOX_QUEUE_NAME) {
      context.addIssue({
        code: "custom",
        path: ["QUERY_EXECUTION_QUEUE_NAME"],
        message: "QUERY_EXECUTION_QUEUE_NAME must be distinct from OUTBOX_QUEUE_NAME",
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
