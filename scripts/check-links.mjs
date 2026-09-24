#!/usr/bin/env node

// Checks every external URL in the documentation, the skill sources, and code comments:
// the page must load (HTTP < 400 after redirects), and a #fragment must exist on the page.
// Internal links are covered offline by tests/docs.test.mjs; this one needs the network.
//
//   node scripts/check-links.mjs            check everything
//   node scripts/check-links.mjs --verbose  also list the URLs that passed

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');
const CONCURRENCY = 6;
const TIMEOUT_MS = 20000;

// Links that are valid but can't be checked by an anonymous request.
const SKIP = [
  /^https:\/\/github\.com\/settings\//, // requires sign-in
  /^https:\/\/api\.github\.com\/?$/, // API root, used as a base URL
];

function sourceFiles() {
  const files = ['README.md', 'package.json'];
  const walk = (dir, filter) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel, filter);
      else if (filter(entry.name)) files.push(rel);
    }
  };
  walk('docs', (n) => n.endsWith('.md'));
  walk('skills/core', () => true);
  walk('.github', (n) => /\.ya?ml$/.test(n));
  for (const f of fs.readdirSync(ROOT)) if (f.endsWith('.mjs')) files.push(f);
  walk('scripts', (n) => n.endsWith('.mjs'));
  return files;
}

function extractUrls(text) {
  const urls = new Set();
  for (let [url] of text.matchAll(/https?:\/\/[^\s)<>"'`\]|\\]+/g)) {
    url = url.replace(/[.,;:*]+$/, '');
    if (/[${}]/.test(url) || url.includes('<') || url.includes('127.0.0.1') || url.includes('api.example')) continue;
    urls.add(url);
  }
  return urls;
}

async function fetchWithTimeout(url, method) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (github-token-utilities link checker)',
        Accept: 'text/html,application/xhtml+xml,*/*',
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function fragmentPresent(html, fragment) {
  const f = decodeURIComponent(fragment);
  const escaped = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(id|name)=["']?(user-content-)?${escaped}["'\\s>]`, 'i').test(html)
    || html.includes(`"user-content-${f}"`)
    || html.includes(`"anchor":"${f}"`)
    || html.includes(`#${f}"`);
}

async function check(url) {
  const [base, fragment] = url.split('#');
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetchWithTimeout(base, 'GET');
      if (response.status === 429 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 5000 * attempt));
        continue;
      }
      if (response.status >= 400) return { url, ok: false, detail: `HTTP ${response.status}` };
      if (fragment && (response.headers.get('content-type') || '').includes('html')) {
        const html = await response.text();
        if (!fragmentPresent(html, fragment)) return { url, ok: false, detail: `#${fragment} not found on page` };
      }
      return { url, ok: true, detail: `HTTP ${response.status}` };
    } catch (error) {
      if (attempt === 3) return { url, ok: false, detail: error.name === 'AbortError' ? 'timeout' : error.message };
    }
  }
  return { url, ok: false, detail: 'rate limited' };
}

async function main() {
  const where = new Map();
  for (const file of sourceFiles()) {
    for (const url of extractUrls(fs.readFileSync(path.join(ROOT, file), 'utf-8'))) {
      if (SKIP.some((re) => re.test(url))) continue;
      if (!where.has(url)) where.set(url, new Set());
      where.get(url).add(file);
    }
  }
  const urls = [...where.keys()].sort();
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < urls.length) results.push(await check(urls[next++]));
  }));

  const failed = results.filter((r) => !r.ok).sort((a, b) => a.url.localeCompare(b.url));
  if (VERBOSE) for (const r of results.filter((x) => x.ok)) console.log(`✅ ${r.url}`);
  for (const r of failed) console.log(`❌ ${r.url}\n   ${r.detail} — in ${[...where.get(r.url)].join(', ')}`);
  console.log(`\n${results.length - failed.length}/${results.length} external links OK`);
  process.exitCode = failed.length ? 1 : 0;
}

main();
