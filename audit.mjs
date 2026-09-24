#!/usr/bin/env node

import os from 'os';
import path from 'path';
import fs from 'fs';
import { execFile, execFileSync } from 'child_process';
import { promisify } from 'util';
import {
  ageStatus,
  gh,
  defaultEnvFile,
  detectEnvFormat,
  expiryStatus,
  isTokenSecret,
  readEnvAssignment,
  verifyToken,
} from './gh-token-lib.mjs';

const SECRETS_FILE_KEYS = ['GITHUB_TOKEN', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'GH_TOKEN'];

const execFileAsync = promisify(execFile);

const HELP = `
Usage: audit-gh-tokens [owner] [options]

Finds token-like Actions secrets across your repositories and reports how long
ago each was last set, then checks your local ~/*.ght token files for validity,
expiration and file permissions. Secret values are never read; local token
values are sent only to GitHub to verify them and are never printed.

Arguments:
  owner                  User or org to scan (default: the authenticated user)

Options:
  --limit <n>            Maximum repositories to scan (default 1000)
  --stale-days <n>       Secrets older than this are STALE (default 90)
  --match <regex>        Extra secret-name pattern to treat as a token
  --no-local             Skip checking local ~/*.ght files and the secrets file
  --secrets-file <path>  Shell secrets file to check (default: ~/.secrets.env,
                         ~/.secrets.ps1 on Windows PowerShell; see store-gh-token)
  --format <fmt>         Secrets file syntax: sh | fish | csh | powershell (default: detected)
  --no-remote            Skip scanning repository secrets
  --json                 Print machine-readable JSON instead of tables
  -h, --help             Show this help
`;

function parseArgs(argv) {
  const opts = { limit: 1000, staleDays: 90, local: true, remote: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === '--limit') opts.limit = parseInt(next(), 10);
    else if (arg === '--stale-days') opts.staleDays = parseInt(next(), 10);
    else if (arg === '--match') opts.match = new RegExp(next(), 'i');
    else if (arg === '--no-local') opts.local = false;
    else if (arg === '--no-remote') opts.remote = false;
    else if (arg === '--secrets-file') opts.secretsFile = next();
    else if (arg === '--format') opts.format = next();
    else if (arg === '--json') opts.json = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else if (!opts.owner) opts.owner = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }
  if (!Number.isInteger(opts.limit) || opts.limit <= 0) throw new Error('--limit must be a positive integer');
  if (!Number.isInteger(opts.staleDays) || opts.staleDays <= 0) throw new Error('--stale-days must be a positive integer');
  if (opts.owner && !/^[A-Za-z0-9_.-]+$/.test(opts.owner)) throw new Error('owner must be a GitHub user or org name');
  return opts;
}

function daysSince(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

function getCurrentUser() {
  const call = gh(['api', 'user', '--jq', '.login']);
  return execFileSync(call.cmd, call.args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function getRepositories(owner, limit) {
  const args = ['repo', 'list'];
  if (owner) args.push(owner);
  args.push('--limit', String(limit), '--no-archived', '--json', 'nameWithOwner');
  const call = gh(args);
  const output = execFileSync(call.cmd, call.args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(output).map((r) => r.nameWithOwner);
}

async function getRepositorySecrets(repo) {
  const call = gh(['secret', 'list', '--repo', repo, '--json', 'name,updatedAt']);
  const { stdout } = await execFileAsync(call.cmd, call.args);
  return JSON.parse(stdout);
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function auditRemote(opts, log) {
  const repositories = getRepositories(opts.owner, opts.limit);
  log(`✅ Found ${repositories.length} non-archived repositories\n`);
  log('🔍 Scanning repository secrets...\n');

  const findings = [];
  const noAccess = [];
  await mapLimit(repositories, 8, async (repo) => {
    try {
      const secrets = await getRepositorySecrets(repo);
      for (const secret of secrets.filter((s) => isTokenSecret(s.name, opts.match))) {
        const days = daysSince(secret.updatedAt);
        findings.push({ repo, secretName: secret.name, updatedAt: secret.updatedAt, ageDays: days, ...ageStatus(days, opts.staleDays) });
      }
    } catch {
      noAccess.push(repo);
    }
  });

  findings.sort((a, b) => b.ageDays - a.ageDays);
  return { scanned: repositories.length, findings, noAccess: noAccess.sort() };
}

function describeLocal(label, filePath, token) {
  const stat = fs.statSync(filePath);
  const loosePermissions = os.platform() !== 'win32' && (stat.mode & 0o077) !== 0;
  const check = token ? verifyToken(token) : { ok: false, error: 'empty file' };
  const expiry = check.ok ? expiryStatus({ expiresAt: check.expiresAt, type: check.type }) : { status: 'INVALID', icon: '🔴', days: null };
  return {
    file: label,
    mode: (stat.mode & 0o777).toString(8),
    loosePermissions,
    modifiedAt: stat.mtime.toISOString(),
    valid: check.ok,
    type: check.type ?? null,
    login: check.login ?? null,
    scopes: check.scopes ?? null,
    expiresAt: check.expiresAt ? check.expiresAt.toISOString() : null,
    error: check.error ?? null,
    ...expiry,
  };
}

function auditLocal(secretsFile) {
  const home = os.homedir();
  const results = fs.readdirSync(home).filter((f) => f.endsWith('.ght')).sort().map((file) => {
    const filePath = path.join(home, file);
    return describeLocal(`~/${file}`, filePath, fs.readFileSync(filePath, 'utf-8').trim());
  });

  // The token a shell secrets file exports (see store-gh-token). Only literal values are
  // checked; the first key holding one wins.
  if (fs.existsSync(secretsFile.path)) {
    const content = fs.readFileSync(secretsFile.path, 'utf-8');
    for (const key of SECRETS_FILE_KEYS) {
      const token = readEnvAssignment(content, key, secretsFile.format);
      if (token) {
        const label = `${secretsFile.path.replace(home, '~')} (${key})`;
        results.push({ ...describeLocal(label, secretsFile.path, token), secretsFile: true, variable: key });
        break;
      }
    }
  }
  return results;
}

function printRemote(remote, staleDays) {
  console.log('═'.repeat(100));
  console.log('🔍 REPOSITORY TOKEN SECRETS\n');
  if (remote.findings.length === 0) {
    console.log('✅ No token-like secrets found\n');
  } else {
    console.log('REPO'.padEnd(42) + 'SECRET NAME'.padEnd(28) + 'STATUS'.padEnd(10) + 'LAST SET');
    console.log('─'.repeat(100));
    for (const f of remote.findings) {
      console.log(`${f.icon} ${f.repo.padEnd(40)}${f.secretName.padEnd(28)}${f.status.padEnd(10)}${f.updatedAt.slice(0, 10)} (${f.ageDays}d ago)`);
    }
    console.log('');
  }
  if (remote.noAccess.length > 0) {
    console.log(`⚠️  Could not read secrets in ${remote.noAccess.length} repo(s) (needs admin access): ${remote.noAccess.slice(0, 10).join(', ')}${remote.noAccess.length > 10 ? ', …' : ''}\n`);
  }
  const stale = remote.findings.filter((f) => f.status === 'STALE').length;
  if (stale > 0) {
    console.log(`🔴 ${stale} secret(s) not rotated in ${staleDays}+ days — rotate with: rotate-gh-token <owner/repo> <SECRET>\n`);
  }
  console.log('ℹ️  GitHub never reveals secret values, so a secret\'s real token expiry cannot be read — "LAST SET" is the best available signal.\n');
}

function printLocal(local) {
  console.log('═'.repeat(100));
  console.log('🗝  LOCAL TOKENS (~/*.ght and your shell secrets file)\n');
  if (local.length === 0) {
    console.log('(none found)\n');
    return;
  }
  console.log('FILE'.padEnd(42) + 'STATUS'.padEnd(20) + 'EXPIRES'.padEnd(26) + 'USER');
  console.log('─'.repeat(100));
  for (const t of local) {
    const expires = t.valid ? (t.expiresAt?.slice(0, 10) ?? (t.status === 'UNKNOWN' ? 'unknown' : 'never')) : (t.error ?? '');
    console.log(`${t.icon} ${t.file.padEnd(40)}${t.status.padEnd(20)}${String(expires).padEnd(26)}${t.login ?? ''}`);
    if (t.note) console.log(`   ℹ️  ${t.note}`);
    if (t.loosePermissions) console.log(`   ⚠️  permissions ${t.mode} — fix with: chmod 600 ${t.file}`);
  }
  console.log('');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  const log = opts.json ? () => {} : (msg) => console.log(msg);

  log('\n🔐 GitHub Token Audit\n');
  const report = { generatedAt: new Date().toISOString(), staleDays: opts.staleDays };

  if (opts.remote) {
    try {
      report.user = getCurrentUser();
    } catch {
      const envHint = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
        ? ' A GH_TOKEN/GITHUB_TOKEN environment variable is set and overrides your gh login — unset it or fix it.'
        : '';
      console.error(`❌ gh is not authenticated. Run: gh auth login.${envHint}`);
      return 1;
    }
    report.owner = opts.owner || report.user;
    log(`👤 User: ${report.user}   📦 Owner: ${report.owner}\n`);
    report.remote = await auditRemote(opts, log);
  }

  if (opts.local) {
    log('⏳ Checking local token files...\n');
    const format = opts.format || detectEnvFormat();
    const secretsPath = opts.secretsFile || defaultEnvFile(format, os.homedir());
    report.local = auditLocal({ path: path.resolve(secretsPath.replace(/^~(?=[\\/])/, os.homedir())), format });
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    if (report.remote) printRemote(report.remote, opts.staleDays);
    if (report.local) printLocal(report.local);
  }
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error('❌ Error:', error.message);
    process.exitCode = 1;
  });
