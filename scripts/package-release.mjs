#!/usr/bin/env node

// Builds the GitHub Release assets into release/:
//   github-token-utilities-<v>.tgz            npm pack tarball (npm i -g <url> installs the CLIs)
//   github-token-utilities-<v>.zip            the same files as a plain zip
//   github-token-utilities-skill-<host>-<v>.zip  one per agent host; unzip into its skills folder
//   SHA256SUMS                                checksums for every asset
//   RELEASE_NOTES.md                          this version's CHANGELOG section (not an asset)
//
//   node scripts/package-release.mjs                   build
//   node scripts/package-release.mjs --check-tag v1.2.3  also fail unless the tag matches package.json
//
// Requires `npm` and `zip` on PATH (both present on GitHub's ubuntu runners).

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'release');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const hosts = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'skills', 'hosts.json'), 'utf-8')).hosts);
const SKILL = 'github-token-utilities';

export function changelogSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start === -1) return null;
  const end = lines.findIndex((l, i) => i > start && /^## \[/.test(l));
  return lines.slice(start + 1, end === -1 ? undefined : end)
    .filter((l) => !/^\[[^\]]+\]: https?:\/\//.test(l)) // drop link reference definitions
    .join('\n')
    .trim();
}

function run(cmd, args, cwd = ROOT) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'inherit'] });
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function main() {
  const tagIndex = process.argv.indexOf('--check-tag');
  if (tagIndex !== -1) {
    const tag = process.argv[tagIndex + 1];
    if (tag !== `v${pkg.version}`) {
      console.error(`❌ Tag ${tag} does not match package.json version ${pkg.version} (expected v${pkg.version}).`);
      process.exit(1);
    }
  }

  const notes = changelogSection(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf-8'), pkg.version);
  if (!notes) {
    console.error(`❌ CHANGELOG.md has no "## [${pkg.version}]" section.`);
    process.exit(1);
  }

  // The skill variants must match their source before they are shipped.
  run(process.execPath, [path.join(ROOT, 'scripts', 'build-skills.mjs'), '--check']);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const base = `${pkg.name}-${pkg.version}`;

  // 1. npm tarball — contents are governed by package.json "files".
  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', OUT]))[0];
  const tarball = path.join(OUT, packed.filename);
  const files = packed.files.map((f) => f.path).sort();

  // 2. Plain zip of exactly the same files, under a top-level folder.
  const staging = path.join(OUT, '.staging', base);
  for (const rel of files) {
    fs.mkdirSync(path.dirname(path.join(staging, rel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), path.join(staging, rel));
  }
  run('zip', ['-q', '-r', '-X', path.join(OUT, `${base}.zip`), base], path.dirname(staging));
  fs.rmSync(path.join(OUT, '.staging'), { recursive: true, force: true });

  // 3. One skill zip per host, containing the ready-to-install github-token-utilities/ folder.
  for (const host of hosts) {
    const zip = path.join(OUT, `${pkg.name}-skill-${host}-${pkg.version}.zip`);
    run('zip', ['-q', '-r', '-X', zip, SKILL], path.join(ROOT, 'skills', 'dist', host));
  }

  // 4. Checksums (sha256sum -c compatible) and release notes.
  const assets = fs.readdirSync(OUT).filter((f) => f !== 'RELEASE_NOTES.md').sort();
  fs.writeFileSync(path.join(OUT, 'SHA256SUMS'), assets.map((f) => `${sha256(path.join(OUT, f))}  ${f}`).join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'RELEASE_NOTES.md'), `${notes}\n`);

  console.log(`✅ ${path.relative(ROOT, tarball)} (${files.length} files)`);
  for (const f of [...assets.filter((f) => !f.endsWith('.tgz')), 'SHA256SUMS']) console.log(`✅ release/${f}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
