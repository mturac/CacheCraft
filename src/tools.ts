import { canonicalJson, canonicalizeJson } from "./canonical-json.js";
import { compareCodeUnits } from "./compare.js";
import type { ToolDefinition } from "./types.js";

export function sortTools(tools: ToolDefinition[]): ToolDefinition[] {
  return tools
    .map((tool): ToolDefinition => ({
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      inputSchema: canonicalizeJson(tool.inputSchema)
    }))
    .sort((left, right) => {
      const name = compareCodeUnits(left.name, right.name);
      if (name !== 0) {
        return name;
      }
      return compareCodeUnits(canonicalJson(left), canonicalJson(right));
    });
}
