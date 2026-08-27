import { createHash } from "node:crypto";

import { canonicalJson } from "./canonical-json.js";

export function sha256Hex(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
