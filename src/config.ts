import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  GITHUB_TOKEN: z.string().optional().default(""),
  GITHUB_OWNER: z.string().default("vercel"),
  GITHUB_REPO: z.string().default("swr"),
  DEFAULT_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  DATABASE_PATH: z.string().default("./data/collab_risk_insight.sqlite"),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  LLM_PROVIDER: z.enum(["anthropic", "openai", "mock"]).default("mock"),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-20250514"),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_BASE_URL: z
    .string()
    .url()
    .refine((value) => value.startsWith("https://"), {
      message: "OPENAI_BASE_URL must use https",
    })
    .default("https://api.openai.com/v1"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  console.error("Invalid configuration:\n" + details);
  process.exit(1);
}

export const env = parsed.data;

export type AppConfig = typeof env;
