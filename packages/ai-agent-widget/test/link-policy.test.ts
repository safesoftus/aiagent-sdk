import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LINK_POLICY,
  isLinkAllowed,
  type LinkPolicy,
} from "../src/link-policy";

const policy = (over: Partial<LinkPolicy>): LinkPolicy => ({
  ...DEFAULT_LINK_POLICY,
  ...over,
});

test("javascript: is always blocked, even with allow_all", () => {
  assert.equal(
    isLinkAllowed("javascript:alert(1)", policy({ allow_all: true, allow_http: true })),
    false,
  );
});

test("data: and other schemes are blocked", () => {
  assert.equal(isLinkAllowed("data:text/html,x", policy({ allow_all: true })), false);
  assert.equal(isLinkAllowed("vbscript:x", policy({ allow_all: true })), false);
  assert.equal(isLinkAllowed("mailto:a@b.co", policy({ allow_all: true })), false);
});

test("http blocked by default, allowed when allow_http", () => {
  assert.equal(isLinkAllowed("http://example.com/x", policy({ allow_all: true })), false);
  assert.equal(
    isLinkAllowed("http://example.com/x", policy({ allow_all: true, allow_http: true })),
    true,
  );
});

test("allow_all admits any https host", () => {
  assert.equal(isLinkAllowed("https://anything.io/p?q=1", policy({ allow_all: true })), true);
});

test("empty allowlist blocks everything without allow_all", () => {
  assert.equal(isLinkAllowed("https://example.com", policy({})), false);
});

test("allowlist match is case-insensitive on hostname", () => {
  const p = policy({ allowed_hosts: ["Example.COM"] });
  assert.equal(isLinkAllowed("https://EXAMPLE.com/path", p), true);
  assert.equal(isLinkAllowed("https://other.com", p), false);
});

test("www variant expansion works both directions when enabled", () => {
  const p = policy({ allowed_hosts: ["example.com"], include_www_variants: true });
  assert.equal(isLinkAllowed("https://www.example.com", p), true);
  const p2 = policy({ allowed_hosts: ["www.example.com"], include_www_variants: true });
  assert.equal(isLinkAllowed("https://example.com", p2), true);
});

test("www variants rejected when disabled", () => {
  const p = policy({ allowed_hosts: ["example.com"], include_www_variants: false });
  assert.equal(isLinkAllowed("https://www.example.com", p), false);
  assert.equal(isLinkAllowed("https://example.com", p), true);
});

test("subdomains are NOT matched implicitly", () => {
  const p = policy({ allowed_hosts: ["example.com"] });
  assert.equal(isLinkAllowed("https://api.example.com", p), false);
});

test("port-qualified entry requires that exact port", () => {
  const p = policy({ allowed_hosts: ["example.com:8443"] });
  assert.equal(isLinkAllowed("https://example.com:8443/x", p), true);
  assert.equal(isLinkAllowed("https://example.com/x", p), false);
});

test("entry without port matches any port; default ports normalize", () => {
  const p = policy({ allowed_hosts: ["example.com"] });
  assert.equal(isLinkAllowed("https://example.com:9000/x", p), true);
  const p443 = policy({ allowed_hosts: ["example.com:443"] });
  assert.equal(isLinkAllowed("https://example.com/x", p443), true);
});

test("relative and malformed URLs never render as links", () => {
  assert.equal(isLinkAllowed("/relative/path", policy({ allow_all: true })), false);
  assert.equal(isLinkAllowed("not a url", policy({ allow_all: true })), false);
});
