import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProposalDecisionResult } from "@pige/contracts";
import type { ConfirmationProposal } from "@pige/schemas";
import { ProposalReviewPanel } from "../../apps/desktop/src/renderer/src/components/ProposalReviewPanel";

const messages: Record<string, string> = {
  "proposal.reviewTitle": "Review proposed change",
  "proposal.reason": "Reason",
  "proposal.target": "Target",
  "proposal.warnings": "Warnings",
  "proposal.markdownPreview": "Markdown preview",
  "proposal.approve": "Approve",
  "proposal.reject": "Reject",
  "proposal.back": "Back",
  "proposal.working": "Working",
  "proposal.operation.create": "Create",
  "proposal.operation.update": "Update",
  "proposal.operation.rename": "Rename",
  "proposal.operation.delete": "Delete",
  "proposal.status.approved": "Approved",
  "proposal.status.applied": "Applied",
  "proposal.status.rejected": "Rejected",
  "proposal.status.conflicted": "Conflicted",
  "proposal.status.not_found": "Not found",
  "proposal.status.not_allowed": "Not allowed",
  "proposal.status.unknown": "Decision status unknown"
};

const t = (key: string): string => messages[key] ?? key;
const noop = (): void => undefined;
const sha256 = `sha256:${"a".repeat(64)}`;

function proposal(overrides: Partial<ConfirmationProposal> = {}): ConfirmationProposal {
  return {
    id: "proposal_review_fixture",
    schemaVersion: 1,
    jobId: "job_agent_fixture",
    createdAt: "2026-07-12T08:00:00.000Z",
    updatedAt: "2026-07-12T08:00:00.000Z",
    state: "ready",
    trustLevel: "explicit_confirmation",
    summary: "Create a concise project note",
    reason: "The selected evidence supports a durable note.",
    sourceRefs: [],
    targetRefs: [{ role: "page", id: "page_fixture", path: "wiki/generated/project-note.md" }],
    proposedOperations: [
      {
        kind: "create",
        path: "wiki/generated/project-note.md",
        content: "# Project note\n\n<script>unsafe()</script>\n"
      }
    ],
    diffRefs: [],
    warnings: ["Review the proposed title before applying."],
    baseHashes: {},
    requiredPermissionIds: [],
    ...overrides
  };
}

function render(
  inputProposal: ConfirmationProposal,
  outcome: ProposalDecisionResult["status"] | null = null,
  busy = false,
  decisionStateUnknown = false
): string {
  return renderToStaticMarkup(createElement(ProposalReviewPanel, {
    proposal: inputProposal,
    busy,
    outcome,
    decisionStateUnknown,
    errorMessageKey: null,
    onApprove: noop,
    onReject: noop,
    onClose: noop,
    t
  }));
}

describe("ProposalReviewPanel", () => {
  it("renders a create-note review with escaped raw Markdown and decision controls", () => {
    const html = render(proposal());

    expect(html).toContain("Create a concise project note");
    expect(html).toContain("The selected evidence supports a durable note.");
    expect(html).toContain("wiki/generated/project-note.md");
    expect(html).toContain("Review the proposed title before applying.");
    expect(html).toContain("&lt;script&gt;unsafe()&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain(">Approve</button>");
    expect(html).toContain(">Reject</button>");
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });

  it("represents generic rename and delete operations without rendering markup", () => {
    const html = render(
      proposal({
        summary: "Review file organization",
        proposedOperations: [
          { kind: "rename", from: "wiki/old-<name>.md", to: "wiki/new-<name>.md" },
          { kind: "delete", path: "wiki/archive-<old>.md", beforeSha256: sha256 }
        ],
        warnings: []
      })
    );

    expect(html).toContain("Rename");
    expect(html).toContain("wiki/old-&lt;name&gt;.md -&gt; wiki/new-&lt;name&gt;.md");
    expect(html).toContain("Delete");
    expect(html).toContain("wiki/archive-&lt;old&gt;.md");
    expect(html).not.toContain("<name>");
    expect(html).not.toContain("<old>");
    expect(html).not.toContain("Markdown preview");
    expect(html).not.toContain("Warnings");
  });

  it.each([
    ["approved", "Approved"],
    ["applied", "Applied"],
    ["rejected", "Rejected"],
    ["conflicted", "Conflicted"],
    ["not_found", "Not found"],
    ["not_allowed", "Not allowed"]
  ] satisfies ReadonlyArray<readonly [ProposalDecisionResult["status"], string]>) (
    "maps the %s outcome to its localized status",
    (outcome, expectedStatus) => {
      expect(render(proposal(), outcome)).toContain(`>${expectedStatus}</p>`);
    }
  );

  it.each(["approved", "applied", "rejected", "conflicted", "not_found"] satisfies ProposalDecisionResult["status"][]) (
    "disables both decisions after the terminal %s outcome",
    (outcome) => {
      const html = render(proposal(), outcome);

      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Reject<\/button>/);
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Approve<\/button>/);
    }
  );

  it("keeps reject available but disables repeated apply after a not_allowed result", () => {
    const html = render(proposal(), "not_allowed");

    expect(html).toContain(">Not allowed</p>");
    expect(html).toContain(">Reject</button>");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Reject<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Approve<\/button>/);
  });

  it("disables decisions when the proposal state is no longer ready", () => {
    const html = render(proposal({ state: "approved" }), "approved");

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Reject<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Approve<\/button>/);
  });

  it("fails closed when the durable decision state cannot be re-read", () => {
    const html = render(proposal(), null, false, true);

    expect(html).toContain(">Decision status unknown</p>");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Reject<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Approve<\/button>/);
  });
});
