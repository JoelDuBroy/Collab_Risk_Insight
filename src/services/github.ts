import type {
  FetchLimits,
  GithubCommit,
  GithubIssue,
  GithubPull,
  GithubReview,
  RepoSnapshot,
} from "../types.js";
import { redactSecrets } from "../lib/security.js";

type GithubClientOptions = {
  token?: string;
  userAgent?: string;
  maxPages?: number;
  maxPullsForReviews?: number;
  reviewConcurrency?: number;
};

type RateLimitInfo = {
  remaining: number | null;
  reset: number | null;
};

export class GithubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly rateLimit: RateLimitInfo,
  ) {
    super(redactSecrets(message));
    this.name = "GithubApiError";
  }
}

export class GithubClient {
  private readonly token?: string;
  private readonly userAgent: string;
  private readonly maxPages: number;
  private readonly maxPullsForReviews: number;
  private readonly reviewConcurrency: number;
  private readonly baseUrl = "https://api.github.com";
  private requestCount = 0;
  private lastRateLimit: RateLimitInfo = { remaining: null, reset: null };

  constructor(options: GithubClientOptions = {}) {
    this.token = options.token?.trim() || undefined;
    this.userAgent = options.userAgent ?? "collab_risk_insight/1.0";
    this.maxPages = options.maxPages ?? 5;
    this.maxPullsForReviews = options.maxPullsForReviews ?? 40;
    this.reviewConcurrency = options.reviewConcurrency ?? 4;
  }

  async fetchRepoSnapshot(
    owner: string,
    repo: string,
    sinceIso: string,
    untilIso: string,
  ): Promise<RepoSnapshot> {
    this.requestCount = 0;

    const meta = await this.request<{ default_branch: string }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    );

    const [commitResult, pullResult, issueResult] = await Promise.all([
      this.fetchCommits(owner, repo, meta.default_branch, sinceIso, untilIso),
      this.fetchPulls(owner, repo, sinceIso),
      this.fetchIssues(owner, repo, sinceIso),
    ]);

    const pullsInScope = pullResult.items.filter((pull) => {
      const created = new Date(pull.createdAt).getTime();
      const since = new Date(sinceIso).getTime();
      const until = new Date(untilIso).getTime();
      if (created >= since && created <= until) return true;
      if (pull.mergedAt) {
        const merged = new Date(pull.mergedAt).getTime();
        if (merged >= since && merged <= until) return true;
      }
      return false;
    });

    // Reviews are per-PR; only inspect PRs that touch the window, capped for rate limits.
    const relevantPulls = pullsInScope.filter((pull) => {
      const created = new Date(pull.createdAt).getTime();
      const since = new Date(sinceIso).getTime();
      const mergedOrClosed = pull.mergedAt ?? pull.closedAt;
      if (created >= since) return true;
      if (mergedOrClosed && new Date(mergedOrClosed).getTime() >= since) return true;
      return false;
    });

    const reviewTargets = relevantPulls.slice(0, this.maxPullsForReviews);
    const truncatedReviews = relevantPulls.length > reviewTargets.length;

    const reviewsNested = await mapLimit(
      reviewTargets,
      this.reviewConcurrency,
      async (pull) => this.fetchReviews(owner, repo, pull.number),
    );
    const reviews = reviewsNested.flat().filter((review) => {
      if (!review.submittedAt) return false;
      const t = new Date(review.submittedAt).getTime();
      return t >= new Date(sinceIso).getTime() && t <= new Date(untilIso).getTime();
    });

    const fetchLimits: FetchLimits = {
      maxPagesPerResource: this.maxPages,
      maxPullsForReviews: this.maxPullsForReviews,
      reviewConcurrency: this.reviewConcurrency,
      truncatedCommits: commitResult.truncated,
      truncatedPulls: pullResult.truncated,
      truncatedIssues: issueResult.truncated,
      truncatedReviews,
      githubRequests: this.requestCount,
    };

    return {
      owner,
      repo,
      defaultBranch: meta.default_branch,
      since: sinceIso,
      until: untilIso,
      commits: commitResult.items,
      pulls: pullsInScope,
      reviews,
      issues: issueResult.items.filter((issue) => {
        if (issue.pullRequest) return false;
        if (!issue.closedAt) return false;
        const closed = new Date(issue.closedAt).getTime();
        return (
          closed >= new Date(sinceIso).getTime() &&
          closed <= new Date(untilIso).getTime()
        );
      }),
      fetchLimits,
      fetchedAt: new Date().toISOString(),
    };
  }

  private async fetchCommits(
    owner: string,
    repo: string,
    branch: string,
    sinceIso: string,
    untilIso: string,
  ): Promise<{ items: GithubCommit[]; truncated: boolean }> {
    const { items, truncated } = await this.paginate<GithubCommitRaw>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits`,
      {
        sha: branch,
        since: sinceIso,
        until: untilIso,
        per_page: "100",
      },
    );

    return {
      truncated,
      items: items.map((item) => ({
        sha: item.sha,
        // Login-only: commit.author.name is free text and breaks identity correctness.
        authorLogin: item.author?.login ?? null,
        date: item.commit?.author?.date ?? null,
      })),
    };
  }

  private async fetchPulls(
    owner: string,
    repo: string,
    sinceIso: string,
  ): Promise<{ items: GithubPull[]; truncated: boolean }> {
    const { items, truncated } = await this.paginate<GithubPullRaw>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
      {
        state: "all",
        sort: "updated",
        direction: "desc",
        per_page: "100",
      },
      (batch) =>
        batch.every(
          (item) => new Date(item.updated_at).getTime() < new Date(sinceIso).getTime(),
        ),
    );

    return {
      truncated,
      items: items.map((item) => ({
        number: item.number,
        userLogin: item.user?.login ?? null,
        state: item.state,
        createdAt: item.created_at,
        mergedAt: item.merged_at,
        closedAt: item.closed_at,
        // List endpoint omits line stats; keep 0 rather than inventing values.
        additions: 0,
        deletions: 0,
      })),
    };
  }

  private async fetchReviews(
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<GithubReview[]> {
    const { items } = await this.paginate<GithubReviewRaw>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${pullNumber}/reviews`,
      { per_page: "100" },
    );

    return items.map((item) => ({
      pullNumber,
      reviewerLogin: item.user?.login ?? null,
      state: item.state,
      submittedAt: item.submitted_at,
    }));
  }

  private async fetchIssues(
    owner: string,
    repo: string,
    sinceIso: string,
  ): Promise<{ items: GithubIssue[]; truncated: boolean }> {
    const { items, truncated } = await this.paginate<GithubIssueRaw>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues`,
      {
        state: "closed",
        since: sinceIso,
        sort: "updated",
        direction: "desc",
        per_page: "100",
      },
    );

    return {
      truncated,
      items: items.map((item) => ({
        number: item.number,
        userLogin: item.user?.login ?? null,
        state: item.state,
        closedAt: item.closed_at,
        pullRequest: Boolean(item.pull_request),
      })),
    };
  }

  private async paginate<T>(
    path: string,
    query: Record<string, string>,
    shouldStop?: (batch: T[]) => boolean,
  ): Promise<{ items: T[]; truncated: boolean }> {
    const results: T[] = [];
    let truncated = false;

    for (let page = 1; page <= this.maxPages; page += 1) {
      const batch = await this.request<T[]>(path, { ...query, page: String(page) });
      if (!Array.isArray(batch) || batch.length === 0) break;
      results.push(...batch);
      if (shouldStop?.(batch)) break;
      const perPage = Number(query.per_page ?? 30);
      if (batch.length < perPage) break;
      if (page === this.maxPages) {
        truncated = true;
      }
    }

    return { items: results, truncated };
  }

  private async request<T>(
    path: string,
    query: Record<string, string> = {},
  ): Promise<T> {
    if (
      this.lastRateLimit.remaining != null &&
      this.lastRateLimit.remaining <= 0
    ) {
      throw new GithubApiError(
        "GitHub rate limit exhausted; wait for reset or set GITHUB_TOKEN",
        403,
        this.lastRateLimit,
      );
    }

    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }

    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": this.userAgent,
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const response = await fetch(url, { headers });
    this.requestCount += 1;
    this.lastRateLimit = {
      remaining: numberOrNull(response.headers.get("x-ratelimit-remaining")),
      reset: numberOrNull(response.headers.get("x-ratelimit-reset")),
    };

    if (!response.ok) {
      const body = redactSecrets((await response.text()).slice(0, 200));
      throw new GithubApiError(
        `GitHub API ${response.status} for ${path}: ${body}`,
        response.status,
        this.lastRateLimit,
      );
    }

    return (await response.json()) as T;
  }
}

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 0)) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

function numberOrNull(value: string | null): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

type GithubCommitRaw = {
  sha: string;
  author?: { login?: string } | null;
  commit?: { author?: { name?: string; date?: string } };
};

type GithubPullRaw = {
  number: number;
  user?: { login?: string } | null;
  state: string;
  created_at: string;
  merged_at: string | null;
  closed_at: string | null;
  updated_at: string;
};

type GithubReviewRaw = {
  user?: { login?: string } | null;
  state: string;
  submitted_at: string | null;
};

type GithubIssueRaw = {
  number: number;
  user?: { login?: string } | null;
  state: string;
  closed_at: string | null;
  pull_request?: unknown;
};
