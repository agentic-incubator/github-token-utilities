#!/usr/bin/env node

// Copies a built skill variant from skills/dist/<host>/ into that host's skills directory.
//
//   node scripts/install-skills.mjs --host claude,gemini          user-wide install
//   node scripts/install-skills.mjs --host all --project ~/code/app  project-local install
//   node scripts/install-skills.mjs --host codex --dry-run         show what would happen
//   node scripts/install-skills.mjs --host claude --uninstall      remove it again

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'skills', 'hosts.json'), 'utf-8'));
const SKILL = config.skill.name;

const HELP = `
Usage: node scripts/install-skills.mjs --host <ids|all> [options]

Hosts: ${Object.keys(config.hosts).join(', ')}

Options:
  --host <list>        Comma-separated host ids, or "all"
  --project <dir>      Install into <dir>'s project skills folder instead of your home
  --force              Replace an existing copy of the skill
  --uninstall          Remove the skill instead of installing it
  --dry-run            Print what would happen; change nothing
  -h, --help           Show this help
`;

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === '--host') opts.hosts = next();
    else if (arg === '--project') opts.project = path.resolve(next());
    else if (arg === '--force') opts.force = true;
    else if (arg === '--uninstall') opts.uninstall = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return opts;
}

function expandHome(p) {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

function targetDir(host, project) {
  const base = project ? path.join(project, host.installProject) : expandHome(host.installUser);
  return path.join(base, SKILL);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.hosts) {
    console.log(HELP);
    return opts.help ? 0 : 1;
  }

  const ids = opts.hosts === 'all' ? Object.keys(config.hosts) : opts.hosts.split(',').map((s) => s.trim());
  const unknown = ids.filter((id) => !config.hosts[id]);
  if (unknown.length) {
    console.error(`❌ Unknown host(s): ${unknown.join(', ')}`);
    return 1;
  }

  const planned = new Map();
  let failed = false;
  for (const id of ids) {
    const host = config.hosts[id];
    const src = path.join(ROOT, 'skills', 'dist', id, SKILL);
    const dest = targetDir(host, opts.project);
    const verb = opts.dryRun ? 'would ' : '';

    if (planned.has(dest)) {
      console.log(`⏭  ${id}: same folder as ${planned.get(dest)} (${dest}); skipped`);
      continue;
    }
    planned.set(dest, id);

    if (opts.uninstall) {
      if (!fs.existsSync(path.join(dest, 'SKILL.md'))) {
        console.log(`➖ ${id}: not installed at ${dest}`);
        continue;
      }
      if (!opts.dryRun) fs.rmSync(dest, { recursive: true, force: true });
      console.log(`🗑  ${id}: ${verb}remove ${dest}`);
      continue;
    }

    if (!fs.existsSync(path.join(src, 'SKILL.md'))) {
      console.error(`❌ ${id}: ${path.relative(ROOT, src)} missing. Run: npm run build:skills`);
      failed = true;
      continue;
    }
    if (fs.existsSync(dest) && !opts.force) {
      console.error(`❌ ${id}: ${dest} already exists. Re-run with --force to replace it.`);
      failed = true;
      continue;
    }
    if (!opts.dryRun) {
      fs.rmSync(dest, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(src, dest, { recursive: true });
    }
    console.log(`✅ ${id}: ${verb}install → ${dest}`);
  }

  // Several hosts also read ~/.agents/skills (Codex's home). Two copies of the same skill
  // name can confuse them, so point that out rather than silently duplicating.
  const sharedReaders = ['opencode', 'gemini', 'grok'].filter((id) => ids.includes(id));
  if (!opts.uninstall && !opts.project && ids.includes('codex') && sharedReaders.length) {
    console.log(`\nℹ️  ${sharedReaders.join(', ')} also read ~/.agents/skills (the Codex copy), so they may list the skill twice.`);
    console.log('   If that happens, keep just the Codex install for them, or uninstall their own copy.');
  }
  // https://geminicli.com/docs/cli/trusted-folders/
  if (!opts.uninstall && opts.project && ids.includes('gemini')) {
    console.log('\nℹ️  Gemini CLI loads project skills only when the folder is trusted (it asks on first launch).');
  }
  return failed ? 1 : 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
}
