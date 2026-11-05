import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config.js";
import { Store } from "./db/store.js";
import { insightsRoutes } from "./routes/insights.js";
import { GithubClient } from "./services/github.js";
import { InsightsService } from "./services/insights.js";
import { LlmService } from "./services/llm.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const store = new Store(env.DATABASE_PATH);
  const github = new GithubClient({ token: env.GITHUB_TOKEN });
  const llm = new LlmService({
    provider: env.LLM_PROVIDER,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    anthropicModel: env.ANTHROPIC_MODEL,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.OPENAI_MODEL,
    openaiBaseUrl: env.OPENAI_BASE_URL,
  });

  const llmModel =
    env.LLM_PROVIDER === "anthropic"
      ? env.ANTHROPIC_MODEL
      : env.LLM_PROVIDER === "openai"
        ? env.OPENAI_MODEL
        : "deterministic-mock";

  const insightsService = new InsightsService(
    github,
    store,
    llm,
    env.CACHE_TTL_SECONDS,
    env.LLM_PROVIDER,
    llmModel,
  );

  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "GITHUB_TOKEN",
          "ANTHROPIC_API_KEY",
          "OPENAI_API_KEY",
          "*.token",
          "*.apiKey",
          "*.api_key",
        ],
        censor: "[REDACTED]",
      },
    },
  });

  await app.register(cors, { origin: true });

  app.get("/health", async () => ({
    ok: true,
    service: "collab_risk_insight",
    llmProvider: env.LLM_PROVIDER,
    defaults: {
      owner: env.GITHUB_OWNER,
      repo: env.GITHUB_REPO,
      days: env.DEFAULT_LOOKBACK_DAYS,
    },
  }));

  app.get("/v1/meta", async () => ({
    metric: {
      id: "collaboration_risk_digest",
      name: "Collaboration Risk Digest",
      description:
        "Multi-signal digest of contribution volume, review concentration, bus factor, cycle time, and author/reviewer asymmetry.",
      why:
        "Leaderboards alone don't support planning decisions. Combining shipping + review topology surfaces delivery risk — closer to an intelligence layer than a vanity chart.",
    },
    endpoints: [
      "GET /health",
      "GET /v1/meta",
      "GET /v1/insights?owner=&repo=&days=&refresh=",
      "GET /v1/narrative?owner=&repo=&days=&refresh=",
      "POST /v1/narrative",
    ],
  }));

  await app.register(insightsRoutes, {
    insightsService,
    defaultDays: env.DEFAULT_LOOKBACK_DAYS,
    cacheTtlSeconds: env.CACHE_TTL_SECONDS,
  });

  await app.register(fastifyStatic, {
    root: path.join(__dirname, "..", "public"),
    prefix: "/",
  });

  const shutdown = async () => {
    await app.close();
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(
    `Collab Risk Insight listening on http://${env.HOST}:${env.PORT} (LLM=${env.LLM_PROVIDER})`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
