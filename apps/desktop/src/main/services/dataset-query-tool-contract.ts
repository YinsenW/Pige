/** Shared JSON Schema fragment for the model-facing bounded Dataset relation join. */
export const DATASET_RELATION_JOIN_TOOL_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    relation: { type: "string", pattern: "^column_[1-9][0-9]*$" },
    targetTable: { type: "string", pattern: "^table_[1-9][0-9]*$" }
  },
  required: ["relation", "targetTable"],
  additionalProperties: false
});
