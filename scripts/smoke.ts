/**
 * Deterministic smoke tests for jev-wiki P0 primitives plus one live Jev round-trip.
 * Run: npm run smoke   (jiti handles TypeScript)
 */
import assert from "node:assert/strict";
import { loadConfig, parseEnvFile } from "../src/config.ts";
import { checkLiterals } from "../src/grounding.ts";
import { createJevClient } from "../src/jev.ts";
import { redact } from "../src/redact.ts";
import { adjudicateClaim, chooseTarget, decideClaim } from "../src/pipeline/adjudicate.ts";
import { parseFrontmatter, serializeFrontmatter } from "../src/wiki/frontmatter.ts";
import { parseIndex, renderIndex } from "../src/wiki/toc.ts";

let failures = 0;

function check(name: string, fn: () => void): void {
	try {
		fn();
		console.log(`  ok  ${name}`);
	} catch (error) {
		failures++;
		console.error(`FAIL  ${name}\n      ${(error as Error).message}`);
	}
}

console.log("env parsing");
check("parses keys, quotes, comments", () => {
	const env = parseEnvFile('A=1\nB = "x y"\n# comment\nC=\n');
	assert.equal(env.A, "1");
	assert.equal(env.B, "x y");
	assert.equal(env.C, "");
});

console.log("\nfrontmatter round-trip");
check("scalars, arrays, and claim lists survive", () => {
	const data = {
		title: 'Auth: "module"',
		type: "architecture/module",
		topic: "architecture",
		summary: "Owns token validation",
		tags: ["auth", "security"],
		updated: "2026-09-19",
		files: ["src/auth/index.ts"],
		claims: [
			{ id: "c1", text: "Tokens are validated in one place.", status: "verified", support: 0.96, evidence: ["raw/auth/notes.md"] },
			{ id: "c2", text: "Sessions never outlive refresh tokens.", status: "disputed", support: 0.41, evidence: [] },
		],
	};
	const text = serializeFrontmatter(data, "# Auth module\n\nBody");
	const parsed = parseFrontmatter(text);
	assert.deepEqual(parsed.data, data);
	assert.equal(parsed.body.trim(), "# Auth module\n\nBody");
});

console.log("\nTOC round-trip");
check("render then parse preserves entries", () => {
	const entries = [
		{ path: "architecture/module-auth.md", title: "Auth module", type: "architecture/module", tags: ["auth"], summary: "Owns tokens", updated: "2026-09-19" },
		{ path: "decisions/decision-db.md", title: "Choose SQLite", type: "decision", tags: [], summary: "Rationale for embedded DB", updated: "2026-09-18" },
	];
	const parsed = parseIndex(renderIndex(entries));
	assert.deepEqual(parsed, entries);
});

console.log("\nredaction and writer grounding");
check("redacts secrets and emails", () => {
	const { text, findings } = redact(
		'Use sk-abcdefghijklmnopqrstuvwxyz0123456789 and mail ops@example.com with Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
	);
	assert.ok(findings.length >= 2, `expected findings, got ${JSON.stringify(findings)}`);
	assert.ok(!text.includes("ops@example.com"));
	assert.ok(!text.includes("sk-abcdefghijklmnopqrstuvwxyz0123456789"));
});
check("flags invented literals but keeps evidenced ones", () => {
	const evidence = "The retry budget is 500 requests and the timeout is 30s.";
	const { missing } = checkLiterals("Retry budget is 500; timeout 30s; observed latency 99ms.", evidence);
	assert.deepEqual(missing, ["99ms"]);
});

console.log("\nconfig");
check("loads .env token and typesafe defaults", () => {
	const loaded = loadConfig(process.cwd());
	assert.ok(loaded.apiKey, "expected JEV_TOKEN from .env");
	assert.equal(loaded.config.provider, "typesafe");
	assert.equal(loaded.config.model, "jev-latest");
	assert.ok(loaded.config.baseUrl.includes("api.typesafe.ai"));
});

console.log("\nlive Jev adjudication");
const loaded = loadConfig(process.cwd());
if (!loaded.apiKey) {
	console.error("FAIL  no API key; skipping live tests");
	failures++;
} else {
	const client = createJevClient(loaded.config, loaded.apiKey);
	const evidence =
		"# Auth notes\n\nThe auth module is the only component allowed to validate session tokens. " +
		"Other modules must call verifyToken() and never inspect the token payload directly. " +
		"This boundary exists because token parsing had security bugs when duplicated across services.";
	const candidatePages = [
		{ path: "architecture/module-auth.md", title: "Auth module", type: "architecture/module", summary: "Owns token validation and sessions", tags: ["auth"] },
		{ path: "architecture/flow-login.md", title: "Login flow", type: "architecture/flow", summary: "End-to-end login", tags: ["auth"] },
		{ path: "decisions/decision-session-store.md", title: "Session store choice", type: "decision", summary: "Why Redis", tags: ["auth"] },
	];
	const candidateClaims = [
		{ text: "Sessions are stored in Redis with a 30-day TTL.", page: "decisions/decision-session-store.md", status: "verified" },
	];

	const good = await adjudicateClaim(
		client,
		{
			text: "The auth module is the only component allowed to validate session tokens; other modules must call verifyToken().",
			kind: "invariant",
			quote: "The auth module is the only component allowed to validate session tokens.",
			files: ["src/auth/index.ts"],
			evidenceText: evidence,
		},
		loaded.config,
		{ candidatePages, candidateClaims, existingTopics: ["architecture", "decisions"], evidenceText: evidence },
	);
	const goodDecision = decideClaim(good.verdicts, loaded.config);
	const placement = await chooseTarget(
		client,
		{ text: "The auth module is the only component allowed to validate session tokens.", kind: "invariant", quote: evidence.split("\n")[2], evidenceText: evidence },
		candidatePages,
		loaded.config,
		{ evidenceText: evidence },
	);
	console.log(`  good claim -> grounded=${good.verdicts.grounded.toFixed(2)} derivable=${good.verdicts.derivable.toFixed(2)} importance=${good.verdicts.importanceNorm.toFixed(2)} action=${goodDecision.action}`);
	console.log(`  placement  -> target=${placement.verdicts.target ?? "(new page)"} anyFit=${(placement.verdicts.anyFit ?? 0).toFixed(2)} newPage=${placement.verdicts.newPage}`);
	check("verdicts and placement are populated", () => {
		assert.ok(Number.isFinite(good.verdicts.grounded));
		assert.ok(Number.isFinite(good.verdicts.derivable));
		assert.ok(["file", "reinforce", "review", "reject_unsupported", "reject_duplicate", "reject_derivable", "reject_sensitive"].includes(goodDecision.action));
		assert.ok(placement.verdicts.target || placement.verdicts.newPage);
		assert.ok(client.totals.input_tokens > 0);
	});

	const trivial = await adjudicateClaim(
		client,
		{
			text: "The verifyToken() function returns a boolean.",
			kind: "fact",
			evidenceText: "function verifyToken(token) { return token.length > 0 }",
			files: ["src/auth/verify.ts"],
		},
		loaded.config,
		{ existingTopics: ["architecture"], evidenceText: "function verifyToken(token) { return token.length > 0 }" },
	);
	const trivialDecision = decideClaim(trivial.verdicts, loaded.config);
	console.log(`  trivial claim -> derivable=${trivial.verdicts.derivable.toFixed(2)} action=${trivialDecision.action}`);
	check("derivability gate fires for an implementation detail", () => {
		assert.equal(trivialDecision.action, "reject_derivable");
	});

	const userEvidence = 'user: user\nquote: "we want the wiki in the project workspace"';
	const userStated = await adjudicateClaim(
		client,
		{
			text: "The wiki root defaults to docs/wiki because knowledge should live next to the code it describes.",
			kind: "decision",
			evidenceText: userEvidence,
		},
		loaded.config,
		{ evidenceText: userEvidence },
	);
	const userDecision = decideClaim(userStated.verdicts, loaded.config);
	console.log(`  user-stated -> trust=${userStated.verdicts.trustTier} grounded=${userStated.verdicts.grounded.toFixed(2)} action=${userDecision.action}`);
	check("user-stated decisions use the lower trust tier instead of being rejected", () => {
		assert.notEqual(userDecision.action, "reject_unsupported");
	});

	console.log(`\nJev usage: ${client.totals.input_tokens} in / ${client.totals.output_tokens} out${client.totals.cost ? ` · $${client.totals.cost.toFixed(6)}` : ""}`);
}

if (failures > 0) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log("\nAll checks passed.");
