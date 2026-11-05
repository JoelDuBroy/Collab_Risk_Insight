import type {
  ContributorStat,
  InsightsResponse,
  Reconciliation,
  RepoSnapshot,
  ReviewerStat,
} from "../types.js";

const METRIC = {
  id: "collaboration_risk_digest",
  name: "Collaboration Risk Digest",
  description:
    "A multi-signal digest of who ships, who reviews, how concentrated that work is, and how long PRs take to land — over a chosen lookback window.",
  why:
    "Single leaderboards hide delivery risk. Pairing contribution volume with review concentration, bus factor, and cycle-time shape surfaces whether a team can keep shipping if one person is out — the kind of planning signal Tempo’s intelligence layer cares about.",
} as const;

export function computeInsights(snapshot: RepoSnapshot, days: number): InsightsResponse {
  const commitsByUser = countBy(
    snapshot.commits
      .map((c) => normalizeLogin(c.authorLogin))
      .filter((login): login is string => Boolean(login)),
  );

  // Opened vs merged are distinct windows on the same pull set.
  const openedPrs = snapshot.pulls.filter((p) => inWindow(p.createdAt, snapshot));
  const mergedPrs = snapshot.pulls.filter(
    (p) => Boolean(p.mergedAt) && inWindow(p.mergedAt as string, snapshot),
  );

  const mergedByUser = countBy(
    mergedPrs
      .map((p) => normalizeLogin(p.userLogin))
      .filter((login): login is string => Boolean(login)),
  );

  const linesByUser = new Map<string, { additions: number; deletions: number }>();
  for (const pull of mergedPrs) {
    const login = normalizeLogin(pull.userLogin);
    if (!login) continue;
    const current = linesByUser.get(login) ?? { additions: 0, deletions: 0 };
    current.additions += pull.additions;
    current.deletions += pull.deletions;
    linesByUser.set(login, current);
  }

  const logins = new Set<string>([
    ...commitsByUser.keys(),
    ...mergedByUser.keys(),
    ...linesByUser.keys(),
  ]);

  const allContributors: ContributorStat[] = [...logins]
    .map((login) => {
      const commits = commitsByUser.get(login) ?? 0;
      const prsMerged = mergedByUser.get(login) ?? 0;
      const lines = linesByUser.get(login) ?? { additions: 0, deletions: 0 };
      const linesChanged = lines.additions + lines.deletions;
      const score = commits + prsMerged * 2 + Math.log1p(linesChanged);
      return {
        login,
        commits,
        prsMerged,
        additions: lines.additions,
        deletions: lines.deletions,
        score: round(score, 2),
      };
    })
    .sort((a, b) => b.score - a.score || b.commits - a.commits);

  const topContributors = allContributors.slice(0, 10);

  const reviewerMap = new Map<string, ReviewerStat>();
  for (const review of snapshot.reviews) {
    const login = normalizeLogin(review.reviewerLogin);
    if (!login) continue;
    const current = reviewerMap.get(login) ?? {
      login,
      reviews: 0,
      approvals: 0,
      changesRequested: 0,
      comments: 0,
    };
    current.reviews += 1;
    if (review.state === "APPROVED") current.approvals += 1;
    if (review.state === "CHANGES_REQUESTED") current.changesRequested += 1;
    if (review.state === "COMMENTED") current.comments += 1;
    reviewerMap.set(login, current);
  }

  const allReviewers = [...reviewerMap.values()].sort(
    (a, b) => b.reviews - a.reviews || b.approvals - a.approvals,
  );
  const topReviewers = allReviewers.slice(0, 10);

  const cycleHours = mergedPrs
    .map((pull) => {
      if (!pull.mergedAt) return null;
      const hours =
        (new Date(pull.mergedAt).getTime() - new Date(pull.createdAt).getTime()) /
        3_600_000;
      return hours >= 0 ? hours : null;
    })
    .filter((value): value is number => value != null);

  const medianPrCycleHours =
    cycleHours.length > 0 ? round(median(cycleHours), 1) : null;

  const cycleTimeDistribution = [
    { label: "<4h", count: cycleHours.filter((h) => h < 4).length },
    { label: "4–24h", count: cycleHours.filter((h) => h >= 4 && h < 24).length },
    { label: "1–3d", count: cycleHours.filter((h) => h >= 24 && h < 72).length },
    { label: "3–7d", count: cycleHours.filter((h) => h >= 72 && h < 168).length },
    { label: ">7d", count: cycleHours.filter((h) => h >= 168).length },
  ];

  // Use FULL distributions (not the top-10 slice) so concentration math stays correct.
  const commitCountsDesc = [...commitsByUser.values()].sort((a, b) => b - a);
  const reviewCountsDesc = allReviewers.map((r) => r.reviews);
  const busFactor = computeBusFactor(commitCountsDesc);
  const reviewConcentrationTop2 = computeTopShare(reviewCountsDesc, 2);

  const authorReviewerAsymmetry = buildAsymmetry(mergedByUser, reviewerMap);

  const humanCommits = [...commitsByUser.values()].reduce((sum, n) => sum + n, 0);
  const humanReviews = reviewCountsDesc.reduce((sum, n) => sum + n, 0);

  const summary = {
    commits: humanCommits,
    prsOpened: openedPrs.length,
    prsMerged: mergedPrs.length,
    reviews: humanReviews,
    issuesClosed: snapshot.issues.length,
    activeContributors: logins.size,
    activeReviewers: reviewerMap.size,
    medianPrCycleHours,
    busFactor,
    reviewConcentrationTop2: round(reviewConcentrationTop2, 3),
  };

  const signals = buildSignals({
    summary,
    topContributors,
    topReviewers,
    cycleTimeDistribution,
    authorReviewerAsymmetry,
  });

  const reconciliation = buildReconciliation({
    humanCommits,
    humanReviews,
    mergedPrs: mergedPrs.length,
    cycleHours: cycleHours.length,
    cycleTimeDistribution,
    allContributors,
    allReviewers,
    commitsByUser,
    reviewerMap,
  });

  return {
    owner: snapshot.owner,
    repo: snapshot.repo,
    period: {
      days,
      since: snapshot.since,
      until: snapshot.until,
    },
    metric: { ...METRIC },
    summary,
    topContributors,
    topReviewers,
    authorReviewerAsymmetry,
    cycleTimeDistribution,
    signals,
    reconciliation,
    fetchLimits: snapshot.fetchLimits ?? {
      maxPagesPerResource: 5,
      maxPullsForReviews: 40,
      reviewConcurrency: 4,
      truncatedCommits: false,
      truncatedPulls: false,
      truncatedIssues: false,
      truncatedReviews: false,
      githubRequests: 0,
    },
    cached: false,
    fetchedAt: snapshot.fetchedAt,
  };
}

function buildReconciliation(input: {
  humanCommits: number;
  humanReviews: number;
  mergedPrs: number;
  cycleHours: number;
  cycleTimeDistribution: InsightsResponse["cycleTimeDistribution"];
  allContributors: ContributorStat[];
  allReviewers: ReviewerStat[];
  commitsByUser: Map<string, number>;
  reviewerMap: Map<string, ReviewerStat>;
}): Reconciliation {
  const contributorCommitSum = input.allContributors.reduce(
    (sum, row) => sum + row.commits,
    0,
  );
  const reviewerReviewSum = input.allReviewers.reduce(
    (sum, row) => sum + row.reviews,
    0,
  );
  const bucketSum = input.cycleTimeDistribution.reduce(
    (sum, bucket) => sum + bucket.count,
    0,
  );
  const mapCommitSum = [...input.commitsByUser.values()].reduce(
    (sum, n) => sum + n,
    0,
  );
  const mapReviewSum = [...input.reviewerMap.values()].reduce(
    (sum, row) => sum + row.reviews,
    0,
  );

  const checks = [
    check("commits_vs_contributor_rows", input.humanCommits, contributorCommitSum),
    check("commits_vs_login_map", input.humanCommits, mapCommitSum),
    check("reviews_vs_reviewer_rows", input.humanReviews, reviewerReviewSum),
    check("reviews_vs_login_map", input.humanReviews, mapReviewSum),
    check("cycle_buckets_vs_merged_with_timing", input.cycleHours, bucketSum),
    // Every timed merge is a merged PR; untimed merges are impossible with valid dates.
    check("timed_merges_lte_merged_prs", input.cycleHours, input.mergedPrs, "lte"),
  ];

  return {
    ok: checks.every((c) => c.ok),
    checks,
  };
}

function check(
  name: string,
  expected: number,
  actual: number,
  mode: "eq" | "lte" = "eq",
) {
  const ok = mode === "eq" ? expected === actual : expected <= actual;
  return { name, expected, actual, ok };
}

function buildAsymmetry(
  mergedByUser: Map<string, number>,
  reviewerMap: Map<string, ReviewerStat>,
) {
  const people = new Set([...mergedByUser.keys(), ...reviewerMap.keys()]);
  return [...people]
    .map((login) => {
      const authoredMergedPrs = mergedByUser.get(login) ?? 0;
      const reviewsGiven = reviewerMap.get(login)?.reviews ?? 0;
      let asymmetry: "heavy_author" | "heavy_reviewer" | "balanced" = "balanced";
      if (authoredMergedPrs >= 3 && reviewsGiven === 0) asymmetry = "heavy_author";
      else if (reviewsGiven >= 5 && authoredMergedPrs === 0) asymmetry = "heavy_reviewer";
      else if (authoredMergedPrs >= reviewsGiven * 3 && authoredMergedPrs >= 3) {
        asymmetry = "heavy_author";
      } else if (reviewsGiven >= authoredMergedPrs * 3 && reviewsGiven >= 5) {
        asymmetry = "heavy_reviewer";
      }
      return { login, authoredMergedPrs, reviewsGiven, asymmetry };
    })
    .filter((row) => row.asymmetry !== "balanced")
    .sort(
      (a, b) =>
        b.authoredMergedPrs +
        b.reviewsGiven -
        (a.authoredMergedPrs + a.reviewsGiven),
    )
    .slice(0, 8);
}

function buildSignals(input: {
  summary: InsightsResponse["summary"];
  topContributors: ContributorStat[];
  topReviewers: ReviewerStat[];
  cycleTimeDistribution: InsightsResponse["cycleTimeDistribution"];
  authorReviewerAsymmetry: InsightsResponse["authorReviewerAsymmetry"];
}): InsightsResponse["signals"] {
  const signals: InsightsResponse["signals"] = [];
  const { summary, topContributors, topReviewers, cycleTimeDistribution, authorReviewerAsymmetry } =
    input;

  if (summary.busFactor > 0 && summary.busFactor <= 2 && summary.commits >= 5) {
    signals.push({
      id: "low_bus_factor",
      severity: summary.commits >= 10 ? "risk" : "watch",
      title: "Low bus factor on commits",
      detail: `Only ${summary.busFactor} contributor(s) account for ≥50% of commits in this window.`,
      evidence: {
        busFactor: summary.busFactor,
        commits: summary.commits,
        topLogin: topContributors[0]?.login ?? null,
        topCommits: topContributors[0]?.commits ?? 0,
      },
    });
  }

  // Require ≥3 distinct reviewers before calling concentration a bottleneck;
  // with only 2 people, top-2 share is tautologically 100%.
  if (
    summary.reviewConcentrationTop2 >= 0.65 &&
    summary.reviews >= 3 &&
    summary.activeReviewers >= 3
  ) {
    signals.push({
      id: "review_bottleneck",
      severity: summary.reviewConcentrationTop2 >= 0.8 ? "risk" : "watch",
      title: "Review load is highly concentrated",
      detail: `Top 2 reviewers handled ${pct(summary.reviewConcentrationTop2)} of reviews.`,
      evidence: {
        reviewConcentrationTop2: summary.reviewConcentrationTop2,
        reviews: summary.reviews,
        activeReviewers: summary.activeReviewers,
        topReviewer: topReviewers[0]?.login ?? null,
        topReviewerCount: topReviewers[0]?.reviews ?? 0,
      },
    });
  }

  const slow = cycleTimeDistribution.find((b) => b.label === ">7d")?.count ?? 0;
  if (slow > 0 && summary.prsMerged >= 2) {
    const share = slow / summary.prsMerged;
    signals.push({
      id: "slow_merge_tail",
      severity: share >= 0.25 ? "risk" : "watch",
      title: "Long-tail PR cycle time",
      detail: `${slow} merged PR(s) took more than 7 days (${pct(share)} of merges).`,
      evidence: {
        slowMerges: slow,
        prsMerged: summary.prsMerged,
        medianPrCycleHours: summary.medianPrCycleHours,
      },
    });
  }

  if (
    summary.medianPrCycleHours != null &&
    summary.medianPrCycleHours >= 72 &&
    summary.prsMerged >= 2
  ) {
    signals.push({
      id: "elevated_median_cycle",
      severity: summary.medianPrCycleHours >= 168 ? "risk" : "watch",
      title: "Elevated median PR cycle time",
      detail: `Median open→merge time is ${summary.medianPrCycleHours} hours.`,
      evidence: {
        medianPrCycleHours: summary.medianPrCycleHours,
        prsMerged: summary.prsMerged,
      },
    });
  }

  const heavyAuthors = authorReviewerAsymmetry.filter((a) => a.asymmetry === "heavy_author");
  if (heavyAuthors.length > 0) {
    signals.push({
      id: "author_review_asymmetry",
      severity: "watch",
      title: "Authors rarely review",
      detail: `${heavyAuthors.length} active author(s) merge often but give few reviews — review debt may accumulate.`,
      evidence: {
        heavyAuthors: heavyAuthors.length,
        example: heavyAuthors[0]?.login ?? null,
        exampleAuthored: heavyAuthors[0]?.authoredMergedPrs ?? 0,
        exampleReviews: heavyAuthors[0]?.reviewsGiven ?? 0,
      },
    });
  }

  if (signals.length === 0) {
    signals.push({
      id: "healthy_distribution",
      severity: "info",
      title: "No strong collaboration risk flags",
      detail:
        "Contribution and review activity look reasonably distributed for this window.",
      evidence: {
        activeContributors: summary.activeContributors,
        activeReviewers: summary.activeReviewers,
        medianPrCycleHours: summary.medianPrCycleHours,
      },
    });
  }

  return signals;
}

function computeBusFactor(commitCountsDesc: number[]): number {
  const total = commitCountsDesc.reduce((sum, n) => sum + n, 0);
  if (total === 0) return 0;
  let covered = 0;
  let people = 0;
  for (const count of commitCountsDesc) {
    covered += count;
    people += 1;
    if (covered / total >= 0.5) return people;
  }
  return people;
}

function computeTopShare(valuesDesc: number[], topN: number): number {
  const total = valuesDesc.reduce((sum, n) => sum + n, 0);
  if (total === 0) return 0;
  const top = valuesDesc.slice(0, topN).reduce((sum, n) => sum + n, 0);
  return top / total;
}

function countBy(values: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const value of values) {
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return map;
}

function normalizeLogin(login: string | null | undefined): string | null {
  if (!login) return null;
  const trimmed = login.trim();
  if (!trimmed) return null;
  if (isBotLogin(trimmed)) return null;
  return trimmed;
}

function isBotLogin(login: string): boolean {
  const lower = login.toLowerCase();
  return lower.endsWith("[bot]") || lower.endsWith("-bot") || lower === "dependabot";
}

function inWindow(iso: string, snapshot: RepoSnapshot): boolean {
  const t = new Date(iso).getTime();
  return t >= new Date(snapshot.since).getTime() && t <= new Date(snapshot.until).getTime();
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}
