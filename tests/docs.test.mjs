// Documentation integrity: every relative link and #anchor resolves, footnotes match, and the
// layout convention (README.md at the root, everything else in docs/ with uppercase names)
// holds. skills/ is excluded: its file names are fixed by the Agent Skills format.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function markdownFiles() {
  const root = fs.readdirSync(ROOT).filter((f) => f.endsWith('.md')).map((f) => f);
  const docs = fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`);
  return [...root, ...docs];
}

// Strip fenced code blocks and inline code so examples aren't parsed as links or headings.
function prose(markdown) {
  return markdown.replace(/^```[\s\S]*?^```/gm, '').replace(/`[^`\n]*`/g, '');
}

// GitHub's heading anchor algorithm: lowercase, drop punctuation except - and _, spaces to -.
export function slug(heading) {
  return heading
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

function anchors(file) {
  const text = fs.readFileSync(path.join(ROOT, file), 'utf-8').replace(/^```[\s\S]*?^```/gm, '');
  const seen = new Map();
  const result = new Set();
  for (const [, heading] of text.matchAll(/^#{1,6} (.+)$/gm)) {
    const base = slug(heading.replace(/`/g, ''));
    const n = seen.get(base) ?? 0;
    result.add(n ? `${base}-${n}` : base);
    seen.set(base, n + 1);
  }
  return result;
}

test('only README.md lives at the root; docs/ files have uppercase names', () => {
  const root = fs.readdirSync(ROOT).filter((f) => f.endsWith('.md'));
  assert.deepEqual(root, ['README.md']);
  for (const f of fs.readdirSync(path.join(ROOT, 'docs')).filter((x) => x.endsWith('.md'))) {
    assert.match(f, /^[A-Z0-9-]+\.md$/, `docs/${f} should be uppercase (e.g. GENERATE.md)`);
  }
});

for (const file of markdownFiles()) {
  test(`${file}: relative links and anchors resolve`, () => {
    const text = prose(fs.readFileSync(path.join(ROOT, file), 'utf-8'));
    const broken = [];
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:)/.test(target)) continue;
      const [rel, frag] = target.split('#');
      const resolved = rel ? path.normalize(path.join(path.dirname(file), rel)) : file;
      if (!fs.existsSync(path.join(ROOT, resolved))) {
        broken.push(`${target} (missing ${resolved})`);
        continue;
      }
      if (frag && resolved.endsWith('.md') && !anchors(resolved).has(frag)) broken.push(`${target} (no #${frag} in ${resolved})`);
    }
    assert.deepEqual(broken, []);
  });

  test(`${file}: every footnote is defined and used`, () => {
    const text = prose(fs.readFileSync(path.join(ROOT, file), 'utf-8'));
    const defs = new Set([...text.matchAll(/^\[\^([\w-]+)\]:/gm)].map((m) => m[1]));
    const refs = new Set([...text.matchAll(/\[\^([\w-]+)\](?!:)/g)].map((m) => m[1]));
    assert.deepEqual([...refs].filter((r) => !defs.has(r)), [], 'undefined footnotes');
    assert.deepEqual([...defs].filter((d) => !refs.has(d)), [], 'unused footnotes');
  });
}
