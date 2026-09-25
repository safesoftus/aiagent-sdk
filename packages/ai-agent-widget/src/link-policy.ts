// Markdown link policy — mirrors the backend-validated widget config rules.
//
// Contract (backend-authoritative, enforced again here at render time):
//   * `javascript:` (and every non-http(s) scheme) is ALWAYS blocked.
//   * `http:` is allowed only when `allow_http` is on (default https-only).
//   * `allow_all` permits any host (scheme rules still apply).
//   * Otherwise the URL's hostname must match an allowlist entry. Entries are
//     hostnames with an optional `:port`. An entry without a port matches any
//     port; an entry with a port requires that exact port.
//   * `include_www_variants` makes `example.com` ⇄ `www.example.com`
//     interchangeable in both directions.

export interface LinkPolicy {
  allow_all: boolean;
  allowed_hosts: string[];
  include_www_variants: boolean;
  allow_http: boolean;
}

export const DEFAULT_LINK_POLICY: LinkPolicy = {
  allow_all: false,
  allowed_hosts: [],
  include_www_variants: true,
  allow_http: false,
};

function splitHostPort(entry: string): { host: string; port: string | null } {
  const idx = entry.lastIndexOf(":");
  // A lone colon or IPv6-style entries are not supported by the backend
  // hostname rule, so a simple split is sufficient here.
  if (idx > 0 && /^\d+$/.test(entry.slice(idx + 1))) {
    return { host: entry.slice(0, idx).toLowerCase(), port: entry.slice(idx + 1) };
  }
  return { host: entry.toLowerCase(), port: null };
}

function hostMatches(
  urlHost: string,
  entryHost: string,
  includeWww: boolean,
): boolean {
  if (urlHost === entryHost) return true;
  if (!includeWww) return false;
  const strip = (h: string) => (h.startsWith("www.") ? h.slice(4) : h);
  return strip(urlHost) === strip(entryHost);
}

/**
 * Decide whether a markdown link may render as a clickable anchor.
 * Disallowed links are rendered as plain text by the markdown renderer.
 */
export function isLinkAllowed(href: string, policy: LinkPolicy): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false; // relative/malformed URLs never render as links
  }
  const scheme = url.protocol;
  if (scheme === "javascript:") return false; // explicit, belt and braces
  if (scheme !== "https:" && scheme !== "http:") return false;
  if (scheme === "http:" && !policy.allow_http) return false;
  if (policy.allow_all) return true;

  const urlHost = url.hostname.toLowerCase();
  const urlPort = url.port; // "" when default for the scheme
  for (const raw of policy.allowed_hosts) {
    const entry = raw.trim();
    if (!entry) continue;
    const { host, port } = splitHostPort(entry);
    if (!hostMatches(urlHost, host, policy.include_www_variants)) continue;
    if (port === null) return true;
    const effectivePort = urlPort || (scheme === "https:" ? "443" : "80");
    if (effectivePort === port) return true;
  }
  return false;
}
