import { PostgresAccessControl, type AccessControl } from "./access.js";
import { PostgresCaptureRepository, type CaptureRepository } from "./capture-repository.js";
import { Database } from "./database.js";
import {
  PostgresObservationRepository,
  type ObservationRepository,
} from "./observation-repository.js";
import { PostgresWorkspaceRepository, type WorkspaceRepository } from "./workspace-repository.js";

export interface RepositoryContainer {
  readonly accessControl: AccessControl;
  readonly workspaceRepository: WorkspaceRepository;
  readonly observationRepository: ObservationRepository;
  readonly captureRepository: CaptureRepository;
  close(): Promise<void>;
}

export function createRepositoryContainer(connectionString: string): RepositoryContainer {
  const database = new Database(connectionString);
  return {
    accessControl: new PostgresAccessControl(database),
    workspaceRepository: new PostgresWorkspaceRepository(database),
    observationRepository: new PostgresObservationRepository(database),
    captureRepository: new PostgresCaptureRepository(database),
    close: async () => database.close(),
  };
}
