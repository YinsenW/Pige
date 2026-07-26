import { describe, expect, it } from "vitest";
import { hasObjectErrorCode } from "../../apps/desktop/src/main/services/object-error-code";

describe("object error code", () => {
  it("matches plain-object and Error codes without coercion", () => {
    const error = Object.assign(new Error("missing"), { code: "ENOENT" });

    expect(hasObjectErrorCode({ code: "ENOENT" }, "ENOENT")).toBe(true);
    expect(hasObjectErrorCode(error, "ENOENT")).toBe(true);
    expect(hasObjectErrorCode({ code: 2 }, "2")).toBe(false);
    expect(hasObjectErrorCode({ code: "EACCES" }, "ENOENT")).toBe(false);
    expect(hasObjectErrorCode(null, "ENOENT")).toBe(false);
  });
});
