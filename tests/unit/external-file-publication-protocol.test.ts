import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertPublicationReceipt,
  capturedExternalTarget,
  hashExternalTarget,
  hashExternalTextCreateActionInput
} from "../../apps/desktop/src/main/services/external-file-publication-protocol";

const parentIdentityHash = `sha256:${"a".repeat(64)}` as const;
const contentHash = `sha256:${"b".repeat(64)}` as const;

describe("external file publication protocol", () => {
  it("derives the opaque target identity from the captured parent identity and exact leaf", () => {
    const targetPath = path.resolve("/tmp", "pige-external-target.txt");
    const target = capturedExternalTarget({
      targetPath,
      targetLeafName: "pige-external-target.txt",
      parentIdentityHash
    });

    expect(target.targetResourceHash).toBe(hashExternalTarget(parentIdentityHash, "pige-external-target.txt"));
    expect(() => capturedExternalTarget({
      ...target,
      targetResourceHash: hashExternalTarget(parentIdentityHash, "different.txt")
    })).toThrowError(expect.objectContaining({ code: "external_filesystem.publication_protocol_invalid" }));
  });

  it("rejects path traversal leaves and non-canonical target paths", () => {
    const targetPath = path.resolve("/tmp", "pige-external-target.txt");
    for (const targetLeafName of ["../target.txt", "folder/target.txt", ".", "..", "target\n.txt"]) {
      expect(() => capturedExternalTarget({ targetPath, targetLeafName, parentIdentityHash })).toThrowError(
        expect.objectContaining({ code: "external_filesystem.publication_protocol_invalid" })
      );
    }
    expect(() => capturedExternalTarget({
      targetPath: `${path.dirname(targetPath)}${path.sep}nested${path.sep}..${path.sep}pige-external-target.txt`,
      targetLeafName: "pige-external-target.txt",
      parentIdentityHash
    })).toThrowError(expect.objectContaining({ code: "external_filesystem.publication_protocol_invalid" }));
  });

  it("requires the platform receipt to match every captured and content identity", () => {
    const targetResourceHash = hashExternalTarget(parentIdentityHash, "target.txt");
    const expected = { state: "published" as const, parentIdentityHash, targetResourceHash, contentHash, byteLength: 7 };
    expect(() => assertPublicationReceipt(expected, expected)).not.toThrow();
    expect(() => assertPublicationReceipt({ ...expected, parentIdentityHash: `sha256:${"f".repeat(64)}` }, expected))
      .toThrowError(expect.objectContaining({ code: "external_filesystem.publication_protocol_invalid" }));
    expect(() => assertPublicationReceipt({ ...expected, byteLength: 8 }, expected))
      .toThrowError(expect.objectContaining({ code: "external_filesystem.publication_protocol_invalid" }));
    expect(() => assertPublicationReceipt({
      ...expected,
      state: "failed_no_effect",
      errorCode: "external_filesystem.untrusted" as "external_filesystem.write_failed"
    }, {
      ...expected,
      state: "failed_no_effect",
      errorCode: "external_filesystem.untrusted" as "external_filesystem.write_failed"
    })).toThrowError(expect.objectContaining({ code: "external_filesystem.publication_protocol_invalid" }));
  });

  it("binds create authority to the exact tool call as well as target and content", () => {
    const targetResourceHash = hashExternalTarget(parentIdentityHash, "target.txt");
    const first = hashExternalTextCreateActionInput({
      toolCallId: "call_external_create_01",
      targetResourceHash,
      contentHash,
      byteLength: 7
    });
    expect(hashExternalTextCreateActionInput({
      toolCallId: "call_external_create_02",
      targetResourceHash,
      contentHash,
      byteLength: 7
    })).not.toBe(first);
    expect(() => hashExternalTextCreateActionInput({
      toolCallId: "",
      targetResourceHash,
      contentHash,
      byteLength: 7
    })).toThrowError(expect.objectContaining({ code: "external_filesystem.publication_protocol_invalid" }));
  });
});
