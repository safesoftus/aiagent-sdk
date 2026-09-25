// Markdown render tree → DOM (shadow-root safe, no innerHTML for content).
//
// Code blocks get a toolbar (copy / download / wrap) using the configured
// text strings; links open in a new tab and are gated by the LinkPolicy at
// parse time (disallowed links arrive as `allowed: false` and render as
// plain text).

import { highlightCode } from "./highlight";
import type { MdBlock, MdInline } from "./markdown";
import { ICONS } from "./icons";

export interface MdRenderOptions {
  syntaxTheme: "auto" | "light" | "dark";
  text: {
    copy: string;
    copied: string;
    download: string;
    wrap: string;
  };
}

export function renderMarkdown(
  blocks: MdBlock[],
  opts: MdRenderOptions,
): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const block of blocks) {
    switch (block.kind) {
      case "paragraph": {
        const p = document.createElement("p");
        p.append(renderInline(block.children));
        frag.append(p);
        break;
      }
      case "heading": {
        const h = document.createElement(`h${Math.min(block.level, 4)}`);
        h.append(renderInline(block.children));
        frag.append(h);
        break;
      }
      case "list": {
        const list = document.createElement(block.ordered ? "ol" : "ul");
        for (const item of block.items) {
          const li = document.createElement("li");
          li.append(renderInline(item));
          list.append(li);
        }
        frag.append(list);
        break;
      }
      case "code_block":
        frag.append(renderCodeBlock(block.lang, block.text, opts));
        break;
    }
  }
  return frag;
}

function renderInline(nodes: MdInline[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
        frag.append(document.createTextNode(node.text));
        break;
      case "strong": {
        const el = document.createElement("strong");
        el.append(renderInline(node.children));
        frag.append(el);
        break;
      }
      case "em": {
        const el = document.createElement("em");
        el.append(renderInline(node.children));
        frag.append(el);
        break;
      }
      case "del": {
        const el = document.createElement("del");
        el.append(renderInline(node.children));
        frag.append(el);
        break;
      }
      case "code": {
        const el = document.createElement("code");
        el.textContent = node.text;
        frag.append(el);
        break;
      }
      case "link": {
        if (node.allowed) {
          const a = document.createElement("a");
          a.href = node.href;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.append(renderInline(node.children));
          frag.append(a);
        } else {
          // Disallowed link: label only, as plain text.
          frag.append(renderInline(node.children));
        }
        break;
      }
    }
  }
  return frag;
}

function renderCodeBlock(
  lang: string,
  code: string,
  opts: MdRenderOptions,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "vw-codeblock";
  wrap.dataset.theme = opts.syntaxTheme;

  const bar = document.createElement("div");
  bar.className = "vw-codeblock-bar";
  const label = document.createElement("span");
  label.textContent = lang || "text";
  bar.append(label);

  const actions = document.createElement("div");
  actions.className = "vw-codeblock-actions";
  actions.append(
    toolButton(ICONS.copy, opts.text.copy, (btn) => {
      const p = navigator.clipboard?.writeText(code);
      if (!p) return;
      void p
        .then(() => {
          btn.title = opts.text.copied;
          btn.innerHTML = ICONS.check;
          setTimeout(() => {
            btn.title = opts.text.copy;
            btn.innerHTML = ICONS.copy;
          }, 1500);
        })
        .catch(() => {
          // Clipboard write failed (permissions / insecure context).
        });
    }),
    toolButton(ICONS.download, opts.text.download, () => {
      const blob = new Blob([code], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `snippet.${lang || "txt"}`;
      a.click();
      URL.revokeObjectURL(url);
    }),
    toolButton(ICONS.wrap, opts.text.wrap, () => {
      if (wrap.hasAttribute("data-wrap")) wrap.removeAttribute("data-wrap");
      else wrap.setAttribute("data-wrap", "");
    }),
  );
  bar.append(actions);
  wrap.append(bar);

  const pre = document.createElement("pre");
  const codeEl = document.createElement("code");
  for (const token of highlightCode(code, lang)) {
    if (token.cls === "pln") {
      codeEl.append(document.createTextNode(token.text));
    } else {
      const span = document.createElement("span");
      span.className = `hl-${token.cls}`;
      span.textContent = token.text;
      codeEl.append(span);
    }
  }
  pre.append(codeEl);
  wrap.append(pre);
  return wrap;
}

function toolButton(
  icon: string,
  title: string,
  onClick: (btn: HTMLButtonElement) => void,
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "vw-iconbtn";
  btn.style.width = "22px";
  btn.style.height = "22px";
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.innerHTML = icon; // static, trusted icon markup only
  btn.addEventListener("click", () => onClick(btn));
  return btn;
}
