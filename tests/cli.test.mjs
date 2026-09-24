// End-to-end tests for the CLI scripts. A fake `gh` on PATH records every call, so nothing
// touches GitHub and we can assert that tokens never appear in command-line arguments.

import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'ghp_FAKE_test_token_for_cli_tests';

let home;
let binDir;
let logFile;

// A fake GitHub API for POST /credentials/revoke, run as its own process because the CLI
// tests block on spawnSync. It records each request and marks the tokens revoked, which the
// fake gh then honours (401). Write a status code into STATUS_FILE to make it fail.
const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtu-api-'));
const revokedFile = path.join(serverDir, 'revoked.txt');
const requestsFile = path.join(serverDir, 'requests.jsonl');
const statusFile = path.join(serverDir, 'status.txt');
let apiUrl;
let server;

const FAKE_API = `
const http = require('http'); const fs = require('fs');
const [revoked, requests, statusFile] = process.argv.slice(1);
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    fs.appendFileSync(requests, JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body }) + '\\n');
    const status = fs.existsSync(statusFile) ? Number(fs.readFileSync(statusFile, 'utf-8')) : 202;
    if (status === 202) for (const t of JSON.parse(body).credentials) fs.appendFileSync(revoked, t + '\\n');
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(status === 202 ? '{}' : JSON.stringify({ message: 'nope' }));
  });
}).listen(0, '127.0.0.1', function () { process.stdout.write(String(this.address().port) + '\\n'); });
`;

before(async () => {
  server = spawn(process.execPath, ['-e', FAKE_API, revokedFile, requestsFile, statusFile], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((resolve) => server.stdout.once('data', (d) => resolve(String(d).trim())));
  apiUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  server.kill();
  fs.rmSync(serverDir, { recursive: true, force: true });
});

function apiRequests() {
  if (!fs.existsSync(requestsFile)) return [];
  return fs.readFileSync(requestsFile, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const FAKE_GH = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const cmd = args.slice(0, 2).join(' ');
// Only "secret set" sends data on stdin. Reading it for other commands would block forever
// on Windows, where callers like execFile leave an open, empty stdin pipe.
let stdin = '';
if (cmd === 'secret set') { try { stdin = fs.readFileSync(0, 'utf-8'); } catch {} }
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ args, stdin, ghToken: process.env.GH_TOKEN || null }) + '\\n');
if (cmd === 'api -i') {
  const revoked = process.env.FAKE_REVOKED_FILE && fs.existsSync(process.env.FAKE_REVOKED_FILE) ? fs.readFileSync(process.env.FAKE_REVOKED_FILE, 'utf-8').split('\\n') : [];
  if ((process.env.GH_TOKEN || '').includes('REVOKED') || revoked.includes(process.env.GH_TOKEN)) { process.stderr.write('HTTP 401: Bad credentials'); process.exit(1); }
  const expiry = process.env.FAKE_GH_EXPIRY || '2099-01-01 00:00:00 UTC';
  const tokenLogin = process.env.FAKE_GH_TOKEN_LOGIN || 'octocat';
  // FAKE_GH_SCOPES overrides the scopes header; 'none' omits it, as for fine-grained tokens.
  const scopes = process.env.FAKE_GH_SCOPES || 'repo';
  const scopeHeader = scopes === 'none' ? '' : 'X-Oauth-Scopes: ' + scopes + '\\r\\n';
  process.stdout.write('HTTP/2.0 200 OK\\r\\n' + scopeHeader + 'Github-Authentication-Token-Expiration: ' + expiry + '\\r\\n\\r\\n{"login":"' + tokenLogin + '"}');
} else if (cmd === 'api user') {
  process.stdout.write((process.env.FAKE_GH_LOGIN || 'octocat') + '\\n');
} else if (cmd === 'api user/memberships/orgs') {
  process.stdout.write('acme\\tadmin\\nwidgets\\tmember\\n');
} else if (cmd === 'api users/acme') {
  process.stdout.write('Organization\\n');
} else if (cmd === 'api repos/acme/api/environments') {
  process.stdout.write('prod\\n');
} else if (cmd.startsWith('api repos/')) {
  process.stderr.write('HTTP 404'); process.exit(1);
} else if (cmd === 'auth token') {
  if (!process.env.FAKE_GH_STORED_TOKEN) { process.stderr.write('no token'); process.exit(1); }
  process.stdout.write(process.env.FAKE_GH_STORED_TOKEN + '\\n');
} else if (cmd === 'repo view') {
  process.stdout.write('{"nameWithOwner":"acme/api"}');
} else if (cmd === 'repo list') {
  const owner = args[2] && !args[2].startsWith('-') ? args[2] : 'acme';
  process.stdout.write(JSON.stringify(owner === 'acme' ? [{ nameWithOwner: 'acme/api' }, { nameWithOwner: 'acme/locked' }] : [{ nameWithOwner: owner + '/dotfiles' }]));
} else if (cmd === 'secret list') {
  if (args.includes('acme/locked')) { process.stderr.write('HTTP 403'); process.exit(1); }
  const app = args.includes('--app') ? args[args.indexOf('--app') + 1] : 'actions';
  const recent = new Date(Date.now() - 86400000).toISOString();
  if (args.includes('--env')) { process.stdout.write(JSON.stringify([{ name: 'DEPLOY_KEY', updatedAt: recent }])); process.exit(0); }
  if (args.includes('--org')) {
    if (app === 'codespaces') { process.stderr.write('HTTP 403'); process.exit(1); }
    if (app === 'agents') { process.stderr.write('HTTP 404: Not Found'); process.exit(1); }
    process.stdout.write(JSON.stringify(app === 'actions' ? [{ name: 'ORG_NPM_TOKEN', updatedAt: '2020-01-01T00:00:00Z', visibility: 'all', numSelectedRepos: 0 }] : []));
    process.exit(0);
  }
  if (args.includes('--user')) { process.stdout.write(JSON.stringify([{ name: 'CS_SECRET', updatedAt: recent }])); process.exit(0); }
  if (app === 'dependabot') { process.stdout.write(JSON.stringify(args.includes('acme/api') ? [{ name: 'REGISTRY_PASSWORD', updatedAt: recent }] : [])); process.exit(0); }
  if (app !== 'actions') { process.stdout.write('[]'); process.exit(0); }
  if (!args.includes('acme/api')) { process.stdout.write('[]'); process.exit(0); }
  process.stdout.write(JSON.stringify([
    { name: 'GH_TOKEN', updatedAt: '2020-01-01T00:00:00Z' },
    { name: 'NPM_TOKEN', updatedAt: '2020-01-01T00:00:00Z' },
  ]));
} else if (cmd === 'secret set') {
  process.stdout.write('✓ Set secret\\n');
} else {
  process.stderr.write('fake gh: unexpected ' + args.join(' '));
  process.exit(2);
}
`;

function run(script, args, { input, env: extraEnv = {} } = {}) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, GTU_GH_SHIM: path.join(binDir, 'fake-gh.cjs'), FAKE_GH_LOG: logFile, GTU_API_URL: apiUrl, FAKE_REVOKED_FILE: revokedFile, ...extraEnv };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  return spawnSync(process.execPath, [path.join(ROOT, script), ...args], { env, input, encoding: 'utf-8' });
}

function ghCalls() {
  if (!fs.existsSync(logFile)) return [];
  return fs.readFileSync(logFile, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

beforeEach(() => {
  for (const f of [revokedFile, requestsFile, statusFile]) fs.rmSync(f, { force: true });
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'gtu-home-'));
  binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtu-bin-'));
  logFile = path.join(binDir, 'calls.jsonl');
  fs.writeFileSync(path.join(binDir, 'fake-gh.cjs'), FAKE_GH);
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(binDir, { recursive: true, force: true });
});

test('generator --print-url prints a prefilled URL without touching gh', () => {
  const result = run('generator.mjs', ['--type', 'fine-grained', '--name', 'deploy', '--permissions', 'contents=read', '--expiration', '30', '--print-url']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /personal-access-tokens\/new\?name=deploy&expires_in=30&contents=read/);
  assert.equal(ghCalls().length, 0);
});

test('generator --token-stdin verifies and saves the token with mode 600, never echoing it', () => {
  const result = run('generator.mjs', ['--type', 'classic', '--name', 'ci', '--scopes', 'repo', '--expiration', '30', '--yes', '--token-stdin'], { input: `${TOKEN}\n` });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const file = path.join(home, 'ci.ght');
  assert.equal(fs.readFileSync(file, 'utf-8'), TOKEN);
  if (os.platform() !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.ok(!result.stdout.includes(TOKEN), 'token must not be printed');
  const [call] = ghCalls();
  assert.deepEqual(call.args, ['api', '-i', 'user']);
  assert.equal(call.ghToken, TOKEN);
});

test('generator --token-stdin refuses to run without every choice supplied', () => {
  const result = run('generator.mjs', ['--name', 'ci', '--token-stdin'], { input: TOKEN });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /requires --type, --name, --expiration and --yes/);
});

test('generator refuses to overwrite an existing token file non-interactively', () => {
  fs.writeFileSync(path.join(home, 'ci.ght'), 'old', { mode: 0o600 });
  const result = run('generator.mjs', ['--type', 'classic', '--name', 'ci', '--scopes', 'repo', '--expiration', '30', '--yes', '--token-stdin'], { input: TOKEN });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /--force/);
  assert.equal(fs.readFileSync(path.join(home, 'ci.ght'), 'utf-8'), 'old');
});

test('rotate --existing sends the token on stdin, not in argv', () => {
  fs.writeFileSync(path.join(home, 'new.ght'), TOKEN, { mode: 0o600 });
  const result = run('rotate.mjs', ['acme/api', 'gh_token', '--existing', 'new', '--yes']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const setCall = ghCalls().find((c) => c.args[0] === 'secret' && c.args[1] === 'set');
  assert.deepEqual(setCall.args, ['secret', 'set', 'GH_TOKEN', '--repo', 'acme/api']);
  assert.equal(setCall.stdin, TOKEN);
  for (const call of ghCalls()) assert.ok(!call.args.join(' ').includes(TOKEN));
  assert.ok(!result.stdout.includes(TOKEN));
});

test('rotate --dry-run changes nothing', () => {
  const result = run('rotate.mjs', ['acme/api', 'GH_TOKEN', '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Dry run/);
  assert.ok(!ghCalls().some((c) => c.args[1] === 'set'));
});

test('rotate rejects reserved and malformed inputs before calling gh', () => {
  assert.equal(run('rotate.mjs', ['acme/api', 'GITHUB_TOKEN']).status, 1);
  assert.equal(run('rotate.mjs', ['not-a-repo', 'GH_TOKEN']).status, 1);
  assert.equal(ghCalls().length, 0);
});

test('audit --json reports stale token secrets, inaccessible repos and local tokens', () => {
  fs.writeFileSync(path.join(home, 'ci.ght'), TOKEN, { mode: 0o644 });
  const result = run('audit.mjs', ['--json']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.user, 'octocat');
  assert.deepEqual(report.remote.findings.map((f) => [f.repo, f.secretName, f.status]), [['acme/api', 'GH_TOKEN', 'STALE']]);
  assert.deepEqual(report.remote.noAccess, ['acme/locked']);
  assert.equal(report.local.length, 1);
  assert.equal(report.local[0].valid, true);
  assert.equal(report.local[0].status, 'VALID');
  if (os.platform() !== 'win32') assert.equal(report.local[0].loosePermissions, true);
  assert.ok(!result.stdout.includes(TOKEN));
});

const ALL_SCOPES = { FAKE_GH_SCOPES: 'repo, admin:org, codespace' };

test('audit --all-secrets lists every secret kind across the user and their orgs', () => {
  const result = run('audit.mjs', ['--json', '--all-secrets', '--no-local'], { env: ALL_SCOPES });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  // Only orgs the user owns are scanned; member-only orgs are skipped and named.
  assert.deepEqual(report.remote.owners, ['octocat', 'acme']);
  assert.deepEqual(report.remote.skippedOrgs, ['widgets']);
  assert.ok(!ghCalls().some((c) => c.args.includes('widgets')));
  assert.equal(report.remote.scanned, 3);
  const rows = report.remote.findings.map((f) => [f.scope, f.repo ?? f.owner, f.environment, f.app, f.secretName, f.tokenLike]).sort();
  assert.deepEqual(rows, [
    ['environment', 'acme/api', 'prod', 'actions', 'DEPLOY_KEY', false],
    ['organization', 'acme', null, 'actions', 'ORG_NPM_TOKEN', false],
    ['repository', 'acme/api', null, 'actions', 'GH_TOKEN', true],
    ['repository', 'acme/api', null, 'actions', 'NPM_TOKEN', false],
    ['repository', 'acme/api', null, 'dependabot', 'REGISTRY_PASSWORD', false],
    ['user', 'octocat', null, 'codespaces', 'CS_SECRET', false],
  ]);
  assert.equal(report.remote.findings[0].status, 'STALE');
  assert.deepEqual(report.remote.noAccess, ['acme/locked']);
  // 403 is a gap; 404 (acme agents, octocat/dotfiles environments) means there is nothing to list.
  assert.deepEqual(report.remote.incomplete.map((i) => i.target), ['acme (codespaces)']);
  assert.deepEqual(report.remote.skippedScopes, []);
  // Every non-archived repo of each owner, each app, and environment listings were requested.
  const apps = ghCalls().filter((c) => c.args[0] === 'secret' && c.args.includes('acme/api') && !c.args.includes('--env')).map((c) => c.args[c.args.indexOf('--app') + 1]);
  assert.deepEqual(apps.sort(), ['actions', 'agents', 'codespaces', 'dependabot']);
});

test('audit --all-secrets skips, and names, listings the gh token lacks the scopes for', () => {
  const result = run('audit.mjs', ['--json', '--all-secrets', '--no-local']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.remote.skippedScopes, [
    { listing: 'organization secrets', scope: 'admin:org' },
    { listing: 'Codespaces user secrets', scope: 'codespace' },
  ]);
  // Not attempted, so nothing failed: no org or user secret calls, and no 403s reported.
  assert.ok(!ghCalls().some((c) => c.args[0] === 'secret' && (c.args.includes('--org') || c.args.includes('--user'))));
  assert.deepEqual(report.remote.incomplete, []);
  assert.ok(report.remote.findings.every((f) => f.scope === 'repository' || f.scope === 'environment'));
  const text = run('audit.mjs', ['--all-secrets', '--no-local']);
  assert.match(text.stdout, /Not scanned — your gh token lacks these scopes: organization secrets \(admin:org\), Codespaces user secrets \(codespace\)/);
  assert.match(text.stdout, /gh auth refresh -h github\.com -s admin:org,codespace/);
});

test('audit --all-secrets attempts every listing when the token reports no scopes (fine-grained)', () => {
  const result = run('audit.mjs', ['--json', '--all-secrets', '--no-local'], { env: { FAKE_GH_SCOPES: 'none' } });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.remote.tokenScopes, null);
  assert.deepEqual(report.remote.skippedScopes, []);
  assert.ok(report.remote.findings.some((f) => f.scope === 'organization'));
  assert.ok(report.remote.findings.some((f) => f.scope === 'user'));
});

test('audit --all-secrets with an owner scans only that owner, and rejects --no-remote', () => {
  const result = run('audit.mjs', ['acme', '--json', '--all-secrets', '--no-local'], { env: ALL_SCOPES });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.remote.owners, ['acme']);
  assert.ok(!report.remote.findings.some((f) => f.scope === 'user'));
  assert.ok(report.remote.findings.some((f) => f.scope === 'organization'));
  assert.equal(run('audit.mjs', ['--all-secrets', '--no-remote']).status, 1);
});

test('audit --all-secrets prints a table without secret values', () => {
  const result = run('audit.mjs', ['--all-secrets', '--no-local'], { env: ALL_SCOPES });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ALL REPOSITORY, ORGANIZATION AND USER SECRETS/);
  assert.match(result.stdout, /env:prod/);
  assert.match(result.stdout, /org\/actions/);
  assert.match(result.stdout, /Skipped 1 org\(s\) where you're a member, not an owner: widgets/);
  // Columns are sized to the data: every value is followed by at least two spaces.
  assert.match(result.stdout, /REGISTRY_PASSWORD {2,}dependabot {2,}/);
});

test('setup --dry-run copies nothing and edits no shell config', () => {
  const result = run('setup.mjs', ['--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /would copy gh-token-lib\.mjs/);
  // On Windows, asking PowerShell for $PROFILE makes PowerShell itself create AppData.
  assert.deepEqual(fs.readdirSync(home).filter((f) => f !== 'AppData'), []);
});

test('setup installs scripts that run from the home directory', () => {
  const result = run('setup.mjs', []);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const help = spawnSync(process.execPath, [path.join(home, 'audit.mjs'), '--help'], { encoding: 'utf-8' });
  assert.equal(help.status, 0, help.stderr);
  // Running setup twice must not duplicate aliases.
  run('setup.mjs', []);
  const rc = fs.readdirSync(home).find((f) => /^\.(zshrc|bashrc|bash_profile)$/.test(f));
  if (rc) {
    const content = fs.readFileSync(path.join(home, rc), 'utf-8');
    assert.equal(content.match(/alias audit-gh-tokens=/g).length, 1);
  }
});

// ── store-gh-token ───────────────────────────────────────────────────────────

const SOON = () => {
  const d = new Date(Date.now() + 7 * 86400000);
  return `${d.toISOString().slice(0, 10)} 00:00:00 UTC`;
};

test('store creates ~/.secrets.env with the value and a reference, owner-only, never printing the token', () => {
  const result = run('store.mjs', ['--format', 'sh', '--token-stdin', '--yes'], { input: TOKEN, env: { FAKE_GH_EXPIRY: SOON() } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const file = path.join(home, '.secrets.env');
  assert.equal(fs.readFileSync(file, 'utf-8'), `export GITHUB_TOKEN=${TOKEN}\nexport GITHUB_PERSONAL_ACCESS_TOKEN="$GITHUB_TOKEN"\n`);
  if (os.platform() !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.ok(!result.stdout.includes(TOKEN));
});

test('store flips the reference direction in an existing file and keeps every other line', () => {
  const file = path.join(home, '.secrets.env');
  const OLD = 'ghp_FAKE_REVOKED_old_token';
  fs.writeFileSync(file, [
    '# my secrets',
    'export OPENAI_API_KEY=sk-keep-me',
    `export GITHUB_PERSONAL_ACCESS_TOKEN=${OLD}`,
    'export GITHUB_TOKEN=$GITHUB_PERSONAL_ACCESS_TOKEN',
    'export OTHER=1',
    '',
  ].join('\n'), { mode: 0o644 });

  const result = run('store.mjs', ['--format', 'sh', '--token-stdin', '--yes'], { input: TOKEN, env: { FAKE_GH_EXPIRY: SOON() } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.readFileSync(file, 'utf-8'), [
    '# my secrets',
    'export OPENAI_API_KEY=sk-keep-me',
    `export GITHUB_TOKEN=${TOKEN}`,
    'export GITHUB_PERSONAL_ACCESS_TOKEN="$GITHUB_TOKEN"',
    'export OTHER=1',
    '',
  ].join('\n'));
  if (os.platform() !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.ok(fs.readFileSync(`${file}.bak`, 'utf-8').includes(OLD), 'backup keeps the previous version');
  assert.match(result.stdout, /already invalid/);
  assert.ok(!result.stdout.includes(TOKEN) && !result.stdout.includes(OLD));
});

test('store refuses a long-lived token unless forced', () => {
  const refused = run('store.mjs', ['--format', 'sh', '--token-stdin', '--yes'], { input: TOKEN });
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /longer than --max-days 30/);
  assert.ok(!fs.existsSync(path.join(home, '.secrets.env')));

  const forced = run('store.mjs', ['--format', 'sh', '--token-stdin', '--yes', '--force'], { input: TOKEN });
  assert.equal(forced.status, 0, forced.stdout);
});

test('store reports when the replaced token is still active', () => {
  const OLD = 'ghp_FAKE_still_active_old_token';
  fs.writeFileSync(path.join(home, '.secrets.env'), `export GITHUB_TOKEN=${OLD}\n`);
  const result = run('store.mjs', ['--format', 'sh', '--token-stdin', '--yes'], { input: TOKEN, env: { FAKE_GH_EXPIRY: SOON() } });
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /STILL ACTIVE/);
});

test('store --dry-run writes nothing', () => {
  const result = run('store.mjs', ['--format', 'sh', '--token-stdin', '--yes', '--dry-run'], { input: TOKEN, env: { FAKE_GH_EXPIRY: SOON() } });
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /Dry run/);
  assert.deepEqual(fs.readdirSync(home), []);
});

test('store rejects values that could execute when the file is sourced', () => {
  const result = run('store.mjs', ['--format', 'sh', '--token-stdin', '--yes', '--no-verify'], { input: 'ghp_x$(touch pwned)' });
  assert.equal(result.status, 1);
  assert.ok(!fs.existsSync(path.join(home, '.secrets.env')));
});

test('store --from reads a saved .ght file', () => {
  fs.writeFileSync(path.join(home, 'terminal.ght'), TOKEN, { mode: 0o600 });
  const result = run('store.mjs', ['--format', 'sh', '--from', 'terminal', '--yes'], { env: { FAKE_GH_EXPIRY: SOON() } });
  assert.equal(result.status, 0, result.stdout);
  assert.match(fs.readFileSync(path.join(home, '.secrets.env'), 'utf-8'), new RegExp(`GITHUB_TOKEN=${TOKEN}`));
});

test('store --ensure-loaded adds the loader to the shell rc exactly once', () => {
  const args = ['--format', 'sh', '--token-stdin', '--yes', '--ensure-loaded'];
  const env = { FAKE_GH_EXPIRY: SOON(), SHELL: '/bin/zsh' };
  assert.equal(run('store.mjs', args, { input: TOKEN, env }).status, 0);
  assert.equal(run('store.mjs', args, { input: TOKEN, env }).status, 0);
  const rc = fs.readFileSync(path.join(home, '.zshrc'), 'utf-8');
  assert.equal(rc, '[ -f "$HOME/.secrets.env" ] && . "$HOME/.secrets.env"\n');
});

test('store writes PowerShell syntax for --format powershell', () => {
  const result = run('store.mjs', ['--format', 'powershell', '--token-stdin', '--yes'], { input: TOKEN, env: { FAKE_GH_EXPIRY: SOON() } });
  assert.equal(result.status, 0, result.stdout);
  assert.equal(fs.readFileSync(path.join(home, '.secrets.ps1'), 'utf-8'),
    `$env:GITHUB_TOKEN = '${TOKEN}'\r\n$env:GITHUB_PERSONAL_ACCESS_TOKEN = $env:GITHUB_TOKEN\r\n`);
});

test('store writes fish syntax for --format fish', () => {
  const result = run('store.mjs', ['--format', 'fish', '--token-stdin', '--yes'], { input: TOKEN, env: { FAKE_GH_EXPIRY: SOON() } });
  assert.equal(result.status, 0, result.stdout);
  assert.equal(fs.readFileSync(path.join(home, '.config', 'fish', 'conf.d', 'secrets.fish'), 'utf-8'),
    `set -gx GITHUB_TOKEN ${TOKEN}\nset -gx GITHUB_PERSONAL_ACCESS_TOKEN $GITHUB_TOKEN\n`);
});

// ── store-gh-token --generate ────────────────────────────────────────────────

test('store --generate opens GitHub for the gh account and stores the token it returns', () => {
  const result = run('store.mjs', ['--generate', '--format', 'sh', '--no-open', '--token-stdin', '--yes'], { input: TOKEN, env: { FAKE_GH_EXPIRY: SOON() } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /gh is signed in as: octocat \(via gh login\)/);
  assert.match(result.stdout, /settings\/tokens\/new\?description=terminal-\d{8}&scopes=repo,/);
  assert.match(result.stdout, /Set Expiration to 7 days/);
  assert.match(fs.readFileSync(path.join(home, '.secrets.env'), 'utf-8'), new RegExp(`^export GITHUB_TOKEN=${TOKEN}$`, 'm'));
  assert.ok(!result.stdout.includes(TOKEN));
});

test('store --generate refuses a token from a different account', () => {
  const result = run('store.mjs', ['--generate', '--format', 'sh', '--no-open', '--token-stdin', '--yes'], {
    input: TOKEN,
    env: { FAKE_GH_EXPIRY: SOON(), FAKE_GH_TOKEN_LOGIN: 'someone-else' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /belongs to someone-else, but gh is signed in as octocat/);
  assert.ok(!fs.existsSync(path.join(home, '.secrets.env')));
});

test('store --generate rejects an expiration beyond --max-days before opening GitHub', () => {
  const result = run('store.mjs', ['--generate', '--expiration', '45', '--no-open', '--token-stdin', '--yes'], { input: TOKEN });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /exceeds --max-days 30/);
  assert.ok(!ghCalls().some((c) => c.args[0] === 'api'));
});

test('store validates --generate option combinations', () => {
  assert.match(run('store.mjs', ['--generate', '--from', 'x']).stderr, /cannot be combined/);
  assert.match(run('store.mjs', ['--scopes', 'repo']).stderr, /only applies with --generate/);
  assert.match(run('store.mjs', ['--generate', '--no-verify']).stderr, /needs verification/);
});

// ── revoke-gh-token ──────────────────────────────────────────────────────────

test('revoke --from calls the revocation API unauthenticated, confirms, and deletes the file', () => {
  fs.writeFileSync(path.join(home, 'old.ght'), TOKEN, { mode: 0o600 });
  const result = run('revoke.mjs', ['--from', 'old', '--yes']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const [req] = apiRequests();
  assert.equal(req.method, 'POST');
  assert.equal(req.url, '/credentials/revoke');
  assert.equal(req.headers.authorization, undefined, 'must be unauthenticated');
  assert.deepEqual(JSON.parse(req.body), { credentials: [TOKEN] });
  assert.match(result.stdout, /GitHub accepted the revocation/);
  assert.match(result.stdout, /Waiting for GitHub to reject the token\.\.\. done/);
  assert.ok(!fs.existsSync(path.join(home, 'old.ght')));
  assert.ok(!result.stdout.includes(TOKEN));
});

test('revoke --dry-run calls nothing and keeps the file', () => {
  fs.writeFileSync(path.join(home, 'old.ght'), TOKEN, { mode: 0o600 });
  const result = run('revoke.mjs', ['--from', 'old', '--dry-run']);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /Dry run/);
  assert.equal(apiRequests().length, 0);
  assert.ok(fs.existsSync(path.join(home, 'old.ght')));
});

test('revoke --stored removes only the variables holding that token', () => {
  const file = path.join(home, '.secrets.env');
  fs.writeFileSync(file, [
    'export OTHER=keep',
    `export GITHUB_TOKEN=${TOKEN}`,
    'export GITHUB_PERSONAL_ACCESS_TOKEN="$GITHUB_TOKEN"',
    'export GH_TOKEN=ghp_FAKE_different_token',
    '',
  ].join('\n'));
  const result = run('revoke.mjs', ['--stored', '--format', 'sh', '--yes']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.readFileSync(file, 'utf-8'), 'export OTHER=keep\nexport GH_TOKEN=ghp_FAKE_different_token\n');
});

test('revoke --previous revokes the token store-gh-token replaced and deletes the backup', () => {
  const file = path.join(home, '.secrets.env');
  fs.writeFileSync(file, `export GITHUB_TOKEN=ghp_FAKE_current_token\n`);
  fs.writeFileSync(`${file}.bak`, `export GITHUB_TOKEN=${TOKEN}\n`);
  const result = run('revoke.mjs', ['--previous', '--format', 'sh', '--yes']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(apiRequests()[0].body).credentials, [TOKEN]);
  assert.ok(!fs.existsSync(`${file}.bak`));
  assert.equal(fs.readFileSync(file, 'utf-8'), 'export GITHUB_TOKEN=ghp_FAKE_current_token\n');
});

test('revoke skips the API for an already-dead token but still cleans up', () => {
  fs.writeFileSync(path.join(home, 'dead.ght'), 'ghp_FAKE_REVOKED_token', { mode: 0o600 });
  const result = run('revoke.mjs', ['--from', 'dead', '--yes']);
  assert.equal(result.status, 0, result.stdout);
  assert.match(result.stdout, /already rejects this token/);
  assert.equal(apiRequests().length, 0);
  assert.ok(!fs.existsSync(path.join(home, 'dead.ght')));
});

test("revoke refuses gh's own login token without --force", () => {
  fs.writeFileSync(path.join(home, 'gh.ght'), TOKEN, { mode: 0o600 });
  const result = run('revoke.mjs', ['--from', 'gh', '--yes'], { env: { FAKE_GH_STORED_TOKEN: TOKEN } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /logs gh out/);
  assert.equal(apiRequests().length, 0);
});

test('revoke keeps local copies when the API refuses', () => {
  fs.writeFileSync(path.join(home, 'old.ght'), TOKEN, { mode: 0o600 });
  fs.writeFileSync(statusFile, '403');
  const result = run('revoke.mjs', ['--from', 'old', '--yes']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /GitHub answered 403.*rate limit/);
  assert.ok(fs.existsSync(path.join(home, 'old.ght')));
});

test('revoke requires confirmation when not interactive', () => {
  fs.writeFileSync(path.join(home, 'old.ght'), TOKEN, { mode: 0o600 });
  const result = run('revoke.mjs', ['--from', 'old']);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Confirmation needed/);
  assert.equal(apiRequests().length, 0);
});

test('revoke needs exactly one token source', () => {
  assert.match(run('revoke.mjs', []).stderr, /exactly one/);
  assert.match(run('revoke.mjs', ['--stored', '--previous']).stderr, /exactly one|only one/);
});

test('store --revoke-previous revokes the replaced token and deletes the backup', () => {
  const OLD = 'ghp_FAKE_old_terminal_token';
  const file = path.join(home, '.secrets.env');
  fs.writeFileSync(file, `export GITHUB_TOKEN=${OLD}\n`);
  const result = run('store.mjs', ['--format', 'sh', '--token-stdin', '--yes', '--revoke-previous'], { input: TOKEN, env: { FAKE_GH_EXPIRY: SOON() } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(apiRequests()[0].body).credentials, [OLD]);
  assert.match(result.stdout, /Revoked; GitHub now rejects it/);
  assert.ok(!fs.existsSync(`${file}.bak`));
  assert.match(fs.readFileSync(file, 'utf-8'), new RegExp(`GITHUB_TOKEN=${TOKEN}`));
});
