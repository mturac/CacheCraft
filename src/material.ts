import type { PromptSection, ToolDefinition } from "./types.js";

export function logicalToolsMaterial(tools: ToolDefinition[]): unknown[] {
  return tools.map((tool) => ({
    name: tool.name,
    ...(tool.description === undefined ? {} : { description: tool.description }),
    inputSchema: tool.inputSchema
  }));
}

export function logicalMessagesMaterial(sections: PromptSection[]): unknown[] {
  return sections.flatMap((section) => section.items.map((item) => ({
    role: item.role,
    content: item.content
  })));
}

export function logicalPromptMaterial(tools: ToolDefinition[], sections: PromptSection[]): unknown {
  return {
    tools: logicalToolsMaterial(tools),
    messages: logicalMessagesMaterial(sections)
  };
}

export function logicalPromptMaterialThroughItem(
  tools: ToolDefinition[],
  sections: PromptSection[],
  sectionIndex: number,
  itemIndex: number
): unknown {
  const includedSections = sections.slice(0, sectionIndex).map((section) => section);
  const target = sections[sectionIndex];
  if (target !== undefined) {
    includedSections.push({
      ...target,
      items: target.items.slice(0, itemIndex + 1)
    });
  }
  return logicalPromptMaterial(tools, includedSections);
}
