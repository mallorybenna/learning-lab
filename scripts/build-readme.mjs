#!/usr/bin/env node
// Regenerates the "Projects" table in README.md from arcs/<slug>/meta.json.
// Source of truth = the repo itself, so it always reflects what's shipped.
// Run directly (`node scripts/build-readme.mjs`) or let the pre-commit hook run it.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARCS_DIR = join(ROOT, 'arcs');
const README = join(ROOT, 'README.md');
const START = '<!-- ARCS:START -->';
const END = '<!-- ARCS:END -->';

const statusBadge = (s) => {
  const v = String(s || '').toLowerCase();
  if (v === 'shipped' || v === 'done') return '✅ shipped';
  if (v === 'in-progress' || v === 'wip') return '🛠️ in progress';
  return s ? String(s) : '—';
};

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();

async function readArcs() {
  let entries = [];
  try {
    entries = await readdir(ARCS_DIR, { withFileTypes: true });
  } catch {
    return []; // arcs/ doesn't exist yet
  }
  const arcs = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const meta = JSON.parse(await readFile(join(ARCS_DIR, e.name, 'meta.json'), 'utf8'));
      arcs.push({ slug: e.name, ...meta });
    } catch {
      // folder without a valid meta.json — skip silently
    }
  }
  arcs.sort(
    (a, b) =>
      (a.season ?? 0) - (b.season ?? 0) ||
      (a.arc ?? 0) - (b.arc ?? 0) ||
      a.slug.localeCompare(b.slug)
  );
  return arcs;
}

function buildTable(arcs) {
  const header =
    '| # | Theme | Project | Rooted in | Status | Demo |\n' +
    '|---|-------|---------|-----------|--------|------|';
  if (!arcs.length) {
    return (
      header +
      '\n| — | — | _No arcs yet — your first lands after Step 1 in #mallory-learning._ | — | — | — |'
    );
  }
  const rows = arcs.map((a) => {
    const id = `S${a.season ?? '?'}·A${a.arc ?? '?'}`;
    const project = `[${cell(a.title || a.slug)}](arcs/${a.slug})`;
    const demo = a.demo ? `[demo](${a.demo})` : '';
    return `| ${id} | ${cell(a.theme)} | ${project} | ${cell(a.rooted)} | ${statusBadge(a.status)} | ${demo} |`;
  });
  return [header, ...rows].join('\n');
}

async function main() {
  const arcs = await readArcs();
  const table = buildTable(arcs);

  let readme;
  try {
    readme = await readFile(README, 'utf8');
  } catch {
    console.error('build-readme: README.md not found at repo root.');
    process.exit(1);
  }
  if (!readme.includes(START) || !readme.includes(END)) {
    console.error(`build-readme: README.md is missing the ${START} / ${END} markers.`);
    process.exit(1);
  }

  const before = readme.slice(0, readme.indexOf(START) + START.length);
  const after = readme.slice(readme.indexOf(END));
  const next = `${before}\n${table}\n${after}`;

  if (next !== readme) {
    await writeFile(README, next);
    console.log(`build-readme: README updated — ${arcs.length} arc(s).`);
  } else {
    console.log('build-readme: README already up to date.');
  }
}

main();
