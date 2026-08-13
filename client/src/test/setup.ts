import "@testing-library/jest-dom/vitest";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

/**
 * jsdom implements no scrolling at all, so `Element.prototype.scrollIntoView` is
 * `undefined` rather than a no-op — a component that scrolls itself into view
 * (`FindingCard` when the URL targets it) throws "is not a function" and takes down
 * every test that merely renders it, including ones with nothing to do with
 * scrolling. A shim here rather than a stub per file, and a real function rather
 * than a bare assignment, so `vi.spyOn` works on it.
 */
if (typeof Element.prototype.scrollIntoView === "undefined") {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
