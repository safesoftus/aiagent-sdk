// `source_info` (the vendor's `setSourceInfo`): which SDK is talking. The
// wrappers (React, React Native, widget) set their own source; the value
// rides the token request (`source`, `version`) and `client-ready.about`.
import { LIBRARY_VERSION } from "../version";

export interface SourceInfo {
  source: string;
  version: string;
}

let current: SourceInfo = { source: "js_sdk", version: LIBRARY_VERSION };

export function setSourceInfo(next: Partial<SourceInfo>): void {
  current = { ...current, ...next };
}

export function sourceInfo(): SourceInfo {
  return current;
}
