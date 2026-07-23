import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { configure } from "@testing-library/react";
import { vi } from "vitest";

configure({ asyncUtilTimeout: 5000 });

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
