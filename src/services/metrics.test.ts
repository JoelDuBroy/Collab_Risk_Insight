import assert from "node:assert/strict";
import { test } from "node:test";
import type { RepoSnapshot } from "../types.js";
import { computeInsights } from "./metrics.js";
import { groundNarrative } from "./grounding.js";

function fixture(): RepoSnapshot {
  return {
    owner: "acme",
    repo: "demo",
    defaultBranch: "main",
    since: "2026-10-01T00:00:00.000Z",
    until: "2026-11-01T00:00:00.000Z",
    commits: [
      { sha: "1", authorLogin: "alice", date: "2026-10-05T00:00:00.000Z" },
      { sha: "2", authorLogin: "alice", date: "2026-10-06T00:00:00.000Z" },
      { sha: "3", authorLogin: "bob", date: "2026-10-07T00:00:00.000Z" },
      { sha: "4", authorLogin: "dependabot[bot]", date: "2026-10-08T00:00:00.000Z" },
      { sha: "5", authorLogin: null, date: "2026-10-09T00:00:00.000Z" },
    ],
    pulls: [
      {
        number: 1,
        userLogin: "alice",
        state: "closed",
        createdAt: "2026-10-02T00:00:00.000Z",
        mergedAt: "2026-10-03T12:00:00.000Z",
        closedAt: "2026-10-03T12:00:00.000Z",
        additions: 0,
        deletions: 0,
      },
      {
        number: 2,
        userLogin: "bob",
        state: "closed",
        createdAt: "2026-10-04T00:00:00.000Z",
        mergedAt: "2026-10-20T00:00:00.000Z",
        closedAt: "2026-10-20T00:00:00.000Z",
        additions: 0,
        deletions: 0,
      },
      {
        number: 3,
        userLogin: "carol",
        state: "open",
        createdAt: "2026-10-10T00:00:00.000Z",
        mergedAt: null,
        closedAt: null,
        additions: 0,
        deletions: 0,
      },
    ],
    reviews: [
      {
        pullNumber: 1,
        reviewerLogin: "bob",
        state: "APPROVED",
        submittedAt: "2026-10-03T00:00:00.000Z",
      },
      {
        pullNumber: 2,
        reviewerLogin: "carol",
        state: "COMMENTED",
        submittedAt: "2026-10-15T00:00:00.000Z",
      },
      {
        pullNumber: 2,
        reviewerLogin: "dave",
        state: "APPROVED",
        submittedAt: "2026-10-16T00:00:00.000Z",
      },
      {
        pullNumber: 2,
        reviewerLogin: "copilot[bot]",
        state: "COMMENTED",
        submittedAt: "2026-10-16T01:00:00.000Z",
      },
    ],
    issues: [
      {
        number: 9,
        userLogin: "alice",
        state: "closed",
        closedAt: "2026-10-12T00:00:00.000Z",
        pullRequest: false,
      },
    ],
    fetchLimits: {
      maxPagesPerResource: 5,
      maxPullsForReviews: 40,
      reviewConcurrency: 4,
      truncatedCommits: false,
      truncatedPulls: false,
      truncatedIssues: false,
      truncatedReviews: false,
      githubRequests: 8,
    },
    fetchedAt: "2026-11-01T00:00:00.000Z",
  };
}

test("aggregates match snapshot rows (correctness)", () => {
  const insights = computeInsights(fixture(), 31);

  assert.equal(insights.summary.commits, 3); // alice×2 + bob×1; bots/null excluded
  assert.equal(insights.summary.prsOpened, 3);
  assert.equal(insights.summary.prsMerged, 2);
  assert.equal(insights.summary.reviews, 3); // bot review excluded
  assert.equal(insights.summary.issuesClosed, 1);
  assert.equal(insights.reconciliation.ok, true);

  const alice = insights.topContributors.find((c) => c.login === "alice");
  assert.ok(alice);
  assert.equal(alice.commits, 2);
  assert.equal(alice.prsMerged, 1);

  const bucketSum = insights.cycleTimeDistribution.reduce((s, b) => s + b.count, 0);
  assert.equal(bucketSum, 2);
});

test("bus factor uses full commit distribution, not top-10 slice", () => {
  const insights = computeInsights(fixture(), 31);
  // alice has 2/3 commits → bus factor 1
  assert.equal(insights.summary.busFactor, 1);
});

test("LLM evidence is rewritten from digest numbers (AI grounding)", () => {
  const insights = computeInsights(fixture(), 31);
  const grounded = groundNarrative(
    insights,
    {
      narrative: "Something interesting happened.",
      hypothesis: "Maybe review bottleneck.",
      confidence: 0.95,
      evidence: [
        {
          signalId: "invented_signal",
          claim: "Made-up claim",
          numbers: { commits: 999, reviews: -1 },
        },
      ],
    },
    { model: "test", provider: "mock" },
  );

  assert.equal(grounded.evidenceGrounded, true);
  assert.ok(grounded.evidence.length >= 1);
  // Invented signalId with bad numbers should not survive as 999.
  for (const row of grounded.evidence) {
    for (const value of Object.values(row.numbers)) {
      assert.notEqual(value, 999);
    }
  }
  assert.ok(grounded.confidence <= 0.7);
});
