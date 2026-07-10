import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { PigeDomainError } from "@pige/domain";
import { WEB_EXTRACTOR_WORKER_ENTRY_RELATIVE_PATH } from "../../shared/web-extractor-entry";
import {
  WEB_EXTRACTOR_MAX_ELEMENTS,
  WEB_EXTRACTOR_MAX_IMAGE_REFERENCES,
  WEB_EXTRACTOR_MAX_INPUT_CHARACTERS,
  WEB_EXTRACTOR_MAX_OUTPUT_CHARACTERS,
  WEB_EXTRACTOR_MAX_PENDING,
  WEB_EXTRACTOR_TIMEOUT_MS,
  type WebExtractionResult,
  type WebExtractorRequest,
  type WebExtractorWorkerResponse
} from "./web-content-extractor-types";

export interface WebContentExtractorPort {
  isAvailable?(): boolean;
  extract(html: string, url: string): Promise<WebExtractionResult>;
}

export class WebContentExtractorWorkerAdapter implements WebContentExtractorPort {
  #pending = 0;
  #tail: Promise<void> = Promise.resolve();
  readonly #timeoutMs: number;
  readonly #workerUrl: URL;
  readonly #resolveModule: (moduleId: string) => string;

  constructor(
    workerUrl = new URL(WEB_EXTRACTOR_WORKER_ENTRY_RELATIVE_PATH, import.meta.url),
    timeoutMs = WEB_EXTRACTOR_TIMEOUT_MS,
    resolveModule: (moduleId: string) => string = (moduleId) => createRequire(import.meta.url).resolve(moduleId)
  ) {
    this.#workerUrl = workerUrl;
    this.#timeoutMs = timeoutMs;
    this.#resolveModule = resolveModule;
  }

  isAvailable(): boolean {
    try {
      return Boolean(
        this.#resolveModule("@mozilla/readability/package.json") &&
        this.#resolveModule("jsdom/package.json")
      );
    } catch {
      return false;
    }
  }

  extract(html: string, url: string): Promise<WebExtractionResult> {
    if (this.#pending >= WEB_EXTRACTOR_MAX_PENDING) {
      return Promise.reject(new PigeDomainError("web_extractor.busy", "The local web extractor queue is full."));
    }
    this.#pending += 1;
    const extraction = this.#tail.then(
      () => this.#extractInWorker(html, url),
      () => this.#extractInWorker(html, url)
    );
    this.#tail = extraction.then(() => undefined, () => undefined);
    return extraction.finally(() => {
      this.#pending -= 1;
    });
  }

  #extractInWorker(html: string, url: string): Promise<WebExtractionResult> {
    const request: WebExtractorRequest = {
      requestId: randomUUID(),
      html,
      url,
      limits: {
        maxInputCharacters: WEB_EXTRACTOR_MAX_INPUT_CHARACTERS,
        maxElements: WEB_EXTRACTOR_MAX_ELEMENTS,
        maxOutputCharacters: WEB_EXTRACTOR_MAX_OUTPUT_CHARACTERS,
        maxImageReferences: WEB_EXTRACTOR_MAX_IMAGE_REFERENCES
      }
    };

    return new Promise((resolve, reject) => {
      const worker = new Worker(this.#workerUrl, {
        name: "pige-web-extractor",
        resourceLimits: { maxOldGenerationSizeMb: 256 }
      });
      let settled = false;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        void worker.terminate().then(callback, callback);
      };
      const timeout = setTimeout(() => {
        finish(() => reject(new PigeDomainError("web_extractor.timeout", "Readable web extraction exceeded the local time limit.")));
      }, this.#timeoutMs);

      worker.once("message", (message: WebExtractorWorkerResponse) => {
        if (!message || message.requestId !== request.requestId) {
          finish(() => reject(new PigeDomainError("web_extractor.worker_protocol", "The web extractor worker returned an invalid response.")));
          return;
        }
        if (message.ok) {
          finish(() => resolve(message.result));
          return;
        }
        finish(() => reject(new PigeDomainError(message.error.code, message.error.message)));
      });
      worker.once("error", () => {
        finish(() => reject(new PigeDomainError("web_extractor.worker_failed", "The web extractor worker failed.")));
      });
      worker.once("exit", (code) => {
        if (!settled && code !== 0) {
          finish(() => reject(new PigeDomainError("web_extractor.worker_failed", "The web extractor worker exited before completing.")));
        }
      });
      worker.postMessage(request);
    });
  }
}
