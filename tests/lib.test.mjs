import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ageStatus,
  buildClassicUrl,
  buildFineGrainedUrl,
  expiryStatus,
  isTokenSecret,
  parseExpirationHeader,
  parsePermissions,
  tokenType,
  validateRepo,
  validateSecretName,
  validateTokenName,
  verifyToken,
} from '../gh-token-lib.mjs';

test('parseExpirationHeader handles UTC and numeric offsets', () => {
  assert.equal(parseExpirationHeader('2026-10-24 12:00:00 UTC').toISOString(), '2026-10-24T12:00:00.000Z');
  assert.equal(parseExpirationHeader('2026-10-24 12:00:00 -0700').toISOString(), '2026-10-24T19:00:00.000Z');
  assert.equal(parseExpirationHeader('not a date'), null);
  assert.equal(parseExpirationHeader(undefined), null);
});

test('expiryStatus buckets by days remaining', () => {
  const now = new Date('2026-09-24T00:00:00Z');
  const at = (days) => new Date(now.getTime() + days * 86400000);
  assert.equal(expiryStatus({ expiresAt: at(-1), type: 'classic', now }).status, 'EXPIRED');
  assert.equal(expiryStatus({ expiresAt: at(3), type: 'classic', now }).status, 'EXPIRING_SOON');
  assert.equal(expiryStatus({ expiresAt: at(20), type: 'classic', now }).status, 'NEARING_EXPIRATION');
  assert.equal(expiryStatus({ expiresAt: at(90), type: 'classic', now }).status, 'VALID');
  assert.equal(expiryStatus({ expiresAt: null, type: 'classic', now }).status, 'NO_EXPIRATION');
});

test('expiryStatus distrusts a fine-grained expiry equal to "now"', () => {
  const now = new Date('2026-09-24T00:00:00Z');
  const result = expiryStatus({ expiresAt: new Date(now.getTime() + 1000), type: 'fine-grained', now });
  assert.equal(result.status, 'UNKNOWN');
  assert.ok(result.note);
  // The same value on a classic token is taken at face value.
  assert.equal(expiryStatus({ expiresAt: new Date(now.getTime() + 1000), type: 'classic', now }).status, 'EXPIRING_SOON');
});

test('buildClassicUrl prefills description and scopes', () => {
  assert.equal(buildClassicUrl('ci', ['repo', 'workflow']), 'https://github.com/settings/tokens/new?description=ci&scopes=repo,workflow');
  assert.equal(buildClassicUrl('ci', []), 'https://github.com/settings/tokens/new?description=ci');
  assert.equal(buildClassicUrl('ci', ['read:org']), 'https://github.com/settings/tokens/new?description=ci&scopes=read%3Aorg');
});

test('buildFineGrainedUrl uses the documented template parameters', () => {
  const url = new URL(buildFineGrainedUrl({ name: 'deploy', owner: 'acme', days: 30, permissions: { contents: 'write' } }));
  assert.equal(url.pathname, '/settings/personal-access-tokens/new');
  assert.equal(url.searchParams.get('name'), 'deploy');
  assert.equal(url.searchParams.get('target_name'), 'acme');
  assert.equal(url.searchParams.get('expires_in'), '30');
  assert.equal(url.searchParams.get('contents'), 'write');
});

test('parsePermissions validates name=level pairs', () => {
  assert.deepEqual(parsePermissions('contents=write, workflows=read'), { contents: 'write', workflows: 'read' });
  assert.deepEqual(parsePermissions(''), {});
  assert.throws(() => parsePermissions('contents=owner'), /Invalid permission/);
  assert.throws(() => parsePermissions('contents'), /Invalid permission/);
  assert.throws(() => parsePermissions('content=write'), /Unknown fine-grained permission/);
});

test('validateTokenName enforces charset and fine-grained length', () => {
  assert.equal(validateTokenName('ci-cd_1'), null);
  assert.match(validateTokenName('bad name'), /letters, numbers/);
  assert.equal(validateTokenName('x'.repeat(41), 'classic'), null);
  assert.match(validateTokenName('x'.repeat(41), 'fine-grained'), /40 characters/);
});

test('validateSecretName follows GitHub naming rules', () => {
  assert.equal(validateSecretName('GH_TOKEN'), null);
  assert.equal(validateSecretName('gh_token'), null);
  assert.match(validateSecretName('GITHUB_TOKEN'), /reserves/);
  assert.match(validateSecretName('github_pat'), /reserves/);
  assert.match(validateSecretName('1TOKEN'), /cannot start with a number/);
  assert.match(validateSecretName('MY-TOKEN'), /letters, numbers/);
});

test('validateRepo requires owner/repo', () => {
  assert.equal(validateRepo('acme/api.v2'), null);
  assert.ok(validateRepo('acme'));
  assert.ok(validateRepo('acme/api; rm -rf ~'));
});

test('isTokenSecret recognises common token secret names', () => {
  for (const name of ['GH_TOKEN', 'gh_pat', 'PAT', 'GH_RELEASE_TOKEN', 'BOT_PAT', 'PERSONAL_ACCESS_TOKEN']) {
    assert.ok(isTokenSecret(name), name);
  }
  for (const name of ['NPM_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'PATH_PREFIX']) {
    assert.ok(!isTokenSecret(name), name);
  }
  assert.ok(isTokenSecret('NPM_TOKEN', /^NPM_/));
});

test('ageStatus scales with the stale threshold', () => {
  assert.equal(ageStatus(95, 90).status, 'STALE');
  assert.equal(ageStatus(60, 90).status, 'AGING');
  assert.equal(ageStatus(10, 90).status, 'FRESH');
});

test('tokenType detects classic and fine-grained prefixes', () => {
  assert.equal(tokenType('ghp_abc'), 'classic');
  assert.equal(tokenType('github_pat_abc'), 'fine-grained');
  assert.equal(tokenType('gho_abc'), 'unknown');
});

test('verifyToken reads login, scopes and expiry from gh api -i', () => {
  let seen;
  const fakeRun = (cmd, args, options) => {
    seen = { cmd, args, env: options.env };
    return [
      'HTTP/2.0 200 OK',
      'X-Oauth-Scopes: repo, workflow',
      'Github-Authentication-Token-Expiration: 2026-10-24 12:00:00 UTC',
      '',
      '{"login":"octocat"}',
    ].join('\r\n');
  };
  process.env.GITHUB_TOKEN = 'should-be-removed';
  const result = verifyToken('ghp_secret', fakeRun);
  delete process.env.GITHUB_TOKEN;

  assert.deepEqual(seen.args, ['api', '-i', 'user']);
  assert.equal(seen.env.GH_TOKEN, 'ghp_secret');
  assert.equal(seen.env.GITHUB_TOKEN, undefined);
  assert.ok(!seen.args.join(' ').includes('ghp_secret'), 'token must not be passed as an argument');
  assert.equal(result.ok, true);
  assert.equal(result.login, 'octocat');
  assert.equal(result.scopes, 'repo, workflow');
  assert.equal(result.expiresAt.toISOString(), '2026-10-24T12:00:00.000Z');
  assert.equal(result.type, 'classic');
});

test('verifyToken reports a 401 as invalid', () => {
  const fakeRun = () => {
    const error = new Error('exit 1');
    error.stderr = 'gh: Bad credentials (HTTP 401)';
    throw error;
  };
  const result = verifyToken('ghp_old', fakeRun);
  assert.equal(result.ok, false);
  assert.match(result.error, /invalid/);
});

// ── secrets-file helpers ─────────────────────────────────────────────────────
import {
  detectEnvFormat,
  defaultEnvFile,
  getPowerShellProfile,
  isFileLoaded,
  readEnvAssignment,
  restrictToOwner,
  upsertEnvToken,
} from '../gh-token-lib.mjs';

const T = 'ghp_abc123';

test('upsertEnvToken appends to an empty file with the primary first', () => {
  const { content, created } = upsertEnvToken('', { primary: 'GITHUB_TOKEN', aliases: ['GITHUB_PERSONAL_ACCESS_TOKEN'], value: T });
  assert.equal(created, true);
  assert.equal(content, `export GITHUB_TOKEN=${T}\nexport GITHUB_PERSONAL_ACCESS_TOKEN="$GITHUB_TOKEN"\n`);
});

test('upsertEnvToken replaces in place, removes duplicates, and fixes reference order', () => {
  const before = ['a=1', 'export GITHUB_PERSONAL_ACCESS_TOKEN=ghp_old', 'b=2', 'export GITHUB_TOKEN=$GITHUB_PERSONAL_ACCESS_TOKEN', 'GITHUB_TOKEN=dup', 'c=3'].join('\n') + '\n';
  const { content, changes } = upsertEnvToken(before, { primary: 'GITHUB_TOKEN', aliases: ['GITHUB_PERSONAL_ACCESS_TOKEN'], value: T });
  assert.equal(content, ['a=1', `export GITHUB_TOKEN=${T}`, 'export GITHUB_PERSONAL_ACCESS_TOKEN="$GITHUB_TOKEN"', 'b=2', 'c=3'].join('\n') + '\n');
  assert.equal(changes.filter((c) => c.action === 'replaced').length, 3);
});

test('upsertEnvToken preserves CRLF line endings and unrelated keys with similar names', () => {
  const before = 'export MY_GITHUB_TOKEN=keep\r\nexport GITHUB_TOKEN=old\r\n';
  const { content } = upsertEnvToken(before, { primary: 'GITHUB_TOKEN', aliases: [], value: T });
  assert.equal(content, `export MY_GITHUB_TOKEN=keep\r\nexport GITHUB_TOKEN=${T}\r\n`);
});

test('upsertEnvToken supports fish and PowerShell', () => {
  assert.equal(
    upsertEnvToken('set -gx GITHUB_TOKEN old\n', { primary: 'GITHUB_TOKEN', aliases: ['GH_TOKEN'], value: T, format: 'fish' }).content,
    `set -gx GITHUB_TOKEN ${T}\nset -gx GH_TOKEN $GITHUB_TOKEN\n`,
  );
  assert.equal(
    upsertEnvToken("$Env:github_token = 'old'\r\n", { primary: 'GITHUB_TOKEN', aliases: [], value: T, format: 'powershell' }).content,
    `$env:GITHUB_TOKEN = '${T}'\r\n`,
  );
});

test('upsertEnvToken refuses shell metacharacters and bad names', () => {
  assert.throws(() => upsertEnvToken('', { primary: 'GITHUB_TOKEN', value: 'x;rm -rf ~' }), /Refusing/);
  assert.throws(() => upsertEnvToken('', { primary: 'BAD-NAME', value: T }), /Invalid/);
});

test('readEnvAssignment returns literals and ignores references', () => {
  const content = 'export GITHUB_PERSONAL_ACCESS_TOKEN=ghp_lit\nexport GITHUB_TOKEN=$GITHUB_PERSONAL_ACCESS_TOKEN\n';
  assert.equal(readEnvAssignment(content, 'GITHUB_PERSONAL_ACCESS_TOKEN'), 'ghp_lit');
  assert.equal(readEnvAssignment(content, 'GITHUB_TOKEN'), null);
  assert.equal(readEnvAssignment("$env:GITHUB_TOKEN = 'ghp_ps'", 'GITHUB_TOKEN', 'powershell'), 'ghp_ps');
});

test('detectEnvFormat follows OS and shell', () => {
  assert.equal(detectEnvFormat({ platform: 'darwin', shell: '/bin/zsh' }), 'sh');
  assert.equal(detectEnvFormat({ platform: 'linux', shell: '/usr/bin/bash' }), 'sh');
  assert.equal(detectEnvFormat({ platform: 'linux', shell: '/usr/bin/fish' }), 'fish');
  assert.equal(detectEnvFormat({ platform: 'win32', shell: '' }), 'powershell');
  assert.equal(detectEnvFormat({ platform: 'win32', shell: '/usr/bin/bash' }), 'sh');
});

test('defaultEnvFile picks a per-format location', () => {
  assert.equal(defaultEnvFile('sh', '/home/u'), '/home/u/.secrets.env');
  assert.equal(defaultEnvFile('fish', '/home/u'), '/home/u/.config/fish/conf.d/secrets.fish');
  assert.equal(defaultEnvFile('powershell', 'C:\\Users\\u'), 'C:\\Users\\u\\.secrets.ps1');
});

test('isFileLoaded recognises ~, $HOME and absolute references', () => {
  assert.ok(isFileLoaded('. ~/.secrets.env', '/home/u/.secrets.env', '/home/u'));
  assert.ok(isFileLoaded('source "$HOME/.secrets.env"', '/home/u/.secrets.env', '/home/u'));
  assert.ok(!isFileLoaded('source ~/.other', '/home/u/.secrets.env', '/home/u'));
});

test('getPowerShellProfile asks pwsh, then Windows PowerShell', () => {
  const calls = [];
  const run = (exe) => {
    calls.push(exe);
    if (exe === 'pwsh') throw new Error('not installed');
    return 'C:\\Users\\u\\OneDrive\\Documents\\WindowsPowerShell\\profile.ps1\r\n';
  };
  assert.equal(getPowerShellProfile(run), 'C:\\Users\\u\\OneDrive\\Documents\\WindowsPowerShell\\profile.ps1');
  assert.deepEqual(calls, ['pwsh', 'powershell']);
});

test('restrictToOwner uses icacls on Windows', () => {
  let seen;
  process.env.USERNAME = 'alice';
  const ok = restrictToOwner('C:\\Users\\alice\\.secrets.ps1', { platform: 'win32', run: (cmd, args) => (seen = [cmd, ...args]) });
  assert.equal(ok, true);
  assert.deepEqual(seen, ['icacls', 'C:\\Users\\alice\\.secrets.ps1', '/inheritance:r', '/grant:r', 'alice:F']);
});

import { clipboardCommands, currentGhLogin, readClipboard } from '../gh-token-lib.mjs';

test('clipboardCommands picks the right tools per platform', () => {
  assert.equal(clipboardCommands('darwin')[0].read[0], 'pbpaste');
  assert.deepEqual(clipboardCommands('win32').map((c) => c.read[0]), ['pwsh', 'powershell']);
  assert.deepEqual(clipboardCommands('linux', { WAYLAND_DISPLAY: 'wayland-0' }).map((c) => c.read[0]), ['wl-paste', 'xclip', 'xsel']);
  assert.deepEqual(clipboardCommands('linux', {}).map((c) => c.read[0]), ['xclip', 'xsel']);
});

test('readClipboard falls back through tools and can clear', () => {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (cmd === 'xclip') throw new Error('no display');
    if (args.includes('--output')) return 'ghp_fromclipboard\n';
    return '';
  };
  const clip = readClipboard({ platform: 'linux', env: {}, run });
  assert.equal(clip.text, 'ghp_fromclipboard');
  assert.equal(clip.clear(), true);
  assert.deepEqual(calls, ['xclip -selection clipboard -o', 'xsel --clipboard --output', 'xsel --clipboard --clear']);
  assert.equal(readClipboard({ platform: 'linux', env: {}, run: () => { throw new Error('none'); } }), null);
});

test('currentGhLogin prefers the stored gh login over GITHUB_TOKEN, then falls back', () => {
  process.env.GITHUB_TOKEN = 'ghp_stale';
  const seen = [];
  const storedOk = (cmd, args, { env }) => { seen.push(env.GITHUB_TOKEN ?? null); return 'pacphi\n'; };
  assert.deepEqual(currentGhLogin(storedOk), { login: 'pacphi', source: 'gh login' });
  assert.deepEqual(seen, [null]);

  const storedFails = (cmd, args, { env }) => { if (!env.GITHUB_TOKEN) throw new Error('not logged in'); return 'envuser\n'; };
  assert.deepEqual(currentGhLogin(storedFails), { login: 'envuser', source: 'GH_TOKEN/GITHUB_TOKEN' });
  delete process.env.GITHUB_TOKEN;
  assert.equal(currentGhLogin(() => { throw new Error('x'); }), null);
});

import { keysHoldingToken, removeEnvAssignments, revokeCredentials, waitUntilRevoked } from '../gh-token-lib.mjs';

test('removeEnvAssignments drops only the named keys', () => {
  const { content, removed } = removeEnvAssignments('a=1\nexport GITHUB_TOKEN=x\nb=2\n', ['GITHUB_TOKEN']);
  assert.equal(content, 'a=1\nb=2\n');
  assert.deepEqual(removed, [{ key: 'GITHUB_TOKEN', line: 2 }]);
  assert.equal(removeEnvAssignments('export GITHUB_TOKEN=x\n', ['GITHUB_TOKEN']).content, '');
});

test('keysHoldingToken finds literals and plain references to them', () => {
  const sh = 'export GITHUB_TOKEN=ghp_a\nexport GITHUB_PERSONAL_ACCESS_TOKEN="$GITHUB_TOKEN"\nexport GH_TOKEN=ghp_b\n';
  assert.deepEqual(keysHoldingToken(sh, 'ghp_a', ['GITHUB_TOKEN', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'GH_TOKEN']), ['GITHUB_TOKEN', 'GITHUB_PERSONAL_ACCESS_TOKEN']);
  const ps = "$env:GITHUB_TOKEN = 'ghp_a'\r\n$env:GITHUB_PERSONAL_ACCESS_TOKEN = $env:GITHUB_TOKEN\r\n";
  assert.deepEqual(keysHoldingToken(ps, 'ghp_a', ['GITHUB_TOKEN', 'GITHUB_PERSONAL_ACCESS_TOKEN'], 'powershell'), ['GITHUB_TOKEN', 'GITHUB_PERSONAL_ACCESS_TOKEN']);
  const csh = 'setenv GITHUB_TOKEN ghp_a\nsetenv GITHUB_PERSONAL_ACCESS_TOKEN "${GITHUB_TOKEN}"\n';
  assert.deepEqual(keysHoldingToken(csh, 'ghp_a', ['GITHUB_TOKEN', 'GITHUB_PERSONAL_ACCESS_TOKEN'], 'csh'), ['GITHUB_TOKEN', 'GITHUB_PERSONAL_ACCESS_TOKEN']);
});

test('revokeCredentials posts unauthenticated JSON and treats only 202 as success', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { status: 202, json: async () => ({}) };
  };
  const result = await revokeCredentials(['ghp_x'], { fetchImpl, apiUrl: 'https://api.example/' });
  assert.equal(result.ok, true);
  assert.equal(seen.url, 'https://api.example/credentials/revoke');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(seen.init.body), { credentials: ['ghp_x'] });
  const failed = await revokeCredentials(['ghp_x'], { fetchImpl: async () => ({ status: 422, json: async () => ({ message: 'Validation Failed' }) }) });
  assert.deepEqual(failed, { ok: false, status: 422, message: 'Validation Failed' });
});

test('waitUntilRevoked polls until the token is rejected', async () => {
  let calls = 0;
  const verify = () => (++calls < 3 ? { ok: true } : { ok: false, error: 'invalid, revoked or expired' });
  assert.equal(await waitUntilRevoked('t', { verify, sleep: async () => {} }), true);
  assert.equal(calls, 3);
  assert.equal(await waitUntilRevoked('t', { verify: () => ({ ok: true }), attempts: 2, sleep: async () => {} }), false);
});
