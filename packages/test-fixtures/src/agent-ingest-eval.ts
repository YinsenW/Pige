import { AgentIngestOutputSchema, type AgentIngestOutput } from "@pige/schemas";

export interface AgentIngestExpectedClaim {
  readonly text: string;
  readonly allowedEvidenceRefs: readonly string[];
  readonly requiredEvidenceTerms: readonly string[];
}

export interface AgentIngestFixtureEvidence {
  readonly ref: string;
  readonly text: string;
  readonly locator?: string;
  readonly confidence?: number;
}

export interface AgentIngestGoldenFixture {
  readonly id: string;
  readonly locale: string;
  readonly input: {
    readonly kind: "text" | "url" | "pdf" | "pptx" | "ocr";
    readonly text: string;
    readonly evidence: readonly AgentIngestFixtureEvidence[];
    readonly quality?: {
      readonly ocrConfidence?: number;
    };
  };
  readonly modelOutput: unknown;
  readonly expected: {
    readonly claims: readonly AgentIngestExpectedClaim[];
    readonly citationLocators: readonly string[];
    readonly languagePattern: string;
    readonly reviewRequired: boolean;
  };
}

export interface AgentIngestEvalMetrics {
  readonly schemaValidRate: number;
  readonly citationCoverage: number;
  readonly unsupportedClaimCount: number;
  readonly expectedClaimRecall: number;
  readonly languagePolicyMatch: number;
}

export interface AgentIngestEvalResult {
  readonly output?: AgentIngestOutput;
  readonly metrics: AgentIngestEvalMetrics;
  readonly errors: readonly string[];
}

export function evaluateAgentIngestFixture(
  fixture: AgentIngestGoldenFixture,
  candidateOutput: unknown = fixture.modelOutput
): AgentIngestEvalResult {
  const parsed = AgentIngestOutputSchema.safeParse(candidateOutput);
  if (!parsed.success) {
    return {
      metrics: {
        schemaValidRate: 0,
        citationCoverage: 0,
        unsupportedClaimCount: fixture.expected.claims.length,
        expectedClaimRecall: 0,
        languagePolicyMatch: 0
      },
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "output"}: ${issue.message}`)
    };
  }

  const output = parsed.data;
  const statements = [output.summary, ...output.keyPoints];
  const evidenceByRef = new Map(fixture.input.evidence.map((evidence) => [evidence.ref, evidence.text]));
  const availableRefs = new Set(evidenceByRef.keys());
  const expectedByText = new Map(fixture.expected.claims.map((claim) => [claim.text, claim]));
  const citedStatements = statements.filter((statement) =>
    statement.evidenceRefs.length > 0 && statement.evidenceRefs.every((ref) => availableRefs.has(ref))
  ).length;
  const unsupportedClaimCount = statements.filter((statement) => {
    const expected = expectedByText.get(statement.text);
    if (!expected) return true;
    if (statement.evidenceRefs.length === 0) return true;
    const allowed = new Set(expected.allowedEvidenceRefs);
    if (statement.evidenceRefs.some((ref) => !allowed.has(ref) || !availableRefs.has(ref))) return true;
    const citedEvidence = normalizeEvidenceText(statement.evidenceRefs
      .map((ref) => evidenceByRef.get(ref) ?? "")
      .join("\n"));
    return expected.requiredEvidenceTerms.some((term) => !citedEvidence.includes(normalizeEvidenceText(term)));
  }).length;
  const expectedClaimRecall = fixture.expected.claims.length === 0
    ? 1
    : fixture.expected.claims.filter((claim) => statements.some((statement) => statement.text === claim.text)).length /
      fixture.expected.claims.length;
  const languagePattern = new RegExp(fixture.expected.languagePattern, "u");
  const languagePolicyMatch = statements.every((statement) => languagePattern.test(statement.text)) ? 1 : 0;

  return {
    output,
    metrics: {
      schemaValidRate: 1,
      citationCoverage: statements.length === 0 ? 1 : citedStatements / statements.length,
      unsupportedClaimCount,
      expectedClaimRecall,
      languagePolicyMatch
    },
    errors: []
  };
}

function normalizeEvidenceText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}
