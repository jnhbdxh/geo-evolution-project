import "dotenv/config";

import { buildApp } from "./app.js";
import { CaptureService } from "./capture-service.js";
import { loadConfig } from "./config.js";
import {
  createEvidenceObjectStore,
  loadEvidenceObjectStoreConfig,
} from "./evidence-object-store-factory.js";
import { InternalExecutionAuth } from "./internal-execution-auth.js";
import { ObservationFinalizationService } from "./observation-finalization-service.js";
import { createRepositoryContainer } from "./repository-container.js";

const config = loadConfig();
const repositories = createRepositoryContainer(config.DATABASE_URL);
const objectStore = createEvidenceObjectStore(loadEvidenceObjectStoreConfig());
const app = await buildApp({
  config,
  accessControl: repositories.accessControl,
  workspaceRepository: repositories.workspaceRepository,
  observationRepository: repositories.observationRepository,
  captureService: new CaptureService(repositories.captureRepository, objectStore),
  observationFinalizationService: new ObservationFinalizationService(
    repositories.observationRepository,
    objectStore,
  ),
  internalExecutionAuth: new InternalExecutionAuth(config.INTERNAL_SERVICE_TOKEN_SECRET),
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
