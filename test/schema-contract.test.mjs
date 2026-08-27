import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schemaUrl = new URL("../schema/cachecraft.schema.json", import.meta.url);

async function loadSectionSchema() {
  const schema = JSON.parse(await readFile(schemaUrl, "utf8"));
  return schema.properties.sections.items;
}

test("JSON Schema constrains instruction-lane item roles", async () => {
  const section = await loadSectionSchema();
  const rule = section.allOf.find((entry) => entry.if?.properties?.lane?.const === "instructions");
  assert.deepEqual(rule.then.properties.items.items.properties.role.enum, ["system", "developer"]);
});

test("JSON Schema constrains conversation-lane item roles", async () => {
  const section = await loadSectionSchema();
  const rule = section.allOf.find((entry) => entry.if?.properties?.lane?.const === "conversation");
  assert.deepEqual(rule.then.properties.items.items.properties.role.enum, ["user", "assistant"]);
});
