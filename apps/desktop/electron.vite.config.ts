import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { LOCAL_DATABASE_REBUILD_WORKER_ENTRY_NAME } from "./src/shared/local-database-rebuild-entry";
import { OFFICE_PARSER_WORKER_ENTRY_NAME } from "./src/shared/office-parser-entry";
import { PDF_PAGE_RENDERER_WORKER_ENTRY_NAME } from "./src/shared/pdf-page-renderer-entry";
import { PRELOAD_ENTRY_FILENAME } from "./src/shared/preload-entry";
import { PDF_PARSER_WORKER_ENTRY_NAME } from "./src/shared/pdf-parser-entry";
import { WEB_EXTRACTOR_WORKER_ENTRY_NAME } from "./src/shared/web-extractor-entry";
import { DATASET_INGEST_WORKER_ENTRY_NAME } from "./src/shared/dataset-ingest-worker";
import { DATASET_QUERY_WORKER_ENTRY_NAME } from "./src/shared/dataset-query-worker";

const alias = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: alias("./src/main/index.ts"),
          "pi-agent-runtime-smoke": alias("./src/main/smokes/pi-agent-runtime-smoke.ts"),
          "unified-agent-roundtrip-smoke": alias("./src/main/smokes/unified-agent-roundtrip-smoke.ts"),
          [DATASET_INGEST_WORKER_ENTRY_NAME]: alias("./src/main/workers/dataset-ingest-worker.ts"),
          [DATASET_QUERY_WORKER_ENTRY_NAME]: alias("./src/main/workers/dataset-query-worker.ts"),
          [LOCAL_DATABASE_REBUILD_WORKER_ENTRY_NAME]: alias("./src/main/workers/local-database-rebuild-worker.ts"),
          [OFFICE_PARSER_WORKER_ENTRY_NAME]: alias("./src/main/workers/office-parser-worker.ts"),
          [PDF_PAGE_RENDERER_WORKER_ENTRY_NAME]: alias("./src/main/workers/pdf-page-renderer-worker.ts"),
          [PDF_PARSER_WORKER_ENTRY_NAME]: alias("./src/main/workers/pdf-parser-worker.ts"),
          [WEB_EXTRACTOR_WORKER_ENTRY_NAME]: alias("./src/main/workers/web-extractor-worker.ts")
        },
        output: {
          entryFileNames: "[name].js"
        }
      }
    },
    resolve: {
      alias: {
        "@pige/domain": alias("../../packages/domain/src/index.ts"),
        "@pige/contracts": alias("../../packages/contracts/src/index.ts")
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: PRELOAD_ENTRY_FILENAME
        }
      }
    },
    resolve: {
      alias: {
        "@pige/contracts": alias("../../packages/contracts/src/index.ts")
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        "@pige/contracts": alias("../../packages/contracts/src/index.ts")
      }
    }
  }
});
