import "dotenv/config";

import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { chromium } from "playwright";

import { resolveBrowserExecutablePath } from "./browser-runtime.js";
import { CoreBoundWebExecution } from "./core-bound-web-execution.js";
import { CoreExecutionClient } from "./core-execution-client.js";
import { CoreWorkerClient } from "./core-worker-client.js";
import { loadQueryEngineConfig, loadQueryEngineWorkerConfig } from "./config.js";
import { DoubaoWebAdapter } from "./doubao-web-adapter.js";
import { doubaoWebCapabilityV20260825 } from "./doubao-web-capability.js";
import { handleExecutionQueuedJob, type ExecutionQueuedJobData } from "./execution-queued-job.js";
import { classifyExecutionJobError, executionJobLogFields } from "./query-engine-worker-logging.js";

const queryConfig = loadQueryEngineConfig();
const workerConfig = loadQueryEngineWorkerConfig();
const executablePath = resolveBrowserExecutablePath(
  queryConfig.QUERY_ENGINE_BROWSER_EXECUTABLE_PATH,
);
const browser = await chromium.launch({
  headless: queryConfig.QUERY_ENGINE_HEADLESS,
  ...(executablePath === undefined ? {} : { executablePath }),
});
const connection = new Redis(workerConfig.REDIS_URL, {
  connectionName: "geo-os-query-engine-worker",
  maxRetriesPerRequest: null,
});
const coreWorker = new CoreWorkerClient({
  baseUrl: workerConfig.CORE_API_BASE_URL,
  workerToken: workerConfig.QUERY_ENGINE_WORKER_TOKEN,
});
const worker = new Worker<ExecutionQueuedJobData>(
  workerConfig.QUERY_EXECUTION_QUEUE_NAME,
  async (job: Job<ExecutionQueuedJobData>) => {
    if (job.name !== "ExecutionQueued") {
      throw new Error("Unexpected event type in the Query Engine execution queue");
    }
    return handleExecutionQueuedJob({
      job: job.data,
      core: coreWorker,
      execute: async ({ token, envelope }) => {
        const core = new CoreExecutionClient({
          baseUrl: workerConfig.CORE_API_BASE_URL,
          executionRunId: envelope.aggregate_id,
          token,
          traceId: envelope.trace_id,
        });
        const assignment = await core.getAssignment();
        const context = await browser.newContext({
          storageState: queryConfig.DOUBAO_STORAGE_STATE_PATH,
          locale: assignment.locale,
          timezoneId: "Asia/Shanghai",
          viewport: { width: 1440, height: 1000 },
        });
        try {
          const adapter = new DoubaoWebAdapter({
            page: await context.newPage(),
            interactiveVerificationTimeoutMs:
              queryConfig.DOUBAO_INTERACTIVE_VERIFICATION_TIMEOUT_MS,
            capability: {
              ...doubaoWebCapabilityV20260825,
              entryUrl: queryConfig.DOUBAO_ENTRY_URL,
            },
          });
          return await new CoreBoundWebExecution({
            adapter,
            core,
            decideCandidate: (result) => {
              if (result.uiTruth.responseText.trim().length === 0) {
                throw new Error("Visible Doubao response text is empty");
              }
              return {
                responseOutcomeKind: "ANSWER",
                representation: "TEXT",
                correlationStatus: "CONFIRMED",
                existenceBasisKind: "VISIBLE_TEXT_RESPONSE",
                detectorVersion: "core-bound-visible-text-contract/1",
              };
            },
          }).run({
            executionRunId: assignment.execution_run_id,
            questionVersionId: assignment.question_version_id,
            identityId: workerConfig.QUERY_ENGINE_IDENTITY_ID,
            promptText: assignment.prompt_text,
            locale: assignment.locale,
            region: assignment.region ?? "CN",
          });
        } finally {
          await context.close();
        }
      },
    });
  },
  { connection, concurrency: 1 },
);

const stop = async (): Promise<void> => {
  await worker.close();
  await browser.close();
  connection.disconnect();
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
worker.on("completed", (job) =>
  writeLog("info", "QUERY_EXECUTION_JOB_COMPLETED", executionJobLogFields(job)),
);
worker.on("failed", (job, error) =>
  writeLog("error", "QUERY_EXECUTION_JOB_FAILED", {
    ...executionJobLogFields(job),
    error_category: classifyExecutionJobError(error),
  }),
);
worker.on("error", (error) =>
  process.stderr.write(
    `${JSON.stringify({ level: "error", code: "QUERY_WORKER_ERROR", name: error.name })}\n`,
  ),
);
await worker.waitUntilReady();
writeLog("info", "QUERY_ENGINE_WORKER_READY");

function writeLog(
  level: "info" | "error",
  code: string,
  fields: Readonly<Record<string, unknown>> = {},
): void {
  process.stdout.write(`${JSON.stringify({ level, code, ...fields })}\n`);
}
