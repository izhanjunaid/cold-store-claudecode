import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement ResizeObserver, which Radix UI primitives rely on.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  globalThis.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);

// jsdom doesn't implement scrollIntoView, which cmdk (Combobox's option list)
// calls to keep the highlighted item in view when its popover opens.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
