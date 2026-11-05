import type {
  InsightsResponse,
  NarrativeEvidence,
  NarrativeResponse,
} from "../types.js";

type RawLlmNarrative = {
  narrative: string;
  hypothesis: string;
  confidence: number;
  evidence: NarrativeEvidence[];
};

/**
 * Evidence must point at digest numbers, not model inventions.
 * We rebuild `numbers` from known signals/summary and drop ungroundable rows.
 */
export function groundNarrative(
  insights: InsightsResponse,
  raw: RawLlmNarrative,
  meta: { model: string; provider: string },
): NarrativeResponse {
  const notes: string[] = [];
  const allowed = buildAllowedNumberIndex(insights);
  const groundedEvidence: NarrativeEvidence[] = [];

  for (const row of raw.evidence) {
    const signal = insights.signals.find((s) => s.id === row.signalId);
    if (signal) {
      groundedEvidence.push({
        signalId: signal.id,
        claim: row.claim.trim() || signal.detail,
        numbers: { ...signal.evidence },
      });
      continue;
    }

    const filteredNumbers: Record<string, number | string | null> = {};
    let invented = false;
    for (const [key, value] of Object.entries(row.numbers ?? {})) {
      if (value == null) {
        filteredNumbers[key] = null;
        continue;
      }
      const allowedValue = allowed.get(key);
      if (allowedValue === undefined) {
        invented = true;
        continue;
      }
      if (typeof value === "number" && typeof allowedValue === "number") {
        if (value !== allowedValue) {
          invented = true;
          filteredNumbers[key] = allowedValue;
        } else {
          filteredNumbers[key] = value;
        }
      } else if (String(value) === String(allowedValue)) {
        filteredNumbers[key] = value;
      } else {
        invented = true;
        filteredNumbers[key] = allowedValue;
      }
    }

    if (Object.keys(filteredNumbers).length === 0) {
      notes.push(`Dropped ungrounded evidence row signalId=${row.signalId}`);
      continue;
    }
    if (invented) {
      notes.push(`Rewrote numbers for signalId=${row.signalId} from digest`);
    }
    groundedEvidence.push({
      signalId: row.signalId,
      claim: row.claim.trim(),
      numbers: filteredNumbers,
    });
  }

  if (groundedEvidence.length === 0) {
    notes.push("Model evidence empty/ungrounded; using digest signals");
    for (const signal of insights.signals.slice(0, 3)) {
      groundedEvidence.push({
        signalId: signal.id,
        claim: signal.detail,
        numbers: { ...signal.evidence },
      });
    }
  }

  let confidence = clamp01(raw.confidence);
  if (notes.length > 0) {
    confidence = Math.min(confidence, 0.7);
  }
  if (!insights.reconciliation.ok) {
    notes.push("Digest reconciliation failed; confidence capped");
    confidence = Math.min(confidence, 0.4);
  }
  if (
    insights.fetchLimits.truncatedCommits ||
    insights.fetchLimits.truncatedPulls ||
    insights.fetchLimits.truncatedReviews
  ) {
    notes.push("Upstream fetch truncated; confidence capped");
    confidence = Math.min(confidence, 0.65);
  }

  return {
    owner: insights.owner,
    repo: insights.repo,
    periodDays: insights.period.days,
    narrative: raw.narrative.trim(),
    hypothesis: raw.hypothesis.trim(),
    confidence: round(confidence, 2),
    evidence: groundedEvidence,
    evidenceGrounded: true,
    groundingNotes: notes,
    model: meta.model,
    provider: meta.provider,
    insightsFetchedAt: insights.fetchedAt,
  };
}

function buildAllowedNumberIndex(
  insights: InsightsResponse,
): Map<string, number | string | null> {
  const map = new Map<string, number | string | null>();
  for (const [key, value] of Object.entries(insights.summary)) {
    map.set(key, value as number | string | null);
  }
  for (const signal of insights.signals) {
    for (const [key, value] of Object.entries(signal.evidence)) {
      map.set(key, value);
      map.set(`${signal.id}.${key}`, value);
    }
  }
  for (const row of insights.topContributors) {
    map.set(`contributor.${row.login}.commits`, row.commits);
    map.set(`contributor.${row.login}.prsMerged`, row.prsMerged);
    map.set(`contributor.${row.login}.score`, row.score);
  }
  for (const row of insights.topReviewers) {
    map.set(`reviewer.${row.login}.reviews`, row.reviews);
    map.set(`reviewer.${row.login}.approvals`, row.approvals);
  }
  return map;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
