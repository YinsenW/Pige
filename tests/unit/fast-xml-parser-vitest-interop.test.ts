import { describe, expect, it } from "vitest";
import { XMLParser } from "fast-xml-parser";

describe("fast-xml-parser Vitest interop", () => {
  it("loads the ESM dependency graph and parses bounded XML", () => {
    const parser = new XMLParser({ ignoreAttributes: false });
    expect(parser.parse('<document version="1"><title>Pige</title></document>')).toEqual({
      document: {
        "@_version": "1",
        title: "Pige"
      }
    });
  });
});
