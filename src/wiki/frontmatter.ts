/**
 * Minimal YAML frontmatter support for the subset jev-wiki writes:
 * flat scalars, inline arrays of scalars, and lists of flat maps (with inline arrays).
 */

export interface Frontmatter {
	data: Record<string, unknown>;
	body: string;
}

const KEY_RE = /^([A-Za-z0-9_-]+):(.*)$/;

function parseScalar(raw: string): unknown {
	const value = raw.trim();
	if (value === "") return "";
	if (value === "null" || value === "~") return null;
	if (value === "true") return true;
	if (value === "false") return false;
	if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
	if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
		try {
			return JSON.parse(value);
		} catch {
			return value.slice(1, -1);
		}
	}
	if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
		return value.slice(1, -1).replace(/''/g, "'");
	}
	if (value.startsWith("[") && value.endsWith("]")) {
		const inner = value.slice(1, -1).trim();
		if (!inner) return [];
		return splitInline(inner).map(parseScalar);
	}
	return value;
}

function splitInline(input: string): string[] {
	const parts: string[] = [];
	let current = "";
	let quote: string | null = null;
	for (const char of input) {
		if (quote) {
			current += char;
			if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			current += char;
			continue;
		}
		if (char === ",") {
			parts.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	if (current.trim()) parts.push(current);
	return parts.map((part) => part.trim());
}

export function parseFrontmatter(text: string): Frontmatter {
	const normalized = text.replace(/^\uFEFF/, "");
	if (!normalized.startsWith("---")) return { data: {}, body: normalized };
	const end = normalized.indexOf("\n---", 3);
	if (end === -1) return { data: {}, body: normalized };
	const block = normalized.slice(4, end).replace(/\r/g, "");
	const body = normalized.slice(end + 4).replace(/^\r?\n/, "");
	return { data: parseYamlBlock(block), body };
}

export function parseYamlBlock(block: string): Record<string, unknown> {
	const root: Record<string, unknown> = {};
	let currentListKey: string | null = null;
	let currentItem: Record<string, unknown> | null = null;

	for (const rawLine of block.split("\n")) {
		if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
		const indent = rawLine.match(/^ */)?.[0].length ?? 0;
		const line = rawLine.trim();

		if (indent === 0) {
			currentListKey = null;
			currentItem = null;
			const match = line.match(KEY_RE);
			if (!match) continue;
			const [, key, rest] = match;
			if (rest.trim() === "") {
				root[key] = [];
				currentListKey = key;
			} else {
				root[key] = parseScalar(rest);
			}
			continue;
		}

		if (line.startsWith("- ")) {
			if (!currentListKey) continue;
			const rest = line.slice(2).trim();
			const list = root[currentListKey] as unknown[];
			const match = rest.match(KEY_RE);
			if (match) {
				currentItem = { [match[1]]: parseScalar(match[2]) };
				list.push(currentItem);
			} else {
				currentItem = null;
				list.push(parseScalar(rest));
			}
			continue;
		}

		const match = line.match(KEY_RE);
		if (match && currentItem) currentItem[match[1]] = parseScalar(match[2]);
	}
	return root;
}

function formatScalar(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	const text = String(value);
	if (text === "") return '""';
	if (/^[\s]|[\s]$|[:#\[\]{},"'|>&*!%@`]|^-|^[?]/.test(text) || text.includes("\n")) {
		return JSON.stringify(text);
	}
	if (/^(true|false|null|~)$/i.test(text) || /^-?\d+(\.\d+)?$/.test(text)) return JSON.stringify(text);
	return text;
}

function formatInlineArray(values: unknown[]): string {
	return `[${values.map((value) => (Array.isArray(value) ? formatInlineArray(value) : formatScalar(value))).join(", ")}]`;
}

export function serializeFrontmatter(data: Record<string, unknown>, body: string): string {
	const lines = ["---"];
	for (const [key, value] of Object.entries(data)) {
		if (value === undefined) continue;
		if (Array.isArray(value)) {
			if (value.length === 0) {
				lines.push(`${key}: []`);
				continue;
			}
			if (value.every((item) => item === null || typeof item !== "object" || Array.isArray(item))) {
				lines.push(`${key}: ${formatInlineArray(value)}`);
				continue;
			}
			lines.push(`${key}:`);
			for (const item of value) {
				const entries = Object.entries(item as Record<string, unknown>).filter(([, v]) => v !== undefined);
				entries.forEach(([childKey, childValue], index) => {
					const prefix = index === 0 ? "  - " : "    ";
					const rendered = Array.isArray(childValue) ? formatInlineArray(childValue) : formatScalar(childValue);
					lines.push(`${prefix}${childKey}: ${rendered}`);
				});
			}
			continue;
		}
		lines.push(`${key}: ${formatScalar(value)}`);
	}
	lines.push("---", "", body.replace(/\s+$/, ""), "");
	return lines.join("\n");
}
