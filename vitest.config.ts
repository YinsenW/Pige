import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const alias = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@pige/domain": alias("./packages/domain/src/index.ts"),
      "@pige/contracts": alias("./packages/contracts/src/index.ts"),
      "@pige/schemas": alias("./packages/schemas/src/index.ts"),
      "@pige/markdown": alias("./packages/markdown/src/index.ts"),
      "@pige/knowledge": alias("./packages/knowledge/src/index.ts"),
      "@pige/test-fixtures": alias("./packages/test-fixtures/src/index.ts")
    }
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/evals/**/*.test.ts"],
    restoreMocks: true
  }
});
