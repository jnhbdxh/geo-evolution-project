import "dotenv/config";

import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createRepositoryContainer } from "./repository-container.js";

const config = loadConfig();
const repositories = createRepositoryContainer(config.DATABASE_URL);
const app = await buildApp({
  config,
  accessControl: repositories.accessControl,
  workspaceRepository: repositories.workspaceRepository,
  observationRepository: repositories.observationRepository,
});

const shutdown = async (): Promise<void> => {
  await app.close();
  await repositories.close();
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.fatal({ error }, "Failed to start API");
  await shutdown();
  process.exitCode = 1;
}
