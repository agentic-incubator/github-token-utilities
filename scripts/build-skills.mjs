#!/usr/bin/env node

// Renders skills/core (one source of truth) into skills/dist/<host>/<skill-name>/ for every
// host in skills/hosts.json, and validates the output against the Agent Skills spec
// (https://agentskills.io/specification).
//
//   node scripts/build-skills.mjs          build
//   node scripts/build-skills.mjs --check  validate and fail if dist/ is out of date

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const CORE_DIR = path.join(SKILLS_DIR, 'core');
const DIST_DIR = path.join(SKILLS_DIR, 'dist');

// Limits from the Agent Skills specification.
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NAME_MAX = 64;
const DESCRIPTION_MAX = 1024;
const COMPATIBILITY_MAX = 500;
const RECOMMENDED_MAX_LINES = 500;

// The skill's version is the package version, so the two can never drift apart.
export function loadConfig() {
  const config = JSON.parse(fs.readFileSync(path.join(SKILLS_DIR, 'hosts.json'), 'utf-8'));
  config.skill.version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')).version;
  return config;
}

// Only these top-level keys are allowed by the spec's reference validator (skills-ref); other
// keys make it (and Claude.ai/API skill uploads) reject the file. Host-specific data goes in
// `metadata`. https://agentskills.io/specification
export const ALLOWED_TOP_LEVEL_KEYS = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];

// skills-ref parses frontmatter with strictyaml, which rejects flow style ({a: b}, [x, y]),
// so everything is emitted in block style with double-quoted strings.
function yamlString(value) {
  return JSON.stringify(String(value));
}

function yamlBlock(key, value, indent) {
  const pad = '  '.repeat(indent);
  if (Array.isArray(value)) return [`${pad}${key}:`, ...value.map((v) => `${pad}  - ${yamlString(v)}`)];
  if (value && typeof value === 'object') {
    return [`${pad}${key}:`, ...Object.entries(value).flatMap(([k, v]) => yamlBlock(k, v, indent + 1))];
  }
  return [`${pad}${key}: ${yamlString(value)}`];
}

function renderFrontmatter(skill, host) {
  const metadata = {
    author: skill.author,
    version: skill.version,
    repository: `https://github.com/${skill.repo}`,
    'short-description': skill.shortDescription,
    ...host.metadata,
  };
  return [
    `name: ${skill.name}`,
    `description: ${yamlString(skill.description)}`,
    `license: ${skill.license}`,
    `compatibility: ${yamlString(skill.compatibility)}`,
    ...yamlBlock('metadata', metadata, 0),
  ].join('\n');
}

function renderText(text, skill, host, frontmatter) {
  const replacements = {
    FRONTMATTER: frontmatter,
    REPO_URL: `https://github.com/${skill.repo}`,
    REPO_GIT: `https://github.com/${skill.repo}.git`,
    HOST_NAME: host.displayName,
    INVOKE: host.invoke,
    ASK_HOW: host.ask,
    SHELL_HOW: host.shell,
    USER_RUN_HOW: host.userRun,
    EXTRA_HOST_NOTES: host.extraNotes,
    VERSION: skill.version,
  };
  const out = text.replace(/\{\{([A-Z_]+)\}\}/g, (match, key) => {
    if (!(key in replacements)) throw new Error(`Unknown placeholder ${match}`);
    return replacements[key];
  });
  return out;
}

// Returns a Map of relative path -> file content for one host.
export function renderHost(config, hostId) {
  const { skill } = config;
  const host = config.hosts[hostId];
  const frontmatter = renderFrontmatter(skill, host);
  const files = new Map();
  files.set('SKILL.md', renderText(fs.readFileSync(path.join(CORE_DIR, 'SKILL.md.tmpl'), 'utf-8'), skill, host, frontmatter));
  const refDir = path.join(CORE_DIR, 'references');
  for (const file of fs.readdirSync(refDir).sort()) {
    files.set(`references/${file}`, renderText(fs.readFileSync(path.join(refDir, file), 'utf-8'), skill, host, frontmatter));
  }
  return files;
}

export function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;
  const fields = {};
  let parent = null;
  for (const line of match[1].split('\n')) {
    const top = line.match(/^([A-Za-z][\w-]*):\s?(.*)$/);
    if (top) {
      const [, key, value] = top;
      fields[key] = value === '' ? {} : value.startsWith('"') ? JSON.parse(value) : value;
      parent = value === '' ? key : null;
      continue;
    }
    const child = line.match(/^  ([A-Za-z][\w-]*):\s?(.*)$/);
    if (child && parent) fields[parent][child[1]] = child[2].startsWith('"') ? JSON.parse(child[2]) : child[2];
  }
  return fields;
}

export function validateSkill(files, dirName) {
  const errors = [];
  const skillMd = files.get('SKILL.md');
  const fm = parseFrontmatter(skillMd);
  if (!fm) return ['SKILL.md has no frontmatter'];

  const unexpected = Object.keys(fm).filter((k) => !ALLOWED_TOP_LEVEL_KEYS.includes(k));
  if (unexpected.length) errors.push(`unexpected top-level frontmatter keys: ${unexpected.join(', ')}`);
  const rawFrontmatter = skillMd.match(/^---\n([\s\S]*?)\n---\n/)[1];
  if (/:\s*[[{]/.test(rawFrontmatter)) errors.push('frontmatter uses YAML flow style ([...] or {...}); use block style');

  if (!fm.name) errors.push('name is required');
  else {
    if (!NAME_PATTERN.test(fm.name)) errors.push(`name "${fm.name}" must be lowercase letters, digits and single hyphens`);
    if (fm.name.length > NAME_MAX) errors.push(`name exceeds ${NAME_MAX} characters`);
    if (fm.name !== dirName) errors.push(`name "${fm.name}" must match directory "${dirName}"`);
  }
  if (!fm.description) errors.push('description is required');
  else if (fm.description.length > DESCRIPTION_MAX) errors.push(`description is ${fm.description.length} chars (max ${DESCRIPTION_MAX})`);
  if (fm.compatibility && fm.compatibility.length > COMPATIBILITY_MAX) errors.push(`compatibility exceeds ${COMPATIBILITY_MAX} chars`);

  const lineCount = skillMd.split('\n').length;
  if (lineCount > RECOMMENDED_MAX_LINES) errors.push(`SKILL.md is ${lineCount} lines (keep under ${RECOMMENDED_MAX_LINES})`);

  for (const [file, content] of files) {
    const leftover = content.match(/\{\{[A-Z_]+\}\}/);
    if (leftover) errors.push(`${file}: unrendered placeholder ${leftover[0]}`);
    for (const ref of content.matchAll(/(?:`|\]\()((?:references\/)?[a-z-]+\.md)(?:`|\))/g)) {
      const target = ref[1].startsWith('references/') ? ref[1] : `references/${ref[1]}`;
      if (ref[1] !== 'SKILL.md' && !files.has(target)) errors.push(`${file}: links to missing ${target}`);
    }
  }
  return errors;
}

function readDir(dir) {
  const files = new Map();
  if (!fs.existsSync(dir)) return files;
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(current, entry.name), rel);
      else files.set(rel, fs.readFileSync(path.join(current, entry.name), 'utf-8'));
    }
  };
  walk(dir, '');
  return files;
}

function main() {
  const check = process.argv.includes('--check');
  const config = loadConfig();
  let failed = false;

  for (const hostId of Object.keys(config.hosts)) {
    const files = renderHost(config, hostId);
    const outDir = path.join(DIST_DIR, hostId, config.skill.name);

    const errors = validateSkill(files, config.skill.name);
    if (errors.length > 0) {
      failed = true;
      errors.forEach((e) => console.error(`❌ ${hostId}: ${e}`));
      continue;
    }

    if (check) {
      const existing = readDir(outDir);
      const stale = [...files].filter(([rel, content]) => existing.get(rel) !== content).map(([rel]) => rel);
      const extra = [...existing.keys()].filter((rel) => !files.has(rel));
      if (stale.length || extra.length) {
        failed = true;
        console.error(`❌ ${hostId}: dist is out of date (${[...stale, ...extra].join(', ')}). Run: npm run build:skills`);
      } else {
        console.log(`✅ ${hostId}: valid and up to date`);
      }
      continue;
    }

    fs.rmSync(outDir, { recursive: true, force: true });
    for (const [rel, content] of files) {
      const dest = path.join(outDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, content);
    }
    console.log(`✅ ${hostId}: ${path.relative(ROOT, outDir)} (${files.size} files)`);
  }

  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
