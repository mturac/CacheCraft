import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cli = fileURLToPath(new URL("../bin/cachecraft.mjs", import.meta.url));
const example = new URL("../examples/agent-plan.json", import.meta.url);

function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    ...options
  });
}

test("CLI compiles an example and writes payload and manifest files", () => {
  const dir = mkdtempSync(join(tmpdir(), "cachecraft-"));
  const payloadPath = join(dir, "payload.json");
  const manifestPath = join(dir, "manifest.json");

  const result = run([
    "compile",
    example.pathname,
    "--provider",
    "openai-responses",
    "--out",
    payloadPath,
    "--manifest-out",
    manifestPath
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(readFileSync(payloadPath, "utf8")).prompt_cache_options.mode, "explicit");
  assert.equal(JSON.parse(readFileSync(manifestPath, "utf8")).schemaVersion, "1");
});

test("CLI accepts a plan from stdin", () => {
  const input = readFileSync(example, "utf8");
  const result = run(["compile", "-", "--provider", "generic"], { input });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).manifest.provider, "generic");
});

test("CLI diff exits with code 2 when fail-on-change is enabled", () => {
  const dir = mkdtempSync(join(tmpdir(), "cachecraft-diff-"));
  const beforePlan = JSON.parse(readFileSync(example, "utf8"));
  const afterPlan = structuredClone(beforePlan);
  afterPlan.version = "2";
  afterPlan.sections[0].items[0].content += " changed";

  const beforePlanPath = join(dir, "before-plan.json");
  const afterPlanPath = join(dir, "after-plan.json");
  const beforeManifestPath = join(dir, "before-manifest.json");
  const afterManifestPath = join(dir, "after-manifest.json");
  writeFileSync(beforePlanPath, JSON.stringify(beforePlan));
  writeFileSync(afterPlanPath, JSON.stringify(afterPlan));

  assert.equal(run(["compile", beforePlanPath, "--provider", "generic", "--manifest-out", beforeManifestPath, "--out", join(dir, "before.json")]).status, 0);
  assert.equal(run(["compile", afterPlanPath, "--provider", "generic", "--manifest-out", afterManifestPath, "--out", join(dir, "after.json")]).status, 0);

  const diff = run(["diff", beforeManifestPath, afterManifestPath, "--fail-on-change"]);
  assert.equal(diff.status, 2);
  assert.match(diff.stdout, /contract changed/i);
});

test("CLI exposes version and stable typed errors", () => {
  const version = run(["--version"]);
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), "0.1.0");

  const bad = run(["compile", example.pathname, "--provider", "unknown"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /CC_PROVIDER_REQUIRED/);
  assert.equal(bad.stdout, "");
});

test("CLI keeps JSON on stdout and reports diagnostics on stderr", () => {
  const result = run(["compile", example.pathname, "--provider", "generic"]);

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotThrow(() => JSON.parse(result.stdout));
  assert.match(result.stderr, /CC104_PREFIX_TOKEN_COUNT_ESTIMATED/);
});

test("CLI accepts a runtime cache-key override", () => {
  const result = run([
    "compile",
    example.pathname,
    "--provider",
    "generic",
    "--cache-key",
    "session:cli-test"
  ]);

  assert.equal(result.status, 0, result.stderr);
  const compiled = JSON.parse(result.stdout);
  assert.equal(compiled.manifest.cacheKey, "session:cli-test");
  assert.equal(compiled.manifest.cacheKeySource, "compile-option");
});

test("CLI returns a typed error for invalid JSON", () => {
  const result = run(["compile", "-", "--provider", "generic"], { input: "{not-json" });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /CC_INVALID_JSON/);
});

test("CLI rejects duplicate options instead of silently choosing the last value", () => {
  const result = run([
    "compile",
    example.pathname,
    "--provider",
    "generic",
    "--provider",
    "anthropic"
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /CC_DUPLICATE_CLI_OPTION/);
});

test("CLI rejects identical payload and manifest output paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "cachecraft-conflict-"));
  const outputPath = join(dir, "output.json");
  const result = run([
    "compile",
    example.pathname,
    "--provider",
    "generic",
    "--out",
    outputPath,
    "--manifest-out",
    outputPath
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /CC_OUTPUT_PATH_CONFLICT/);
});
