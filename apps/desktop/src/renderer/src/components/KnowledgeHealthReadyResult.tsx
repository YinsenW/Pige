import type {
  KnowledgeHealthIssueKind,
  KnowledgeHealthIssueSummary,
  KnowledgeHealthRunResult
} from "@pige/contracts";
import type { Locale } from "@pige/schemas";

export type KnowledgeHealthRepairState =
  | { readonly kind: "repairing"; readonly issueKey: string }
  | { readonly kind: "committed"; readonly issueKind: "broken_link" | "orphan_page" | "duplicate_topic" }
  | { readonly kind: "stale" | "failed" }
  | null;

export type RepairableOrphan = Extract<KnowledgeHealthIssueSummary, { readonly kind: "orphan_page" }> & {
  readonly repairContextId: string;
  readonly targetRevision: string;
  readonly targetRenderProof: string;
};

export type RepairableBrokenLink = Extract<KnowledgeHealthIssueSummary, { readonly kind: "broken_link" }> & {
  readonly repairContextId: string;
  readonly sourceRevision: string;
  readonly sourceRenderProof: string;
  readonly occurrenceId: string;
};

export type RepairableDuplicateTopic = Extract<KnowledgeHealthIssueSummary, { readonly kind: "duplicate_topic" }> & {
  readonly repairContextId: string;
  readonly pageProofs: readonly [
    { readonly pageId: string; readonly revision: string; readonly renderProof: string },
    { readonly pageId: string; readonly revision: string; readonly renderProof: string }
  ];
};

export function KnowledgeHealthReadyResult(props: {
  readonly result: Extract<KnowledgeHealthRunResult, { readonly status: "ready" }>;
  readonly groupedIssues: readonly {
    readonly kind: KnowledgeHealthIssueKind;
    readonly issues: readonly KnowledgeHealthIssueSummary[];
  }[];
  readonly locale: Locale;
  readonly onOpenPage: (pageId: string) => Promise<void>;
  readonly onRepairIssue: (issue: RepairableBrokenLink) => Promise<void>;
  readonly onRetargetIssue: (issue: RepairableBrokenLink) => void;
  readonly onChooseOrphanParent: (issue: RepairableOrphan) => void;
  readonly onMergeDuplicateTopic: (issue: RepairableDuplicateTopic, trigger: HTMLButtonElement) => void;
  readonly repairState: KnowledgeHealthRepairState;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const resultDescription = props.result.counts.totalIssueCount === 0
    ? props.t("maintenance.knowledgeHealth.readyZero")
    : `${props.result.counts.totalIssueCount} ${props.t("maintenance.knowledgeHealth.issueCount")}`;
  const checkedAt = new Intl.DateTimeFormat(props.locale === "zh-Hans" ? "zh-CN" : props.locale, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(props.result.checkedAt));
  return (
    <>
      <div className="settings-row">
        <div className="settings-row-copy">
          <strong>{props.t("maintenance.knowledgeHealth.resultTitle")}</strong>
          <span>{resultDescription} · {props.t("maintenance.lastChecked")}: {checkedAt}</span>
        </div>
        <span className={props.result.coverage === "partial" || props.result.truncated
          ? "settings-status warning"
          : "settings-status"}
        >
          {props.t(props.result.coverage === "partial"
            ? "maintenance.knowledgeHealth.partial"
            : props.result.truncated
              ? "maintenance.knowledgeHealth.truncated"
              : "maintenance.knowledgeHealth.complete")}
        </span>
      </div>
      {props.result.coverage === "partial" ? (
        <div className="settings-row">
          <div className="settings-row-copy">
            <strong>{props.t("maintenance.knowledgeHealth.partialTitle")}</strong>
            <span>{props.result.invalidPageCount} {props.t("maintenance.knowledgeHealth.invalidPageCount")}</span>
          </div>
        </div>
      ) : null}
      {props.result.truncated ? (
        <div className="settings-row">
          <div className="settings-row-copy">
            <strong>{props.t("maintenance.knowledgeHealth.truncatedTitle")}</strong>
            <span>{props.t("maintenance.knowledgeHealth.truncatedDescription")}</span>
          </div>
        </div>
      ) : null}
      {props.groupedIssues.map((group) => (
        <div key={group.kind} className="settings-row tall">
          <div className="settings-row-copy">
            <strong>{props.t(`maintenance.knowledgeHealth.kind.${group.kind}`)}</strong>
            {group.issues.map((issue) => (
              <KnowledgeHealthIssueRow
                key={knowledgeHealthIssueKey(issue)}
                issue={issue}
                onOpenPage={props.onOpenPage}
                onRepairIssue={props.onRepairIssue}
                onRetargetIssue={props.onRetargetIssue}
                onChooseOrphanParent={props.onChooseOrphanParent}
                onMergeDuplicateTopic={props.onMergeDuplicateTopic}
                repairState={props.repairState}
                t={props.t}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function KnowledgeHealthIssueRow(props: {
  readonly issue: KnowledgeHealthIssueSummary;
  readonly onOpenPage: (pageId: string) => Promise<void>;
  readonly onRepairIssue: (issue: RepairableBrokenLink) => Promise<void>;
  readonly onRetargetIssue: (issue: RepairableBrokenLink) => void;
  readonly onChooseOrphanParent: (issue: RepairableOrphan) => void;
  readonly onMergeDuplicateTopic: (issue: RepairableDuplicateTopic, trigger: HTMLButtonElement) => void;
  readonly repairState: KnowledgeHealthRepairState;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  if (props.issue.kind === "duplicate_topic") {
    const repairable = props.issue.repairContextId && props.issue.pageProofs?.length === 2 &&
      props.issue.candidatePageCount === 2 && props.issue.pages.length === 2
      ? props.issue as RepairableDuplicateTopic
      : null;
    return (
      <span>
        {props.issue.pages.map((page, index) => (
          <span key={page.pageId}>
            {index > 0 ? " · " : ""}
            <button className="settings-button" type="button" onClick={() => void props.onOpenPage(page.pageId)}>
              {page.title}
            </button>
          </span>
        ))}
        {props.issue.candidatePageCount > props.issue.pages.length
          ? ` · +${props.issue.candidatePageCount - props.issue.pages.length}`
          : ""}
        {repairable ? (
          <>
            {" · "}
            <button className="settings-button" type="button"
              disabled={props.repairState?.kind === "repairing"}
              onClick={(event) => props.onMergeDuplicateTopic(repairable, event.currentTarget)}>
              {props.t("maintenance.knowledgeHealth.mergeDuplicateTopic")}
            </button>
          </>
        ) : null}
      </span>
    );
  }
  const detail = props.issue.kind === "broken_link"
    ? ` · ${props.issue.unresolvedLinkCount} ${props.t("maintenance.knowledgeHealth.unresolvedLinks")}`
    : "";
  const page = props.issue.page;
  const issueKey = knowledgeHealthIssueKey(props.issue);
  const repairableIssue = props.issue.kind === "broken_link" && props.issue.repairContextId &&
    props.issue.sourceRevision && props.issue.sourceRenderProof && props.issue.occurrenceId
    ? props.issue as RepairableBrokenLink
    : null;
  const repairableOrphan = props.issue.kind === "orphan_page" && props.issue.repairContextId &&
    props.issue.targetRevision && props.issue.targetRenderProof
    ? props.issue as RepairableOrphan
    : null;
  return (
    <span>
      <button className="settings-button" type="button" onClick={() => void props.onOpenPage(page.pageId)}>
        {page.title}
      </button>
      {detail}
      {repairableIssue ? (
        <>
          {" · "}
          <button className="settings-button" type="button" disabled={props.repairState?.kind === "repairing"}
            onClick={() => props.onRetargetIssue(repairableIssue)}>
            {props.t("maintenance.knowledgeHealth.retarget")}
          </button>
          {" · "}
          <button className="settings-button" type="button" disabled={props.repairState?.kind === "repairing"}
            onClick={() => void props.onRepairIssue(repairableIssue)}>
            {props.t(props.repairState?.kind === "repairing" && props.repairState.issueKey === issueKey
              ? "maintenance.knowledgeHealth.repairing"
              : "maintenance.knowledgeHealth.removeBrokenLink")}
          </button>
        </>
      ) : null}
      {repairableOrphan ? (
        <>
          {" · "}
          <button className="settings-button" type="button" disabled={props.repairState?.kind === "repairing"}
            onClick={() => props.onChooseOrphanParent(repairableOrphan)}>
            {props.t("maintenance.knowledgeHealth.chooseOrphanParent")}
          </button>
        </>
      ) : null}
    </span>
  );
}

export function knowledgeHealthIssueKey(issue: KnowledgeHealthIssueSummary): string {
  return issue.kind === "duplicate_topic"
    ? `${issue.kind}:${issue.pages.map(({ pageId }) => pageId).join(":")}`
    : `${issue.kind}:${issue.page.pageId}`;
}
