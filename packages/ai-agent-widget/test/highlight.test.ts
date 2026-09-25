import test from "node:test";
import assert from "node:assert/strict";
import { highlightCode } from "../src/highlight";

const joined = (tokens: ReturnType<typeof highlightCode>) =>
  tokens.map((t) => t.text).join("");

test("tokens reassemble to the exact input (lossless)", () => {
  const code = 'const x = "hi"; // note\nlet n = 42;';
  assert.equal(joined(highlightCode(code, "ts")), code);
});

test("keywords, strings, comments, numbers classified for ts", () => {
  const tokens = highlightCode('const s = "a"; // c\n1.5', "ts");
  const byCls = (cls: string) =>
    tokens.filter((t) => t.cls === cls).map((t) => t.text);
  assert.ok(byCls("kw").some((t) => t.includes("const")));
  assert.deepEqual(byCls("str"), ['"a"']);
  assert.ok(byCls("com")[0]?.startsWith("//"));
  assert.deepEqual(byCls("num"), ["1.5"]);
});

test("sql keywords are case-insensitive, -- comments", () => {
  const tokens = highlightCode("SELECT a FROM t -- x", "sql");
  const kws = tokens.filter((t) => t.cls === "kw").map((t) => t.text);
  assert.ok(kws.includes("SELECT"));
  assert.ok(kws.includes("FROM"));
  assert.ok(tokens.some((t) => t.cls === "com" && t.text.startsWith("--")));
});

test("python # comments; // is not a comment there", () => {
  const py = highlightCode("# note\nx = 1", "python");
  assert.ok(py.some((t) => t.cls === "com" && t.text.startsWith("#")));
  const ts = highlightCode("# not a comment", "ts");
  assert.ok(!ts.some((t) => t.cls === "com"));
});

test("unknown language degrades to plain but still lossless", () => {
  const code = "whatever ⟨unicode⟩ text";
  const tokens = highlightCode(code, "brainfuck");
  assert.equal(joined(tokens), code);
  assert.ok(tokens.every((t) => t.cls !== "kw"));
});
