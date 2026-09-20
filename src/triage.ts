/**
 * Triage for rejected claims.
 *
 * The decision ledger already holds every verdict. This module turns it into an
 * actionable report: what was rejected, why, whether the rejection is fixable
 * (re-submit with better evidence) or a policy call (high-importance framing),
 * and whether the derivability threshold is calibrated for this project.
 */
import type { LedgerEntry } from "./ledger.ts";

export interface RejectionEntry {
	ts: string;
	claim: string;
	action: string;
	reason: string;
	derivable?: number;
	grounded?: number;
	importance?: number;
	kind?: string;
	trustTier?: string;
}

export interface ScoreStats {
	count: number;
	min: number;
	median: number;
	max: number;
}

export interface TriageReport {
	rejections: RejectionEntry[];
	counts: Record<string, number>;
	separated: {
		acceptedDerivable: ScoreStats | null;
		rejectedDerivable: ScoreStats | null;
		rejectedGrounded: ScoreStats | null;
	};
}

const ADJUDICATE_OPS = new Set(["insight.adjudicate", "ingest.adjudicate"]);
const ACCEPTED = new Set(["file", "reinforce", "file_user_stated"]);

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stats(values: number[]): ScoreStats | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return {
		count: sorted.length,
		min: Number(sorted[0].toFixed(2)),
		median: Number(sorted[Math.floor(sorted.length / 2)].toFixed(2)),
		max: Number(sorted[sorted.length - 1].toFixed(2)),
	};
}

export function buildTriageReport(entries: LedgerEntry[], options?: { limit?: number; sinceDays?: number }): TriageReport {
	const cutoff = options?.sinceDays ? Date.now() - options.sinceDays * 86_400_000 : undefined;
	const rows = entries.filter((entry) => {
		if (!ADJUDICATE_OPS.has(String(entry.op))) return false;
		if (cutoff !== undefined) {
			const ts = Date.parse(String(entry.ts ?? ""));
			if (!Number.isFinite(ts) || ts < cutoff) return false;
		}
		return true;
	});

	const counts: Record<string, number> = {};
	const rejections: RejectionEntry[] = [];
	const acceptedDerivable: number[] = [];
	const rejectedDerivable: number[] = [];
	const rejectedGrounded: number[] = [];

	for (const row of rows) {
		const action = String(row.action ?? "unknown");
		counts[action] = (counts[action] ?? 0) + 1;
		const verdict = asRecord(row.verdict);
		const derivable = asNumber(verdict.derivable);
		const grounded = asNumber(verdict.grounded);
		if (ACCEPTED.has(action) && derivable !== undefined) acceptedDerivable.push(derivable);
		if (action === "reject_derivable" && derivable !== undefined) rejectedDerivable.push(derivable);
		if (action === "reject_unsupported" && grounded !== undefined) rejectedGrounded.push(grounded);
		if (!action.startsWith("reject")) continue;
		rejections.push({
			ts: String(row.ts ?? ""),
			claim: String(row.subject ?? "(unknown claim)"),
			action,
			reason: String(row.reason ?? verdict.reason ?? ""),
			derivable,
			grounded,
			importance: asNumber(verdict.importanceNorm),
			kind: typeof verdict.kind === "string" ? verdict.kind : undefined,
			trustTier: typeof verdict.trustTier === "string" ? verdict.trustTier : undefined,
		});
	}

	rejections.sort((a, b) => b.ts.localeCompare(a.ts));
	const limited = options?.limit ? rejections.slice(0, options.limit) : rejections;

	return {
		rejections: limited,
		counts,
		separated: {
			acceptedDerivable: stats(acceptedDerivable),
			rejectedDerivable: stats(rejectedDerivable),
			rejectedGrounded: stats(rejectedGrounded),
		},
	};
}

/** Concrete next step for a rejected claim. */
export function remedyFor(entry: RejectionEntry): string {
	switch (entry.action) {
		case "reject_derivable": {
			const framing = ["architecture", "invariant", "decision"].includes(entry.kind ?? "") && (entry.importance ?? 0) >= 0.6;
			if (framing) {
				return "High-importance framing: re-submit as-is (kind architecture/invariant/decision) and it will be queued for confirmation instead of dropped.";
			}
			return "Add rationale the code cannot show: a commit message (evidence kind=commit), a source quote, or state the reasoning behind it as kind=decision.";
		}
		case "reject_unsupported":
			return "Ground it: attach a verbatim quote (kind=source), the commit message that introduced it (kind=commit), a file excerpt that states it, or the user's own words (kind=user). Referencing a file without a supporting passage is not enough.";
		case "reject_duplicate":
			return "Already covered: find the page, then reinforce it (wiki_insights with the page's claim) or extend it rather than filing a new claim.";
		case "reject_sensitive":
			return "Contains secrets or PII; redact before re-submitting. Sensitive claims are never written to the wiki.";
		default:
			return "Review the reason above and re-submit with stronger evidence if the claim matters.";
	}
}

export function renderTriage(report: TriageReport): string {
	const lines: string[] = ["# Rejected-claim triage", ""];
	const total = Object.values(report.counts).reduce((sum, count) => sum + count, 0);
	lines.push(
		`Adjudicated: ${total} · accepted ${["file", "reinforce", "file_user_stated"].reduce((sum, action) => sum + (report.counts[action] ?? 0), 0)} · rejected ${Object.entries(report.counts)
			.filter(([action]) => action.startsWith("reject"))
			.reduce((sum, [, count]) => sum + count, 0)} · queued ${report.counts.review ?? 0}`,
		"",
		`Breakdown: ${Object.entries(report.counts)
			.map(([action, count]) => `${action} ${count}`)
			.join(" · ")}`,
		"",
	);

	const { acceptedDerivable, rejectedDerivable, rejectedGrounded } = report.separated;
	if (acceptedDerivable && rejectedDerivable) {
		const overlap = acceptedDerivable.max >= rejectedDerivable.min;
		lines.push(
			`## Threshold separation (project data)`,
			`- accepted claims derivable: ${acceptedDerivable.min}–${acceptedDerivable.max} (median ${acceptedDerivable.median}, n=${acceptedDerivable.count})`,
			`- reject_derivable derivable: ${rejectedDerivable.min}–${rejectedDerivable.max} (median ${rejectedDerivable.median}, n=${rejectedDerivable.count})`,
			overlap
				? `- ⚠️ ranges overlap: the ${"minDerivable"} threshold may be miscalibrated for this project — consider raising thresholds.minDerivable or filing the borderline claims as framing.`
				: `- clean separation: no accepted claim scored at or above the rejected range.`,
			"",
		);
	}
	if (rejectedGrounded) {
		lines.push(
			`- reject_unsupported grounded: ${rejectedGrounded.min}–${rejectedGrounded.max} (median ${rejectedGrounded.median}, n=${rejectedGrounded.count}) — these are evidence problems, not policy problems.`,
			"",
		);
	}

	if (report.rejections.length === 0) {
		lines.push("No rejected claims in the selected window.");
		return lines.join("\n");
	}

	lines.push("## Rejections (newest first)", "", "| When | Action | Claim | Scores | Fix |", "|------|--------|-------|--------|-----|");
	for (const entry of report.rejections) {
		const when = entry.ts.slice(0, 16).replace("T", " ");
		const scores = [
			entry.grounded !== undefined ? `g ${entry.grounded.toFixed(2)}` : "",
			entry.derivable !== undefined ? `d ${entry.derivable.toFixed(2)}` : "",
			entry.importance !== undefined ? `i ${entry.importance.toFixed(2)}` : "",
		]
			.filter(Boolean)
			.join(" · ");
		const claim = entry.claim.replace(/\|/g, "\\|").slice(0, 90);
		lines.push(`| ${when} | ${entry.action} | ${claim} | ${scores || "—"} | ${remedyFor(entry)} |`);
	}
	return lines.join("\n");
}
