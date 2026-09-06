/**
 * The heuristic token estimate only runs when gpt-tokenizer itself fails,
 * so it needs the tokenizer mocked out for the whole module graph.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { calculateTokens } from "../src/utils/tokens";

vi.mock("gpt-tokenizer", () => ({
  encode: () => {
    throw new Error("tokenizer unavailable");
  },
}));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("calculateTokens", () => {
  it("estimates from words and characters instead of throwing", () => {
    // 4 words -> 3; 18 chars -> 5; the larger wins.
    expect(calculateTokens("four words go here")).toBe(5);
  });

  it("handles empty text", () => {
    expect(calculateTokens("")).toBe(1);
  });
});
