/**
 * pi-wiki-eval — pi extension surface.
 *
 * Two tools and one command over the same core the CLI uses: measure what an episode cost, where
 * its tool calls went, and whether the wiki replaced codebase discovery. Local only — session
 * files, the project's wiki state, and nothing else. No network, no telemetry, no writes to the
 * wiki.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { analyzeProject } from "./core/analyze.js";
import { renderReport } from "./core/report.js";

/** Keep a tool result inside a sane context budget; the CLI prints the whole report. */
const REPORT_CHAR_LIMIT = 14_000;

function ratio(value: number | null): string {
	return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "wiki_eval",
		label: "Wiki Evaluation",
		description:
			"Measure where this project's agent context was spent: billed cost and tokens, discovery versus wiki consultation, and the rediscovery rate — how often the agent still read the files a retrieved wiki page describes. Reads local pi session files and the wiki's own state; sends nothing anywhere.",
		promptSnippet: "Measure context usage and wiki efficacy for this project",
		promptGuidelines: [
			"Use wiki_eval when the user asks how much context a project consumes, how the wiki is actually used, or whether the wiki replaces codebase discovery.",
			"wiki_eval is read-only and local; it never writes to the wiki and never sends data anywhere.",
			"Prefer the CLI (pi-wiki-eval --project <dir>) when a full report is wanted; the tool result is truncated.",
		],
		parameters: Type.Object({
			sinceDays: Type.Optional(Type.Number({ description: "Only episodes from the last N days" })),
			includeQueries: Type.Optional(Type.Boolean({ description: "Include prompt and wiki query text (off by default)" })),
			episodes: Type.Optional(Type.Number({ description: "Episodes to tabulate (default 20)" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const analysis = await analyzeProject({
				projectDir: ctx.cwd,
				includeQueries: params.includeQueries === true,
				...(typeof params.sinceDays === "number" ? { sinceDays: params.sinceDays } : {}),
			});
			const report = renderReport(analysis, {
				includeQueries: params.includeQueries === true,
				...(typeof params.episodes === "number" ? { maxEpisodes: params.episodes } : {}),
			});
			const text = report.length > REPORT_CHAR_LIMIT
				? `${report.slice(0, REPORT_CHAR_LIMIT)}\n\n[... report truncated at ${REPORT_CHAR_LIMIT} characters. Run \`npx pi-wiki-eval --project ${ctx.cwd}\` for the full report.]`
				: report;
			return {
				content: [{ type: "text", text }],
				details: {
					episodes: analysis.totals.episodes,
					sessions: analysis.sessions.length,
					cost: analysis.totals.usage.cost,
					tokens: analysis.totals.usage.totalTokens,
					consultationRate: analysis.totals.consultationRate,
					rediscoveryRate: analysis.totals.rediscovery.rate,
				},
			};
		},
	});

	pi.registerCommand("wiki-eval", {
		description: "Measure context usage and wiki efficacy for this project",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			const analysis = await analyzeProject({ projectDir: ctx.cwd });
			const totals = analysis.totals;
			ctx.ui.notify(
				`pi-wiki-eval: ${totals.episodes} episode(s) in ${analysis.sessions.length} session(s) · $${totals.usage.cost.toFixed(4)} · ${Math.round(totals.usage.totalTokens).toLocaleString("en-US")} tokens · consultation ${ratio(totals.consultationRate)} · rediscovery ${ratio(totals.rediscovery.rate)}`,
				"info",
			);
		},
	});
}
