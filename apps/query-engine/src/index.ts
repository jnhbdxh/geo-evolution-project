export { resolveBrowserExecutablePath } from "./browser-runtime.js";
export {
  type CandidateDecision,
  CoreExecutionClient,
  CoreExecutionCommandError,
  type CoreExecutionAssignment,
  type CoreExecutionClientOptions,
} from "./core-execution-client.js";
export {
  CoreBoundWebExecution,
  type CoreBoundExecutionResult,
  type CoreBoundWebExecutionDependencies,
} from "./core-bound-web-execution.js";
export { loadQueryEngineConfig, type QueryEngineConfig } from "./config.js";
export { DoubaoWebAdapter, type DoubaoWebAdapterDependencies } from "./doubao-web-adapter.js";
export { doubaoWebCapabilityV20260822, type DoubaoWebCapability } from "./doubao-web-capability.js";
export {
  type UiTruthCapture,
  type QuestionResponseBinding,
  type VisibleLinkCandidate,
  type WebSurfaceAdapter,
  type WebSurfaceExecutionRequest,
  type WebSurfaceExecutionLifecycle,
  type WebSurfaceExecutionResult,
  type WebSurfaceRuntimeContext,
  WebSurfaceExecutionError,
  type WebSurfaceExecutionErrorKind,
} from "./web-surface-adapter.js";
