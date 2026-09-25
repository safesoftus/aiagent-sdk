// Minimal generic syntax highlighter for widget code blocks.
//
// One tokenizer, per-language keyword sets. Output is a flat token list the
// DOM layer renders as <span class="hl-...">; themes (auto/light/dark) are
// pure CSS in the shadow root. Not a real lexer — good enough for chat
// snippets, zero dependencies.

export type HlClass = "kw" | "str" | "com" | "num" | "pln";

export interface HlToken {
  cls: HlClass;
  text: string;
}

const KEYWORDS: Record<string, string[]> = {
  javascript: jsKeywords(),
  typescript: [...jsKeywords(), "type", "interface", "enum", "namespace", "declare", "readonly", "keyof", "infer", "is", "asserts", "satisfies"],
  js: jsKeywords(),
  ts: [...jsKeywords(), "type", "interface", "enum", "readonly"],
  jsx: jsKeywords(),
  tsx: [...jsKeywords(), "type", "interface", "enum", "readonly"],
  python: ["def", "return", "if", "elif", "else", "for", "while", "in", "not", "and", "or", "import", "from", "as", "class", "try", "except", "finally", "with", "lambda", "pass", "break", "continue", "raise", "yield", "global", "nonlocal", "assert", "del", "True", "False", "None", "async", "await", "match", "case"],
  py: ["def", "return", "if", "elif", "else", "for", "while", "in", "not", "and", "or", "import", "from", "as", "class", "try", "except", "finally", "with", "lambda", "True", "False", "None", "async", "await"],
  rust: ["fn", "let", "mut", "const", "static", "if", "else", "match", "loop", "while", "for", "in", "return", "break", "continue", "struct", "enum", "trait", "impl", "pub", "use", "mod", "crate", "self", "Self", "super", "where", "async", "await", "move", "ref", "type", "unsafe", "dyn", "as", "true", "false"],
  go: ["func", "return", "if", "else", "for", "range", "switch", "case", "default", "break", "continue", "type", "struct", "interface", "map", "chan", "go", "defer", "select", "package", "import", "var", "const", "nil", "true", "false"],
  java: ["public", "private", "protected", "class", "interface", "extends", "implements", "return", "if", "else", "for", "while", "switch", "case", "new", "static", "final", "void", "int", "long", "double", "boolean", "String", "true", "false", "null", "import", "package", "try", "catch", "finally", "throw", "throws"],
  sql: ["select", "from", "where", "insert", "into", "values", "update", "set", "delete", "create", "table", "alter", "drop", "join", "left", "right", "inner", "outer", "on", "group", "by", "order", "having", "limit", "offset", "and", "or", "not", "null", "as", "distinct", "union", "all", "exists", "in", "like", "between", "primary", "key", "foreign", "references", "index"],
  bash: ["if", "then", "else", "elif", "fi", "for", "while", "do", "done", "case", "esac", "function", "return", "local", "export", "echo", "exit", "in"],
  sh: ["if", "then", "else", "elif", "fi", "for", "while", "do", "done", "case", "esac", "function", "return", "local", "export", "echo", "exit", "in"],
  json: ["true", "false", "null"],
  css: [],
  html: [],
};

function jsKeywords(): string[] {
  return ["const", "let", "var", "function", "return", "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "new", "delete", "typeof", "instanceof", "in", "of", "class", "extends", "super", "this", "import", "export", "from", "as", "async", "await", "yield", "try", "catch", "finally", "throw", "true", "false", "null", "undefined", "void", "static", "get", "set"];
}

const TOKEN_RE =
  /(\/\/[^\n]*|#[^\n]*|--[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][A-Za-z0-9_$]*)|(\s+|[^\sA-Za-z0-9_$]+)/g;

/** Tokenize `code` for language `lang` (lowercase; unknown ⇒ plain). */
export function highlightCode(code: string, lang: string): HlToken[] {
  const kw = new Set(KEYWORDS[lang] ?? []);
  const caseInsensitive = lang === "sql";
  const tokens: HlToken[] = [];
  const push = (cls: HlClass, text: string) => {
    const last = tokens[tokens.length - 1];
    if (last && last.cls === cls) last.text += text;
    else tokens.push({ cls, text });
  };

  // Comment syntax varies; only treat a marker as a comment when the language
  // plausibly uses it (# for python/bash, -- for sql, // and /* */ elsewhere).
  const hashComment = lang === "python" || lang === "py" || lang === "bash" || lang === "sh";
  const dashComment = lang === "sql";
  const slashComment = !hashComment && !dashComment && lang !== "css" && lang !== "html";

  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(code)) !== null) {
    const [full, com, str, num, word, other] = m;
    if (com !== undefined) {
      const isComment =
        (com.startsWith("#") && hashComment) ||
        (com.startsWith("--") && dashComment) ||
        ((com.startsWith("//") || com.startsWith("/*")) && slashComment);
      push(isComment ? "com" : "pln", com);
    } else if (str !== undefined) {
      push("str", str);
    } else if (num !== undefined) {
      push("num", num);
    } else if (word !== undefined) {
      const probe = caseInsensitive ? word.toLowerCase() : word;
      push(kw.has(probe) ? "kw" : "pln", word);
    } else if (other !== undefined) {
      push("pln", other);
    } else {
      push("pln", full);
    }
  }
  return tokens;
}
