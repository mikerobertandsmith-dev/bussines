declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = () => {};

/*
 * jsdom ships neither observer, and `motion`'s `whileInView` (plus recharts'
 * responsive containers) need them the moment a landing-page section mounts.
 * Stub them out: nothing in the tests asserts on scroll-triggered animation.
 */
if (typeof window.IntersectionObserver === "undefined") {
  class IntersectionObserverStub {
    root = null;
    rootMargin = "";
    thresholds: number[] = [];
    disconnect() {}
    observe() {}
    unobserve() {}
    takeRecords() {
      return [];
    }
  }

  window.IntersectionObserver = IntersectionObserverStub as unknown as typeof IntersectionObserver;
}

if (typeof window.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    disconnect() {}
    observe() {}
    unobserve() {}
  }

  window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
