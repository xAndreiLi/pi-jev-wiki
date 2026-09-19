/**
 * Structure scan: a deterministic map of modules, dependency edges, entry points,
 * and test surface — plus coverage checks against the wiki's architecture pages.
 * No model calls: this is the reproducible substrate an agent can reason over.
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { listMarkdownFiles, readPage, type WikiLayout } from "./wiki/layout.ts";
import { readIndex } from "./wiki/toc.ts";

export interface ModuleInfo {
	dir: string;
	files: number;
	imports: string[];
	importedBy: string[];
	entry: boolean;
}

export interface StructureReport {
	manifests: string[];
	entryPoints: string[];
	totalFiles: number;
	testFiles: number;
	modules: ModuleInfo[];
	wiki: {
		architecturePages: number;
		undocumentedModules: string[];
		staleFileReferences: string[];
	};
}

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".rb"]);
const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	"out",
	".next",
	"coverage",
	"vendor",
	"target",
	".venv",
	"venv",
	"__pycache__",
	".jev-wiki",
	".pi",
]);
const ENTRY_CANDIDATES = ["src/index.ts", "src/main.ts", "src/extension.ts", "src/index.js", "index.js", "main.py", "src/main.rs", "src/main.go"];
const MAX_FILES = 6000;

async function walk(root: string, dir: string, files: string[], depth = 0): Promise<void> {
	if (files.length >= MAX_FILES || depth > 7) return;
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
			await walk(root, full, files, depth + 1);
		} else if (entry.isFile() && CODE_EXTENSIONS.has(extname(entry.name))) {
			files.push(full);
		}
	}
}

function moduleOf(root: string, file: string): string {
	const rel = relative(root, file).split("\\").join("/");
	const parts = rel.split("/");
	if (parts.length === 1) return "(root)";
	if (["src", "packages", "apps", "lib", "modules"].includes(parts[0]) && parts.length > 2) return `${parts[0]}/${parts[1]}`;
	return parts[0];
}

function importSpecifiers(content: string, extension: string): string[] {
	const specs: string[] = [];
	if (extension === ".py") {
		for (const match of content.matchAll(/^\s*(?:from|import)\s+([.\w/]+)/gm)) specs.push(match[1]);
		return specs;
	}
	for (const match of content.matchAll(/from\s+["']([^"']+)["']|import\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g)) {
		const spec = match[1] ?? match[2] ?? match[3];
		if (spec) specs.push(spec);
	}
	return specs;
}

async function findManifests(root: string): Promise<string[]> {
	const candidates = ["package.json", "pyproject.toml", "go.mod", "Cargo.toml", "requirements.txt", "pom.xml", "build.gradle"];
	const found: string[] = [];
	for (const candidate of candidates) if (existsSync(join(root, candidate))) found.push(candidate);
	if (existsSync(join(root, "packages"))) {
		const entries = await readdir(join(root, "packages"), { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			if (entry.isDirectory() && existsSync(join(root, "packages", entry.name, "package.json"))) {
				found.push(`packages/${entry.name}/package.json`);
			}
		}
	}
	return found;
}

export async function scanStructure(root: string, layout?: WikiLayout): Promise<StructureReport> {
	const files: string[] = [];
	await walk(root, root, files);

	const moduleMap = new Map<string, { files: number; imports: Set<string>; importedBy: Set<string>; entry: boolean }>();
	const entryPoints: string[] = [];
	let testFiles = 0;

	for (const file of files) {
		const rel = relative(root, file).split("\\").join("/");
		const moduleName = moduleOf(root, file);
		const record = moduleMap.get(moduleName) ?? { files: 0, imports: new Set<string>(), importedBy: new Set<string>(), entry: false };
		record.files++;
		if (ENTRY_CANDIDATES.includes(rel) || /^src\/(cli|server|index)\.(ts|js|py)$/.test(rel)) {
			record.entry = true;
			entryPoints.push(rel);
		}
		if (/(^|[._-])(test|spec)\./i.test(rel) || rel.includes("/tests/") || rel.startsWith("tests/")) testFiles++;
		moduleMap.set(moduleName, record);
	}

	// import edges (second pass, so all modules exist)
	for (const file of files) {
		const content = await readFile(file, "utf8").catch(() => "");
		if (!content) continue;
		if (content.length > 200_000) continue;
		const from = moduleOf(root, file);
		for (const spec of importSpecifiers(content, extname(file))) {
			if (!spec.startsWith(".")) continue;
			const target = resolve(dirname(file), spec);
			const targetModule = moduleOf(root, target);
			if (targetModule === from) continue;
			const fromRecord = moduleMap.get(from);
			const toRecord = moduleMap.get(targetModule);
			if (fromRecord && toRecord) {
				fromRecord.imports.add(targetModule);
				toRecord.importedBy.add(from);
			}
		}
	}

	const manifests = await findManifests(root);
	const modules: ModuleInfo[] = [...moduleMap.entries()]
		.map(([dir, record]) => ({
			dir,
			files: record.files,
			imports: [...record.imports].sort(),
			importedBy: [...record.importedBy].sort(),
			entry: record.entry,
		}))
		.sort((a, b) => b.files - a.files);

	const wiki = { architecturePages: 0, undocumentedModules: [] as string[], staleFileReferences: [] as string[] };
	if (layout && existsSync(layout.wikiDir)) {
		const entries = await readIndex(layout);
		const architecture = entries.filter((entry) => entry.type.startsWith("architecture/"));
		wiki.architecturePages = architecture.length;
		const documentedText = architecture.map((entry) => `${entry.title} ${entry.summary} ${entry.path}`.toLowerCase());
		const documentedFiles: string[] = [];
		for (const file of await listMarkdownFiles(layout.wikiDir)) {
			if (file.endsWith("index.md") || file.endsWith("log.md")) continue;
			const page = await readPage(file).catch(() => undefined);
			if (!page) continue;
			const referenced = Array.isArray(page.data.files) ? page.data.files.map(String) : [];
			const pageType = String(page.data.type ?? "");
			if (pageType.startsWith("architecture/")) documentedFiles.push(...referenced);
			for (const ref of referenced) {
				if (!existsSync(resolve(root, ref))) {
					wiki.staleFileReferences.push(`${relative(layout.wikiDir, file).split("\\").join("/")} → ${ref}`);
				}
			}
		}
		for (const module of modules) {
			if (module.dir === "(root)") continue;
			const name = module.dir.split("/").pop()!.toLowerCase();
			const prefix = `${module.dir}/`;
			const documented =
				documentedText.some((text) => text.includes(name)) || documentedFiles.some((ref) => ref === module.dir || ref.startsWith(prefix));
			if (!documented) wiki.undocumentedModules.push(module.dir);
		}
	}

	return { manifests, entryPoints, totalFiles: files.length, testFiles, modules, wiki };
}

/** Compact markdown rendering for the wiki_structure tool. */
export function renderStructure(report: StructureReport): string {
	const lines = [
		"# Repository structure",
		"",
		`Files scanned: ${report.totalFiles} · test files: ${report.testFiles}`,
		`Manifests: ${report.manifests.join(", ") || "(none)"}`,
		`Entry points: ${report.entryPoints.join(", ") || "(none detected)"}`,
		"",
		"| Module | Files | Imports | Imported by | Entry |",
		"|--------|-------|---------|-------------|-------|",
	];
	for (const module of report.modules.slice(0, 40)) {
		lines.push(
			`| \`${module.dir}\` | ${module.files} | ${module.imports.slice(0, 5).join(", ") || "—"} | ${module.importedBy.slice(0, 5).join(", ") || "—"} | ${module.entry ? "yes" : ""} |`,
		);
	}
	if (report.wiki.architecturePages > 0 || report.wiki.undocumentedModules.length > 0) {
		lines.push(
			"",
			`Architecture pages: ${report.wiki.architecturePages}`,
			`Modules without an architecture page: ${report.wiki.undocumentedModules.join(", ") || "none"}`,
			`Stale file references in wiki pages: ${report.wiki.staleFileReferences.length}`,
			...report.wiki.staleFileReferences.slice(0, 10).map((ref) => `- ${ref}`),
		);
	}
	return lines.join("\n");
}
