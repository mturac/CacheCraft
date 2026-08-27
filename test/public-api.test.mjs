import assert from "node:assert/strict";
import test from "node:test";

import * as cachecraft from "../dist/index.js";

const expectedRuntimeExports = [
  "CacheCraftError",
  "VERSION",
  "compilePromptPlan",
  "diffManifests",
  "explainCompilation",
  "explainManifestDiff",
  "validateManifest",
  "validatePromptPlan"
];

test("public runtime API exposes only supported high-level entry points", () => {
  assert.deepEqual(Object.keys(cachecraft).sort(), expectedRuntimeExports);
});
