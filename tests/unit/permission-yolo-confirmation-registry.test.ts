import { describe, expect, it } from "vitest";
import { PermissionYoloConfirmationRegistry } from "../../apps/desktop/src/main/services/permission-yolo-confirmation-registry";

describe("PermissionYoloConfirmationRegistry", () => {
  it("binds a one-use token to the exact sender and settings revision", () => {
    const registry = new PermissionYoloConfirmationRegistry(() => Date.parse("2026-07-18T00:00:00.000Z"));
    const confirmation = registry.issue(7, 3);

    expect(confirmation.confirmationToken).toMatch(/^permyolo_20260718_[a-f0-9]{32}$/);
    expect(() => registry.consume(8, 3, confirmation.confirmationToken)).toThrowError(
      expect.objectContaining({ code: "permission.yolo_confirmation_invalid" })
    );
    expect(() => registry.consume(7, 3, confirmation.confirmationToken)).toThrowError(
      expect.objectContaining({ code: "permission.yolo_confirmation_invalid" })
    );

    const exact = registry.issue(7, 3);
    expect(() => registry.consume(7, 4, exact.confirmationToken)).toThrowError(
      expect.objectContaining({ code: "permission.yolo_confirmation_invalid" })
    );
  });

  it("expires tokens and clears all tokens owned by a destroyed sender", () => {
    let now = Date.parse("2026-07-18T00:00:00.000Z");
    const registry = new PermissionYoloConfirmationRegistry(() => now, 1_000);
    const expired = registry.issue(5, 0);
    now += 1_001;
    expect(() => registry.consume(5, 0, expired.confirmationToken)).toThrowError(
      expect.objectContaining({ code: "permission.yolo_confirmation_invalid" })
    );

    const cleared = registry.issue(5, 0);
    registry.clearSender(5);
    expect(() => registry.consume(5, 0, cleared.confirmationToken)).toThrowError(
      expect.objectContaining({ code: "permission.yolo_confirmation_invalid" })
    );
  });

  it("consumes a valid token exactly once", () => {
    const registry = new PermissionYoloConfirmationRegistry();
    const confirmation = registry.issue(11, 9);
    expect(() => registry.consume(11, 9, confirmation.confirmationToken)).not.toThrow();
    expect(() => registry.consume(11, 9, confirmation.confirmationToken)).toThrowError(
      expect.objectContaining({ code: "permission.yolo_confirmation_invalid" })
    );
  });
});
