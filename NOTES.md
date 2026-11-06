# Submission notes — Collab Risk Insight

## 1. How to run locally

**Prerequisites**

- Node.js 22.5+ (built-in `node:sqlite`)
- GitHub token with read access to public repo metadata / contents / PRs / issues

**Steps**

```bash
cp .env.example .env
# Required for reliable demos:
#   GITHUB_TOKEN=ghp_...
# Recommended for the LLM endpoint demo:
#   LLM_PROVIDER=anthropic
#   ANTHROPIC_API_KEY=...

npm install
npm run build:web
npm run dev:api
```

- UI + API: http://localhost:3000  
- Tests: `npm test`  
- Defaults: `fastapi/fastapi` (`https://github.com/fastapi/fastapi`), 30-day window, `LLM_PROVIDER=mock`, SQLite at `./data/collab_risk_insight.sqlite`

**Example UI query**

- Owner: `fastapi`
- Repo: `fastapi`  
  (or paste `https://github.com/fastapi/fastapi` into either field — the UI parses it)

**Example API query**

```bash
curl "http://localhost:3000/v1/insights?owner=fastapi&repo=fastapi&days=30"
curl "http://localhost:3000/v1/narrative?owner=fastapi&repo=fastapi&days=30"
```

---

## 2. Architecture tour and main decisions

### Shape of the system

```
Fastify HTTP
  ├─ Zod request validation (owner/repo/days)
  ├─ InsightsService
  │    ├─ SQLite TTL cache (snapshot → insights → narrative)
  │    ├─ GithubClient (paginated, capped, rate-aware)
  │    ├─ metrics.computeInsights (pure) + reconciliation
  │    └─ LlmService → groundNarrative
  └─ Static MUI UI from /public
```

### Why GitHub

Fastest path to rich collaboration data with a personal token. Public repos need no private org credentials from the reviewer. The assignment explicitly allows GitHub.

### Why this insight (not only “top N commits”)

The brief asks for something interesting over a period, then an LLM narrative with hypothesis, confidence, and evidence. A Collaboration Risk Digest — shipping volume + review topology + cycle time — is closer to an enterprise planning signal than a leaderboard.

### Boundaries

| Module | Responsibility |
| --- | --- |
| `GithubClient` | I/O only; never invents line counts the list API does not provide |
| `metrics` | Pure aggregation; easy to unit test |
| `LlmService` | Provider adapters + JSON schema parse |
| `grounding` | Forces evidence numbers to come from the digest |
| `Store` | Cache / repeat-query performance |
| Routes | HTTP semantics, validation, safe errors |

### LLM contract (assignment core)

1. Service computes the numeric digest first (`/v1/insights`).
2. Digest JSON is sent as structured prompt input to the model.
3. Model returns narrative + hypothesis + confidence + evidence.
4. `groundNarrative` rewrites `evidence.numbers` from digest signals/summary so invented values cannot pass through.
5. Confidence is capped when grounding rewrites, reconciliation fails, or GitHub fetch was truncated.

Providers: `anthropic` (preferred; aligns with Tempo/Bedrock Claude), `openai`, or `mock` for key-less local demos.

---

## 3. How this maps to grading themes

### Correctness

- Counts use GitHub **logins** only (not free-text commit author names).
- Bot accounts are excluded from human collaboration math.
- `prsOpened` = created in window; `prsMerged` = **merged** in window.
- Bus factor and review concentration use the **full** distributions, not the top-10 UI slice.
- Every insights payload includes `reconciliation` checksums (contributor rows ↔ `summary.commits`, reviewer rows ↔ `summary.reviews`, cycle buckets ↔ timed merges).
- Locked by `src/services/metrics.test.ts`.

### AI evidence

- Zod-validate model JSON, then ground evidence.
- Response exposes `evidenceGrounded` and `groundingNotes`.
- Prompt forbids inventing users/counts; server still enforces grounding.

### Security

- Secrets only via `.env` (gitignored).
- Logger redacts auth / API key fields.
- `redactSecrets()` strips token-like strings from outbound errors.
- `owner`/`repo` allowlisted; GitHub host fixed (no user-controlled SSRF URL).
- `OPENAI_BASE_URL` must be `https://`.

### Performance

- Paginated fetches with `maxPages` and early stop outside the window.
- Review crawl capped (`maxPullsForReviews=40`) with concurrency 4.
- Abort further calls when rate-limit remaining is exhausted.
- SQLite TTL cache for snapshots / insights / narratives.
- `fetchLimits` exposed so truncation is visible, not hidden.
- Narrative refresh reuses cached insights (does not force another GitHub crawl).

### Judgement

**Chose**

- One integration (GitHub)
- One metric family (collaboration risk)
- Two primary endpoints + health/meta
- SQLite instead of Postgres for a reviewable demo
- MUI line-by-line UI for walkthroughs
- Real LLM adapters with a mock fallback

**Chose not to**

- Multi-tool federation (Jira/Linear/…)
- Hydrating every PR for additions/deletions (list API omits them — keep 0 rather than invent)
- Unbounded review fetch
- Auth gateway for a localhost take-home

---

## 4. What I would do with another day

1. Golden fixtures across quiet vs busy repos; LLM rubric that evidence numbers must appear in the digest.
2. Persist raw event rows and recompute digests without re-fetching GitHub.
3. Background sync / webhooks so `/insights` is always a local read.
4. API auth if the service left localhost.
5. SSE/streaming narrative for a smoother interview demo.

---

## 5. Demo plan (~10 minutes)

1. Live UI: `fastapi/fastapi`, 30 days → Fetch insights → Synthesize narrative.
2. Show `reconciliation.ok`, a risk signal, and grounded evidence numbers.
3. Code tour: `metrics.ts` (correctness), `grounding.ts` (AI evidence), `github.ts` (limits/cache interplay).
4. Trade-offs: SQLite vs Postgres; review cap; mock vs Anthropic for submission.
