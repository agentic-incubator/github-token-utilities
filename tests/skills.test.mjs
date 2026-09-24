import { test } from 'node:test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'node:assert/strict';
import { loadConfig, parseFrontmatter, renderHost, validateSkill } from '../scripts/build-skills.mjs';

const config = loadConfig();

for (const hostId of Object.keys(config.hosts)) {
  test(`${hostId} variant passes Agent Skills validation`, () => {
    const files = renderHost(config, hostId);
    assert.deepEqual(validateSkill(files, config.skill.name), []);
  });

  test(`${hostId} variant names its own tools and none of another host's`, () => {
    const skillMd = renderHost(config, hostId).get('SKILL.md');
    assert.ok(skillMd.includes(config.hosts[hostId].displayName));
    const foreign = { claude: 'AskUserQuestion', gemini: 'ask_user`', hermes: '`clarify`', grok: 'ask_user_question' };
    for (const [other, marker] of Object.entries(foreign)) {
      if (other !== hostId) assert.ok(!skillMd.includes(marker), `${hostId} mentions ${other}'s ${marker}`);
    }
  });
}

test('frontmatter keeps version and host data under metadata', () => {
  for (const hostId of Object.keys(config.hosts)) {
    const fm = parseFrontmatter(renderHost(config, hostId).get('SKILL.md'));
    assert.equal(fm.metadata.version, config.skill.version, hostId);
    assert.equal(fm.version, undefined, hostId);
  }
  assert.match(renderHost(config, 'hermes').get('SKILL.md'), /\n  hermes:\n    tags:\n      - "github"/);
});

test('description front-loads the trigger within Hermes\'s 57-character index', () => {
  assert.match(config.skill.description.slice(0, 57), /GitHub personal access tokens/);
});

test('validator rejects non-portable frontmatter', () => {
  const files = renderHost(config, 'claude');
  const bad = new Map(files);
  bad.set('SKILL.md', files.get('SKILL.md').replace('license: MIT', 'license: MIT\nversion: "1"\ntags: [a, b]'));
  const errors = validateSkill(bad, config.skill.name);
  assert.ok(errors.some((e) => /unexpected top-level/.test(e)));
  assert.ok(errors.some((e) => /flow style/.test(e)));
});

test('every variant links the configured repository', () => {
  for (const hostId of Object.keys(config.hosts)) {
    const setup = renderHost(config, hostId).get('references/setup.md');
    assert.ok(setup.includes(`https://github.com/${config.skill.repo}.git`), hostId);
  }
});

test('skill instructions never tell the agent to read token files', () => {
  for (const [file, content] of renderHost(config, 'claude')) {
    assert.ok(!/cat ~\/[\w-]+\.ght(?!\))/.test(content.replace(/\$\(cat ~\/NAME\.ght\)/g, '')), `${file} reads a token file`);
  }
});

test('skills/dist matches what skills/core renders (run npm run build:skills if this fails)', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const hostId of Object.keys(config.hosts)) {
    for (const [rel, content] of renderHost(config, hostId)) {
      const onDisk = path.join(root, 'skills', 'dist', hostId, config.skill.name, rel);
      assert.equal(fs.readFileSync(onDisk, 'utf-8'), content, `${hostId}/${rel} is stale`);
    }
  }
});
