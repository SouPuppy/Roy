import test from "node:test";
import assert from "node:assert/strict";
import { expandQuery } from "@/rag/query";

test("expandQuery adds semantic aliases", () => {
  const expanded = expandQuery("db tuning");
  assert.ok(expanded.includes("db tuning"));
  assert.ok(expanded.some((q) => q.includes("database")));
});
