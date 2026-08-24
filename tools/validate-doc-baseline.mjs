import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const requireExternalSources = process.argv.includes("--require-external-sources");

const frozenMigrations = new Map([
  [
    "packages/database/migrations/0001_slice_1_foundation.sql",
    "e52769e5a4a0521adef73ae96bf3fd723c078aa2077567636513352522678ab5",
  ],
  [
    "packages/database/migrations/0002_slice_2_observation.sql",
    "9ac60051d0fb45868d2c1b0d84bd555eb105badf46e8eff46d19f320b8cce4e0",
  ],
]);

const frozenDecisionSources = new Map([
  [
    "docs/decision-registry/a1-observation-existence.yaml",
    "7268b8110cc6a58406cea3968552156bfa88c7060e0f8c1f4afba9ec961cd323",
  ],
  [
    "docs/decision-registry/a2-observation-validity-metric-eligibility.yaml",
    "e45f569851dd533b68edd9e600b42b75af5ad75e5d1f50865ef619080f829a53",
  ],
  [
    "docs/decision-registry/a3-immutability-review-model.yaml",
    "293fc110f5590e28ade243feacf7aa7d99cbb7c463d1a293014e85cf26c41ad9",
  ],
  [
    "docs/decision-registry/b-final-decision.yaml",
    "f8233f20fa67dee7b234b0e485893fe06d332f8af5e1b9e385dac986f2afa339",
  ],
  [
    "docs/decision-registry/c-citation-source-intelligence.yaml",
    "758ec17cdbbffbd7669075699b42f0d28f198a80ca5f010eb7b1426bc8244414",
  ],
]);

const requiredRepositoryDocuments = [
  "docs/document-index.yaml",
  "docs/product-implementation-status.yaml",
  "docs/worktree-change-inventory.yaml",
  "docs/product/GEO_OS_V2_Product_Scope_and_Implementation_Baseline_V1.0.md",
  "docs/contracts/GEO_OS_Core_Domain_Lifecycle_and_Authorization_Contract_V1.0.md",
  "docs/contracts/GEO_OS_Rules_Metrics_Evidence_and_Attribution_Contract_V1.0.md",
  "docs/contracts/GEO_OS_Engineering_Boundaries_Interaction_and_Release_Contract_V1.0.md",
  "docs/contracts/slice-2-observation-domain-contract-v0.1-addendum-1.md",
  "docs/decision-registry/index.yaml",
];

const stalePhrases = [
  "执行失败不会产生正式 Observation",
  "产品结果（归因子域 + 策略子域）",
  "customer inspection flow",
  "customer-visible execution/observation inspection UI",
];

function fail(message) {
  throw new Error(message);
}

function repositoryPath(relativePath) {
  return resolve(repositoryRoot, relativePath);
}

function readRepositoryText(relativePath) {
  return readFileSync(repositoryPath(relativePath), "utf8");
}

function hashFile(absolutePath) {
  return createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
}

function unquoteYamlScalar(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return JSON.parse(trimmed);
  }
  return trimmed;
}

function listTrackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  return new Set(output.split("\0").filter(Boolean));
}

function validateRequiredDocuments() {
  for (const relativePath of requiredRepositoryDocuments) {
    if (!existsSync(repositoryPath(relativePath))) {
      fail(`Required document is missing: ${relativePath}`);
    }
  }
}

function validateIndexedPaths() {
  const index = readRepositoryText("docs/document-index.yaml");
  const referencePattern =
    /^\s+(path|manifest|addendum|pending_addendum|parent_baseline|superseded_by|closed_by|mapped_by):\s+(.+)$/gm;
  const missing = [];
  let count = 0;

  for (const match of index.matchAll(referencePattern)) {
    count += 1;
    const declaredPath = unquoteYamlScalar(match[2]);
    const candidate = isAbsolute(declaredPath) ? declaredPath : repositoryPath(declaredPath);

    if (!existsSync(candidate)) {
      const isExternalWindowsPath = /^[A-Za-z]:\\/.test(declaredPath);
      if (isExternalWindowsPath && !requireExternalSources) {
        continue;
      }
      missing.push(declaredPath);
    }
  }

  if (missing.length > 0) {
    fail(`Indexed paths are missing:\n${missing.join("\n")}`);
  }

  return count;
}

function validateFrozenMigrations() {
  const freezeRecord = readRepositoryText(
    "docs/contracts/slice-1-and-2-ddl-freeze-record-v1.0.md",
  ).toLowerCase();

  for (const [relativePath, expectedHash] of frozenMigrations) {
    const actualHash = hashFile(repositoryPath(relativePath));
    if (actualHash !== expectedHash) {
      fail(`${relativePath} SHA-256 changed: ${actualHash}`);
    }
    if (!freezeRecord.includes(expectedHash)) {
      fail(`Freeze Record does not contain ${relativePath} SHA-256`);
    }
  }
}

function validateDecisionRegistrySources() {
  let verifiedExternalByteCount = 0;

  for (const [manifestPath, expectedHash] of frozenDecisionSources) {
    const manifest = readRepositoryText(manifestPath);
    const declaredHash = manifest.match(/^\s+sha256:\s+([0-9a-f]{64})\s*$/m)?.[1];
    const declaredSource = manifest.match(/^\s+path:\s+(.+)$/m)?.[1];

    if (declaredHash !== expectedHash) {
      fail(`${manifestPath} does not contain the approved source SHA-256`);
    }
    if (!declaredSource) {
      fail(`${manifestPath} does not declare a source path`);
    }

    const sourcePath = unquoteYamlScalar(declaredSource);
    if (!existsSync(sourcePath)) {
      if (requireExternalSources) {
        fail(`Frozen decision source is unavailable: ${sourcePath}`);
      }
      continue;
    }

    if (!statSync(sourcePath).isFile()) {
      fail(`Frozen decision source is not a file: ${sourcePath}`);
    }
    const actualHash = hashFile(sourcePath);
    if (actualHash !== expectedHash) {
      fail(`${sourcePath} SHA-256 changed: ${actualHash}`);
    }
    verifiedExternalByteCount += 1;
  }

  return verifiedExternalByteCount;
}

function validateNoStalePhrases() {
  const checkedFiles = [
    "README.md",
    "docs/product/GEO_OS_Product_Slice_Implementation_Map_V0.1.md",
    "docs/product/GEO_OS_V2_Product_Scope_and_Implementation_Baseline_V1.0.md",
    "docs/contracts/core-bound-query-execution-contract-v0.1.md",
    "docs/contracts/GEO_OS_Core_Domain_Lifecycle_and_Authorization_Contract_V1.0.md",
    "docs/contracts/GEO_OS_Engineering_Boundaries_Interaction_and_Release_Contract_V1.0.md",
  ];

  for (const relativePath of checkedFiles) {
    const text = readRepositoryText(relativePath);
    for (const phrase of stalePhrases) {
      if (text.includes(phrase)) {
        fail(`Stale phrase remains in ${relativePath}: ${phrase}`);
      }
    }
  }
}

function validateStatusSemantics() {
  const trackedFiles = listTrackedFiles();
  const index = readRepositoryText("docs/document-index.yaml");
  const status = readRepositoryText("docs/product-implementation-status.yaml");

  if (status.includes("product_accepted: PARTIAL")) {
    fail("PRODUCT_ACCEPTED cannot be PARTIAL without an explicit scoped acceptance record");
  }
  if (!status.includes("slice_2.a1_detector_contract")) {
    fail("A1 detector contract capability is missing");
  }
  if (!status.match(/slice_2\.production_a1_detector[\s\S]+?repository_state: NOT_PRESENT/)) {
    fail("Production A1 detector must remain NOT_PRESENT until implemented");
  }

  const activeEntryPattern =
    /- id:\s+([^\n]+)\n\s+path:\s+([^\n]+)\n\s+status:\s+(ACTIVE|ACTIVE_WITH_ADDENDUM|ACTIVE_WORKING_BASELINE|EVIDENCE_PASSED)\b/g;
  for (const match of index.matchAll(activeEntryPattern)) {
    const indexedPath = unquoteYamlScalar(match[2]);
    if (indexedPath.startsWith("docs/") && !trackedFiles.has(indexedPath)) {
      fail(`Active document is not tracked by Git: ${match[1]} (${indexedPath})`);
    }
  }
}

validateRequiredDocuments();
const indexedPathCount = validateIndexedPaths();
validateFrozenMigrations();
const externalSourceCount = validateDecisionRegistrySources();
validateNoStalePhrases();
validateStatusSemantics();

console.log(`Document baseline validation passed.`);
console.log(`Indexed path references checked: ${indexedPathCount}`);
console.log(`Frozen migration hashes checked: ${frozenMigrations.size}`);
console.log(`Decision source declarations checked: ${frozenDecisionSources.size}`);
console.log(`External decision source bytes checked: ${externalSourceCount}`);
if (externalSourceCount < frozenDecisionSources.size) {
  console.log(
    "External source bytes unavailable; run pnpm docs:validate:sources where the frozen DOCX sources are mounted.",
  );
}
