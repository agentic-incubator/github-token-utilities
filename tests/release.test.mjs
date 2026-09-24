import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { changelogSection } from '../scripts/package-release.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

test('changelogSection returns only the requested version, without link definitions', () => {
  const changelog = [
    '# Changelog', '', '## [2.0.0] - 2026-01-01', '', '### Added', '', '- new', '',
    '## [1.0.0]', '', '- old', '', '[2.0.0]: https://example.com/v2', '[1.0.0]: https://example.com/v1', '',
  ].join('\n');
  assert.equal(changelogSection(changelog, '2.0.0'), '### Added\n\n- new');
  assert.equal(changelogSection(changelog, '1.0.0'), '- old');
  assert.equal(changelogSection(changelog, '9.9.9'), null);
});

test('the current version has release notes in CHANGELOG.md', () => {
  const notes = changelogSection(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf-8'), pkg.version);
  assert.ok(notes && notes.length > 20, `CHANGELOG.md needs a "## [${pkg.version}]" section`);
});

test('package-release refuses a tag that does not match package.json', () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'package-release.mjs'), '--check-tag', 'v0.0.0-mismatch'], { encoding: 'utf-8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match package\.json version/);
});
