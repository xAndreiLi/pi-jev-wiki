#!/usr/bin/env node
/**
 * pi-wiki-eval — command line surface.
 *
 *   pi-wiki-eval [--project <dir>] [--since <days>] [--episodes <n>]
 *                [--include-queries] [--json] [--out <file>]
 *
 * Reads pi session files, the wiki's own state, and nothing else. No network, no model calls.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { analyzeProject, type AnalyzeOptions } from "./core/analyze.js";
import { discoverProjects } from "./core/projects.js";
import { renderReport, renderSummaryTable, summarize } from "./core/report.js";
import { resolveAgentPaths } from "./core/sessions.js";

export interface CliArgs {
	project: string;
	sinceDays?: number;
	episodes?: number;
	includeQueries: boolean;
	json: boolean;
	out?: string;
	agentDir?: string;
	sessionsRoot?: string;
	allProjects: boolean;
	roots?: string[];
	help: boolean;
}

const HELP = `pi-wiki-eval — where did the agent's context go, and did the wiki replace discovery?

Usage:
  pi-wiki-eval [options]

Options:
  --project <dir>       Project to analyse (default: current directory)
  --all-projects        Summarise every project with session history, one row each
  --roots <dirs>        Comma-separated session roots for --all-projects
  --since <days>        Only episodes from the last N days
  --episodes <n>        Episodes to tabulate in the report (default: 20)
  --include-queries     Include prompt and wiki query text (off by default)
  --agent-dir <dir>     Override the pi agent directory (default: ~/.pi/agent)
  --sessions-root <dir> Override the session directory
  --json                Print the raw analysis as JSON instead of markdown
  --out <file>          Write the report to a file as well as stdout
  --version             Print the package version
  --help                Show this message

Everything is read from local files: pi's session JSONL, the project's wiki state, and git.
Nothing is sent anywhere.`;

export function parseArgs(argv: string[]): CliArgs | { error: string } {
	const args: CliArgs = { project: process.cwd(), includeQueries: false, json: false, allProjects: false, help: false };
	for (let index = 0; index < argv.length; index++) {
		const flag = argv[index];
		const next = (): string | undefined => argv[++index];
		switch (flag) {
			case "--project":
			case "-p": {
				const value = next();
				if (!value) return { error: `${flag} needs a directory` };
				args.project = resolve(value);
				break;
			}
			case "--since": {
				const value = Number(next());
				if (!Number.isFinite(value) || value <= 0) return { error: "--since needs a positive number of days" };
				args.sinceDays = value;
				break;
			}
			case "--episodes": {
				const value = Number(next());
				if (!Number.isFinite(value) || value <= 0) return { error: "--episodes needs a positive number" };
				args.episodes = value;
				break;
			}
			case "--agent-dir": {
				const value = next();
				if (!value) return { error: "--agent-dir needs a directory" };
				args.agentDir = resolve(value);
				break;
			}
			case "--sessions-root": {
				const value = next();
				if (!value) return { error: "--sessions-root needs a directory" };
				args.sessionsRoot = resolve(value);
				break;
			}
			case "--out": {
				const value = next();
				if (!value) return { error: "--out needs a file path" };
				args.out = resolve(value);
				break;
			}
			case "--roots": {
				const value = next();
				if (!value) return { error: "--roots needs a comma-separated list of session roots" };
				args.roots = value.split(",").map((entry) => entry.trim()).filter(Boolean);
				break;
			}
			case "--all-projects":
				args.allProjects = true;
				break;
			case "--include-queries":
				args.includeQueries = true;
				break;
			case "--json":
				args.json = true;
				break;
			case "--help":
			case "-h":
				args.help = true;
				break;
			default:
				return { error: `unknown option: ${flag}` };
		}
	}
	return args;
}

async function packageVersion(): Promise<string> {
	try {
		const raw = await readFile(new URL("../package.json", import.meta.url), "utf8");
		const parsed = JSON.parse(raw) as { version?: string };
		return parsed.version ?? "unknown";
	} catch {
		return "unknown";
	}
}

export async function run(argv: string[]): Promise<{ code: number; output: string }> {
	if (argv.includes("--version")) return { code: 0, output: await packageVersion() };
	const parsed = parseArgs(argv);
	if ("error" in parsed) return { code: 2, output: `${parsed.error}\n\n${HELP}` };
	if (parsed.help) return { code: 0, output: HELP };

	const analysisOptions: AnalyzeOptions = {
		projectDir: parsed.project,
		includeQueries: parsed.includeQueries,
		...(parsed.sinceDays !== undefined ? { sinceDays: parsed.sinceDays } : {}),
		...(parsed.agentDir ? { agentDir: parsed.agentDir } : {}),
		...(parsed.sessionsRoot ? { sessionsRoot: parsed.sessionsRoot } : {}),
	};

	if (parsed.allProjects) {
		const defaults = resolveAgentPaths();
		const roots = parsed.roots && parsed.roots.length > 0
			? parsed.roots
			: [parsed.sessionsRoot ?? (parsed.agentDir ? join(parsed.agentDir, "sessions") : defaults.sessionsRoot)];
		const discovered = await discoverProjects(roots);
		const analyses = [];
		for (const project of discovered) {
			analyses.push(
				await analyzeProject({
					...analysisOptions,
					projectDir: project.projectPath,
					sessionDir: project.slugDir,
					sessionsRoot: project.sessionsRoot,
				}),
			);
		}
		const summaries = analyses.map((analysis) => summarize(analysis));
		if (parsed.json) {
			const text = `${JSON.stringify({ roots, summaries, analyses }, null, "\t")}\n`;
			if (parsed.out) await writeFile(parsed.out, text, "utf8");
			return { code: 0, output: text };
		}
		const header = [
			"# Cross-project summary",
			"",
			`${discovered.length} project(s) with session history across ${roots.length} root(s).`,
			`Explore/Wiki are shares of all tool calls; Consult is the share of episodes that used the wiki; Rediscovery is the share of files declared by retrieved pages that the agent read anyway.`,
			"",
		];
		const text = `${header.join("\n")}${renderSummaryTable(summaries)}\n`;
		if (parsed.out) await writeFile(parsed.out, text, "utf8");
		return { code: 0, output: text };
	}

	const analysis = await analyzeProject(analysisOptions);

	if (parsed.json) {
		const text = `${JSON.stringify(analysis, null, "\t")}\n`;
		if (parsed.out) await writeFile(parsed.out, text, "utf8");
		return { code: 0, output: text };
	}

	const report = renderReport(analysis, {
		includeQueries: parsed.includeQueries,
		...(parsed.episodes !== undefined ? { maxEpisodes: parsed.episodes } : {}),
	});
	if (parsed.out) await writeFile(parsed.out, `${report}\n`, "utf8");
	if (analysis.totals.episodes === 0) {
		return { code: 0, output: `${report}\n\nNo episodes found. Check --project, or pass --sessions-root if pi stores sessions elsewhere.\n` };
	}
	return { code: 0, output: report };
}

const invoked = process.argv[1] ?? "";
if (invoked.endsWith("cli.js") || invoked.endsWith("cli.ts")) {
	run(process.argv.slice(2))
		.then((result) => {
			process.stdout.write(`${result.output}\n`);
			process.exit(result.code);
		})
		.catch((error: unknown) => {
			process.stderr.write(`pi-wiki-eval failed: ${error instanceof Error ? error.message : String(error)}\n`);
			process.exit(1);
		});
}
