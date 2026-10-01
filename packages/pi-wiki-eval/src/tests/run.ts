/**
 * Tests. No framework: the point is to pin the parsing and classification rules, which are the
 * parts most likely to rot silently against a changing session format.
 *
 * Run with `npm test` (builds first, then executes this against the built output).
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeProject } from "../core/analyze.js";
import { classifyMessage, classifyToolCall, isSearchCall, wikiCallKind } from "../core/classify.js";
import { segmentEpisodes } from "../core/episodes.js";
import { renderReport } from "../core/report.js";
import { joinRediscovery, parseFilesField, pathMatches, samePage } from "../core/retrieval.js";
import { activePath, projectSlug, sameDir, type SessionEntry, type SessionMessage } from "../core/sessions.js";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
	if (condition) {
		passed += 1;
		return;
	}
	failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

function equal<T>(name: string, actual: T, expected: T): void {
	check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const CTX = { wikiRoots: ["C:\\proj\\docs\\wiki"] };

function message(role: string, extra: Partial<SessionMessage> = {}): SessionMessage {
	return { role, ...extra };
}

function entry(id: string, parentId: string | null, body: Partial<SessionEntry>): SessionEntry {
	return { id, parentId, timestamp: `2026-01-01T00:00:0${id.slice(1)}.000Z`, ...body } as SessionEntry;
}

// --- paths -------------------------------------------------------------------------------------

equal("projectSlug windows", projectSlug("C:\\Coding\\pi-jev-wiki"), "--C--Coding-pi-jev-wiki--");
equal("projectSlug posix", projectSlug("/home/liand/dev/app"), "--home-liand-dev-app--");
check("sameDir windows ignores case", sameDir("C:\\Proj\\App", "c:/proj/app"));
check("sameDir posix respects case", !sameDir("/home/a/App", "/home/a/app"));

// --- active branch -----------------------------------------------------------------------------

const withBranch: SessionEntry[] = [
	entry("a1", null, {}),
	entry("a2", "a1", {}),
	entry("a3", "a2", {}),
	entry("dead", "a1", {}),
];
const branch = activePath(withBranch);
// The active leaf is the last entry in the file — here `dead`, so its chain (dead → a1) is the branch.
equal("activePath follows the leaf's chain", branch.entries.length, 2);
check("activePath reports the dropped branch", typeof branch.note === "string");

const broken: SessionEntry[] = [entry("b1", null, {}), entry("b2", "missing-parent", {})];
equal("activePath falls back on a broken chain", activePath(broken).entries.length, 2);

// --- classification ----------------------------------------------------------------------------

const cases: Array<[string, string, unknown, string]> = [
	["wiki tool", "wiki_ask", { query: "x" }, "wiki"],
	["wiki read", "read", { path: "docs/wiki/wiki/architecture/a.md" }, "wiki"],
	["code read", "read", { path: "src/core/analyze.ts" }, "explore"],
	["shell search", "bash", { command: "rg -n 'foo' src" }, "explore"],
	["git history", "bash", { command: "git log --oneline -5" }, "explore"],
	["git commit", "bash", { command: "git commit -m 'x'" }, "act"],
	["tests", "bash", { command: "npm test" }, "verify"],
	["typecheck", "bash", { command: "npx tsc --noEmit" }, "verify"],
	["edit", "edit", { path: "src/a.ts" }, "act"],
	["unknown", "codemode", { script: "..." }, "other"],
];
for (const [label, name, args, expected] of cases) {
	equal(`classify ${label}`, classifyToolCall(name, args, CTX).bucket, expected);
}

check("search detection covers shell rg", isSearchCall("bash", "explore", "rg -n foo src"));
check("search detection ignores non-explore", !isSearchCall("bash", "act", "git commit -m x"));
check("search detection covers grep tool", isSearchCall("grep", "explore"));

const nestedMessage = message("assistant", {
	content: [{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "src/a.ts" } }],
	nestedCalls: { calls: [{ id: "call_1/1", name: "wiki_toc", arguments: {} }, { id: "call_1/2", name: "bash", arguments: { command: "ls" } }] },
});
const classified = classifyMessage(nestedMessage, CTX);
equal("nested calls are flattened", classified.length, 3);
equal("nested wiki call classified as wiki", classified.filter((call) => call.bucket === "wiki").length, 1);
check("nested flag set", classified.filter((call) => call.nested === true).length === 2);

// --- episode segmentation ----------------------------------------------------------------------

const usage = (cost: number): Record<string, unknown> => ({ input: 10, output: 5, cacheRead: 100, cacheWrite: 0, totalTokens: 115, cost: { total: cost } });
const session: SessionEntry[] = [
	entry("a0", null, {}),
	entry("a1", "a0", { type: "message", message: message("user", { content: [{ type: "text", text: "first prompt" }] }) }),
	entry("a2", "a1", {
		type: "message",
		message: message("assistant", {
			model: "test-model",
			stopReason: "toolUse",
			usage: usage(0.01),
			content: [
				{ type: "toolCall", id: "c1", name: "read", arguments: { path: "src/a.ts" } },
				{ type: "toolCall", id: "c2", name: "edit", arguments: { path: "src/a.ts" } },
			],
		}),
	}),
	entry("a3", "a2", {
		type: "message",
		message: message("toolResult", { toolCallId: "c1", toolName: "read", content: [{ type: "text", text: "x".repeat(400) }] }),
	}),
	entry("a4", "a3", { type: "custom_message", customType: "jev-wiki", content: "brief text" }),
	entry("a5", "a4", { type: "message", message: message("assistant", { model: "test-model", stopReason: "stop", usage: usage(0.02), content: [{ type: "text", text: "done" }] }) }),
	entry("a6", "a5", { type: "message", message: message("user", { content: [{ type: "text", text: "second prompt" }] }) }),
	entry("a7", "a6", { type: "message", message: message("assistant", { model: "test-model", stopReason: "stop", usage: usage(0.03), content: [{ type: "text", text: "done" }] }) }),
	// A maintenance-only episode: it files knowledge but never reads the wiki.
	entry("a8", "a7", { type: "message", message: message("user", { content: [{ type: "text", text: "third prompt" }] }) }),
	entry("a9", "a8", {
		type: "message",
		message: message("assistant", {
			model: "test-model",
			stopReason: "toolUse",
			usage: usage(0.04),
			content: [{ type: "toolCall", id: "c3", name: "wiki_review", arguments: { action: "list" } }],
		}),
	}),
	entry("a10", "a9", { type: "message", message: message("assistant", { model: "test-model", stopReason: "stop", usage: usage(0.01), content: [] }) }),
];
const episodes = segmentEpisodes("synthetic.jsonl", session, CTX);
equal("three episodes", episodes.length, 3);
equal("first episode settled", episodes[0]?.endReason, "settled");
equal("first episode cost summed", Math.round((episodes[0]?.usage.cost ?? 0) * 100), 3);
equal("first episode read one file", episodes[0]?.readFiles.length, 1);
equal("first episode read chars from the result", episodes[0]?.readChars, 400);
equal("first episode counted the injected brief", episodes[0]?.injected.count, 1);
equal("first episode bucket counts", episodes[0]?.byBucket.explore, 1);
equal("edit recorded as act", episodes[0]?.byBucket.act, 1);
equal("first episode has a model", episodes[0]?.models["test-model"], 2);
equal("second episode is separate", Math.round((episodes[1]?.usage.cost ?? 0) * 100), 3);
equal("maintenance episode counted as a wiki write", episodes[2]?.wikiWrites, 1);
equal("maintenance episode is not a consultation", episodes[2]?.wikiReads, 0);
equal("reading episode counted as a wiki read", episodes[0]?.wikiReads, 0);
equal("wiki_ask is a read", wikiCallKind("wiki_ask"), "read");
equal("wiki_review is a write", wikiCallKind("wiki_review"), "write");
equal("an unknown wiki tool is not a consultation", wikiCallKind("wiki_something_new"), "write");

// --- frontmatter and joins ---------------------------------------------------------------------

equal("inline files field", parseFilesField("files: [a.ts, b.ts]").length, 2);
equal("block files field", parseFilesField("files:\n  - src/a.ts\n  - src/b.ts").length, 2);
equal("missing files field", parseFilesField("title: x").length, 0);
check("samePage matches a wiki-relative page", samePage("wiki/architecture/a.md", "architecture/a.md"));
check("pathMatches matches basename", pathMatches("src/core/a.ts", "C:/proj/src/core/a.ts"));

const target = episodes[0];
const rediscovery = target
	? joinRediscovery(
			target,
			[{ ts: "2026-01-01T00:00:02.000Z", pages: ["architecture/a.md"] }],
			new Map([["wiki/architecture/a.md", ["src/a.ts"]]]),
		)
	: undefined;
equal("retrieval event attributed to the episode", rediscovery?.retrievedPages.length, 1);
equal("rediscovery counted the read file", rediscovery?.rediscoveredCount, 1);
equal("rediscovery rate", rediscovery?.rate, 1);

// An episode with no end of its own must not absorb later retrieval events: without a bound, a
// project's whole future history would be attributed to whichever episode happened to be last.
const pageFilesFixture = new Map([["wiki/architecture/a.md", ["src/a.ts"]]]);
const unsettled = target ? { ...target, endedAt: undefined, startedAt: "2026-01-01T00:00:00.000Z" } : undefined;
const laterEvent = [{ ts: "2026-03-01T00:00:00.000Z", pages: ["architecture/a.md"] }];
if (unsettled) {
	equal("an unbounded episode attributes nothing", joinRediscovery(unsettled, laterEvent, pageFilesFixture).retrievedPages.length, 0);
	equal("an explicit window bounds it", joinRediscovery(unsettled, laterEvent, pageFilesFixture, "2026-04-01T00:00:00.000Z").retrievedPages.length, 1);
	equal("an event after the window is excluded", joinRediscovery(unsettled, laterEvent, pageFilesFixture, "2026-02-01T00:00:00.000Z").retrievedPages.length, 0);
	equal("an event before the episode is excluded", joinRediscovery(unsettled, [{ ts: "2025-12-01T00:00:00.000Z", pages: ["architecture/a.md"] }], pageFilesFixture, "2026-04-01T00:00:00.000Z").retrievedPages.length, 0);
}

// --- end to end --------------------------------------------------------------------------------

async function endToEnd(): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "pi-wiki-eval-"));
	const project = join(root, "proj");
	const agent = join(root, "agent");
	try {
		await mkdir(join(agent, "sessions", projectSlug(project)), { recursive: true });
		await mkdir(join(project, "docs", "wiki", "wiki", "architecture"), { recursive: true });
		await mkdir(join(project, "docs", "wiki", ".jev-wiki"), { recursive: true });
		await mkdir(join(project, "src"), { recursive: true });
		await writeFile(join(project, "src", "a.ts"), "export const a = 1;\n", "utf8");
		await writeFile(
			join(project, "docs", "wiki", "wiki", "architecture", "a.md"),
			"---\ntitle: A\ntype: architecture/module\ntopic: architecture\nfiles: [src/a.ts]\n---\n\n# A\n\nBody.\n",
			"utf8",
		);
		await writeFile(
			join(project, "docs", "wiki", ".jev-wiki", "metrics.jsonl"),
			`${JSON.stringify({ ts: "2026-01-01T00:00:02.000Z", op: "ask", query: "how does a work", pages: ["architecture/a.md"] })}\n`,
			"utf8",
		);
		const lines = [
			JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-01-01T00:00:00.000Z", cwd: project }),
			JSON.stringify(entry("a1", null, { type: "message", message: message("user", { content: [{ type: "text", text: "change a" }] }) })),
			JSON.stringify(
				entry("a2", "a1", {
					type: "message",
					message: message("assistant", {
						model: "test-model",
						stopReason: "toolUse",
						usage: usage(0.02),
						content: [
							{ type: "toolCall", id: "c0", name: "wiki_ask", arguments: { query: "how does a work" } },
							{ type: "toolCall", id: "c1", name: "read", arguments: { path: "src/a.ts" } },
						],
					}),
				}),
			),
			JSON.stringify(
				entry("a3", "a2", {
					type: "message",
					message: message("toolResult", { toolCallId: "c0", toolName: "wiki_ask", content: [{ type: "text", text: "### architecture/a.md (score 0.9)" }] }),
				}),
			),
			JSON.stringify(
				entry("a3b", "a3", {
					type: "message",
					message: message("toolResult", { toolCallId: "c1", toolName: "read", content: [{ type: "text", text: "export const a = 1;" }] }),
				}),
			),
			JSON.stringify(entry("a4", "a3b", { type: "message", message: message("assistant", { model: "test-model", stopReason: "stop", usage: usage(0.01), content: [] }) })),
			"not json at all",
		];
		await writeFile(join(agent, "sessions", projectSlug(project), "2026-01-01T00-00-00-000Z_s1.jsonl"), `${lines.join("\n")}\n`, "utf8");

		const analysis = await analyzeProject({ projectDir: project, agentDir: agent, sessionsRoot: join(agent, "sessions") });
		equal("end-to-end episode count", analysis.totals.episodes, 1);
		equal("end-to-end cost", Math.round(analysis.totals.usage.cost * 100), 3);
		equal("end-to-end consultation", analysis.totals.consultedEpisodes, 1);
		equal("end-to-end rediscovery rate", analysis.totals.rediscovery.rate, 1);
		check("end-to-end wiki calls classified", analysis.totals.byBucket.wiki >= 1);
		equal("end-to-end parse warning recorded", analysis.sessions[0]?.warnings.length, 1);
		equal("end-to-end episode label", analysis.episodes[0]?.label, "E01");

		const report = renderReport(analysis);
		check("report has the accounting section", report.includes("## Context accounting"));
		check("report names the episode label", report.includes("E01"));
		check("report shows the rediscovery rate", report.includes("100.0%"));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

await endToEnd();

for (const failure of failures) console.log(`FAIL  ${failure}`);
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length === 0 ? 0 : 1);
