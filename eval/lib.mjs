/**
 * Shared helpers for the evaluation harness: argument parsing, git, run directories,
 * and the pairing statistics the report needs. No dependencies, Node 22+.
 */
import { execFile, spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** `--flag value`, `--bool`, `-p value`, with commas split into arrays for --roots/--tasks. */
export function parseArgs(argv, { lists = ["tasks"] } = {}) {
	const out = { _: [] };
	for (let index = 0; index < argv.length; index++) {
		const token = argv[index];
		if (!token.startsWith("-")) {
			out._.push(token);
			continue;
		}
		const key = token.replace(/^-+/, "");
		const next = argv[index + 1];
		const takesValue = next !== undefined && !next.startsWith("--");
		if (!takesValue) {
			out[key] = true;
			continue;
		}
		index += 1;
		out[key] = lists.includes(key) ? next.split(",").map((entry) => entry.trim()).filter(Boolean) : next;
	}
	return out;
}

export function git(cwd, args, { allowFailure = false, trim = true } = {}) {
	return new Promise((res, rej) => {
		execFile("git", args, { cwd, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
			if (error && !allowFailure) rej(new Error(`git ${args.join(" ")} failed in ${cwd}: ${stderr.trim() || error.message}`));
			else res(trim ? stdout.trimEnd() : stdout);
		});
	});
}

export async function gitOk(cwd, args) {
	try {
		await git(cwd, args);
		return true;
	} catch {
		return false;
	}
}

export async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

export async function readJsonl(path) {
	if (!existsSync(path)) return [];
	const text = await readFile(path, "utf8");
	const rows = [];
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim()) continue;
		try {
			rows.push(JSON.parse(line));
		} catch {
			/* a partially written line is dropped, not fatal */
		}
	}
	return rows;
}

export async function appendJsonl(path, row) {
	await mkdir(join(path, ".."), { recursive: true });
	await writeFile(path, `${JSON.stringify(row)}\n`, { encoding: "utf8", flag: "a" });
}

export function runId(prefix = "run") {
	return `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
}

export function nowIso() {
	return new Date().toISOString();
}

/**
 * Spawn a command, streaming its output to a log file as it arrives.
 *
 * Capture-then-print is what makes a long run look like a hang: nothing is visible until the end.
 * Callers get `onLine` for every complete line and `onTick` on an interval, so progress is visible
 * while the process is still running.
 */
export function spawnCapture(command, args, options = {}) {
	const { cwd, timeoutMs = 60_000, env = {}, shell = false, logPath, onLine, onTick, tickMs = 15_000 } = options;
	return new Promise((resolve) => {
		const started = Date.now();
		// Callers should not have to remember to create the log directory: a missing one used to kill the
		// whole run with an unhandled stream error.
		if (logPath) mkdirSync(dirname(logPath), { recursive: true });
		const log = logPath ? createWriteStream(logPath, { flags: "a" }) : undefined;
		// stdin must not be an open pipe: a CLI that reads stdin when it is not a TTY would wait forever
		// for an EOF that never comes, and the run would look identical to a slow model.
		const child = spawn(command, args, { cwd, shell, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
		let stdout = "";
		let stderr = "";
		let lastOutputAt = started;
		let timedOut = false;
		let settled = false;
		const partial = { stdout: "", stderr: "" };

		const finish = (exitCode, extra = {}) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutTimer);
			if (tickTimer) clearInterval(tickTimer);
			log?.end();
			resolve({ exitCode, timedOut, stdout, stderr, wallMs: Date.now() - started, ...extra });
		};

		const consume = (chunk, stream) => {
			const text = chunk.toString();
			lastOutputAt = Date.now();
			if (stream === "stderr") stderr += text;
			else stdout += text;
			log?.write(text);
			partial[stream] += text;
			let index = partial[stream].indexOf("\n");
			while (index !== -1) {
				const line = partial[stream].slice(0, index).replace(/\r$/, "");
				partial[stream] = partial[stream].slice(index + 1);
				if (onLine && line.trim()) onLine(line, stream);
				index = partial[stream].indexOf("\n");
			}
		};

		child.stdout?.on("data", (chunk) => consume(chunk, "stdout"));
		child.stderr?.on("data", (chunk) => consume(chunk, "stderr"));
		child.on("error", (error) => finish(1, { spawnError: String(error) }));
		child.on("close", (code, signal) => finish(typeof code === "number" ? code : 1, { signal: signal ?? null }));

		const timeoutTimer = setTimeout(() => {
			timedOut = true;
			try {
				child.kill();
			} catch {
				/* already gone */
			}
		}, timeoutMs);

		const tickTimer = onTick ? setInterval(() => onTick({ elapsedMs: Date.now() - started, idleMs: Date.now() - lastOutputAt }), tickMs) : undefined;
	});
}

// --- statistics ---------------------------------------------------------------------------------

function erf(x) {
	// Abramowitz & Stegun 7.1.26, adequate for a p-value display.
	const sign = x < 0 ? -1 : 1;
	const ax = Math.abs(x);
	const t = 1 / (1 + 0.3275911 * ax);
	const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
	return sign * y;
}

export function normalTwoSidedP(z) {
	return 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)));
}

/**
 * Wilcoxon signed-rank test on paired differences (arm A − arm B).
 * Exact enumeration for n ≤ 15; normal approximation with tie correction above that.
 */
export function wilcoxonSignedRank(differences) {
	const nonzero = differences.filter((value) => value !== 0);
	const n = nonzero.length;
	if (n === 0) return { n: 0, statistic: 0, p: 1, method: "none" };
	const items = nonzero.map((value) => ({ abs: Math.abs(value), sign: Math.sign(value) })).sort((a, b) => a.abs - b.abs);
	const ranks = new Array(n);
	let cursor = 0;
	while (cursor < n) {
		let end = cursor;
		while (end + 1 < n && items[end + 1].abs === items[cursor].abs) end += 1;
		const rank = (cursor + end + 2) / 2;
		for (let index = cursor; index <= end; index += 1) ranks[index] = rank;
		cursor = end + 1;
	}
	let wPlus = 0;
	for (let index = 0; index < n; index += 1) if (items[index].sign > 0) wPlus += ranks[index];
	const total = (n * (n + 1)) / 2;
	const statistic = Math.min(wPlus, total - wPlus);

	if (n <= 15) {
		const observed = Math.abs(wPlus - total / 2);
		let atLeastAsExtreme = 0;
		for (let mask = 0; mask < 1 << n; mask += 1) {
			let sum = 0;
			for (let index = 0; index < n; index += 1) if (mask & (1 << index)) sum += ranks[index];
			if (Math.abs(sum - total / 2) >= observed - 1e-9) atLeastAsExtreme += 1;
		}
		return { n, statistic, p: atLeastAsExtreme / 2 ** n, method: "exact" };
	}

	// Tie correction: sum of t³ − t over tied groups.
	let tieCorrection = 0;
	cursor = 0;
	while (cursor < n) {
		let end = cursor;
		while (end + 1 < n && items[end + 1].abs === items[cursor].abs) end += 1;
		const t = end - cursor + 1;
		if (t > 1) tieCorrection += t ** 3 - t;
		cursor = end + 1;
	}
	const variance = (n * (n + 1) * (2 * n + 1)) / 24 - tieCorrection / 48;
	if (variance <= 0) return { n, statistic, p: 1, method: "normal" };
	const z = (wPlus - total / 2 - 0.5 * Math.sign(wPlus - total / 2)) / Math.sqrt(variance);
	return { n, statistic, p: normalTwoSidedP(z), method: "normal" };
}

export function median(values) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function mean(values) {
	return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function sd(values) {
	if (values.length < 2) return null;
	const average = mean(values);
	return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

/** Bootstrap CI for the median of a sample, seeded so a report is reproducible. */
export function bootstrapMedianCi(values, { resamples = 2000, alpha = 0.05 } = {}) {
	if (values.length < 2) return { low: null, high: null };
	let seed = 12345;
	const random = () => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed / 0x7fffffff;
	};
	const medians = [];
	for (let iteration = 0; iteration < resamples; iteration += 1) {
		const sample = [];
		for (let index = 0; index < values.length; index += 1) sample.push(values[Math.floor(random() * values.length)]);
		medians.push(median(sample));
	}
	medians.sort((a, b) => a - b);
	return {
		low: medians[Math.floor((alpha / 2) * medians.length)],
		high: medians[Math.min(medians.length - 1, Math.ceil((1 - alpha / 2) * medians.length) - 1)],
	};
}

export function resolveFrom(here, maybeRelative) {
	return resolve(here, maybeRelative);
}
