export type RetrievalEvalConfidence = "grounded" | "limited" | "insufficient";

export interface RetrievalGoldenPage {
  readonly pageId: string;
  readonly pagePath: string;
  readonly title: string;
  readonly pageType: "note" | "source";
  readonly language: string;
  readonly body: string;
}

export interface RetrievalGoldenQuery {
  readonly id: string;
  readonly query: string;
  readonly locale: string;
  readonly limit: number;
  readonly expected: {
    readonly topPageId?: string;
    readonly requiredCitationPageIds: readonly string[];
    readonly allowedCitationPageIds: readonly string[];
    readonly knownDistractorPageIds: readonly string[];
    readonly confidence: RetrievalEvalConfidence;
    readonly warning?: string;
  };
}

export interface RetrievalGoldenRelatedCase {
  readonly id: string;
  readonly pageId: string;
  readonly expectedOutgoingPageIds: readonly string[];
  readonly expectedBacklinkPageIds: readonly string[];
}

export interface RetrievalGoldenFixture {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: string;
  readonly pages: readonly RetrievalGoldenPage[];
  readonly queries: readonly RetrievalGoldenQuery[];
  readonly relatedCases: readonly RetrievalGoldenRelatedCase[];
  readonly privateSentinels: readonly string[];
}

export interface RetrievalQueryObservation {
  readonly queryId: string;
  readonly topPageId?: string;
  readonly resultPageIds: readonly string[];
  readonly citationPageIds: readonly string[];
  readonly confidence: RetrievalEvalConfidence;
  readonly warnings: readonly string[];
}

export interface RetrievalRelatedObservation {
  readonly caseId: string;
  readonly outgoingPageIds: readonly string[];
  readonly backlinkPageIds: readonly string[];
}

export interface RetrievalEvalMetrics {
  readonly topResultAccuracy: number;
  readonly citationCoverage: number;
  readonly unsupportedCitationCount: number;
  readonly knownDistractorTop1Count: number;
  readonly relatedPageRecall: number;
  readonly insufficientEvidenceAccuracy: number;
}

export interface RetrievalEvalReport {
  readonly schemaVersion: 1;
  readonly fixtureId: string;
  readonly fixtureVersion: string;
  readonly metrics: RetrievalEvalMetrics;
  readonly queryCases: readonly {
    readonly id: string;
    readonly topPageId?: string;
    readonly resultPageIds: readonly string[];
    readonly citationPageIds: readonly string[];
    readonly confidence: RetrievalEvalConfidence;
    readonly warnings: readonly string[];
  }[];
  readonly relatedCases: readonly {
    readonly id: string;
    readonly outgoingPageIds: readonly string[];
    readonly backlinkPageIds: readonly string[];
  }[];
}

export interface RetrievalEvalResult {
  readonly metrics: RetrievalEvalMetrics;
  readonly report: RetrievalEvalReport;
  readonly errors: readonly string[];
}

export function evaluateRetrievalGoldenFixture(
  fixture: RetrievalGoldenFixture,
  queryObservations: readonly RetrievalQueryObservation[],
  relatedObservations: readonly RetrievalRelatedObservation[]
): RetrievalEvalResult {
  const queryById = uniqueById(queryObservations, (observation) => observation.queryId, "query observation");
  const relatedById = uniqueById(relatedObservations, (observation) => observation.caseId, "related observation");
  const errors: string[] = [];
  let correctTopResults = 0;
  let expectedTopResults = 0;
  let requiredCitationCount = 0;
  let presentCitationCount = 0;
  let unsupportedCitationCount = 0;
  let knownDistractorTop1Count = 0;
  let insufficientCaseCount = 0;
  let correctInsufficientCases = 0;

  for (const query of fixture.queries) {
    const observation = queryById.get(query.id);
    if (!observation) {
      errors.push(`${query.id}: missing query observation`);
      continue;
    }
    const expected = query.expected;
    if (expected.topPageId) {
      expectedTopResults += 1;
      if (observation.topPageId === expected.topPageId) correctTopResults += 1;
      else errors.push(`${query.id}: unexpected top page ${observation.topPageId ?? "none"}`);
    }

    const citations = new Set(observation.citationPageIds);
    requiredCitationCount += expected.requiredCitationPageIds.length;
    for (const pageId of expected.requiredCitationPageIds) {
      if (citations.has(pageId)) presentCitationCount += 1;
      else errors.push(`${query.id}: missing required citation ${pageId}`);
    }
    const allowedCitations = new Set(expected.allowedCitationPageIds);
    for (const pageId of citations) {
      if (!allowedCitations.has(pageId)) {
        unsupportedCitationCount += 1;
        errors.push(`${query.id}: unsupported citation ${pageId}`);
      }
    }
    if (observation.topPageId && expected.knownDistractorPageIds.includes(observation.topPageId)) {
      knownDistractorTop1Count += 1;
      errors.push(`${query.id}: known distractor ranked first`);
    }
    if (observation.confidence !== expected.confidence) {
      errors.push(`${query.id}: expected ${expected.confidence} confidence, received ${observation.confidence}`);
    }

    if (expected.confidence === "insufficient") {
      insufficientCaseCount += 1;
      const correct = observation.topPageId === undefined &&
        observation.citationPageIds.length === 0 &&
        (!expected.warning || observation.warnings.includes(expected.warning));
      if (correct) correctInsufficientCases += 1;
      else errors.push(`${query.id}: insufficient-evidence routing did not fail closed`);
    } else if (expected.warning && !observation.warnings.includes(expected.warning)) {
      errors.push(`${query.id}: missing warning ${expected.warning}`);
    }
  }

  let expectedRelatedCount = 0;
  let presentRelatedCount = 0;
  for (const relatedCase of fixture.relatedCases) {
    const observation = relatedById.get(relatedCase.id);
    if (!observation) {
      errors.push(`${relatedCase.id}: missing related-page observation`);
      continue;
    }
    const outgoing = new Set(observation.outgoingPageIds);
    const backlinks = new Set(observation.backlinkPageIds);
    expectedRelatedCount += relatedCase.expectedOutgoingPageIds.length + relatedCase.expectedBacklinkPageIds.length;
    for (const pageId of relatedCase.expectedOutgoingPageIds) {
      if (outgoing.has(pageId)) presentRelatedCount += 1;
      else errors.push(`${relatedCase.id}: missing outgoing page ${pageId}`);
    }
    for (const pageId of relatedCase.expectedBacklinkPageIds) {
      if (backlinks.has(pageId)) presentRelatedCount += 1;
      else errors.push(`${relatedCase.id}: missing backlink page ${pageId}`);
    }
  }

  for (const observation of queryObservations) {
    if (!fixture.queries.some((query) => query.id === observation.queryId)) {
      errors.push(`${observation.queryId}: unexpected query observation`);
    }
  }
  for (const observation of relatedObservations) {
    if (!fixture.relatedCases.some((relatedCase) => relatedCase.id === observation.caseId)) {
      errors.push(`${observation.caseId}: unexpected related observation`);
    }
  }

  const metrics: RetrievalEvalMetrics = {
    topResultAccuracy: ratio(correctTopResults, expectedTopResults),
    citationCoverage: ratio(presentCitationCount, requiredCitationCount),
    unsupportedCitationCount,
    knownDistractorTop1Count,
    relatedPageRecall: ratio(presentRelatedCount, expectedRelatedCount),
    insufficientEvidenceAccuracy: ratio(correctInsufficientCases, insufficientCaseCount)
  };
  const report: RetrievalEvalReport = {
    schemaVersion: 1,
    fixtureId: fixture.id,
    fixtureVersion: fixture.version,
    metrics,
    queryCases: fixture.queries.flatMap((query) => {
      const observation = queryById.get(query.id);
      return observation ? [{
        id: query.id,
        ...(observation.topPageId ? { topPageId: observation.topPageId } : {}),
        resultPageIds: [...observation.resultPageIds],
        citationPageIds: [...observation.citationPageIds],
        confidence: observation.confidence,
        warnings: [...observation.warnings]
      }] : [];
    }),
    relatedCases: fixture.relatedCases.flatMap((relatedCase) => {
      const observation = relatedById.get(relatedCase.id);
      return observation ? [{
        id: relatedCase.id,
        outgoingPageIds: [...observation.outgoingPageIds],
        backlinkPageIds: [...observation.backlinkPageIds]
      }] : [];
    })
  };

  return { metrics, report, errors };
}

function uniqueById<T>(values: readonly T[], getId: (value: T) => string, label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = getId(value);
    if (result.has(id)) throw new Error(`Duplicate ${label}: ${id}`);
    result.set(id, value);
  }
  return result;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : Number((numerator / denominator).toFixed(6));
}
