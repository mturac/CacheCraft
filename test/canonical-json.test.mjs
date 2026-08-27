import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJson } from "../dist/canonical-json.js";
import { sha256Hex } from "../dist/hash.js";

test("canonicalJson sorts object keys recursively and preserves array order", () => {
  const value = {
    z: 1,
    a: {
      y: true,
      x: [
        { b: 2, a: 1 },
        "second"
      ]
    }
  };

  assert.equal(
    canonicalJson(value),
    '{"a":{"x":[{"a":1,"b":2},"second"],"y":true},"z":1}'
  );
});

test("canonicalJson rejects values that JSON cannot represent deterministically", () => {
  assert.throws(
    () => canonicalJson({ bad: Number.NaN }),
    (error) => error?.code === "CC_INVALID_CANONICAL_VALUE"
  );
});

test("sha256Hex is stable for semantically identical objects", () => {
  assert.equal(
    sha256Hex({ a: 1, b: { c: 2 } }),
    sha256Hex({ b: { c: 2 }, a: 1 })
  );
});

test("canonicalJson uses locale-independent UTF-16 code-unit key ordering", () => {
  assert.equal(canonicalJson({ "ä": 1, z: 2 }), '{"z":2,"ä":1}');
});

test("canonicalJson rejects circular object graphs with a typed error", () => {
  const value = {};
  value.self = value;

  assert.throws(
    () => canonicalJson(value),
    (error) => error?.code === "CC_INVALID_CANONICAL_VALUE"
  );
});

test("canonicalJson rejects sparse arrays instead of emitting invalid JSON", () => {
  const sparse = [];
  sparse.length = 2;
  sparse[1] = "value";

  assert.throws(
    () => canonicalJson(sparse),
    (error) => error?.code === "CC_INVALID_CANONICAL_VALUE"
  );
});
