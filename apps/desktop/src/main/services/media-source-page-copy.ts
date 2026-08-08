export interface MediaSourcePageCopy {
  readonly summary: string;
  readonly keyPoint: string;
  readonly body: string;
}

const UNAVAILABLE_MEDIA_COPY: MediaSourcePageCopy = {
  summary: "Pige preserved this local media source without sending it to a model. Audio and video transcription are unavailable in this version.",
  keyPoint: "This media is waiting for a future local transcription capability and will not be sent to a model.",
  body: "No text preview is available. The local media source is preserved and waiting for a future transcription capability; Pige did not send it to a model."
};

export function mediaSourcePageCopy(metadata: Record<string, unknown>): MediaSourcePageCopy | undefined {
  return metadata.mediaTranscriptionStatus === "unavailable" ? UNAVAILABLE_MEDIA_COPY : undefined;
}
