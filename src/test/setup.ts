import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { configure } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { resetAppHistoryUnwind } from "../lib/appHistory";

configure({ asyncUtilTimeout: 5000 });

// jsdom's history.back() never traverses, so a dialog unmount cannot fire the
// popstate that would normally release the "app started this unwind" marker.
// Clear it between tests to mirror a settled history stack.
afterEach(() => resetAppHistoryUnwind());

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  }))
});
