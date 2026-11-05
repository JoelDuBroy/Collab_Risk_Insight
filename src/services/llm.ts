import { z } from "zod";
import type { InsightsResponse, NarrativeResponse } from "../types.js";
import { publicErrorMessage } from "../lib/security.js";
import { groundNarrative } from "./grounding.js";

export type LlmProviderName = "anthropic" | "openai" | "mock";

export type LlmConfig = {
  provider: LlmProviderName;
  anthropicApiKey: string;
  anthropicModel: string;
  openaiApiKey: string;
  openaiModel: string;
  openaiBaseUrl: string;
};

const llmOutputSchema = z.object({
  narrative: z.string().min(1),
  hypothesis: z.string().min(1),
  confidence: z.number().min(0).max(1),
  evidence: z
    .array(
      z.object({
        signalId: z.string(),
        claim: z.string(),
        numbers: z.record(z.union([z.string(), z.number(), z.null()])),
      }),
    )
    .min(1),
});

export class LlmService {
  constructor(private readonly config: LlmConfig) {}

  async synthesizeNarrative(insights: InsightsResponse): Promise<NarrativeResponse> {
    if (this.config.provider === "mock") {
      return groundNarrative(insights, this.mockRaw(insights), {
        model: "deterministic-mock",
        provider: "mock",
      });
    }

    const prompt = buildPrompt(insights);

    try {
      const rawText =
        this.config.provider === "anthropic"
          ? await this.callAnthropic(prompt)
          : await this.callOpenAI(prompt);

      const parsed = parseModelJson(rawText);
      return groundNarrative(insights, parsed, {
        model: this.activeModel(),
        provider: this.config.provider,
      });
    } catch (error) {
      const fallback = groundNarrative(insights, this.mockRaw(insights), {
        model: this.activeModel(),
        provider: this.config.provider,
      });
      fallback.narrative =
        `LLM call failed (${publicErrorMessage(error, "provider_error")}); ` +
        `falling back to deterministic synthesis. ${fallback.narrative}`;
      fallback.confidence = Math.min(fallback.confidence, 0.45);
      fallback.groundingNotes = [
        ...fallback.groundingNotes,
        "Used deterministic fallback after provider failure",
      ];
      return fallback;
    }
  }

  private activeModel(): string {
    if (this.config.provider === "anthropic") return this.config.anthropicModel;
    if (this.config.provider === "openai") return this.config.openaiModel;
    return "deterministic-mock";
  }

  private async callAnthropic(prompt: string): Promise<string> {
    if (!this.config.anthropicApiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.config.anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.config.anthropicModel,
        max_tokens: 900,
        temperature: 0.2,
        system:
          "You are a staff engineer analyzing collaboration metrics. Respond with JSON only. Every evidence.numbers value MUST copy a value from DATA.",
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic HTTP ${response.status}`);
    }

    const body = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = body.content?.find((part) => part.type === "text")?.text;
    if (!text) throw new Error("Anthropic response missing text content");
    return text;
  }

  private async callOpenAI(prompt: string): Promise<string> {
    if (!this.config.openaiApiKey) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const response = await fetch(`${this.config.openaiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${this.config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: this.config.openaiModel,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a staff engineer analyzing collaboration metrics. Respond with JSON only. Every evidence.numbers value MUST copy a value from DATA.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI HTTP ${response.status}`);
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = body.choices?.[0]?.message?.content;
    if (!text) throw new Error("OpenAI response missing content");
    return text;
  }

  private mockRaw(insights: InsightsResponse) {
    const topSignal = insights.signals[0];
    const topContributor = insights.topContributors[0];
    const topReviewer = insights.topReviewers[0];

    const narrativeParts = [
      `Over the last ${insights.period.days} days, ${insights.owner}/${insights.repo} saw ${insights.summary.commits} commits, ${insights.summary.prsMerged} merged PRs, and ${insights.summary.reviews} reviews across ${insights.summary.activeContributors} contributors.`,
    ];

    if (topContributor) {
      narrativeParts.push(
        `${topContributor.login} leads contribution score (${topContributor.score}) with ${topContributor.commits} commit(s) and ${topContributor.prsMerged} merge(s).`,
      );
    }
    if (topReviewer) {
      narrativeParts.push(
        `Review load is led by ${topReviewer.login} (${topReviewer.reviews} reviews, ${topReviewer.approvals} approvals).`,
      );
    }
    if (topSignal) {
      narrativeParts.push(`${topSignal.title}: ${topSignal.detail}`);
    }

    const hypothesis =
      topSignal?.id === "review_bottleneck"
        ? "Review throughput is gated by a small reviewer set; expanding review rotation should reduce merge latency risk."
        : topSignal?.id === "low_bus_factor"
          ? "Delivery risk is concentrated in a few commit authors; knowledge sharing or pairing would raise bus factor."
          : topSignal?.id === "slow_merge_tail" ||
              topSignal?.id === "elevated_median_cycle"
            ? "A subset of PRs is stalled in review or iteration; process SLAs or smaller PR size may compress the tail."
            : "Activity is broadly distributed; no single bottleneck dominates this window.";

    const evidence = insights.signals.slice(0, 3).map((signal) => ({
      signalId: signal.id,
      claim: signal.detail,
      numbers: { ...signal.evidence },
    }));

    let confidence = 0.62;
    if (insights.summary.commits + insights.summary.prsMerged >= 20) confidence += 0.12;
    if (insights.signals.some((s) => s.severity === "risk")) confidence += 0.08;
    if (insights.summary.reviews < 3) confidence -= 0.15;

    return {
      narrative: narrativeParts.join(" "),
      hypothesis,
      confidence,
      evidence,
    };
  }
}

function buildPrompt(insights: InsightsResponse): string {
  const compact = {
    repo: `${insights.owner}/${insights.repo}`,
    periodDays: insights.period.days,
    metric: insights.metric,
    summary: insights.summary,
    topContributors: insights.topContributors.slice(0, 5),
    topReviewers: insights.topReviewers.slice(0, 5),
    authorReviewerAsymmetry: insights.authorReviewerAsymmetry.slice(0, 5),
    cycleTimeDistribution: insights.cycleTimeDistribution,
    signals: insights.signals,
    reconciliationOk: insights.reconciliation.ok,
    fetchLimits: insights.fetchLimits,
  };

  return `Analyze these GitHub collaboration insights and return JSON with keys:
- narrative: 3-5 sentences describing what is interesting or unusual
- hypothesis: one root-cause hypothesis supported by the numbers (or explicitly say evidence is weak)
- confidence: number from 0 to 1 reflecting how strongly the data supports the hypothesis
- evidence: array of { signalId, claim, numbers } where signalId MUST be one of the provided signals.*.id and numbers MUST be copied from that signal's evidence (or summary)

Rules:
- Do not invent users or counts that are not in the data.
- Prefer calibrated confidence (avoid 0.95+ unless evidence is overwhelming).
- If fetchLimits shows truncation, mention uncertainty and keep confidence ≤ 0.7.
- Keep claims falsifiable and tied to the evidence numbers.

DATA:
${JSON.stringify(compact, null, 2)}`;
}

function parseModelJson(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Model response did not contain JSON object");
  }
  const parsed = JSON.parse(candidate.slice(start, end + 1));
  return llmOutputSchema.parse(parsed);
}
