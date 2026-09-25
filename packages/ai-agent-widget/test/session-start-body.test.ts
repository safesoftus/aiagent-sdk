import test from "node:test";
import assert from "node:assert/strict";
import { sessionStartBody } from "../src/api";

test("sessionStartBody sends only the keys the embed set", () => {
  assert.deepEqual(sessionStartBody(null, null), {});
  assert.deepEqual(sessionStartBody("es", null), { language: "es" });
  assert.deepEqual(sessionStartBody(null, {}), {});
  assert.deepEqual(sessionStartBody("es", { first_message: "Hola", voice_id: "v1" }), {
    language: "es",
    overrides: { first_message: "Hola", voice_id: "v1" },
  });
});
