import { canonicalJson } from "./canonical-json.js";
import type { PromptSection, ToolDefinition } from "./types.js";

export function estimateTextTokens(text: string): number {
  return text.length === 0 ? 0 : Math.max(1, Math.ceil(text.length / 4));
}

export function estimateToolsTokens(tools: ToolDefinition[]): number {
  return tools.length === 0 ? 0 : estimateTextTokens(canonicalJson(tools));
}

export function estimateSectionsTokens(sections: PromptSection[]): number {
  return sections.reduce(
    (total, section) => total + section.items.reduce(
      (sectionTotal, item) => sectionTotal + estimateTextTokens(item.content),
      0
    ),
    0
  );
}

export function estimateSectionsTokensThroughItem(
  sections: PromptSection[],
  sectionIndex: number,
  itemIndex: number
): number {
  const completed = estimateSectionsTokens(sections.slice(0, sectionIndex));
  const target = sections[sectionIndex];
  if (target === undefined) {
    return completed;
  }
  return completed + target.items
    .slice(0, itemIndex + 1)
    .reduce((total, item) => total + estimateTextTokens(item.content), 0);
}
