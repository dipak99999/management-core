// Install a jsdom window on globalThis before any test imports. Vitest's
// `environment: "jsdom"` option doesn't apply reliably under Node 22+ in
// our monorepo (Node's experimental native localStorage shadows window
// resolution), so we set up the DOM ourselves here.
import { JSDOM } from "jsdom";
import { beforeEach } from "vitest";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});

const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window as unknown as Window;
g.document = dom.window.document;
g.navigator = dom.window.navigator;
g.HTMLElement = dom.window.HTMLElement;
g.Element = dom.window.Element;
g.Node = dom.window.Node;
g.localStorage = dom.window.localStorage;

beforeEach(() => {
  dom.window.localStorage.clear();
});
