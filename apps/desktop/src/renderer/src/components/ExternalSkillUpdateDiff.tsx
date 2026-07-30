import type { SkillStagedSummary } from "@pige/contracts";

export function ExternalSkillUpdateDiff(props: {
  readonly staged: SkillStagedSummary;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const pureReview = props.staged.pureUpdateReview;
  if (pureReview) {
    const fileChanges = [
      ...pureReview.addedFiles.map((value) => `+ ${value}`),
      ...pureReview.removedFiles.map((value) => `− ${value}`),
      ...pureReview.changedFiles.map((value) => `~ ${value}`)
    ];
    return <div className="skill-registry-meta" data-pure-skill-update-diff="true"
      aria-label={props.t("skills.pureUpdateDiffTitle")}>
      <span>{`${props.t("skills.externalUpdatePreviousVersion")} · v${pureReview.previousVersion}`}</span>
      {fileChanges.length > 0
        ? fileChanges.map((value) => <span key={value}>{value}</span>)
        : <span>{props.t("skills.pureUpdateFilesUnchanged")}</span>}
      <span>{props.t(pureReview.finalEnabled ? "skills.pureUpdateRemainsEnabled" : "skills.pureUpdateRemainsDisabled")}</span>
    </div>;
  }
  const review = props.staged.externalUpdateReview;
  if (!review) return null;
  const capabilityChanges = [
    ...review.addedCapabilities.map((value) => `+ ${value}`),
    ...review.removedCapabilities.map((value) => `− ${value}`)
  ];
  const boundaryChanges = [
    ...review.addedDataBoundaries.map((value) => `+ ${props.t(`skills.boundary.${value}`)}`),
    ...review.removedDataBoundaries.map((value) => `− ${props.t(`skills.boundary.${value}`)}`)
  ];
  return <div className="skill-registry-meta" data-external-skill-update-diff="true"
    aria-label={props.t("skills.externalUpdateDiffTitle")}>
    <span>{`${props.t("skills.externalUpdatePreviousVersion")} · v${review.previousVersion}`}</span>
    {capabilityChanges.length > 0
      ? capabilityChanges.map((value) => <span key={value}>{value}</span>)
      : <span>{props.t("skills.externalUpdateCapabilitiesUnchanged")}</span>}
    {boundaryChanges.length > 0
      ? boundaryChanges.map((value) => <span key={value}>{value}</span>)
      : <span>{props.t("skills.externalUpdateBoundariesUnchanged")}</span>}
    <span>{props.t("skills.externalUpdateDisabledAfterInstall")}</span>
  </div>;
}
