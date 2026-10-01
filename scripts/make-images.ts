/**
 * Writes the plugin's static images. Key images come from the same renderer the
 * key uses; list icons are white glyphs on transparent, as Elgato asks.
 * Run: node scripts/make-images.ts
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { statusKey } from "../src/render.ts";

const root = path.join(import.meta.dirname, "..", "com.boxofraccoons.jira-herdr.sdPlugin", "imgs");

/** A 40x40 white list icon from a path drawn in a 144 box. */
function listIcon(inner: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 144 144">${inner}</svg>`;
}
const S = `fill="none" stroke="#FFFFFF" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"`;
const FONT = `font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="bold"`;
const strip = (label: string) =>
	`<rect x="14" y="40" width="116" height="64" rx="10" ${S.replace('stroke-width="12"', 'stroke-width="9"')}/><text x="72" y="84" text-anchor="middle" ${FONT} font-size="34" fill="#FFFFFF">${label}</text>`;
/** A ticket: a card with a folded corner. */
const ticket = `<path d="M 34 22 H 92 L 112 42 V 122 H 34 Z M 92 22 V 42 H 112" ${S}/><path d="M 52 70 H 94 M 52 94 H 82" ${S}/>`;

const ICONS: Record<string, string> = {
	status: `<text x="72" y="100" text-anchor="middle" ${FONT} font-size="86" fill="#FFFFFF">3</text>`,
	"project-dial": strip("PRJ"),
	"ticket-dial": ticket,
};

function dialKey(inner: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" fill="#000000"/>${inner}</svg>`;
}

const sample = statusKey({ status: "To Do", project: "All", count: 3, category: "new", problem: null });
const KEYS: Record<string, string> = {
	status: statusKey({ status: null, project: "All", count: null, category: null, problem: null }),
	"project-dial": dialKey(strip("PRJ")),
	"ticket-dial": dialKey(ticket),
};

for (const [name, svg] of Object.entries(ICONS)) {
	const dir = path.join(root, "actions", name);
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, "icon.svg"), listIcon(svg));
	writeFileSync(path.join(dir, "key.svg"), KEYS[name]);
}

mkdirSync(path.join(root, "plugin"), { recursive: true });
writeFileSync(path.join(root, "plugin", "category-icon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 144 144">${ticket}</svg>`);

function rasterize(svg: string, px: number, out: string): void {
	const dir = mkdtempSync(path.join(tmpdir(), "jira-herdr-img-"));
	const src = path.join(dir, "img.svg");
	writeFileSync(src, svg);
	execFileSync("qlmanage", ["-t", "-s", String(px), "-o", dir, src], { stdio: "ignore" });
	renameSync(`${src}.png`, out);
}
rasterize(sample, 256, path.join(root, "plugin", "marketplace.png"));
rasterize(sample, 512, path.join(root, "plugin", "marketplace@2x.png"));
