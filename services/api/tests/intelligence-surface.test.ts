import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the intelligence service exposes health and no financial route", () => {
  const source = readFileSync(new URL("../../intelligence/app/main.py", import.meta.url), "utf8");
  const routes = [...source.matchAll(/@app\.(get|post|put|patch|delete)\("([^"]+)"\)/g)].map((match) => match[2]);
  assert.deepEqual(routes, ["/health"]);
  assert.match(source, /docs_url=None/);
  assert.match(source, /openapi_url=None/);
  assert.equal(source.includes("user_id"), false);
});
