import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

interface SourceFile {
  readonly relativePath: string;
  readonly content: string;
}

const writeBoundaryFiles = new Set([
  "apps/api/src/workspace-repository.ts",
  "apps/api/src/observation-repository.ts",
  "apps/api/src/capture-repository.ts",
  "apps/api/src/outbox-repository.ts",
  "apps/api/src/repository-container.ts",
]);
let productionFiles: SourceFile[] = [];

beforeAll(async () => {
  productionFiles = await readProductionSources(path.resolve(process.cwd(), "apps"));
});

describe("production database write architecture", () => {
  it("allows domain DML only in explicit Repository boundary files", () => {
    const violations = productionFiles
      .filter((file) => !writeBoundaryFiles.has(file.relativePath))
      .filter((file) => /\b(?:INSERT\s+INTO|UPDATE\s+[a-z_]|DELETE\s+FROM)\b/iu.test(file.content))
      .map((file) => file.relativePath);

    expect(violations).toEqual([]);
  });

  it("allows write-capable Database imports only in Repository composition", () => {
    const violations = productionFiles
      .filter((file) => file.relativePath !== "apps/api/src/database.ts")
      .filter((file) => /from\s+["'][^"']*database(?:\.js)?["']/u.test(file.content))
      .filter((file) => {
        if (writeBoundaryFiles.has(file.relativePath)) return false;
        if (file.relativePath !== "apps/api/src/access.ts") return true;
        return !file.content.includes("import type { ReadDatabase, SqlExecutor }");
      })
      .map((file) => file.relativePath);

    expect(violations).toEqual([]);
  });

  it("prevents Routes, Services, Workers and adapters from opening write transactions", () => {
    const violations = productionFiles
      .filter((file) => file.relativePath !== "apps/api/src/database.ts")
      .filter((file) => !writeBoundaryFiles.has(file.relativePath))
      .filter((file) => /\.with(?:Tenant|Platform)Transaction\s*\(/u.test(file.content))
      .map((file) => file.relativePath);

    expect(violations).toEqual([]);
  });

  it("confines the dedicated Outbox database boundary to its config, adapter and Repository", () => {
    const allowedFiles = new Set([
      "apps/api/src/config.ts",
      "apps/api/src/outbox-database.ts",
      "apps/api/src/outbox-repository.ts",
    ]);
    const violations = productionFiles
      .filter((file) => !allowedFiles.has(file.relativePath))
      .filter((file) =>
        /(?:OUTBOX_DATABASE_URL|OutboxDatabase|app\.outbox_dispatcher_context)/u.test(file.content),
      )
      .map((file) => file.relativePath);

    expect(violations).toEqual([]);
    expect(
      productionFiles.find((file) => file.relativePath === "apps/api/src/database.ts")?.content,
    ).not.toContain("outbox_dispatcher_context");
  });

  it("prevents Query Engine and Worker modules from importing PostgreSQL or credentials", () => {
    const violations = productionFiles
      .filter((file) => /(?:query[-_]?engine|worker|adapter)/iu.test(file.relativePath))
      .filter((file) =>
        /(?:from\s+["']pg["']|from\s+["'][^"']*database(?:\.js)?["']|DATABASE_URL)/u.test(
          file.content,
        ),
      )
      .map((file) => file.relativePath);

    expect(violations).toEqual([]);
  });

  it("keeps CaptureArtifact registration behind the byte-verifying CaptureService", () => {
    const violations = productionFiles
      .filter(
        (file) =>
          file.relativePath !== "apps/api/src/capture-service.ts" &&
          file.relativePath !== "apps/api/src/capture-repository.ts" &&
          file.relativePath !== "apps/api/src/repository-container.ts",
      )
      .filter((file) => /from\s+["'][^"']*capture-repository(?:\.js)?["']/u.test(file.content))
      .map((file) => file.relativePath);

    expect(violations).toEqual([]);
  });

  it("keeps RawObservation finalization behind object-byte verification", () => {
    const violations = productionFiles
      .filter(
        (file) =>
          file.relativePath !== "apps/api/src/observation-repository.ts" &&
          file.relativePath !== "apps/api/src/observation-finalization-service.ts",
      )
      .filter((file) => /\.finalizeObservation\s*\(/u.test(file.content))
      .map((file) => file.relativePath);

    expect(violations).toEqual([]);
  });

  it("keeps vendor object-storage SDKs inside their provider adapters", () => {
    const violations = productionFiles
      .filter(
        (file) =>
          file.relativePath !== "apps/api/src/evidence-object-store.ts" &&
          file.relativePath !== "apps/api/src/cos-evidence-object-store.ts",
      )
      .filter((file) => /from\s+["'](?:minio|cos-nodejs-sdk-v5)["']/u.test(file.content))
      .map((file) => file.relativePath);

    expect(violations).toEqual([]);
  });

  it("keeps deterministic evidence deletion out of synchronous production request paths", () => {
    const violations = productionFiles
      .filter(
        (file) =>
          file.relativePath !== "apps/api/src/evidence-object-store.ts" &&
          file.relativePath !== "apps/api/src/cos-evidence-object-store.ts" &&
          file.relativePath !== "apps/api/src/capture-orphan-cleaner.ts",
      )
      .filter((file) => /\.removeVerifiedObject\s*\(/u.test(file.content))
      .map((file) => file.relativePath);

    expect(violations).toEqual([]);
  });
});

async function readProductionSources(appsRoot: string): Promise<SourceFile[]> {
  const files = await walk(appsRoot);
  return Promise.all(
    files
      .filter((file) => file.endsWith(".ts"))
      .filter((file) => normalizePath(file).includes("/src/"))
      .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".integration.ts"))
      .map(async (file) => ({
        relativePath: normalizePath(path.relative(process.cwd(), file)),
        content: await readFile(file, "utf8"),
      })),
  );
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(fullPath) : [fullPath];
    }),
  );
  return nested.flat();
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}
