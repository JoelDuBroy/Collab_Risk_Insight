export type InsightsResponse = {
  owner: string;
  repo: string;
  period: { days: number; since: string; until: string };
  summary: {
    commits: number;
    prsOpened: number;
    prsMerged: number;
    reviews: number;
    issuesClosed: number;
    activeContributors: number;
    activeReviewers: number;
    medianPrCycleHours: number | null;
    busFactor: number;
    reviewConcentrationTop2: number;
  };
  topContributors: Array<{
    login: string;
    commits: number;
    prsMerged: number;
    score: number;
  }>;
  topReviewers: Array<{
    login: string;
    reviews: number;
    approvals: number;
    changesRequested: number;
  }>;
  signals: Array<{
    id: string;
    severity: "info" | "watch" | "risk";
    title: string;
    detail: string;
    evidence: Record<string, number | string | null>;
  }>;
  reconciliation?: { ok: boolean };
  fetchLimits?: {
    truncatedCommits: boolean;
    truncatedPulls: boolean;
    truncatedReviews: boolean;
    githubRequests: number;
  };
  cached: boolean;
  fetchedAt: string;
};

export type NarrativeResponse = {
  owner: string;
  repo: string;
  periodDays: number;
  narrative: string;
  hypothesis: string;
  confidence: number;
  evidence: Array<{
    signalId: string;
    claim: string;
    numbers: Record<string, number | string | null>;
  }>;
  evidenceGrounded?: boolean;
  groundingNotes?: string[];
  model: string;
  provider: string;
  insightsFetchedAt: string;
};
