# Future Mobile And Cloud Architecture

Status: Draft baseline
Date: 2026-07-09

## 1. Decision

Pige should choose one primary future direction:

**Remote Agent Backend + Web/mobile clients.**

Mobile Lite Client remains valuable, but only as a client-side offline and degraded-capability layer. It is not the primary Agent runtime strategy.

In practical terms:

- Desktop v0.1 remains local-first.
- Post-v0.1 primary expansion should be a Pige-compatible Remote Agent Backend.
- Web and mobile clients should access that backend for heavy Agent work.
- Mobile apps should support local capture, offline capture queue, reading, cached search, and queued jobs, but should not aim to run the full desktop Agent/toolchain locally.

## 2. Why This Direction Is More Reasonable

### 2.1 Technical Evaluation

Remote Agent Backend is more feasible for feature parity:

- It can run parsers, OCR, embeddings, reranking, package-backed tools, external/Web Skills, and long jobs consistently.
- It can use server-side runtimes and binaries that mobile platforms cannot normally execute.
- It avoids trying to package Bun, `uv`, npm tools, Python environments, Poppler, PaddleOCR, and large local models into mobile apps.
- It can keep background jobs alive independent of mobile app lifecycle.
- It can provide one Agent execution environment for Web, mobile, and desktop clients.

Mobile Lite Client is more feasible for instant capture and offline utility:

- It can capture text, links, images, files, and voice.
- It can preserve sources locally and queue jobs.
- It can read recent/synced Markdown notes.
- It can search cached metadata and content.
- It can run small local transforms later if a platform-native implementation is stable.

Mobile Lite Client is not a good primary full-Agent strategy:

- Mobile background execution is limited.
- Battery and thermal pressure will hurt long parsing, OCR, indexing, and model jobs.
- Arbitrary executable download and package execution is not a normal mobile product path.
- Full local RAG models and OCR packs increase app size and update complexity.
- Feature parity would diverge across iOS, Android, desktop, and Web.
- The product would need many "not available on mobile" branches for core workflows.

### 2.2 Product Evaluation

Remote Agent Backend gives a clearer user promise:

- Same Agent capability across Web, mobile, and desktop.
- Mobile app feels like a fast client, not a weaker clone.
- Heavy work continues after the phone is locked or the app is closed.
- Users can inspect progress, confirmation proposals, and results from any device.

Mobile Lite Client still matters:

- Capture must be instant.
- Users need offline capture queue and reading.
- Users should not lose material when network is unavailable.
- Some users will prefer desktop-local processing for privacy-sensitive vaults.

The product should not promise full local mobile Agent parity in early mobile versions.

### 2.3 Commercial Evaluation

Remote Agent Backend is the stronger commercial path:

- Hosted cloud can support subscription revenue.
- Server-side compute, storage, sync, and advanced Agent jobs are monetizable.
- Team/workspace features become possible later.
- Web access becomes natural.
- Mobile clients can ship faster because they do not need full local tool/runtime parity.

Self-hosting is valuable but should not be the default user path:

- Most users cannot deploy or maintain an Agent backend.
- Self-host should be an advanced option after the hosted/backend architecture stabilizes.
- A future "personal desktop backend" or one-click server bundle can reduce self-host complexity.

## 3. Chosen Future Architecture

The chosen future architecture is:

```txt
Desktop Local Runtime  ->  Remote Agent Backend  ->  Web/Mobile Clients
                                  ^
                                  |
                         optional self-host/personal backend
```

v0.1 implements:

- Desktop local runtime only.
- Local-first vault.
- Runtime capability boundaries that do not block future backend execution.

Post-v0.1 should prioritize:

1. Sync/change protocol and identity model.
2. Remote Agent Backend contract.
3. Server-side job runtime.
4. Web client.
5. Mobile client with offline capture/read/cache.

Mobile Lite Client should be implemented as part of the mobile client, not as a competing full Agent runtime.

## 4. Runtime Model

Pige should model Agent execution runtimes separately from client capability tiers.

Executable runtime and client-tier names are owned by
`PigeRuntimeKind`/`PigeClientCapabilityTier` in `packages/domain/src/index.ts`:

- Agent runtimes: `desktop_local`, `remote_agent_backend`.
- Client tiers: `desktop_full`, `web_client`, `mobile_lite`.
- Future remote deployments: `pige_cloud`, `self_hosted`, or
  `personal_desktop_backend`. Deployment becomes an executable shared-schema field only
  when a remote backend is implemented.

Rules:

- `desktop_local` can run the full v0.1 local toolchain.
- `remote_agent_backend` can run heavy Agent jobs for Web/mobile/desktop clients.
- `mobile_lite` is a client capability tier, not a full Agent runtime.
- Mobile clients may create captures and pending jobs locally, then hand them to `remote_agent_backend` or a paired desktop backend.

## 5. Runtime Capability Manifest

Every Agent runtime must eventually publish one shared-schema capability manifest. The
manifest records runtime/deployment identity, supported network/parser/OCR/retrieval/
shell/package/Skill/background-job capabilities, byte/time/memory limits, and offline
behavior. Every client tier similarly declares capture, offline queue, read/edit/search,
and local-Agent capabilities.

Exact field names and enums MUST be added once to shared executable contracts when the
first non-desktop runtime or client is implemented. Until then, documents and product
logic use capability IDs and the two executable vocabularies above rather than inventing
parallel TypeScript manifest shapes.

v0.1 should implement `desktop_local` and `desktop_full`, while keeping contracts ready for remote backend and mobile-lite clients.

## 6. Command And Event Contracts

Capture, ingest, Agent, confirmation, permission, and sync-like operations should be serializable so they can cross process, device, and network boundaries later.

Portable contracts:

- `CaptureCommand`.
- `SourceReference`.
- `AgentJobRequest`.
- `AgentJobEvent`.
- `PermissionRequest`.
- `ChangeProposal`.
- `OperationRecord`.
- `ConversationEvent`.
- `MemoryEvent`.
- `SyncChangeEnvelope`.

Avoid contracts that require:

- Desktop absolute paths as the only source reference.
- Node streams.
- Open file descriptors.
- Electron objects.
- Local process handles.
- Direct binary paths.

## 7. Tool Capability Abstraction

Desktop tools such as Bun, `uv`, Poppler, PaddleOCR, Git, and package-backed Skills should be exposed through capability IDs, not direct binary paths in product logic.

Bad:

```txt
Agent says: run /Applications/Pige/tools/bun ...
```

Good:

```txt
Agent requests: capability=document.pdf.extract_text
Runtime adapter resolves: desktop Poppler or remote parser.
Mobile client shows: queued for backend processing.
```

## 8. Remote Agent Backend Future Shape

Remote Agent Backend should be Pige-compatible, not a separate semantic product.

Logical services:

- Auth and workspace service.
- Vault metadata service.
- Blob/source storage service.
- Agent job service.
- Parser/OCR service.
- Retrieval/index service.
- Permission policy service.
- Skill/package runtime service.
- Sync/change service.
- Backup/export service.

Client responsibilities:

- Home composer.
- Preserve local pending captures when offline.
- Show data boundary and execution location.
- Upload sources when the user allows.
- Display job progress, confirmation proposals, and results.
- Keep local cache of recent notes and search metadata.

Backend responsibilities:

- Run heavy Agent jobs.
- Run package-backed tools and external/Web Skills.
- Store and index server-side vault data according to the same ID and operation contracts.
- Enforce permission policy.
- Produce portable Markdown/export output.

## 9. Mobile Client Future Shape

Mobile should prioritize:

- Fast capture.
- Offline capture queue.
- Reading recent notes.
- Searching cached metadata and content.
- Voice/image/file capture through platform APIs.
- Queueing heavy processing for backend or paired desktop.
- Confirming simple proposals.

Likely mobile-client capabilities:

| Capability | Mobile stance |
| --- | --- |
| Text capture | Required |
| URL capture | Required as bookmark/raw URL; full fetch may be backend |
| Image capture | Required |
| Voice capture | Platform-dependent |
| Markdown read/edit | Required for recent/synced notes |
| Cached lexical search | Required |
| Local vector search | Optional, small model only, not primary |
| PDF/DOCX/PPTX full parse | Backend/desktop |
| Heavy OCR | Backend/desktop |
| Bun/uv/npm/package tools | Not local |
| Shell execution | Not local |
| External/Web Skill execution | Backend or disabled unless pure Skill |
| Backup/restore | Backend/desktop-assisted |

## 10. Self-Hosting Strategy

Self-host should be supported eventually, but not as the primary default path.

Recommended order:

1. Pige Cloud backend as the reference hosted deployment.
2. Remote backend protocol and export/import guarantees.
3. Advanced self-host package after the backend stabilizes.
4. Future personal desktop backend for users who want their desktop to serve mobile clients.

Self-host requirements later:

- One-command or container-based install where possible.
- Clear hardware requirements.
- Upgrade and backup path.
- Same permission and data-boundary model as hosted backend.
- No requirement that ordinary mobile users understand server deployment.

## 11. Permission Model Across Runtimes

Permission Broker remains the authority, but execution location matters.

Permission requests must include:

- Actor.
- Capability.
- Resource scope.
- Execution location: desktop local, Pige Cloud, self-hosted backend, or personal desktop backend.
- Data boundary.
- Whether data leaves the current device.
- Whether a backend can continue after the client is closed.

YOLO Full Access is runtime/deployment scoped:

- Desktop YOLO does not automatically grant backend YOLO.
- Pige Cloud YOLO must be a separate explicit choice.
- Self-host YOLO must be a separate explicit choice.
- Mobile client YOLO cannot imply shell/package access because those capabilities are absent locally.

## 12. Data Boundary UX

Future clients must clearly show:

- Local-only.
- Desktop local.
- Pige Cloud backend.
- Self-hosted backend.
- Personal desktop backend.
- Third-party cloud model provider.

The same capture may have different processing locations:

- Captured source asset or pending source reference stored on mobile.
- Parsing queued for backend.
- Summary generated by BYOK provider.
- Retrieval run on backend or desktop.

Pige should display that without forcing users to understand infrastructure details.

## 13. v0.1 Design Rules

Implementation must:

- Keep domain logic out of Electron-specific UI code.
- Keep Agent jobs serializable as requests/events.
- Keep parser/OCR/RAG/tool execution behind capability adapters.
- Avoid storing absolute desktop paths as the only way to understand a source.
- Avoid making Bun, `uv`, npm, shell, Python, parser binary, or large model assumptions in product-level workflows.
- Keep permission records scoped by actor, runtime, deployment, resource, and device/profile.
- Follow `docs/SYNC_CONFLICT_AND_MIGRATION.md` for stable IDs, conflict detection, tombstones, schema versions, and future sync-adapter boundaries.
- Keep SQLite rebuildable and not a sync authority.
- Keep Markdown knowledge files, source records, and source asset data portable.
- Let future mobile clients create pending jobs that desktop/backend can later process.

Implementation must not:

- Let Agent prompts reference desktop binary paths directly.
- Store local tool output in formats that only the desktop runtime can understand.
- Make UI states depend on a job being in the same process.
- Make backup/export require desktop-only caches.
- Treat installed Pi packages as portable mobile capabilities.
- Assume every client can run external/Web Skills.
- Treat Mobile Lite Client as a goal for full Agent parity.

## 14. Contract Tests Later

When backend/mobile work begins, create contract tests for:

- `AgentJobRequest` serialization.
- Runtime capability manifest degradation.
- Capture created on mobile, processed on backend/desktop.
- Source with mobile local path and later uploaded blob reference.
- Permission request for backend execution.
- Job progress streaming from remote runtime.
- Confirmation proposal generated remotely and applied locally.
- Conflict resolution across desktop/Web/mobile edits.

## 15. Relationship To v0.1

v0.1 remains desktop local-first.

Required v0.1 actions:

- Document runtime boundaries.
- Keep service interfaces serializable.
- Use stable IDs and operation records.
- Keep tool execution behind capability services.
- Avoid desktop-only assumptions in domain contracts.
- Record mobile/backend implications in decisions when introducing new runtime dependencies.

Deferred:

- Mobile app implementation.
- Web app implementation.
- Pige Cloud backend.
- Self-hosted backend.
- Personal desktop backend.
- Cloud sync.
- Mobile local model/runtime packaging.
- Server-side package sandbox implementation.
