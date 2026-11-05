# Collab Risk Insight

A small production-minded service for the **Loop / Tempo** take-home.

It connects to **GitHub**, computes a **Collaboration Risk Digest** over a lookback window, exposes that digest over HTTP, and sends the **computed numbers** to an LLM to produce a short narrative with:

- a root-cause **hypothesis**
- a **confidence** score
- an **evidence chain** that points back at the underlying metrics

This is an intelligence-style API (with a demo UI), not a notebook prototype.

---

## What problem it solves

“Top contributors” alone is a vanity chart. Delivery risk shows up when:

- a few people own most commits (**bus factor**)
- a few people handle most reviews (**review bottleneck**)
- PRs linger in a long merge tail (**cycle time**)
- authors ship a lot but rarely review (**asymmetry**)

**Collab Risk Insight** turns those collaboration signals into a digest a planner can reason about, then asks an LLM to explain what is unusual — grounded in the numbers, not invented.

---

## Metric: Collaboration Risk Digest

| Signal | How it is computed |
| --- | --- |
| Top contributors | Score ≈ `commits + 2×merged_prs + log1p(lines)` (human logins only) |
| Top reviewers | Review / approval / changes-requested counts in the window |
| Bus factor | How many people account for ≥50% of commits |
| Review concentration | Share of reviews done by the top 2 reviewers |
| PR cycle time | Median open→merge hours + bucket distribution |
| Author/reviewer asymmetry | Heavy authors who rarely review (and the reverse) |
| Risk signals | Rule-based flags (`low_bus_factor`, `review_bottleneck`, …) with evidence maps |

**Why this metric:** it matches the assignment’s “interesting insight” bar and mirrors the job’s insight-synthesis idea — quantitative signals → hypothesis → confidence → evidence.

---

## Quickstart

**Prerequisites**

- Node.js **22.5+** (uses built-in `node:sqlite`)
- A GitHub personal access token (strongly recommended)

```bash
cp .env.example .env
# set GITHUB_TOKEN=ghp_...
# for a real LLM demo:
#   LLM_PROVIDER=anthropic
#   ANTHROPIC_API_KEY=...

npm install
npm run build:web
npm run dev:api
```

Open **http://localhost:3000**

### Dev with hot-reload UI

```bash
npm run dev
# API  → http://localhost:3000
# Vite → http://localhost:5173  (proxies /v1 and /health)
```

### curl

```bash
curl "http://localhost:3000/v1/insights?owner=fastapi&repo=fastapi&days=30"
curl "http://localhost:3000/v1/narrative?owner=fastapi&repo=fastapi&days=30"
```

### GitHub token scopes

- Classic: `public_repo` (or `repo` for private repos you own)
- Fine-grained: Contents **read**, Pull requests **read**, Issues **read**, Metadata **read**

### LLM modes

| `LLM_PROVIDER` | Behavior |
| --- | --- |
| `mock` (default) | Deterministic narrative shaped like the real response — no API key |
| `anthropic` | Live Claude call (`ANTHROPIC_API_KEY`) — preferred for submission |
| `openai` | Live OpenAI-compatible call (`OPENAI_API_KEY`) |

`mock` is only for local demos without a key. The assignment’s LLM step expects a real model for a serious demo.

---

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness, LLM provider, UI defaults |
| `GET` | `/v1/meta` | Metric definition and endpoint list |
| `GET` | `/v1/insights?owner=&repo=&days=&refresh=` | Collaboration Risk Digest |
| `GET` | `/v1/narrative?owner=&repo=&days=&refresh=` | LLM narrative over the digest |
| `POST` | `/v1/narrative` | Same as GET; JSON body `{ owner, repo, days, refresh? }` |

**Input rules**

- `owner` / `repo`: `[A-Za-z0-9_.-]+` only (rejects full URLs at the API layer)
- The MUI UI accepts a pasted GitHub URL and parses it into owner/repo before calling the API
- `days`: 1–365 (default from env, usually 30)

**Useful response fields**

- `reconciliation` — checksums that aggregates still match row sums
- `fetchLimits` — pagination caps, truncation flags, GitHub request count
- narrative: `evidenceGrounded`, `groundingNotes`, `confidence`, `evidence[]`

---

## End-to-end flow

```
UI or curl
  → GET /v1/insights
      → SQLite cache? (TTL)
      → else GithubClient (commits, PRs, reviews, issues)
      → metrics.computeInsights (+ reconciliation)
      → cache + return digest
  → GET /v1/narrative
      → reuse digest (no forced re-crawl on narrative refresh)
      → LlmService(prompt = digest JSON)
      → groundNarrative (rewrite evidence numbers from digest)
      → return narrative / hypothesis / confidence / evidence
```

---

## Project layout

```
src/
  server.ts              Fastify entry, /health, /v1/meta, static UI
  config.ts              Zod-validated env
  types.ts               Shared domain types
  lib/security.ts        Secret redaction for logs/errors
  db/store.ts            SQLite cache (snapshots / insights / narratives)
  routes/insights.ts     HTTP validation + Cache-Control
  services/
    github.ts            Paginated GitHub REST client
    metrics.ts           Pure digest computation
    llm.ts               Anthropic / OpenAI / mock adapter
    grounding.ts         Evidence grounding against digest numbers
    insights.ts          Orchestration
  services/metrics.test.ts
web/                     React + MUI source (Vite)
public/                  Built UI served by the API
NOTES.md                 Design decisions & grading map
```

---

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | API + Vite UI together |
| `npm run dev:api` | API only (serves `public/`) |
| `npm run build:web` | Build MUI app into `public/` |
| `npm run build` | Compile API + build web |
| `npm start` | Run compiled API (`dist/`) |
| `npm test` | Correctness + grounding tests |
| `npm run typecheck` | TypeScript check |

---

## Design notes (short)

- **Storage:** SQLite via `node:sqlite` — enough to show caching without running Postgres
- **Correctness:** human login-only counts, distinct opened vs merged windows, full-distribution bus factor / concentration, `reconciliation` block
- **LLM:** digest numbers go into the prompt; evidence is re-grounded server-side so invented counts cannot ship
- **Security:** tokens only in `.env`; logger redaction; allowlisted owner/repo; fixed GitHub host; HTTPS-only OpenAI base URL
- **Performance:** page caps, review fetch cap (40 PRs), concurrency limit, rate-limit guard, TTL cache

Longer rationale: [NOTES.md](./NOTES.md)
