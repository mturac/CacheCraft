import type { JsonObject } from "./types.js";

export class CacheCraftError extends Error {
  readonly code: string;
  readonly path?: string;
  readonly details?: JsonObject;

  constructor(code: string, message: string, options: { path?: string; details?: JsonObject } = {}) {
    super(message);
    this.name = "CacheCraftError";
    this.code = code;
    if (options.path !== undefined) {
      this.path = options.path;
    }
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}
