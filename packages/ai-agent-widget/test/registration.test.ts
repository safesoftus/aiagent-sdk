import test from "node:test";
import assert from "node:assert/strict";

// E4 Q7 — the bundle registers <voso-widget> AND <convoso-widget>, the same
// element (an empty subclass: a constructor backs one tag only). Drift test:
// the alias adds nothing of its own, so both tags render identically.
// A minimal DOM stand-in is installed BEFORE the module evaluates.

const defined = new Map<string, CustomElementConstructor>();

/** Just enough of an element for the constructor and the event paths. */
class FakeElement {
  readonly attrs = new Map<string, string>();
  readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  attachShadow() {
    return {};
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  addEventListener(type: string, fn: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  dispatchEvent(event: { type: string }) {
    for (const fn of this.listeners.get(event.type) ?? []) fn(event);
    return true;
  }
}

class FakeCustomEvent {
  constructor(
    readonly type: string,
    readonly init: { bubbles?: boolean; composed?: boolean; detail?: unknown },
  ) {}
  get detail() {
    return this.init.detail;
  }
}

Object.assign(globalThis, {
  HTMLElement: FakeElement,
  CustomEvent: FakeCustomEvent,
  window: globalThis,
  customElements: {
    get: (name: string) => defined.get(name),
    define: (name: string, ctor: CustomElementConstructor) => {
      if (defined.has(name)) throw new Error(`${name} already defined`);
      defined.set(name, ctor);
    },
  },
});

test("widget registers voso-widget and the convoso-widget alias on load", async () => {
  const mod = await import("../src/index");
  assert.deepEqual([...defined.keys()], ["voso-widget", "convoso-widget"]);
  assert.equal(defined.get("voso-widget"), mod.VosoWidgetElement);
  const alias = defined.get("convoso-widget")!;
  assert.equal(Object.getPrototypeOf(alias), mod.VosoWidgetElement, "the alias extends the element");
  assert.deepEqual(Object.getOwnPropertyNames(alias.prototype), ["constructor"], "the alias adds no behaviour");
  assert.deepEqual(
    (alias as unknown as { observedAttributes: string[] }).observedAttributes,
    mod.VosoWidgetElement.observedAttributes,
  );
});

test("registerWidget(tagName) adds a custom tag once; repeats are no-ops", async () => {
  const { registerWidget, VosoWidgetElement } = await import("../src/index");
  registerWidget("acme-agent");
  registerWidget("acme-agent");
  registerWidget("voso-widget");
  assert.equal(Object.getPrototypeOf(defined.get("acme-agent")!), VosoWidgetElement);
  assert.equal(defined.size, 3);
});

test("the element observes the four display attributes (Q9) and keeps agent-id / config-json", async () => {
  const { VosoWidgetElement } = await import("../src/index");
  for (const name of [
    "agent-id",
    "config-json",
    "show-agent-status",
    "show-resize-button",
    "show-language-selector-on-trigger",
    "show-avatar-when-collapsed",
  ]) {
    assert.ok(VosoWidgetElement.observedAttributes.includes(name), name);
  }
});

test("voso-widget:call: dispatched (bubbling, composed) with the start config; listener mutations are used", async () => {
  const { VosoWidgetElement } = await import("../src/index");
  const el = new VosoWidgetElement() as unknown as FakeElement & {
    clientTools: Record<string, unknown>;
    dispatchCall: (textOnly: boolean) => {
      agentId: string;
      overrides: Record<string, unknown> | null;
      clientTools: Record<string, unknown>;
      textOnly: boolean;
      userId: string | null;
    };
  };
  el.setAttribute("agent-id", "wgt_0123");
  el.setAttribute("override-first-message", "Hi from the attribute");
  el.setAttribute("overrides", JSON.stringify({ first_message: "Hi from overrides" }));
  el.setAttribute("user-id", "crm-42");
  const seen: FakeCustomEvent[] = [];
  const lookup = () => "found";
  el.addEventListener("voso-widget:call", (event) => {
    const e = event as FakeCustomEvent;
    seen.push(e);
    (e.detail as { config: { clientTools: Record<string, unknown> } }).config.clientTools = { lookup };
  });
  const config = el.dispatchCall(false);
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0]!.init.bubbles, seen[0]!.init.composed], [true, true]);
  assert.equal(config.agentId, "wgt_0123");
  assert.equal(config.textOnly, false);
  assert.equal(config.userId, "crm-42");
  assert.deepEqual(config.overrides, { first_message: "Hi from overrides" }, "the explicit overrides object wins");
  assert.deepEqual(el.clientTools, { lookup }, "the injected client tools serve the session");
});

test("allow-events: the element forwards nothing until allow-events=\"true\"", async () => {
  const { VosoWidgetElement } = await import("../src/index");
  const el = new VosoWidgetElement() as unknown as FakeElement & { onDebug: ((e: Record<string, unknown>) => void) | null };
  const debug: Array<Record<string, unknown>> = [];
  el.onDebug = (e) => debug.push(e);
  el.dispatchEvent(new FakeCustomEvent("voso-widget:user-message", { detail: { message: "hi" } }) as never);
  assert.deepEqual(debug, [], "ignored silently without the attribute");
  el.setAttribute("allow-events", "true");
  el.dispatchEvent(new FakeCustomEvent("voso-widget:user-message", { detail: { message: "hi" } }) as never);
  assert.deepEqual(debug, [{ type: "no_live_session", event: "voso-widget:user-message" }], "heard, no session to take it");
});
