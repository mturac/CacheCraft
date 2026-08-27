import type { JsonValue } from "./types.js";
import { compareCodeUnits } from "./compare.js";
import { CacheCraftError } from "./errors.js";

function fail(path: string, reason: string): never {
  throw new CacheCraftError(
    "CC_INVALID_CANONICAL_VALUE",
    `Cannot canonicalize value at ${path}: ${reason}.`,
    { path }
  );
}

function serialize(value: unknown, path: string, ancestors: WeakSet<object>): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        return fail(path, "number must be finite");
      }
      return JSON.stringify(value);
    case "object": {
      if (ancestors.has(value)) {
        return fail(path, "circular references are not supported");
      }
      ancestors.add(value);
      try {
        if (Array.isArray(value)) {
          const entries: string[] = [];
          for (let index = 0; index < value.length; index += 1) {
            if (!Object.prototype.hasOwnProperty.call(value, index)) {
              return fail(`${path}[${index}]`, "sparse arrays are not supported");
            }
            entries.push(serialize(value[index], `${path}[${index}]`, ancestors));
          }
          return `[${entries.join(",")}]`;
        }

        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
          return fail(path, "only plain objects are supported");
        }

        const record = value as Record<string, unknown>;
        const keys = Object.keys(record).sort(compareCodeUnits);
        const entries = keys.map((key) => {
          const entry = record[key];
          if (entry === undefined) {
            return fail(`${path}.${key}`, "undefined is not supported");
          }
          return `${JSON.stringify(key)}:${serialize(entry, `${path}.${key}`, ancestors)}`;
        });
        return `{${entries.join(",")}}`;
      } finally {
        ancestors.delete(value);
      }
    }
    default:
      return fail(path, `${typeof value} is not supported`);
  }
}

export function canonicalJson(value: unknown): string {
  return serialize(value, "$", new WeakSet());
}

export function canonicalizeJson<T extends JsonValue>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}
