import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workspace = mkdtempSync(join(tmpdir(), "cachecraft-package-"));
let tarball;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: process.env
  });
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(" ")} failed with exit code ${result.status}.`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join("\n"));
  }
  return result;
}

try {
  const packed = run("npm", ["pack", "--json", "--ignore-scripts"]);
  const records = JSON.parse(packed.stdout);
  if (!Array.isArray(records) || records.length !== 1) {
    throw new Error("npm pack returned an unexpected result.");
  }

  const record = records[0];
  if (typeof record?.filename !== "string" || !Array.isArray(record.files)) {
    throw new Error("npm pack did not return filename and file metadata.");
  }
  tarball = join(root, record.filename);

  const allowedFiles = new Set([
    "CHANGELOG.md",
    "LICENSE",
    "NOTICE",
    "README.md",
    "package.json"
  ]);
  const allowedPrefixes = ["bin/", "dist/", "examples/", "schema/"];
  const unexpected = record.files
    .map((entry) => entry.path)
    .filter((path) => !allowedFiles.has(path) && !allowedPrefixes.some((prefix) => path.startsWith(prefix)));
  if (unexpected.length > 0) {
    throw new Error(`Unexpected files in package: ${unexpected.join(", ")}`);
  }

  writeFileSync(join(workspace, "package.json"), '{"name":"cachecraft-smoke","private":true,"type":"module"}\n');
  run("npm", [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-package-lock",
    tarball
  ], { cwd: workspace });

  const smokeFile = join(workspace, "smoke.mjs");
  writeFileSync(smokeFile, `
import { VERSION, compilePromptPlan } from "@mturac/cachecraft";

const result = compilePromptPlan({
  schemaVersion: "1",
  id: "package-smoke",
  version: "1",
  sections: [
    {
      id: "policy",
      lane: "instructions",
      stability: "global",
      items: [{ role: "developer", content: "Stable policy" }]
    },
    {
      id: "request",
      lane: "conversation",
      stability: "request",
      items: [{ role: "user", content: "Hello" }]
    }
  ]
}, { provider: "generic" });

if (VERSION !== "0.1.0" || result.manifest.compiler.version !== VERSION) {
  throw new Error("Installed package version contract is inconsistent.");
}
if (result.payload.cache_key !== result.manifest.cacheKey) {
  throw new Error("Installed package compile contract is inconsistent.");
}
`);
  run(process.execPath, [smokeFile], { cwd: workspace });

  const installedCli = join(workspace, "node_modules", "@mturac", "cachecraft", "bin", "cachecraft.mjs");
  const versionResult = run(process.execPath, [installedCli, "--version"], { cwd: workspace });
  if (versionResult.stdout.trim() !== "0.1.0") {
    throw new Error(`Installed CLI reported ${JSON.stringify(versionResult.stdout.trim())}.`);
  }

  const installedPackage = JSON.parse(readFileSync(
    join(workspace, "node_modules", "@mturac", "cachecraft", "package.json"),
    "utf8"
  ));
  if (installedPackage.name !== "@mturac/cachecraft") {
    throw new Error(`Installed unexpected package ${basename(installedPackage.name ?? "unknown")}.`);
  }

  process.stdout.write(`Package smoke test passed (${record.files.length} files, ${record.size} bytes).\n`);
} finally {
  if (tarball !== undefined) {
    rmSync(tarball, { force: true });
  }
  rmSync(workspace, { recursive: true, force: true });
}
