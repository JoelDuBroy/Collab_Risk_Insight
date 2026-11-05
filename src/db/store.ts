import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { InsightsResponse, NarrativeResponse, RepoSnapshot } from "../types.js";

export class Store {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS snapshots (
        cache_key TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        repo TEXT NOT NULL,
        days INTEGER NOT NULL,
        payload TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS insights (
        cache_key TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        repo TEXT NOT NULL,
        days INTEGER NOT NULL,
        payload TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS narratives (
        cache_key TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        repo TEXT NOT NULL,
        days INTEGER NOT NULL,
        provider TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  getSnapshot(cacheKey: string, maxAgeSeconds: number): RepoSnapshot | null {
    const row = this.db
      .prepare(`SELECT payload, fetched_at FROM snapshots WHERE cache_key = ?`)
      .get(cacheKey) as { payload: string; fetched_at: string } | undefined;

    if (!row) return null;
    if (ageSeconds(row.fetched_at) > maxAgeSeconds) return null;
    return JSON.parse(row.payload) as RepoSnapshot;
  }

  putSnapshot(
    cacheKey: string,
    owner: string,
    repo: string,
    days: number,
    snapshot: RepoSnapshot,
  ): void {
    this.db
      .prepare(
        `INSERT INTO snapshots (cache_key, owner, repo, days, payload, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           payload = excluded.payload,
           fetched_at = excluded.fetched_at,
           days = excluded.days`,
      )
      .run(
        cacheKey,
        owner,
        repo,
        days,
        JSON.stringify(snapshot),
        snapshot.fetchedAt,
      );
  }

  getInsights(cacheKey: string, maxAgeSeconds: number): InsightsResponse | null {
    const row = this.db
      .prepare(`SELECT payload, fetched_at FROM insights WHERE cache_key = ?`)
      .get(cacheKey) as { payload: string; fetched_at: string } | undefined;

    if (!row) return null;
    if (ageSeconds(row.fetched_at) > maxAgeSeconds) return null;
    return JSON.parse(row.payload) as InsightsResponse;
  }

  putInsights(
    cacheKey: string,
    owner: string,
    repo: string,
    days: number,
    insights: InsightsResponse,
  ): void {
    this.db
      .prepare(
        `INSERT INTO insights (cache_key, owner, repo, days, payload, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           payload = excluded.payload,
           fetched_at = excluded.fetched_at,
           days = excluded.days`,
      )
      .run(
        cacheKey,
        owner,
        repo,
        days,
        JSON.stringify(insights),
        insights.fetchedAt,
      );
  }

  getNarrative(
    cacheKey: string,
    maxAgeSeconds: number,
  ): NarrativeResponse | null {
    const row = this.db
      .prepare(`SELECT payload, created_at FROM narratives WHERE cache_key = ?`)
      .get(cacheKey) as { payload: string; created_at: string } | undefined;

    if (!row) return null;
    if (ageSeconds(row.created_at) > maxAgeSeconds) return null;
    return JSON.parse(row.payload) as NarrativeResponse;
  }

  putNarrative(
    cacheKey: string,
    owner: string,
    repo: string,
    days: number,
    provider: string,
    narrative: NarrativeResponse,
  ): void {
    this.db
      .prepare(
        `INSERT INTO narratives (cache_key, owner, repo, days, provider, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           payload = excluded.payload,
           created_at = excluded.created_at,
           provider = excluded.provider`,
      )
      .run(
        cacheKey,
        owner,
        repo,
        days,
        provider,
        JSON.stringify(narrative),
        new Date().toISOString(),
      );
  }

  close(): void {
    this.db.close();
  }
}

function ageSeconds(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 1000;
}

export function snapshotCacheKey(owner: string, repo: string, days: number): string {
  return `snap:${owner.toLowerCase()}/${repo.toLowerCase()}:${days}`;
}

export function insightsCacheKey(owner: string, repo: string, days: number): string {
  return `ins:${owner.toLowerCase()}/${repo.toLowerCase()}:${days}`;
}

export function narrativeCacheKey(
  owner: string,
  repo: string,
  days: number,
  provider: string,
  model: string,
): string {
  return `nar:${owner.toLowerCase()}/${repo.toLowerCase()}:${days}:${provider}:${model}`;
}
