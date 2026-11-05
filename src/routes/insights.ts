import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { publicErrorMessage } from "../lib/security.js";
import { GithubApiError } from "../services/github.js";
import type { InsightsService } from "../services/insights.js";

const querySchema = z.object({
  owner: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9_.-]+$/, "owner contains invalid characters"),
  repo: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9_.-]+$/, "repo contains invalid characters"),
  days: z.coerce.number().int().min(1).max(365).optional(),
  refresh: z
    .union([z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false")])
    .optional(),
});

export const insightsRoutes: FastifyPluginAsync<{
  insightsService: InsightsService;
  defaultDays: number;
  cacheTtlSeconds: number;
}> = async (app, opts) => {
  app.get("/v1/insights", async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_query",
        details: parsed.error.flatten(),
      });
    }

    const days = parsed.data.days ?? opts.defaultDays;
    const refresh =
      parsed.data.refresh === "1" || parsed.data.refresh === "true";

    try {
      const insights = await opts.insightsService.getInsights(
        parsed.data.owner,
        parsed.data.repo,
        days,
        { refresh },
      );
      reply.header(
        "Cache-Control",
        insights.cached
          ? `public, max-age=${Math.min(60, opts.cacheTtlSeconds)}`
          : "no-store",
      );
      return insights;
    } catch (error) {
      return sendUpstreamError(reply, error);
    }
  });

  app.get("/v1/narrative", async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_query",
        details: parsed.error.flatten(),
      });
    }

    const days = parsed.data.days ?? opts.defaultDays;
    const refresh =
      parsed.data.refresh === "1" || parsed.data.refresh === "true";

    try {
      const narrative = await opts.insightsService.getNarrative(
        parsed.data.owner,
        parsed.data.repo,
        days,
        { refresh },
      );
      reply.header("Cache-Control", "no-store");
      return narrative;
    } catch (error) {
      return sendUpstreamError(reply, error);
    }
  });

  app.post("/v1/narrative", async (request, reply) => {
    const parsed = querySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        details: parsed.error.flatten(),
      });
    }

    const days = parsed.data.days ?? opts.defaultDays;
    const refresh =
      parsed.data.refresh === "1" || parsed.data.refresh === "true";

    try {
      const narrative = await opts.insightsService.getNarrative(
        parsed.data.owner,
        parsed.data.repo,
        days,
        { refresh },
      );
      reply.header("Cache-Control", "no-store");
      return narrative;
    } catch (error) {
      return sendUpstreamError(reply, error);
    }
  });
};

function sendUpstreamError(
  reply: {
    code: (status: number) => { send: (payload: unknown) => unknown };
  },
  error: unknown,
) {
  if (error instanceof GithubApiError) {
    const status = error.status === 404 ? 404 : 502;
    return reply.code(status).send({
      error: "github_upstream_error",
      message: publicErrorMessage(error, "GitHub upstream error"),
      status: error.status,
      rateLimit: error.rateLimit,
    });
  }

  return reply.code(500).send({
    error: "internal_error",
    message: publicErrorMessage(error),
  });
}
