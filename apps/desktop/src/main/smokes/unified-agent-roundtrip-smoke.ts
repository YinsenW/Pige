import fs from "node:fs";
import path from "node:path";
import { LocalSettingsStore } from "../services/local-settings";
import { createVaultOnDisk } from "../services/vault-layout";

const ROUNDTRIP_PAGE_ID = "page_20260712_roundtrip";
const ROUNDTRIP_TIME = "2026-07-12T00:00:00.000Z";

export function prepareUnifiedAgentRoundtripSmoke(input: {
  readonly rootPath: string;
  readonly userDataPath: string;
}): { readonly vaultId: string; readonly pageId: string } {
  const vaultParentPath = path.join(input.rootPath, "vaults");
  fs.mkdirSync(vaultParentPath, { recursive: true });
  const vault = createVaultOnDisk({
    parentDirectory: vaultParentPath,
    vaultName: "Roundtrip Vault",
    appDataPath: path.join(input.rootPath, "guard-app-data"),
    tempPath: path.join(input.rootPath, "guard-temp"),
    locale: "en",
    now: new Date(ROUNDTRIP_TIME)
  });
  const vaultPath = path.join(vaultParentPath, "Roundtrip Vault");
  writeRoundtripPage(vaultPath);

  const settings = new LocalSettingsStore(input.userDataPath);
  settings.setAppLocale("en");
  settings.setActiveVault(vaultPath, vault);
  return { vaultId: vault.vaultId, pageId: ROUNDTRIP_PAGE_ID };
}

function writeRoundtripPage(vaultPath: string): void {
  const pagePath = path.join(vaultPath, "wiki", "roundtrip-knowledge.md");
  fs.writeFileSync(pagePath, `---
id: "${ROUNDTRIP_PAGE_ID}"
schema_version: 1
title: "Roundtrip knowledge"
type: "note"
created_at: "${ROUNDTRIP_TIME}"
updated_at: "${ROUNDTRIP_TIME}"
status: "active"
language: "en"
source_ids: []
---

The roundtrip launch phrase is heliotrope seven.
`, "utf8");
}
