import type { SkillStagedSummary } from "@pige/contracts";

export function ExternalSkillUpdateDiff(props: {
  readonly staged: SkillStagedSummary;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
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
