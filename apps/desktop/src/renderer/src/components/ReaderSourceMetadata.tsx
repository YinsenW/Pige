import type { NoteSourceMetadataItem } from "@pige/schemas";

export function ReaderSourceMetadata(props: {
  readonly fallbackLabel: string;
  readonly metadata: NoteSourceMetadataItem | undefined;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const { metadata, t } = props;
  const detail = metadata?.status === "current"
    ? [
        t(`note.sourceCategory.${metadata.category}`),
        t(`note.sourceStorage.${metadata.storage}`),
        t(`note.sourceExtraction.${metadata.extraction}`),
      ].join(" · ")
    : t("note.sourceMetadataUnavailable");
  return <>
    <strong>{metadata?.status === "current" && metadata.displayName ? metadata.displayName : props.fallbackLabel}</strong>
    <span>{detail}</span>
  </>;
}
