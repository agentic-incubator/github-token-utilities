// End-to-end tests for the CLI scripts. A fake `gh` on PATH records every call, so nothing
// touches GitHub and we can assert that tokens never appear in command-line arguments.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'ghp_FAKE_test_token_for_cli_tests';

let home;
let binDir;
let logFile;

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
  if ((process.env.GH_TOKEN || '').includes('REVOKED')) { process.stderr.write('HTTP 401: Bad credentials'); process.exit(1); }
  const expiry = process.env.FAKE_GH_EXPIRY || '2099-01-01 00:00:00 UTC';
  process.stdout.write('HTTP/2.0 200 OK\\r\\nX-Oauth-Scopes: repo\\r\\nGithub-Authentication-Token-Expiration: ' + expiry + '\\r\\n\\r\\n{"login":"octocat"}');
} else if (cmd === 'api user') {
  process.stdout.write('octocat\\n');
} else if (cmd === 'repo view') {
  process.stdout.write('{"nameWithOwner":"acme/api"}');
} else if (cmd === 'repo list') {
  process.stdout.write(JSON.stringify([{ nameWithOwner: 'acme/api' }, { nameWithOwner: 'acme/locked' }]));
} else if (cmd === 'secret list') {
  if (args.includes('acme/locked')) { process.stderr.write('HTTP 403'); process.exit(1); }
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
  const env = { ...process.env, HOME: home, USERPROFILE: home, GTU_GH_SHIM: path.join(binDir, 'fake-gh.cjs'), FAKE_GH_LOG: logFile, ...extraEnv };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  return spawnSync(process.execPath, [path.join(ROOT, script), ...args], { env, input, encoding: 'utf-8' });
}

function ghCalls() {
  if (!fs.existsSync(logFile)) return [];
  return fs.readFileSync(logFile, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

beforeEach(() => {
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

test('setup --dry-run copies nothing and edits no shell config', () => {
  const result = run('setup.mjs', ['--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /would copy gh-token-lib\.mjs/);
  assert.deepEqual(fs.readdirSync(home), []);
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
