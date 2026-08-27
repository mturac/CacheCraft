#!/usr/bin/env node

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  CacheCraftError,
  VERSION,
  compilePromptPlan,
  diffManifests,
  explainCompilation,
  explainManifestDiff
} from "../dist/index.js";

const PROVIDERS = new Set(["generic", "openai-responses", "openai-chat", "anthropic"]);

function usage() {
  return `CacheCraft ${VERSION}

Usage:
  cachecraft compile <plan.json|-> --provider <provider> [--model <model>] [--cache-key <key>] [--out <payload.json>] [--manifest-out <manifest.json>]
  cachecraft explain <plan.json|-> --provider <provider> [--model <model>] [--cache-key <key>]
  cachecraft diff <before-manifest.json> <after-manifest.json> [--json] [--fail-on-change]
  cachecraft --version
  cachecraft --help

Providers:
  generic, openai-responses, openai-chat, anthropic
`;
}

function parseFlags(values, allowed) {
  const positionals = [];
  const flags = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }
    if (!allowed.has(value)) {
      throw new CacheCraftError("CC_UNKNOWN_CLI_OPTION", `Unknown option: ${value}.`);
    }
    if (flags.has(value)) {
      throw new CacheCraftError("CC_DUPLICATE_CLI_OPTION", `Option ${value} may be provided only once.`);
    }
    if (value === "--json" || value === "--fail-on-change") {
      flags.set(value, true);
      continue;
    }
    const next = values[index + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new CacheCraftError("CC_MISSING_CLI_OPTION_VALUE", `Option ${value} requires a value.`);
    }
    flags.set(value, next);
    index += 1;
  }
  return { positionals, flags };
}

function readText(path) {
  if (path === "-") {
    return readFileSync(0, "utf8");
  }
  return readFileSync(resolve(path), "utf8");
}

function readJson(path, kind) {
  let text;
  try {
    text = readText(path);
  } catch (error) {
    throw new CacheCraftError(
      "CC_FILE_READ_FAILED",
      `Could not read ${kind} file ${path}: ${error instanceof Error ? error.message : String(error)}.`
    );
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CacheCraftError(
      "CC_INVALID_JSON",
      `Could not parse ${kind} JSON from ${path}: ${error instanceof Error ? error.message : String(error)}.`
    );
  }
}

function atomicWrite(path, value) {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.cachecraft-${process.pid}-${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}


function writeDiagnostics(diagnostics) {
  for (const diagnostic of diagnostics) {
    const section = diagnostic.sectionId === undefined ? "" : ` (${diagnostic.sectionId})`;
    process.stderr.write(`CacheCraft ${diagnostic.code} [${diagnostic.severity}]${section}: ${diagnostic.message}\n`);
  }
}

function providerFrom(flags) {
  const provider = flags.get("--provider");
  if (typeof provider !== "string" || !PROVIDERS.has(provider)) {
    throw new CacheCraftError(
      "CC_PROVIDER_REQUIRED",
      `--provider must be one of: ${[...PROVIDERS].join(", ")}.`
    );
  }
  return provider;
}

function compileCommand(values, explainOnly) {
  const { positionals, flags } = parseFlags(
    values,
    new Set(["--provider", "--model", "--cache-key", "--out", "--manifest-out"])
  );
  if (positionals.length !== 1) {
    throw new CacheCraftError("CC_INVALID_CLI_USAGE", `${explainOnly ? "explain" : "compile"} expects one plan path.`);
  }
  if (explainOnly && (flags.has("--out") || flags.has("--manifest-out"))) {
    throw new CacheCraftError("CC_INVALID_CLI_USAGE", "explain does not accept output file options.");
  }

  const out = flags.get("--out");
  const manifestOut = flags.get("--manifest-out");
  if (typeof out === "string" && typeof manifestOut === "string"
    && resolve(out) === resolve(manifestOut)) {
    throw new CacheCraftError(
      "CC_OUTPUT_PATH_CONFLICT",
      "--out and --manifest-out must resolve to different files."
    );
  }

  const input = readJson(positionals[0], "plan");
  const provider = providerFrom(flags);
  const model = flags.get("--model");
  const cacheKey = flags.get("--cache-key");
  const result = compilePromptPlan(input, {
    provider,
    ...(typeof model === "string" ? { model } : {}),
    ...(typeof cacheKey === "string" ? { cacheKey } : {})
  });

  if (explainOnly) {
    process.stdout.write(explainCompilation(result));
    return 0;
  }

  writeDiagnostics(result.diagnostics);

  if (typeof out === "string") {
    atomicWrite(out, result.payload);
  }
  if (typeof manifestOut === "string") {
    atomicWrite(manifestOut, result.manifest);
  }
  if (typeof out !== "string" && typeof manifestOut !== "string") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
  return 0;
}

function diffCommand(values) {
  const { positionals, flags } = parseFlags(values, new Set(["--json", "--fail-on-change"]));
  if (positionals.length !== 2) {
    throw new CacheCraftError("CC_INVALID_CLI_USAGE", "diff expects before and after manifest paths.");
  }
  const before = readJson(positionals[0], "before manifest");
  const after = readJson(positionals[1], "after manifest");
  const diff = diffManifests(before, after);
  process.stdout.write(flags.has("--json")
    ? `${JSON.stringify(diff, null, 2)}\n`
    : explainManifestDiff(diff));
  return flags.has("--fail-on-change") && diff.changed ? 2 : 0;
}

function main(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(usage());
    return 0;
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const [command, ...values] = argv;
  switch (command) {
    case "compile":
      return compileCommand(values, false);
    case "explain":
      return compileCommand(values, true);
    case "diff":
      return diffCommand(values);
    default:
      throw new CacheCraftError("CC_UNKNOWN_COMMAND", `Unknown command: ${command}.`);
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (error instanceof CacheCraftError) {
    const location = error.path === undefined ? "" : ` (${error.path})`;
    process.stderr.write(`CacheCraft ${error.code}${location}: ${error.message}\n`);
  } else {
    process.stderr.write(`CacheCraft CC_INTERNAL_ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exitCode = 1;
}
