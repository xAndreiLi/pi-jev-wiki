/** Markdown link helpers shared by the extension and lint. */

export function extractMarkdownLinks(markdown: string): string[] {
	const links: string[] = [];
	for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
		links.push(match[1].trim());
	}
	return links;
}

export function isExternalLink(link: string): boolean {
	return /^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith("#");
}

export function linkTarget(link: string): string {
	return link.split("#")[0].trim();
}
