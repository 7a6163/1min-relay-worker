import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/utils/errors";
import { assertToolsUnsupported } from "../src/utils/tools";

describe("assertToolsUnsupported", () => {
  it("allows a request without tools", () => {
    expect(() => assertToolsUnsupported(undefined)).not.toThrow();
    expect(() => assertToolsUnsupported(null)).not.toThrow();
    expect(() => assertToolsUnsupported([])).not.toThrow();
  });

  it("rejects a request that carries tools", () => {
    const tools = [
      { type: "function", name: "get_weather", parameters: {} },
    ];
    expect(() => assertToolsUnsupported(tools)).toThrow(ValidationError);
    expect(() => assertToolsUnsupported(tools)).toThrow(/Function calling/);
  });

  it("reports a 400 pointing at the tools field", () => {
    try {
      assertToolsUnsupported([{ type: "function" }]);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).status).toBe(400);
      expect((error as ValidationError).param).toBe("tools");
      expect((error as ValidationError).code).toBe("unsupported_parameter");
    }
  });

  it("ignores a non-array value rather than throwing something odd", () => {
    expect(() => assertToolsUnsupported("not an array")).not.toThrow();
    expect(() => assertToolsUnsupported({})).not.toThrow();
  });
});
