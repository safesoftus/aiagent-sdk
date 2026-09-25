// Shadow-root stylesheet. Every visual knob flows through the --vw-*
// custom properties set from the config (see config.ts buildCssVars).

export const WIDGET_CSS = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }
button { font: inherit; background: none; border: none; cursor: pointer; color: inherit; }
input, textarea { font: inherit; color: inherit; }

.vw-root {
  position: fixed;
  z-index: 2147483000;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.45;
  color: var(--vw-base-primary);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
}
/* Preview mode (dashboard settings page): fill the preview container and
   size the sheet to IT, not the viewport — otherwise the sheet clips.
   The [data-placement] compound outranks the corner-placement rules below
   regardless of source order. */
.vw-root[data-preview],
.vw-root[data-preview][data-placement] {
  position: absolute;
  inset: 0;
  padding: var(--vw-overlay-padding);
  flex-direction: column;
  align-items: flex-end;
  justify-content: flex-end;
  transform: none;
}
.vw-root[data-preview] .vw-sheet,
.vw-root[data-preview] .vw-sheet[data-large] {
  max-height: 100%;
  max-width: 100%;
  min-height: 0;
}
.vw-root[data-placement="bottom-right"] { right: var(--vw-overlay-padding); bottom: var(--vw-overlay-padding); }
.vw-root[data-placement="bottom-left"]  { left: var(--vw-overlay-padding); bottom: var(--vw-overlay-padding); align-items: flex-start; }
.vw-root[data-placement="bottom"]       { left: 50%; transform: translateX(-50%); bottom: var(--vw-overlay-padding); align-items: center; }
.vw-root[data-placement="top-right"]    { right: var(--vw-overlay-padding); top: var(--vw-overlay-padding); flex-direction: column-reverse; }
.vw-root[data-placement="top-left"]     { left: var(--vw-overlay-padding); top: var(--vw-overlay-padding); align-items: flex-start; flex-direction: column-reverse; }
.vw-root[data-placement="top"]          { left: 50%; transform: translateX(-50%); top: var(--vw-overlay-padding); align-items: center; flex-direction: column-reverse; }

/* ── Launcher ─────────────────────────────────────────────── */
.vw-launcher {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  background: var(--vw-accent);
  color: var(--vw-accent-primary);
  border-radius: var(--vw-button-radius);
  padding: 12px 18px;
  box-shadow: 0 8px 28px rgba(0,0,0,.22);
  transition: background .15s ease, transform .1s ease;
}
.vw-launcher:hover { background: var(--vw-accent-hover); }
.vw-launcher:active { background: var(--vw-accent-active); transform: scale(.98); }
.vw-launcher .vw-avatar { width: 26px; height: 26px; }
.vw-launcher-label { font-weight: 600; white-space: nowrap; }
.vw-launcher[data-variant="tiny"] { padding: 5px; border-radius: 50%; }
.vw-launcher[data-variant="tiny"] .vw-avatar { width: 44px; height: 44px; }
.vw-launcher[data-variant="tiny"] .vw-launcher-label { display: none; }
.vw-launcher[data-variant="full"] { flex-direction: column; padding: 16px 22px; gap: 8px; }
.vw-launcher[data-variant="full"] .vw-avatar { width: 40px; height: 40px; }

/* ── Avatar ───────────────────────────────────────────────── */
.vw-avatar {
  width: 34px; height: 34px;
  border-radius: 50%;
  flex: none;
  background: radial-gradient(circle at 30% 30%, var(--vw-orb-1, #7959ff), var(--vw-orb-2, #9b7aff));
  overflow: hidden;
}
.vw-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.vw-avatar-glyph { display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; color: #fff; }
.vw-avatar-glyph svg { width: 55%; height: 55%; }
.vw-avatar canvas { width: 100% !important; height: 100% !important; }
.vw-avatar[data-speaking] { animation: vw-pulse 1.6s ease-in-out infinite; }
@keyframes vw-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(99,102,241,.45); }
  50% { box-shadow: 0 0 0 7px rgba(99,102,241,0); }
}

/* ── Sheet ────────────────────────────────────────────────── */
.vw-sheet {
  width: 360px;
  height: 540px;
  max-height: calc(100vh - 2 * var(--vw-overlay-padding));
  max-width: calc(100vw - 2 * var(--vw-overlay-padding));
  display: flex;
  flex-direction: column;
  background: var(--vw-base);
  color: var(--vw-base-primary);
  border: 1px solid var(--vw-base-border);
  border-radius: var(--vw-sheet-radius);
  box-shadow: 0 18px 50px rgba(0,0,0,.28);
  overflow: hidden;
}
.vw-sheet[data-large] { width: 460px; height: 660px; }

.vw-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--vw-base-border);
  flex: none;
}
.vw-header-meta { flex: 1; min-width: 0; }
.vw-header-name { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vw-header-status { font-size: 12px; color: var(--vw-base-subtle); display: flex; align-items: center; gap: 5px; }
.vw-status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--vw-base-subtle); flex: none; }
.vw-status-dot[data-live] { background: #22c55e; }
.vw-header-actions { display: flex; align-items: center; gap: 2px; }
.vw-iconbtn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px;
  border-radius: 8px;
  color: var(--vw-base-subtle);
}
.vw-iconbtn:hover { background: var(--vw-base-hover); color: var(--vw-base-primary); }
.vw-iconbtn:active { background: var(--vw-base-active); }
.vw-iconbtn[data-active] { color: var(--vw-base-primary); background: var(--vw-base-active); }

.vw-lang {
  font-size: 12px;
  color: var(--vw-base-subtle);
  background: var(--vw-base);
  border: 1px solid var(--vw-base-border);
  border-radius: var(--vw-dropdown-sheet-radius);
  padding: 3px 8px;
  max-width: 90px;
}

/* ── Body ─────────────────────────────────────────────────── */
.vw-body { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.vw-body[data-hidden] { display: none; }

.vw-intro {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  text-align: center;
  padding: 20px;
}
.vw-intro .vw-avatar { width: 64px; height: 64px; }
.vw-intro-title { font-weight: 600; font-size: 16px; }
.vw-cta {
  display: inline-flex; align-items: center; gap: 8px;
  background: var(--vw-accent);
  color: var(--vw-accent-primary);
  border-radius: var(--vw-button-radius);
  padding: 10px 18px;
  font-weight: 600;
}
.vw-cta:hover { background: var(--vw-accent-hover); }
.vw-cta:active { background: var(--vw-accent-active); }
.vw-cta-secondary {
  background: var(--vw-base);
  color: var(--vw-base-primary);
  border: 1px solid var(--vw-base-border);
}
.vw-cta-secondary:hover { background: var(--vw-base-hover); }

.vw-msg { max-width: 85%; }
.vw-msg-agent { align-self: flex-start; }
.vw-msg-user { align-self: flex-end; }
.vw-bubble {
  padding: 8px 12px;
  border-radius: var(--vw-bubble-radius);
  word-wrap: break-word;
  overflow-wrap: anywhere;
}
.vw-msg-agent .vw-bubble { background: var(--vw-base-hover); border: 1px solid var(--vw-base-border); }
.vw-msg-user .vw-bubble { background: var(--vw-accent); color: var(--vw-accent-primary); }
.vw-system { align-self: center; font-size: 12px; color: var(--vw-base-subtle); text-align: center; }
.vw-error { color: var(--vw-base-error); font-size: 12px; align-self: center; text-align: center; }

.vw-typing { display: inline-flex; align-items: center; gap: 6px; color: var(--vw-base-subtle); font-size: 12px; }
.vw-typing-dots { display: inline-flex; gap: 3px; }
.vw-typing-dots span { width: 5px; height: 5px; border-radius: 50%; background: var(--vw-base-subtle); animation: vw-blink 1.2s infinite; }
.vw-typing-dots span:nth-child(2) { animation-delay: .2s; }
.vw-typing-dots span:nth-child(3) { animation-delay: .4s; }
@keyframes vw-blink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }

.vw-action { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--vw-base-subtle); border: 1px solid var(--vw-base-border); border-radius: 999px; padding: 3px 10px; }
.vw-action[data-state="error"] { color: var(--vw-base-error); border-color: var(--vw-base-error); }
.vw-spin { animation: vw-rotate 1s linear infinite; }
@keyframes vw-rotate { to { transform: rotate(360deg); } }

/* Markdown */
.vw-bubble p + p, .vw-bubble ul, .vw-bubble ol, .vw-bubble h1, .vw-bubble h2, .vw-bubble h3, .vw-bubble h4 { margin-top: 6px; }
.vw-bubble h1 { font-size: 17px; } .vw-bubble h2 { font-size: 16px; } .vw-bubble h3, .vw-bubble h4 { font-size: 15px; }
.vw-bubble ul, .vw-bubble ol { padding-left: 18px; }
.vw-bubble a { color: inherit; text-decoration: underline; }
.vw-bubble code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: var(--vw-base-active); border-radius: 4px; padding: 1px 4px; }
.vw-codeblock { margin-top: 6px; border: 1px solid var(--vw-base-border); border-radius: 8px; overflow: hidden; font-size: 12px; }
.vw-codeblock-bar { display: flex; align-items: center; justify-content: space-between; padding: 3px 8px; background: var(--vw-base-hover); border-bottom: 1px solid var(--vw-base-border); color: var(--vw-base-subtle); font-size: 11px; }
.vw-codeblock-actions { display: inline-flex; gap: 2px; }
.vw-codeblock pre { padding: 8px; overflow-x: auto; background: var(--vw-base); }
.vw-codeblock[data-wrap] pre { white-space: pre-wrap; overflow-wrap: anywhere; }
.vw-codeblock pre code { background: none; padding: 0; }
/* highlight themes */
.vw-codeblock[data-theme="light"] pre { background: #f8fafc; color: #0f172a; }
.vw-codeblock[data-theme="light"] .hl-kw { color: #7c3aed; }
.vw-codeblock[data-theme="light"] .hl-str { color: #16a34a; }
.vw-codeblock[data-theme="light"] .hl-com { color: #94a3b8; font-style: italic; }
.vw-codeblock[data-theme="light"] .hl-num { color: #ea580c; }
.vw-codeblock[data-theme="dark"] pre { background: #0f172a; color: #e2e8f0; }
.vw-codeblock[data-theme="dark"] .hl-kw { color: #c4b5fd; }
.vw-codeblock[data-theme="dark"] .hl-str { color: #86efac; }
.vw-codeblock[data-theme="dark"] .hl-com { color: #64748b; font-style: italic; }
.vw-codeblock[data-theme="dark"] .hl-num { color: #fdba74; }
@media (prefers-color-scheme: light) {
  .vw-codeblock[data-theme="auto"] pre { background: #f8fafc; color: #0f172a; }
  .vw-codeblock[data-theme="auto"] .hl-kw { color: #7c3aed; }
  .vw-codeblock[data-theme="auto"] .hl-str { color: #16a34a; }
  .vw-codeblock[data-theme="auto"] .hl-com { color: #94a3b8; font-style: italic; }
  .vw-codeblock[data-theme="auto"] .hl-num { color: #ea580c; }
}
@media (prefers-color-scheme: dark) {
  .vw-codeblock[data-theme="auto"] pre { background: #0f172a; color: #e2e8f0; }
  .vw-codeblock[data-theme="auto"] .hl-kw { color: #c4b5fd; }
  .vw-codeblock[data-theme="auto"] .hl-str { color: #86efac; }
  .vw-codeblock[data-theme="auto"] .hl-com { color: #64748b; font-style: italic; }
  .vw-codeblock[data-theme="auto"] .hl-num { color: #fdba74; }
}

/* ── Footer ───────────────────────────────────────────────── */
.vw-footer { flex: none; border-top: 1px solid var(--vw-base-border); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.vw-inputrow { display: flex; align-items: center; gap: 8px; }
.vw-input {
  flex: 1;
  border: 1px solid var(--vw-base-border);
  border-radius: var(--vw-input-radius);
  background: var(--vw-base);
  padding: 8px 12px;
  outline: none;
  min-width: 0;
}
.vw-input:focus { border-color: var(--vw-accent-border); }
.vw-sendbtn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; flex: none;
  background: var(--vw-accent);
  color: var(--vw-accent-primary);
  border-radius: var(--vw-button-radius);
}
.vw-sendbtn:hover { background: var(--vw-accent-hover); }
.vw-sendbtn:disabled { opacity: .5; cursor: default; }
.vw-attachbtn {
  background: var(--vw-base);
  color: var(--vw-base-subtle);
  border: 1px solid var(--vw-base-border);
}
.vw-attachbtn:hover { background: var(--vw-base-hover); color: var(--vw-base-primary); }
.vw-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.vw-chip {
  display: inline-flex; align-items: center; gap: 4px;
  max-width: 100%;
  padding: 3px 6px 3px 10px;
  font-size: 12px;
  color: var(--vw-base-primary);
  background: var(--vw-base-hover);
  border: 1px solid var(--vw-base-border);
  border-radius: var(--vw-button-radius);
}
.vw-chip-name {
  max-width: 160px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.vw-chip-remove {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; flex: none;
  color: var(--vw-base-subtle);
  border-radius: 50%;
}
.vw-chip-remove:hover { color: var(--vw-base-primary); background: var(--vw-base-active); }
.vw-callrow { display: flex; align-items: center; justify-content: center; gap: 10px; }
.vw-callbtn {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 8px 16px;
  border-radius: var(--vw-button-radius);
  font-weight: 600;
  border: 1px solid var(--vw-base-border);
  background: var(--vw-base);
  color: var(--vw-base-primary);
}
.vw-callbtn:hover { background: var(--vw-base-hover); }
.vw-callbtn[data-danger] { background: var(--vw-base-error); border-color: var(--vw-base-error); color: #ffffff; }
.vw-callbtn[data-accent] { background: var(--vw-accent); border-color: var(--vw-accent); color: var(--vw-accent-primary); }
.vw-callbtn[data-accent]:hover { background: var(--vw-accent-hover); }
.vw-footer-note { font-size: 11px; color: var(--vw-base-subtle); text-align: center; display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap; }
.vw-footer-note button { text-decoration: underline; color: inherit; }

/* ── Overlays (terms / feedback) ──────────────────────────── */
.vw-overlay {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--vw-base) 55%, transparent);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: flex-end;
  z-index: 5;
}
.vw-overlay-card {
  width: 100%;
  max-height: 85%;
  overflow-y: auto;
  background: var(--vw-base);
  border-top: 1px solid var(--vw-base-border);
  border-radius: var(--vw-compact-sheet-radius) var(--vw-compact-sheet-radius) 0 0;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.vw-overlay-title { font-weight: 600; font-size: 15px; }
.vw-overlay-body { font-size: 13px; color: var(--vw-base-subtle); max-height: 240px; overflow-y: auto; }
.vw-overlay-actions { display: flex; gap: 8px; justify-content: flex-end; }
.vw-stars { display: flex; gap: 6px; justify-content: center; }
.vw-star { color: var(--vw-base-subtle); padding: 3px; }
.vw-star[data-on] { color: #f59e0b; }
.vw-star :is(svg) { fill: none; }
.vw-star[data-on] :is(svg) { fill: currentColor; }
.vw-textarea {
  width: 100%;
  min-height: 72px;
  border: 1px solid var(--vw-base-border);
  border-radius: var(--vw-input-radius);
  background: var(--vw-base);
  padding: 8px 12px;
  resize: vertical;
  outline: none;
}
.vw-convo-id { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 11px; color: var(--vw-base-subtle); }
.vw-convo-id code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.vw-sheet-container { position: relative; display: flex; flex-direction: column; flex: 1; min-height: 0; }
.vw-hidden { display: none !important; }
`;
