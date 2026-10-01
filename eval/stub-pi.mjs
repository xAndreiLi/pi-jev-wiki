#!/usr/bin/env node
/**
 * A stand-in for pi that calls no model, so the self-test can drive the real runner and judge.
 *
 * It answers like pi (prints a reply, writes a session pi-wiki-eval can measure), and it records what an
 * agent standing in its working directory could see — the check R1 lacked. Environment:
 *
 *   EVAL_STUB_PROBE   append one JSON line per invocation describing what was visible
 *   EVAL_STUB_CANARY  the card's canary: report whether it is anywhere in the working tree
 *   EVAL_STUB_WANDER  a path to "read", whose result carries the canary — for testing the scan
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, relative } from "node:path";

const argv = process.argv.slice(2);
const option = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
const prompt = option("-p") ?? "";
const sessionDir = option("--session-dir");
const agentDir = process.env.PI_CODING_AGENT_DIR ?? "";
const canary = process.env.EVAL_STUB_CANARY ?? "";
const wander = process.env.EVAL_STUB_WANDER ?? "";
const git = (...args) => {
	try {
		return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return null;
	}
};

/** The files an agent would find with `ls` and `find`: what is on disk, not what the git index holds. */
function visibleFiles(dir, found = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if ([".git", "node_modules", ".venv"].includes(entry.name)) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) visibleFiles(full, found);
		else found.push(relative(process.cwd(), full).replace(/\\/g, "/"));
	}
	return found;
}

const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
const hasWiki = (settings.packages ?? []).some((entry) => String(entry?.source ?? entry).includes("pi-jev-wiki"));
const excluded = (option("--exclude-tools") ?? "").split(",").filter(Boolean);
const tools = argv.includes("--no-tools") ? [] : ["read", "bash", "edit", "write", "web_search", ...(hasWiki ? ["wiki_ask", "wiki_toc", "wiki_status", "wiki_insights", "wiki_finalize"] : [])].filter((tool) => !excluded.includes(tool));
const kind = prompt.startsWith("Reply with exactly") ? "preflight" : prompt.includes("Return only a JSON object") ? "judge" : "agent";

if (process.env.EVAL_STUB_PROBE) {
	const files = kind === "agent" ? visibleFiles(process.cwd()) : [];
	appendFileSync(
		process.env.EVAL_STUB_PROBE,
		`${JSON.stringify({
			kind,
			cwd: process.cwd(),
			agentDirEnv: agentDir,
			tools,
			prompt,
			userContext: existsSync(join(agentDir, "AGENTS.md")),
			registry: existsSync(join(agentDir, "jev-wiki", "wikis.json")),
			remotes: git("remote"),
			status: git("status", "--porcelain"),
			files,
			canaryInTree: canary ? files.filter((file) => statSync(file).size < 1_000_000 && readFileSync(file, "utf8").includes(canary)).join(", ") || null : null,
		})}\n`,
	);
}

// The agent's "work": one source file, and — in a wiki arm that may still write — a wiki page and a
// ledger line with Jev usage, as the extension writes them.
const calls = [];
const results = [];
if (kind === "agent") {
	mkdirSync("src", { recursive: true });
	writeFileSync(join("src", "stub-work.js"), "export const work = true;\n");
	calls.push({ type: "toolCall", id: "c1", name: "write", arguments: { path: "src/stub-work.js", content: "export const work = true;\n" } });
	results.push({ id: "c1", name: "write", text: "ok" });
	if (tools.includes("wiki_insights") && existsSync(join("docs", "wiki"))) {
		mkdirSync(join("docs", "wiki", "wiki", "notes"), { recursive: true });
		writeFileSync(join("docs", "wiki", "wiki", "notes", "stub.md"), "---\ntitle: Stub\n---\n");
		mkdirSync(join("docs", "wiki", ".jev-wiki"), { recursive: true });
		appendFileSync(join("docs", "wiki", ".jev-wiki", "decisions.jsonl"), `${JSON.stringify({ op: "insight.adjudicated", usage: { input_tokens: 1000, output_tokens: 100 } })}\n`);
		calls.push({ type: "toolCall", id: "c2", name: "wiki_insights", arguments: { insights: [{ text: "stub" }] } });
		results.push({ id: "c2", name: "wiki_insights", text: "filed" });
	}
	if (wander) {
		calls.push({ type: "toolCall", id: "c3", name: "read", arguments: { path: wander } });
		results.push({ id: "c3", name: "read", text: `// eval-canary: ${canary}` });
	}
}

let reply = "ok";
if (kind === "judge") {
	const labels = (/Score every label you were given \(([^)]*)\)/.exec(prompt)?.[1] ?? "").split(",").map((label) => label.trim()).filter(Boolean);
	const scores = { correctness: 2, conventions: 2, scope: 2, edge_cases: 2, clarity: 2, restraint: 2 };
	reply = JSON.stringify({ labels: labels.map((label) => ({ label, scores, verdict: "merge_with_nits", notes: "stub", test_changes_weaken_tests: false })), comparison: "stub" });
}

if (sessionDir) {
	mkdirSync(sessionDir, { recursive: true });
	const now = new Date().toISOString();
	const usage = { input: 100, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 110, cost: { total: 0.001 } };
	const entries = [
		{ type: "thinking_level_change", thinkingLevel: "off" },
		{ type: "message", message: { role: "system", content: "", sections: { tools: `<tools>\n${tools.map((tool) => `- ${tool}: stub`).join("\n")}\n</tools>`, cwd: `<cwd>\n${process.cwd()}\n</cwd>` } } },
		{ type: "message", message: { role: "user", content: [{ type: "text", text: prompt }] } },
		{ type: "message", message: { role: "assistant", content: calls, usage, stopReason: calls.length ? "toolUse" : "stop" } },
		...results.map((result) => ({ type: "message", message: { role: "toolResult", toolCallId: result.id, toolName: result.name, content: [{ type: "text", text: result.text }] } })),
		{ type: "message", message: { role: "assistant", content: [{ type: "text", text: reply }], usage, stopReason: "stop" } },
	];
	let parentId = null;
	const lines = [{ type: "session", version: 3, id: randomUUID(), timestamp: now, cwd: process.cwd() }];
	entries.forEach((entry, index) => {
		const id = `e${index}`;
		lines.push({ ...entry, id, parentId, timestamp: now });
		parentId = id;
	});
	writeFileSync(join(sessionDir, `${now.replace(/[:.]/g, "-")}_${randomUUID()}.jsonl`), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
}
console.log(reply);
