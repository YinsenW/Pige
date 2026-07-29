import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";

const SCOPE_HASH = /^sha256:[a-f0-9]{64}$/u;
const MAX_GRANTS = 128;

interface StoredPermissionGrant {
  readonly grantId: string;
  readonly scopeHash: `sha256:${string}`;
  readonly createdAt: string;
  readonly lastUsedAt: string;
}

interface StoredPermissionGrants {
  readonly schemaVersion: 1;
  readonly grants: readonly StoredPermissionGrant[];
}

/** Machine-local, body-free grants. Exact scope material is hashed before it reaches this owner. */
export class PermissionGrantStore {
  readonly #root: string;
  readonly #filePath: string;

  constructor(userDataPath: string) {
    const root = path.join(userDataPath, "permissions");
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    this.#root = fs.realpathSync.native(root);
    this.#filePath = path.join(this.#root, "scoped-grants.json");
  }

  has(scopeHash: `sha256:${string}`): boolean {
    assertScopeHash(scopeHash);
    return this.#read().grants.some((grant) => grant.scopeHash === scopeHash);
  }

  remember(scopeHash: `sha256:${string}`): void {
    assertScopeHash(scopeHash);
    const current = this.#read();
    const now = new Date().toISOString();
    const existing = current.grants.find((grant) => grant.scopeHash === scopeHash);
    const next = existing
      ? current.grants.map((grant) => grant === existing ? { ...grant, lastUsedAt: now } : grant)
      : [
          ...current.grants,
          { grantId: `grant_${randomUUID().replaceAll("-", "")}`, scopeHash, createdAt: now, lastUsedAt: now }
        ].slice(-MAX_GRANTS);
    this.#write({ schemaVersion: 1, grants: next });
  }

  count(): number {
    return this.#read().grants.length;
  }

  clear(): number {
    const count = this.#read().grants.length;
    this.#write({ schemaVersion: 1, grants: [] });
    return count;
  }

  #read(): StoredPermissionGrants {
    let body: string;
    try {
      const stats = fs.lstatSync(this.#filePath);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 128 * 1_024) throw invalidGrantStore();
      const descriptor = fs.openSync(this.#filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      try { body = fs.readFileSync(descriptor, "utf8"); } finally { fs.closeSync(descriptor); }
    } catch (caught) {
      if ((caught as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, grants: [] };
      throw invalidGrantStore();
    }
    try {
      const parsed = JSON.parse(body) as Partial<StoredPermissionGrants>;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.grants) || parsed.grants.length > MAX_GRANTS) {
        throw invalidGrantStore();
      }
      const grants = parsed.grants.map(parseGrant);
      if (new Set(grants.map((grant) => grant.scopeHash)).size !== grants.length) throw invalidGrantStore();
      return { schemaVersion: 1, grants };
    } catch (caught) {
      if (caught instanceof PigeDomainError) throw caught;
      throw invalidGrantStore();
    }
  }

  #write(value: StoredPermissionGrants): void {
    const temporary = path.join(this.#root, `.scoped-grants.${randomUUID()}.tmp`);
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(
        temporary,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0),
        0o600
      );
      fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporary, this.#filePath);
      const rootDescriptor = fs.openSync(this.#root, fs.constants.O_RDONLY);
      try { fs.fsyncSync(rootDescriptor); } finally { fs.closeSync(rootDescriptor); }
    } catch {
      throw invalidGrantStore();
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      fs.rmSync(temporary, { force: true });
    }
  }
}

function parseGrant(value: unknown): StoredPermissionGrant {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidGrantStore();
  const grant = value as Record<string, unknown>;
  if (
    Object.keys(grant).some((key) => !["grantId", "scopeHash", "createdAt", "lastUsedAt"].includes(key)) ||
    typeof grant.grantId !== "string" || !/^grant_[a-f0-9]{32}$/u.test(grant.grantId) ||
    typeof grant.scopeHash !== "string" || !SCOPE_HASH.test(grant.scopeHash) ||
    typeof grant.createdAt !== "string" || Number.isNaN(Date.parse(grant.createdAt)) ||
    typeof grant.lastUsedAt !== "string" || Number.isNaN(Date.parse(grant.lastUsedAt))
  ) throw invalidGrantStore();
  return grant as unknown as StoredPermissionGrant;
}

function assertScopeHash(value: string): asserts value is `sha256:${string}` {
  if (!SCOPE_HASH.test(value)) throw invalidGrantStore();
}

function invalidGrantStore(): PigeDomainError {
  return new PigeDomainError("permission.grant_store_invalid", "The scoped permission grant store is invalid.");
}
