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

export type ApiConfig = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  return configSchema.parse(environment);
}
