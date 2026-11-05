import {
  insightsCacheKey,
  narrativeCacheKey,
  snapshotCacheKey,
  type Store,
} from "../db/store.js";
import type { InsightsResponse, NarrativeResponse } from "../types.js";
import { GithubClient } from "./github.js";
import type { LlmService } from "./llm.js";
import { computeInsights } from "./metrics.js";

export class InsightsService {
  constructor(
    private readonly github: GithubClient,
    private readonly store: Store,
    private readonly llm: LlmService,
    private readonly cacheTtlSeconds: number,
    private readonly llmProvider: string,
    private readonly llmModel: string,
  ) {}

  async getInsights(
    owner: string,
    repo: string,
    days: number,
    options: { refresh?: boolean } = {},
  ): Promise<InsightsResponse> {
    const key = insightsCacheKey(owner, repo, days);

    if (!options.refresh) {
      const cached = this.store.getInsights(key, this.cacheTtlSeconds);
      if (cached) {
        return { ...cached, cached: true };
      }
    }

    const snapshot = await this.getSnapshot(owner, repo, days, options.refresh);
    const insights = computeInsights(snapshot, days);
    this.store.putInsights(key, owner, repo, days, insights);
    return insights;
  }

  async getNarrative(
    owner: string,
    repo: string,
    days: number,
    options: { refresh?: boolean } = {},
  ): Promise<NarrativeResponse> {
    const key = narrativeCacheKey(
      owner,
      repo,
      days,
      this.llmProvider,
      this.llmModel,
    );

    if (!options.refresh) {
      const cached = this.store.getNarrative(key, this.cacheTtlSeconds);
      if (cached) return cached;
    }

    // Reuse cached insights when possible — narrative refresh should not
    // force another GitHub crawl unless the digest itself is missing/stale.
    const insights = await this.getInsights(owner, repo, days, { refresh: false });
    const narrative = await this.llm.synthesizeNarrative(insights);
    this.store.putNarrative(key, owner, repo, days, this.llmProvider, narrative);
    return narrative;
  }

  private async getSnapshot(
    owner: string,
    repo: string,
    days: number,
    refresh?: boolean,
  ) {
    const key = snapshotCacheKey(owner, repo, days);
    if (!refresh) {
      const cached = this.store.getSnapshot(key, this.cacheTtlSeconds);
      if (cached) return cached;
    }

    const until = new Date();
    const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
    const snapshot = await this.github.fetchRepoSnapshot(
      owner,
      repo,
      since.toISOString(),
      until.toISOString(),
    );
    this.store.putSnapshot(key, owner, repo, days, snapshot);
    return snapshot;
  }
}
