import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/utils/errors";
import { convertInputToMessages } from "../src/utils/response-input";
import type { ResponseInputItem } from "../src/types/requests";

describe("convertInputToMessages", () => {
  it("accepts an input item that omits the optional type field", () => {
    // The n8n OpenAI node sends role + content only; `type: "message"` is an
    // omittable default in the Responses API spec.
    const input = [
      {
        role: "user",
        content: [{ type: "input_text", text: "Hello there" }],
      },
    ] as ResponseInputItem[];

    expect(convertInputToMessages(input)).toEqual([
      { role: "user", content: "Hello there" },
    ]);
  });

  it("accepts an explicit type: message item", () => {
    const input: ResponseInputItem[] = [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Hello there" }],
      },
    ];

    expect(convertInputToMessages(input)).toEqual([
      { role: "user", content: "Hello there" },
    ]);
  });

  it.each(["text", "input_text", "output_text"])(
    "extracts text from a %s content part",
    (partType) => {
      const input: ResponseInputItem[] = [
        {
          role: "user",
          content: [{ type: partType, text: "part text" }],
        },
      ];

      expect(convertInputToMessages(input)).toEqual([
        { role: "user", content: "part text" },
      ]);
    },
  );

  it("joins multiple text parts with newlines", () => {
    const input: ResponseInputItem[] = [
      {
        role: "user",
        content: [
          { type: "input_text", text: "first" },
          { type: "input_text", text: "second" },
        ],
      },
    ];

    expect(convertInputToMessages(input)).toEqual([
      { role: "user", content: "first\nsecond" },
    ]);
  });

  it("accepts a plain string input", () => {
    expect(convertInputToMessages("just a prompt")).toEqual([
      { role: "user", content: "just a prompt" },
    ]);
  });

  it("accepts string content on an input item", () => {
    const input: ResponseInputItem[] = [
      { role: "user", content: "string content" },
    ];

    expect(convertInputToMessages(input)).toEqual([
      { role: "user", content: "string content" },
    ]);
  });

  it("prepends instructions as a system message", () => {
    const input: ResponseInputItem[] = [
      { role: "user", content: "question" },
    ];

    expect(convertInputToMessages(input, "be brief")).toEqual([
      { role: "system", content: "be brief" },
      { role: "user", content: "question" },
    ]);
  });

  it("preserves a multi-turn conversation", () => {
    const input: ResponseInputItem[] = [
      { role: "user", content: [{ type: "input_text", text: "hi" }] },
      {
        role: "assistant",
        content: [{ type: "output_text", text: "hello" }],
      },
      { role: "user", content: [{ type: "input_text", text: "and now?" }] },
    ];

    expect(convertInputToMessages(input)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "and now?" },
    ]);
  });

  it("skips input items of an unrelated type", () => {
    const input = [
      { type: "function_call", role: "assistant", content: "" },
      { role: "user", content: "real prompt" },
    ] as ResponseInputItem[];

    expect(convertInputToMessages(input)).toEqual([
      { role: "user", content: "real prompt" },
    ]);
  });

  it("rejects non-text content parts instead of dropping them", () => {
    const input: ResponseInputItem[] = [
      {
        role: "user",
        content: [
          { type: "input_text", text: "what is in this picture?" },
          { type: "input_image" },
        ],
      },
    ];

    expect(() => convertInputToMessages(input)).toThrow(ValidationError);
    expect(() => convertInputToMessages(input)).toThrow(/input_image/);
  });

  it("rejects an empty input array", () => {
    expect(() => convertInputToMessages([])).toThrow(ValidationError);
  });

  it("rejects an item with an empty content array", () => {
    const input: ResponseInputItem[] = [{ role: "user", content: [] }];

    expect(() => convertInputToMessages(input)).toThrow(/empty/i);
  });

  it("rejects whitespace-only content", () => {
    const input: ResponseInputItem[] = [
      { role: "user", content: [{ type: "input_text", text: "   \n" }] },
    ];

    expect(() => convertInputToMessages(input)).toThrow(ValidationError);
  });

  it("rejects an input that only carries instructions", () => {
    // A system prompt on its own is not a prompt: forwarding it would make
    // the upstream model answer with a generic greeting.
    expect(() => convertInputToMessages([], "be brief")).toThrow(
      ValidationError,
    );
  });

  it("reports the validation error as a 400 with a param", () => {
    try {
      convertInputToMessages([]);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).status).toBe(400);
      expect((error as ValidationError).param).toBe("input");
    }
  });
});
