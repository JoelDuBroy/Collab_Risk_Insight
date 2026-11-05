export type ContributorStat = {
  login: string;
  commits: number;
  prsMerged: number;
  additions: number;
  deletions: number;
  /** Weighted score: commits + 2*prsMerged + log1p(linesChanged) */
  score: number;
};

export type ReviewerStat = {
  login: string;
  reviews: number;
  approvals: number;
  changesRequested: number;
  comments: number;
};

export type CycleTimeBucket = {
  label: string;
  count: number;
};

/** Machine-checkable proof that aggregates still match the snapshot rows. */
export type Reconciliation = {
  ok: boolean;
  checks: Array<{
    name: string;
    expected: number;
    actual: number;
    ok: boolean;
  }>;
};

export type FetchLimits = {
  maxPagesPerResource: number;
  maxPullsForReviews: number;
  reviewConcurrency: number;
  truncatedCommits: boolean;
  truncatedPulls: boolean;
  truncatedIssues: boolean;
  truncatedReviews: boolean;
  githubRequests: number;
};

export type InsightsResponse = {
  owner: string;
  repo: string;
  period: {
    days: number;
    since: string;
    until: string;
  };
  metric: {
    id: string;
    name: string;
    description: string;
    why: string;
  };
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
  topContributors: ContributorStat[];
  topReviewers: ReviewerStat[];
  authorReviewerAsymmetry: Array<{
    login: string;
    authoredMergedPrs: number;
    reviewsGiven: number;
    asymmetry: "heavy_author" | "heavy_reviewer" | "balanced";
  }>;
  cycleTimeDistribution: CycleTimeBucket[];
  signals: Array<{
    id: string;
    severity: "info" | "watch" | "risk";
    title: string;
    detail: string;
    evidence: Record<string, number | string | null>;
  }>;
  reconciliation: Reconciliation;
  fetchLimits: FetchLimits;
  cached: boolean;
  fetchedAt: string;
};

export type NarrativeEvidence = {
  signalId: string;
  claim: string;
  numbers: Record<string, number | string | null>;
};

export type NarrativeResponse = {
  owner: string;
  repo: string;
  periodDays: number;
  narrative: string;
  hypothesis: string;
  confidence: number;
  evidence: NarrativeEvidence[];
  /** True when evidence numbers were rewritten from the digest (not trusted from the model). */
  evidenceGrounded: boolean;
  groundingNotes: string[];
  model: string;
  provider: string;
  insightsFetchedAt: string;
};

export type GithubCommit = {
  sha: string;
  authorLogin: string | null;
  date: string | null;
};

export type GithubPull = {
  number: number;
  userLogin: string | null;
  state: string;
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  additions: number;
  deletions: number;
};

export type GithubReview = {
  pullNumber: number;
  reviewerLogin: string | null;
  state: string;
  submittedAt: string | null;
};

export type GithubIssue = {
  number: number;
  userLogin: string | null;
  state: string;
  closedAt: string | null;
  pullRequest: boolean;
};

export type RepoSnapshot = {
  owner: string;
  repo: string;
  defaultBranch: string;
  since: string;
  until: string;
  commits: GithubCommit[];
  pulls: GithubPull[];
  reviews: GithubReview[];
  issues: GithubIssue[];
  fetchLimits: FetchLimits;
  fetchedAt: string;
};
