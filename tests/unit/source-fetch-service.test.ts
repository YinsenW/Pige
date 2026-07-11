import { describe, expect, it } from "vitest";
import { PigeDomainError } from "@pige/domain";
import { extractWebContent } from "../../apps/desktop/src/main/services/web-content-extractor-core";
import {
  WEB_EXTRACTOR_MAX_ELEMENTS,
  WEB_EXTRACTOR_MAX_IMAGE_REFERENCES,
  WEB_EXTRACTOR_MAX_INPUT_CHARACTERS,
  WEB_EXTRACTOR_MAX_OUTPUT_CHARACTERS
} from "../../apps/desktop/src/main/services/web-content-extractor-types";
import {
  createPinnedLookup,
  SourceFetchService
} from "../../apps/desktop/src/main/services/source-fetch-service";

describe("source fetch service", () => {
  it("extracts readable text and metadata from a safe HTML URL", async () => {
    const service = new SourceFetchService({
      lookup: async () => ["93.184.216.34"],
      extractor: directExtractor(),
      fetchImpl: async () =>
        new Response(`<!doctype html>
          <html>
            <head>
              <title>Example Article</title>
              <link rel="canonical" href="/article" />
              <script>window.secret = "ignore";</script>
            </head>
            <body><h1>Example Article</h1><p>Readable web content.</p></body>
          </html>`, {
          headers: { "content-type": "text/html; charset=utf-8" }
        })
    });

    const result = await service.fetchSnapshot("https://example.com/source#fragment");

    expect(result.originalUrl).toBe("https://example.com/source");
    expect(result.finalUrl).toBe("https://example.com/source");
    expect(result.canonicalUrl).toBe("https://example.com/article");
    expect(result.title).toBe("Example Article");
    expect(result.rawContent).toContain("<script>");
    expect(result.extractedText).toContain("Readable web content.");
    expect(result.extractedText).not.toContain("window.secret");
    expect(result.extraction).toMatchObject({ parserId: "mozilla_readability", engine: "@mozilla/readability+jsdom" });
  });

  it("blocks private network URLs before fetch", async () => {
    const service = new SourceFetchService({
      lookup: async () => ["127.0.0.1"],
      fetchImpl: async () => {
        throw new Error("fetch should not run");
      }
    });

    await expect(service.fetchSnapshot("http://internal.example")).rejects.toMatchObject({
      name: "PigeDomainError",
      code: "url_fetch.private_network_blocked"
    } satisfies Partial<PigeDomainError>);
  });

  it("blocks embedded credentials before fetch", async () => {
    const service = new SourceFetchService({
      lookup: async () => ["93.184.216.34"],
      fetchImpl: async () => {
        throw new Error("fetch should not run");
      }
    });

    await expect(service.fetchSnapshot("https://user:password@example.com/source")).rejects.toMatchObject({
      name: "PigeDomainError",
      code: "url_fetch.credentials_not_allowed"
    } satisfies Partial<PigeDomainError>);
  });

  it("blocks IPv4-mapped IPv6 loopback addresses", async () => {
    const service = new SourceFetchService({
      lookup: async () => ["::ffff:127.0.0.1"],
      fetchImpl: async () => {
        throw new Error("fetch should not run");
      }
    });

    await expect(service.fetchSnapshot("https://mapped.example")).rejects.toMatchObject({
      name: "PigeDomainError",
      code: "url_fetch.private_network_blocked"
    } satisfies Partial<PigeDomainError>);
  });

  it.each([
    "192.0.2.10",
    "198.51.100.20",
    "203.0.113.30",
    "::ffff:7f00:1",
    "2001:db8::1",
    "3fff::1"
  ])("blocks non-public address %s", async (address) => {
    const service = new SourceFetchService({
      lookup: async () => [address],
      fetchImpl: async () => {
        throw new Error("fetch should not run");
      }
    });

    await expect(service.fetchSnapshot("https://blocked.example/source")).rejects.toMatchObject({
      name: "PigeDomainError",
      code: "url_fetch.private_network_blocked"
    } satisfies Partial<PigeDomainError>);
  });

  it("revalidates redirects before following them", async () => {
    const requests: { readonly url: string; readonly redirect: RequestRedirect | undefined }[] = [];
    const service = new SourceFetchService({
      lookup: async (hostname) => (hostname === "example.com" ? ["93.184.216.34"] : ["169.254.169.254"]),
      fetchImpl: async (url, init) => {
        requests.push({ url: url.toString(), redirect: init?.redirect });
        return new Response("", { status: 302, headers: { location: "http://metadata.local/latest" } });
      }
    });

    await expect(service.fetchSnapshot("https://example.com")).rejects.toMatchObject({
      name: "PigeDomainError",
      code: "url_fetch.private_network_blocked"
    } satisfies Partial<PigeDomainError>);
    expect(requests).toEqual([{ url: "https://example.com/", redirect: "manual" }]);
  });

  it("uses manual redirect handling after revalidating every fetch hop", async () => {
    const lookups: string[] = [];
    const requests: { readonly url: string; readonly redirect: RequestRedirect | undefined }[] = [];
    const service = new SourceFetchService({
      lookup: async (hostname) => {
        lookups.push(hostname);
        return [hostname === "example.com" ? "93.184.216.34" : "93.184.216.35"];
      },
      fetchImpl: async (url, init) => {
        requests.push({ url: url.toString(), redirect: init?.redirect });
        if (requests.length === 1) {
          return new Response("", { status: 302, headers: { location: "https://redirect.example/final" } });
        }
        return new Response("done", { headers: { "content-type": "text/plain" } });
      }
    });

    const result = await service.fetchSnapshot("https://example.com/start");

    expect(result.finalUrl).toBe("https://redirect.example/final");
    expect(result.extractedText).toBe("done");
    expect(lookups).toEqual(["example.com", "redirect.example"]);
    expect(requests).toEqual([
      { url: "https://example.com/start", redirect: "manual" },
      { url: "https://redirect.example/final", redirect: "manual" }
    ]);
  });

  it("rejects declared and streamed response bodies above the capture byte limit", async () => {
    const declared = new SourceFetchService({
      lookup: async () => ["93.184.216.34"],
      maxBytes: 8,
      fetchImpl: async () => new Response("short", {
        headers: { "content-type": "text/plain", "content-length": "64" }
      })
    });
    await expect(declared.fetchSnapshot("https://example.com/declared")).rejects.toMatchObject({
      code: "url_fetch.response_too_large"
    });

    const streamed = new SourceFetchService({
      lookup: async () => ["93.184.216.34"],
      maxBytes: 8,
      fetchImpl: async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3, 4, 5]));
          controller.enqueue(new Uint8Array([6, 7, 8, 9, 10]));
          controller.close();
        }
      }), { headers: { "content-type": "text/plain" } })
    });
    await expect(streamed.fetchSnapshot("https://example.com/streamed")).rejects.toMatchObject({
      code: "url_fetch.response_too_large"
    });
  });

  it("applies the deadline while reading a response body", async () => {
    let cancelled = false;
    const service = new SourceFetchService({
      lookup: async () => ["93.184.216.34"],
      timeoutMs: 20,
      fetchImpl: async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("partial"));
        },
        cancel() {
          cancelled = true;
        }
      }), { headers: { "content-type": "text/plain" } })
    });

    await expect(service.fetchSnapshot("https://example.com/slow-body")).rejects.toMatchObject({
      code: "url_fetch.timeout"
    });
    expect(cancelled).toBe(true);
  });

  it("decodes an HTML meta charset before local extraction", async () => {
    const prefix = Buffer.from("<html><head><meta charset=gbk><title>GBK</title></head><body><p>", "ascii");
    const chinese = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]);
    const suffix = Buffer.from("</p></body></html>", "ascii");
    const service = new SourceFetchService({
      lookup: async () => ["93.184.216.34"],
      extractor: { isAvailable: () => false, extract: async () => { throw new Error("unavailable"); } },
      fetchImpl: async () => new Response(Buffer.concat([prefix, chinese, suffix]), {
        headers: { "content-type": "text/html" }
      })
    });

    const result = await service.fetchSnapshot("https://example.com/gbk");

    expect(result.charset).toBe("gbk");
    expect(result.extractedText).toContain("中文");
    expect(result.extraction).toMatchObject({
      parserId: "pige_basic_html",
      engine: "pige_domless_fallback",
      mode: "regex_fallback"
    });
    expect(result.warnings).toContain("readability_unavailable");
  });

  it("pins transport lookup to the already validated hostname and addresses", async () => {
    type AllLookup = (
      hostname: string,
      options: { readonly all: true; readonly family: 0 },
      callback: (error: NodeJS.ErrnoException | null, addresses: readonly { readonly address: string; readonly family: number }[]) => void
    ) => void;
    const lookup = createPinnedLookup("example.com", ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]) as unknown as AllLookup;
    const addresses = await new Promise<readonly { readonly address: string; readonly family: number }[]>((resolve, reject) => {
      lookup("example.com", { all: true, family: 0 }, (error, result) => error ? reject(error) : resolve(result));
    });

    expect(addresses).toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }
    ]);
    await expect(new Promise((resolve, reject) => {
      lookup("rebound.example", { all: true, family: 0 }, (error, result) => error ? reject(error) : resolve(result));
    })).rejects.toMatchObject({ code: "EACCES" });
  });
});

function directExtractor() {
  return {
    isAvailable: () => true,
    extract: async (html: string, url: string) => extractWebContent({
      requestId: "source-fetch-test",
      html,
      url,
      limits: {
        maxInputCharacters: WEB_EXTRACTOR_MAX_INPUT_CHARACTERS,
        maxElements: WEB_EXTRACTOR_MAX_ELEMENTS,
        maxOutputCharacters: WEB_EXTRACTOR_MAX_OUTPUT_CHARACTERS,
        maxImageReferences: WEB_EXTRACTOR_MAX_IMAGE_REFERENCES
      }
    })
  };
}
