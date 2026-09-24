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
  parseHeaders,
  readEnvAssignment,
  verifyToken,
} from './gh-token-lib.mjs';

const SECRETS_FILE_KEYS = ['GITHUB_TOKEN', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'GH_TOKEN'];

// Every application `gh secret list --app` accepts, at repository and organization level.
const SECRET_APPS = ['actions', 'agents', 'dependabot', 'codespaces'];

// Classic/OAuth token scopes some --all-secrets listings need. Organization secrets need
// admin:org for every app; Codespaces user secrets need codespace or codespace:secrets.
//   https://docs.github.com/en/rest/actions/secrets#list-organization-secrets
//   https://docs.github.com/en/rest/codespaces/secrets#list-secrets-for-the-authenticated-user
const SCOPED_LISTINGS = {
  org: { listing: 'organization secrets', scope: 'admin:org', accepts: ['admin:org'] },
  user: { listing: 'Codespaces user secrets', scope: 'codespace', accepts: ['codespace', 'codespace:secrets'] },
};

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
  --all-secrets          List every secret, not just token-like names: Actions, Agents,
                         Dependabot and Codespaces secrets of each repo, its environments'
                         secrets, org-level secrets, and your Codespaces user secrets.
                         Without an owner, scans your account and the orgs you own
                         (orgs where you're only a member are skipped and named).
                         Listings your gh token lacks the scope for (org secrets:
                         admin:org; Codespaces user secrets: codespace) are skipped
                         and named instead of failing
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
    else if (arg === '--all-secrets') opts.allSecrets = true;
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
  if (opts.allSecrets && !opts.remote) throw new Error('--all-secrets cannot be combined with --no-remote');
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

// The scopes of the token gh itself uses, from the X-OAuth-Scopes header, or null when GitHub
// doesn't send one (fine-grained tokens), in which case nothing can be known in advance.
function getGhTokenScopes() {
  try {
    const call = gh(['api', '-i', 'user']);
    const raw = execFileSync(call.cmd, call.args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    const headers = parseHeaders(raw.split(/\r?\n\r?\n/)[0]);
    if (!('x-oauth-scopes' in headers)) return null;
    return headers['x-oauth-scopes'].split(',').map((s) => s.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

function getRepositories(owner, limit) {
  const args = ['repo', 'list'];
  if (owner) args.push(owner);
  args.push('--limit', String(limit), '--no-archived', '--json', 'nameWithOwner');
  const call = gh(args);
  const output = execFileSync(call.cmd, call.args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(output).map((r) => r.nameWithOwner);
}

function ghLines(args) {
  const call = gh(args);
  const output = execFileSync(call.cmd, call.args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  return output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

async function ghJson(args) {
  const call = gh(args);
  const { stdout } = await execFileAsync(call.cmd, call.args);
  return JSON.parse(stdout);
}

async function ghLinesAsync(args) {
  const call = gh(args);
  const { stdout } = await execFileAsync(call.cmd, call.args);
  return stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
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

function firstLine(error) {
  return String(error.stderr || error.message || error).trim().split('\n')[0];
}

// --all-secrets: every secret, at every level GitHub keeps them, for each owner.
async function auditAllSecrets(opts, user, log) {
  // Without an owner: the user plus the orgs they own (role "admin"). In orgs where they are
  // only a member they can't list org secrets or, usually, repo secrets, so those are skipped
  // and named; pass the org as the owner to scan it anyway.
  let owners;
  let skippedOrgs = [];
  if (opts.owner) {
    owners = [opts.owner];
  } else {
    let memberships = [];
    try {
      memberships = ghLines(['api', 'user/memberships/orgs', '--paginate', '--jq', '.[] | select(.state == "active") | "\\(.organization.login)\\t\\(.role)"'])
        .map((line) => line.split('\t'));
    } catch (error) {
      log(`⚠️  Could not list your organizations (${firstLine(error)}); scanning ${user} only\n`);
    }
    const owned = memberships.filter(([, role]) => role === 'admin').map(([org]) => org);
    skippedOrgs = memberships.filter(([, role]) => role !== 'admin').map(([org]) => org).sort();
    owners = [user, ...owned.filter((o) => o !== user)];
  }
  log(`🏢 Owners: ${owners.join(', ')}\n`);

  // Skip, rather than attempt and fail, the listings the token is known not to allow.
  const tokenScopes = getGhTokenScopes();
  const allowed = (need) => tokenScopes === null || need.accepts.some((s) => tokenScopes.includes(s));
  const scanOrgSecrets = allowed(SCOPED_LISTINGS.org);
  const scanUserSecrets = allowed(SCOPED_LISTINGS.user);
  const skippedScopes = [
    ...(scanOrgSecrets ? [] : [SCOPED_LISTINGS.org]),
    ...(scanUserSecrets ? [] : [SCOPED_LISTINGS.user]),
  ].map(({ listing, scope }) => ({ listing, scope }));
  if (skippedScopes.length > 0) log(`ℹ️  Not scanning ${skippedScopes.map((s) => s.listing).join(' or ')}: your gh token lacks ${skippedScopes.map((s) => s.scope).join(', ')}\n`);
  if (skippedOrgs.length > 0) log(`ℹ️  Skipping ${skippedOrgs.length} org(s) where you're a member, not an owner: ${skippedOrgs.join(', ')}\n`);

  const findings = [];
  const noAccess = [];
  const incomplete = [];
  const add = (secrets, where) => {
    for (const secret of secrets) {
      const days = daysSince(secret.updatedAt);
      findings.push({
        ...where,
        secretName: secret.name,
        updatedAt: secret.updatedAt,
        ageDays: days,
        tokenLike: isTokenSecret(secret.name, opts.match),
        ...(secret.visibility ? { visibility: secret.visibility } : {}),
        ...ageStatus(days, opts.staleDays),
      });
    }
  };
  // A 404 means the feature isn't available there (e.g. Codespaces not enabled for an org),
  // so there are no secrets to miss; anything else (usually 403) is a gap worth reporting.
  const attempt = async (target, args, where) => {
    try {
      add(await ghJson(args), where);
    } catch (error) {
      if (!/\b404\b/.test(firstLine(error))) incomplete.push({ target, error: firstLine(error) });
    }
  };

  const repositories = [];
  for (const owner of owners) {
    const isOrg = owner !== user && (opts.owner ? ownerIsOrg(owner) : true);
    if (isOrg && scanOrgSecrets) {
      for (const app of SECRET_APPS) {
        await attempt(`${owner} (${app})`, ['secret', 'list', '--org', owner, '--app', app, '--json', 'name,updatedAt,visibility'],
          { scope: 'organization', owner, repo: null, environment: null, app });
      }
    } else if (owner === user && scanUserSecrets) {
      await attempt(`${owner} (codespaces user secrets)`, ['secret', 'list', '--user', '--json', 'name,updatedAt'],
        { scope: 'user', owner, repo: null, environment: null, app: 'codespaces' });
    }
    try {
      repositories.push(...getRepositories(owner, opts.limit));
    } catch (error) {
      incomplete.push({ target: `${owner} (repositories)`, error: firstLine(error) });
    }
  }
  log(`✅ Found ${repositories.length} non-archived repositories\n`);
  log('🔍 Scanning every secret (this makes several calls per repository)...\n');

  await mapLimit(repositories, 8, async (repo) => {
    const owner = repo.split('/')[0];
    try {
      add(await ghJson(['secret', 'list', '--repo', repo, '--app', 'actions', '--json', 'name,updatedAt']),
        { scope: 'repository', owner, repo, environment: null, app: 'actions' });
    } catch {
      noAccess.push(repo);
      return;
    }
    for (const app of SECRET_APPS.filter((a) => a !== 'actions')) {
      await attempt(`${repo} (${app})`, ['secret', 'list', '--repo', repo, '--app', app, '--json', 'name,updatedAt'],
        { scope: 'repository', owner, repo, environment: null, app });
    }
    let environments = [];
    try {
      environments = await ghLinesAsync(['api', `repos/${repo}/environments`, '--paginate', '--jq', '.environments[].name']);
    } catch (error) {
      // 404: the repo has no environments (e.g. private repos on plans without them).
      if (!/\b404\b/.test(firstLine(error))) incomplete.push({ target: `${repo} (environments)`, error: firstLine(error) });
    }
    for (const environment of environments) {
      await attempt(`${repo} (env ${environment})`, ['secret', 'list', '--repo', repo, '--env', environment, '--json', 'name,updatedAt'],
        { scope: 'environment', owner, repo, environment, app: 'actions' });
    }
  });

  findings.sort((a, b) => b.ageDays - a.ageDays);
  incomplete.sort((a, b) => a.target.localeCompare(b.target));
  return { mode: 'all-secrets', owners, skippedOrgs, tokenScopes, skippedScopes, scanned: repositories.length, findings, noAccess: noAccess.sort(), incomplete };
}

function ownerIsOrg(owner) {
  try {
    return ghLines(['api', `users/${owner}`, '--jq', '.type'])[0] === 'Organization';
  } catch {
    return false;
  }
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

function secretLocation(f) {
  return f.repo ?? f.owner;
}

function secretKind(f) {
  if (f.scope === 'environment') return `env:${f.environment}`;
  if (f.scope === 'organization') return `org/${f.app}`;
  if (f.scope === 'user') return 'user/codespaces';
  return f.app;
}

function printAllSecrets(remote, staleDays) {
  console.log('═'.repeat(110));
  console.log('🔍 ALL REPOSITORY, ORGANIZATION AND USER SECRETS\n');
  if (remote.findings.length === 0) {
    console.log('✅ No secrets found\n');
  } else {
    // Size each column to its longest value so long repo and secret names never run together.
    const secretLabel = (f) => `${f.secretName}${f.tokenLike ? ' 🔑' : ''}`;
    const width = (header, values) => Math.max(header.length, ...values.map((v) => v.length)) + 2;
    const locationWidth = width('LOCATION', remote.findings.map(secretLocation));
    const nameWidth = width('SECRET NAME', remote.findings.map(secretLabel));
    const kindWidth = width('KIND', remote.findings.map(secretKind));
    console.log('  ' + 'LOCATION'.padEnd(locationWidth) + 'SECRET NAME'.padEnd(nameWidth) + 'KIND'.padEnd(kindWidth) + 'STATUS'.padEnd(8) + 'LAST SET');
    console.log('─'.repeat(2 + locationWidth + nameWidth + kindWidth + 8 + 22));
    for (const f of remote.findings) {
      console.log(`${f.icon} ${secretLocation(f).padEnd(locationWidth)}${secretLabel(f).padEnd(nameWidth)}${secretKind(f).padEnd(kindWidth)}${f.status.padEnd(8)}${f.updatedAt.slice(0, 10)} (${f.ageDays}d ago)`);
    }
    console.log('');
  }
  const repos = new Set(remote.findings.map((f) => f.repo).filter(Boolean)).size;
  console.log(`📊 ${remote.findings.length} secret(s) in ${repos} of ${remote.scanned} repositories across ${remote.owners.length} owner(s); 🔑 marks GitHub-token-like names\n`);
  if (remote.skippedScopes.length > 0) {
    console.log(`ℹ️  Not scanned — your gh token lacks these scopes: ${remote.skippedScopes.map((s) => `${s.listing} (${s.scope})`).join(', ')}`);
    console.log(`   To include them: gh auth refresh -h github.com -s ${remote.skippedScopes.map((s) => s.scope).join(',')}\n`);
  }
  if (remote.skippedOrgs.length > 0) {
    console.log(`ℹ️  Skipped ${remote.skippedOrgs.length} org(s) where you're a member, not an owner: ${remote.skippedOrgs.join(', ')} — name one as the owner to scan it anyway\n`);
  }
  if (remote.noAccess.length > 0) {
    console.log(`⚠️  Could not read secrets in ${remote.noAccess.length} repo(s) (needs admin access): ${remote.noAccess.slice(0, 10).join(', ')}${remote.noAccess.length > 10 ? ', …' : ''}\n`);
  }
  if (remote.incomplete.length > 0) {
    console.log(`⚠️  ${remote.incomplete.length} listing(s) failed and are missing from the table (usually missing admin rights or token scopes): ${remote.incomplete.slice(0, 10).map((i) => i.target).join(', ')}${remote.incomplete.length > 10 ? ', …' : ''}\n`);
  }
  const stale = remote.findings.filter((f) => f.status === 'STALE');
  if (stale.length > 0) {
    const rotatable = stale.filter((f) => f.tokenLike && f.scope === 'repository' && f.app === 'actions').length;
    console.log(`🔴 ${stale.length} secret(s) not set in ${staleDays}+ days${rotatable ? ` — ${rotatable} of them token-like repository secret(s); rotate with: rotate-gh-token <owner/repo> <SECRET>` : ''}\n`);
  }
  console.log('ℹ️  GitHub never reveals secret values; "LAST SET" is the only age signal available.\n');
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
    report.remote = opts.allSecrets ? await auditAllSecrets(opts, report.user, log) : await auditRemote(opts, log);
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
    if (report.remote) (opts.allSecrets ? printAllSecrets : printRemote)(report.remote, opts.staleDays);
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
