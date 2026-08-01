const DATASET_RELATION_HOP_TOOL_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    relation: { type: "string", pattern: "^column_[1-9][0-9]*$" },
    targetTable: { type: "string", pattern: "^table_[1-9][0-9]*$" }
  },
  required: ["relation", "targetTable"],
  additionalProperties: false
});

/** Shared JSON Schema fragment for at most two model-facing Dataset relation hops. */
export const DATASET_RELATION_JOIN_TOOL_SCHEMA = Object.freeze({
  ...DATASET_RELATION_HOP_TOOL_SCHEMA,
  properties: {
    ...DATASET_RELATION_HOP_TOOL_SCHEMA.properties,
    next: DATASET_RELATION_HOP_TOOL_SCHEMA
  }
});
