import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement ResizeObserver, which Radix UI primitives rely on.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  globalThis.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);
