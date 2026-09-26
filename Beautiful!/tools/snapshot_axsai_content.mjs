#!/usr/bin/env node
/**
 * Produces the local AXSAI reading snapshot used by Project Orbit.
 *
 * This intentionally runs only during authoring. The public site imports the
 * generated TypeScript data and never requests axsai.com at runtime.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const site = "https://axsai.com";
const output = new URL("../src/axsaiContent.ts", import.meta.url);

const page = (id, worldId, itemIndex, url) => ({ id, worldId, itemIndex, url, kind: "page" });

const targets = [
  page("about:01", "about", "01", `${site}/about-us/who-we-are/`),
  page("about:02", "about", "02", `${site}/about-us/vision-and-values/`),
  page("about:03", "about", "03", `${site}/about-us/our-people/`),
  page("about:04", "about", "04", `${site}/about-us/quality/`),
  page("about:05", "about", "05", `${site}/about-us/our-clients/`),

  page("services:01", "services", "01", `${site}/services/application-development/`),
  page("services:02", "services", "02", `${site}/services/application-maintenance-and-support/`),
  page("services:03", "services", "03", `${site}/services/independent-validation-and-testing/`),
  page("services:04", "services", "04", `${site}/services/mobile-app-development/`),
  page("services:05", "services", "05", `${site}/services/artificial-intelligence/`),
  page("services:06", "services", "06", `${site}/services/aws-migration/`),
  page("services:07", "services", "07", `${site}/services/dev-ops/`),
  page("services:08", "services", "08", `${site}/services/big-data-analytics/`),
  page("services:09", "services", "09", `${site}/services/cloud-automation-and-hosting/`),
  page("services:10", "services", "10", `${site}/services/business-transformation/`),
  page("services:11", "services", "11", `${site}/services/digital-transformation-cybersecurity-governance/`),

  page("solution:01", "solution", "01", `${site}/solution/akin/`),
  page("solution:02", "solution", "02", `${site}/solution/nimos/`),
  page("solution:03", "solution", "03", `${site}/solution/minerva-365/`),

  page("work-flow:01", "work-flow", "01", `${site}/work-flow/estimate-the-job/`),
  page("work-flow:02", "work-flow", "02", `${site}/work-flow/team-assignment/`),
  page("work-flow:03", "work-flow", "03", `${site}/work-flow/communication-within-the-team/`),
  page("work-flow:04", "work-flow", "04", `${site}/work-flow/track-the-progress/`),

  page("technology-stack:01", "technology-stack", "01", `${site}/technology-stack/mern/`),
  page("technology-stack:02", "technology-stack", "02", `${site}/technology-stack/mern/node/`),
  page("technology-stack:03", "technology-stack", "03", `${site}/technology-stack/mern/react-js/`),
  page("technology-stack:04", "technology-stack", "04", `${site}/technology-stack/mern/express/`),
  page("technology-stack:05", "technology-stack", "05", `${site}/technology-stack/php/`),
  page("technology-stack:06", "technology-stack", "06", `${site}/technology-stack/php/symfony/`),
  page("technology-stack:07", "technology-stack", "07", `${site}/technology-stack/php/wordpress/`),
  page("technology-stack:08", "technology-stack", "08", `${site}/technology-stack/php/magento/`),
  page("technology-stack:09", "technology-stack", "09", `${site}/technology-stack/mobile/`),
  page("technology-stack:10", "technology-stack", "10", `${site}/technology-stack/mobile/swift/`),
  page("technology-stack:11", "technology-stack", "11", `${site}/technology-stack/mobile/react-native/`),
  page("technology-stack:12", "technology-stack", "12", `${site}/technology-stack/mobile/kotlin/`),
  page("technology-stack:13", "technology-stack", "13", `${site}/technology-stack/devops/`),
  page("technology-stack:14", "technology-stack", "14", `${site}/technology-stack/devops/jenkins/`),
  page("technology-stack:15", "technology-stack", "15", `${site}/technology-stack/devops/amazon-web-services/`),
  page("technology-stack:16", "technology-stack", "16", `${site}/technology-stack/devops/docker/`),
  page("technology-stack:17", "technology-stack", "17", `${site}/technology-stack/devops/vibrant/`),

  page("tools:01", "tools", "01", `${site}/tools/slack/`),
  page("tools:02", "tools", "02", `${site}/tools/jira-software/`),
  page("tools:03", "tools", "03", `${site}/tools/zeplin/`),
  page("tools:04", "tools", "04", `${site}/tools/figma/`),
  page("tools:05", "tools", "05", `${site}/tools/github/`),
  page("tools:06", "tools", "06", `${site}/tools/bitbucket/`),
  page("tools:07", "tools", "07", `${site}/tools/confluence/`),

  page("products", "products", null, `${site}/our-products-2/`),
  page("clients", "clients", null, `${site}/about-us/our-clients/`),
  page("why-axsai", "why-axsai", null, `${site}/about-us/why-axsai/`),
  { id: "blog", worldId: "blog", itemIndex: null, url: `${site}/blog/`, kind: "blog-index" },
  page("contact", "contact", null, `${site}/contact/`),
];

const namedEntities = {
  amp: "&", apos: "'", quot: '"', lt: "<", gt: ">", nbsp: " ", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…", copy: "©", reg: "®",
};

function decodeHtml(value) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, token) => {
      const key = token.toLowerCase();
      if (key.startsWith("#x")) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
      if (key.startsWith("#")) return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
      return namedEntities[key] ?? entity;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function extractBlocks(html, pageTitle) {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--([\s\S]*?)-->/g, "");
  const matches = body.matchAll(/<(h[1-6]|p|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi);
  const blocks = [];
  let pendingList = null;

  const commitList = () => {
    if (pendingList?.items.length) blocks.push(pendingList);
    pendingList = null;
  };

  for (const match of matches) {
    const tag = match[1].toLowerCase();
    const text = decodeHtml(match[2]);
    if (!text || text.length < 2) continue;
    if (tag === "li") {
      if (!pendingList) pendingList = { type: "list", items: [] };
      if (!pendingList.items.includes(text)) pendingList.items.push(text);
      continue;
    }
    commitList();
    if (tag.startsWith("h")) {
      const level = Number(tag.slice(1));
      if (blocks.length === 0 && text.toLowerCase() === pageTitle.toLowerCase()) continue;
      if (blocks.at(-1)?.type === "heading" && blocks.at(-1).text === text) continue;
      blocks.push({ type: "heading", level, text });
    } else if (blocks.at(-1)?.type !== "paragraph" || blocks.at(-1).text !== text) {
      blocks.push({ type: "paragraph", text });
    }
  }
  commitList();
  return blocks;
}

function slugFromUrl(url) {
  return new URL(url).pathname.split("/").filter(Boolean).at(-1);
}

async function fetchPage(target) {
  if (target.kind === "blog-index") {
    const response = await fetch(`${site}/wp-json/wp/v2/posts?per_page=20&_fields=link,title,excerpt,date`);
    if (!response.ok) throw new Error(`Blog index request failed: ${response.status}`);
    const posts = await response.json();
    return {
      id: target.id,
      worldId: target.worldId,
      itemIndex: target.itemIndex,
      sourceUrl: target.url,
      title: "Blog",
      blocks: posts.flatMap((post, index) => [
        { type: "heading", level: 2, text: decodeHtml(post.title.rendered) },
        { type: "paragraph", text: decodeHtml(post.excerpt.rendered) },
        { type: "paragraph", text: `Published: ${new Date(post.date).toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" })}` },
      ]),
    };
  }

  const slug = slugFromUrl(target.url);
  const response = await fetch(`${site}/wp-json/wp/v2/pages?slug=${encodeURIComponent(slug)}`);
  if (!response.ok) throw new Error(`Page request failed for ${target.url}: ${response.status}`);
  const records = await response.json();
  const record = records.find((candidate) => candidate.link === target.url) ?? records[0];
  if (!record) throw new Error(`No WordPress page found for ${target.url}`);
  const title = decodeHtml(record.title.rendered);
  const blocks = extractBlocks(record.content.rendered, title);
  if (!blocks.length) {
    // A small number of live navigation entries are published as intentionally
    // empty WordPress pages. Preserve the destination and make that source
    // state explicit rather than manufacturing substitute marketing copy.
    blocks.push({ type: "paragraph", text: "This AXSAI source page currently has no published body text." });
  }
  return { id: target.id, worldId: target.worldId, itemIndex: target.itemIndex, sourceUrl: target.url, title, blocks };
}

const entries = [];
for (const target of targets) {
  process.stdout.write(`Snapshotting ${target.id}\n`);
  entries.push(await fetchPage(target));
}

const detailIdsByWorld = {};
for (const target of targets) {
  const mapping = detailIdsByWorld[target.worldId] ??= {};
  if (target.itemIndex) mapping[target.itemIndex] = target.id;
  else mapping.root = target.id;
}

const source = `/*
 * Generated from current axsai.com source pages by tools/snapshot_axsai_content.mjs.
 * Do not fetch remote content at runtime; regenerate this file intentionally when the
 * source website content changes.
 */

export type AxsaiContentBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: readonly string[] };

export interface AxsaiDetail {
  id: string;
  worldId: string;
  itemIndex: string | null;
  sourceUrl: string;
  title: string;
  blocks: readonly AxsaiContentBlock[];
}

export const AXSAI_DETAILS: Readonly<Record<string, AxsaiDetail>> = ${JSON.stringify(Object.fromEntries(entries.map((entry) => [entry.id, entry])), null, 2)};

export const AXSAI_DETAIL_IDS_BY_WORLD: Readonly<Record<string, Readonly<Record<string, string>>>> = ${JSON.stringify(detailIdsByWorld, null, 2)};

export function getAxsaiDetail(id: string): AxsaiDetail | null {
  return AXSAI_DETAILS[id] ?? null;
}

export function getAxsaiDetailId(worldId: string, itemIndex?: string): string | null {
  const entry = AXSAI_DETAIL_IDS_BY_WORLD[worldId];
  if (!entry) return null;
  return itemIndex ? entry[itemIndex] ?? null : entry.root ?? null;
}
`;

await writeFile(fileURLToPath(output), source, "utf8");
console.log(`Wrote ${entries.length} local AXSAI content snapshots to ${fileURLToPath(output)}`);
