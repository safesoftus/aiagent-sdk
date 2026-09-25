// The package version, injected at build time (build.mjs `define`) so the
// bundle never embeds package.json. `client-ready.about.library_version`.
declare const __AI_AGENT_VERSION__: string | undefined;

export const LIBRARY_NAME = "@convoso/ai-agent";
export const LIBRARY_VERSION: string =
  typeof __AI_AGENT_VERSION__ === "string" ? __AI_AGENT_VERSION__ : "0.0.0";
