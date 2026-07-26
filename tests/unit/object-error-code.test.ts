import { describe, expect, it } from "vitest";
import {
  hasErrorInstanceCode,
  hasNodeErrnoExceptionCode,
  hasObjectErrorCode
} from "../../apps/desktop/src/main/services/object-error-code";

describe("object error code", () => {
  it("matches plain-object and Error codes without coercion", () => {
    const error = Object.assign(new Error("missing"), { code: "ENOENT" });

    expect(hasObjectErrorCode({ code: "ENOENT" }, "ENOENT")).toBe(true);
    expect(hasObjectErrorCode(error, "ENOENT")).toBe(true);
    expect(hasObjectErrorCode({ code: 2 }, "2")).toBe(false);
    expect(hasObjectErrorCode({ code: "EACCES" }, "ENOENT")).toBe(false);
    expect(hasObjectErrorCode(null, "ENOENT")).toBe(false);
  });

  it("requires an Error instance when the owner boundary does", () => {
    const error = Object.assign(new Error("exists"), { code: "EEXIST" });

    expect(hasErrorInstanceCode(error, "EEXIST")).toBe(true);
    expect(hasErrorInstanceCode({ code: "EEXIST" }, "EEXIST")).toBe(false);
    expect(hasErrorInstanceCode(Object.assign(new Error("exists"), { code: 17 }), "17")).toBe(false);
    expect(hasNodeErrnoExceptionCode(error, "EEXIST")).toBe(true);
    expect(hasNodeErrnoExceptionCode({ code: "EEXIST" }, "EEXIST")).toBe(false);
  });
});
