import { renderAnthropic } from "./providers/anthropic.js";
import { renderGeneric } from "./providers/generic.js";
import { renderOpenAIChat } from "./providers/openai-chat.js";
import { renderOpenAIResponses } from "./providers/openai-responses.js";
import type { JsonObject, ProviderTarget } from "./types.js";
import type { RenderContext } from "./providers/shared.js";

export function renderProviderPayload(provider: ProviderTarget, context: RenderContext): JsonObject {
  switch (provider) {
    case "generic":
      return renderGeneric(context);
    case "openai-responses":
      return renderOpenAIResponses(context);
    case "openai-chat":
      return renderOpenAIChat(context);
    case "anthropic":
      return renderAnthropic(context);
  }
}
