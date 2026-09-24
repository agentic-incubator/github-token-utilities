// Shared helpers for generator.mjs, audit.mjs and rotate.mjs.
// Pure functions are exported for tests; only verifyToken() touches the network (via gh).

import fs from 'fs';
import { execFileSync } from 'child_process';

// Every GitHub CLI call goes through gh(). GTU_GH_SHIM (a path to a Node script) replaces the
// real gh; the test suite uses it so the same fake works on Windows, where a .cmd stand-in
// can't be launched without a shell.
export function gh(args) {
  const shim = process.env.GTU_GH_SHIM;
  return shim ? { cmd: process.execPath, args: [shim, ...args] } : { cmd: 'gh', args };
}

// Every classic scope GitHub offers (the generator's "default" set).
// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
export const DEFAULT_SCOPES = [
  // Repositories
  'repo',
  'repo:status',
  'repo_deployment',
  'public_repo',
  'repo:invite',
  // Workflows & Automation
  'workflow',
  'security_events',
  // Package Management
  'write:packages',
  'read:packages',
  'delete:packages',
  // Organization & Team Management
  'admin:org',
  'write:org',
  'read:org',
  'manage_runners:org',
  // Keys & Security
  'admin:public_key',
  'write:public_key',
  'read:public_key',
  'admin:gpg_key',
  'write:gpg_key',
  'read:gpg_key',
  'admin:ssh_signing_key',
  'write:ssh_signing_key',
  'read:ssh_signing_key',
  // Webhooks & Hooks
  'admin:repo_hook',
  'write:repo_hook',
  'read:repo_hook',
  'admin:org_hook',
  // User & Account
  'gist',
  'notifications',
  'user',
  'read:user',
  'user:email',
  'user:follow',
  'delete_repo',
  // Discussions & Collaboration
  'write:discussion',
  'read:discussion',
  // Enterprise
  'admin:enterprise',
  'manage_runners:enterprise',
  'read:enterprise',
  // Auditing & Logging
  'audit_log',
  'read:audit_log',
  // Advanced Features
  'codespace',
  'copilot',
  'manage_billing:copilot',
  'write:network_configurations',
  'read:network_configurations',
  'project',
  'read:project',
];

export const TOKEN_TYPES = ['classic', 'fine-grained'];

// Fine-grained PAT names are limited to 40 characters.
// https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
export const FINE_GRAINED_NAME_MAX = 40;
export const FINE_GRAINED_MAX_DAYS = 366;

export function validateTokenName(name, type = 'classic') {
  if (!name) return 'Token name is required.';
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return 'Token name can only contain letters, numbers, hyphens, and underscores.';
  if (type === 'fine-grained' && name.length > FINE_GRAINED_NAME_MAX) {
    return `Fine-grained token names are limited to ${FINE_GRAINED_NAME_MAX} characters.`;
  }
  return null;
}

// Classic PAT prefill. GitHub calls this a "hidden feature" rather than a documented API, so
// the scopes/description parameters could change:
// https://github.blog/changelog/2025-08-26-template-urls-for-fine-grained-pats-and-updated-permissions-ui/
export function buildClassicUrl(name, scopes) {
  const parts = [`description=${encodeURIComponent(name)}`];
  if (scopes.length > 0) parts.push(`scopes=${scopes.map(encodeURIComponent).join(',')}`);
  return `https://github.com/settings/tokens/new?${parts.join('&')}`;
}

// Fine-grained PAT template URL (documented parameters: name, description, target_name,
// expires_in, and <permission>=read|write|admin).
// https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
export function buildFineGrainedUrl({ name, description, owner, days, permissions = {} }) {
  const params = new URLSearchParams({ name });
  if (description) params.set('description', description);
  if (owner) params.set('target_name', owner);
  if (days) params.set('expires_in', String(days));
  for (const [permission, level] of Object.entries(permissions)) params.set(permission, level);
  return `https://github.com/settings/personal-access-tokens/new?${params.toString()}`;
}

// Permission names accepted by the fine-grained PAT template URL, as listed in
// "Pre-filling fine-grained personal access token details using URL parameters":
// https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
export const FINE_GRAINED_PERMISSIONS = new Set([
  // Account
  'blocking', 'codespaces_user_secrets', 'copilot_messages', 'copilot_editor_context', 'copilot_requests',
  'emails', 'user_events', 'followers', 'gpg_keys', 'gists', 'keys', 'interaction_limits', 'knowledge_bases',
  'user_models', 'plan', 'private_repository_invitations', 'profile', 'git_signing_ssh_public_keys',
  'starring', 'watching',
  // Repository
  'actions', 'administration', 'artifact_metadata', 'attestations', 'code_quality', 'security_events',
  'codespaces', 'codespaces_lifecycle_admin', 'codespaces_metadata', 'codespaces_secrets', 'statuses',
  'contents', 'repository_custom_properties', 'vulnerability_alerts', 'dependabot_secrets', 'deployments',
  'discussions', 'environments', 'issues', 'merge_queues', 'metadata', 'pages', 'pull_requests',
  'repository_advisories', 'secret_scanning_alerts', 'secrets', 'actions_variables', 'repository_hooks',
  'workflows',
  // Organization
  'organization_api_insights', 'organization_administration', 'organization_user_blocking',
  'organization_campaigns', 'organization_custom_org_roles', 'organization_custom_properties',
  'organization_custom_roles', 'organization_events', 'organization_copilot_seat_management', 'issue_types',
  'organization_knowledge_bases', 'members', 'organization_models', 'organization_network_configurations',
  'organization_announcement_banners', 'organization_codespaces', 'organization_codespaces_secrets',
  'organization_codespaces_settings', 'organization_dependabot_secrets',
  'organization_code_scanning_dismissal_requests', 'organization_private_registries', 'organization_plan',
  'organization_projects', 'organization_secrets', 'organization_self_hosted_runners', 'team_discussions',
  'organization_actions_variables', 'organization_hooks',
]);

// "contents=write,workflows=write" -> { contents: 'write', workflows: 'write' }
export function parsePermissions(value) {
  const permissions = {};
  for (const entry of value.split(',').map((s) => s.trim()).filter(Boolean)) {
    const match = entry.match(/^([a-z_]+)=(read|write|admin)$/);
    if (!match) throw new Error(`Invalid permission "${entry}" (expected name=read|write|admin)`);
    if (!FINE_GRAINED_PERMISSIONS.has(match[1])) {
      throw new Error(`Unknown fine-grained permission "${match[1]}" (e.g. contents, workflows, secrets, pull_requests, issues, actions)`);
    }
    permissions[match[1]] = match[2];
  }
  return permissions;
}

export function tokenType(token) {
  if (token.startsWith('github_pat_')) return 'fine-grained';
  if (token.startsWith('ghp_')) return 'classic';
  return 'unknown';
}

// GitHub sends e.g. "2026-10-24 12:00:00 UTC", and some tokens use an offset
// ("2026-10-24 12:00:00 -0700"). go-github parses both forms:
// https://github.com/google/go-github/blob/master/github/github.go
export function parseExpirationHeader(value) {
  if (!value) return null;
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (UTC|[+-]\d{4})$/);
  if (!match) return null;
  const [, date, time, zone] = match;
  const offset = zone === 'UTC' ? 'Z' : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const parsed = new Date(`${date}T${time}${offset}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseHeaders(headerBlock) {
  const headers = {};
  for (const line of headerBlock.split(/\r?\n/).slice(1)) {
    const index = line.indexOf(':');
    if (index > 0) headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return headers;
}

// Fine-grained tokens have been reported to return the current server time instead of the
// real expiry (https://github.com/google/go-github/issues/3708). A value this close to "now"
// on a token that just worked is treated as unreliable.
const UNRELIABLE_WINDOW_MS = 10 * 60 * 1000;

export function expiryStatus({ expiresAt, type, now = new Date() }) {
  if (!expiresAt) return { status: 'NO_EXPIRATION', icon: '🟠', days: null };
  const ms = expiresAt.getTime() - now.getTime();
  if (type === 'fine-grained' && Math.abs(ms) < UNRELIABLE_WINDOW_MS) {
    return { status: 'UNKNOWN', icon: '❓', days: null, note: 'GitHub did not report a usable expiry; check it in Settings → Developer settings' };
  }
  const days = Math.floor(ms / 86400000);
  if (ms < 0) return { status: 'EXPIRED', icon: '🔴', days };
  if (days <= 7) return { status: 'EXPIRING_SOON', icon: '🟠', days };
  if (days <= 30) return { status: 'NEARING_EXPIRATION', icon: '🟡', days };
  return { status: 'VALID', icon: '🟢', days };
}

// Calls GET /user with the token and reads the X-OAuth-Scopes and
// GitHub-Authentication-Token-Expiration response headers.
// https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
// https://github.blog/changelog/2021-07-26-expiration-options-for-personal-access-tokens/
// GH_TOKEN takes precedence over GITHUB_TOKEN and stored credentials in gh:
// https://cli.github.com/manual/gh_help_environment
export function verifyToken(token, run = execFileSync) {
  const env = { ...process.env, GH_TOKEN: token };
  delete env.GITHUB_TOKEN;
  let raw;
  try {
    const call = gh(['api', '-i', 'user']);
    raw = run(call.cmd, call.args, { env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    const detail = `${error.stdout || ''}${error.stderr || ''}`;
    return {
      ok: false,
      error: /401|Bad credentials/i.test(detail) ? 'invalid, revoked or expired' : 'could not verify (network or gh problem)',
    };
  }
  const [headerBlock, ...bodyParts] = raw.split(/\r?\n\r?\n/);
  const headers = parseHeaders(headerBlock);
  let login = null;
  try {
    login = JSON.parse(bodyParts.join('\n\n')).login ?? null;
  } catch {
    // A 200 response already proves the token works; the login is informational.
  }
  const type = tokenType(token);
  return {
    ok: true,
    login,
    type,
    scopes: 'x-oauth-scopes' in headers ? headers['x-oauth-scopes'] : null,
    expiresAt: parseExpirationHeader(headers['github-authentication-token-expiration']),
  };
}

// Actions secret names: [A-Za-z0-9_], not starting with a digit or GITHUB_; case-insensitive.
// https://docs.github.com/en/actions/reference/security/secrets
export function validateSecretName(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name || '')) {
    return 'Secret names may only contain letters, numbers and underscores, and cannot start with a number.';
  }
  if (/^GITHUB_/i.test(name)) return 'GitHub reserves the GITHUB_ prefix; Actions secrets cannot use it. Try GH_TOKEN.';
  return null;
}

export function validateRepo(repo) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo || '') ? null : 'Repository must look like owner/repo.';
}

const KNOWN_TOKEN_SECRETS = ['GH_TOKEN', 'GH_PAT', 'PA_TOKEN', 'PAT', 'PAT_TOKEN', 'PERSONAL_ACCESS_TOKEN', 'GH_SECRET'];

export function isTokenSecret(name, extra) {
  const upper = name.toUpperCase();
  if (KNOWN_TOKEN_SECRETS.includes(upper)) return true;
  if (/^(GH|GIT|GITHUB)_.*(TOKEN|PAT)$/.test(upper)) return true;
  if (/(^|_)PAT(_|$)|PERSONAL_ACCESS_TOKEN/.test(upper)) return true;
  return extra ? extra.test(name) : false;
}

export function ageStatus(days, staleDays) {
  if (days >= staleDays) return { status: 'STALE', icon: '🔴' };
  if (days >= Math.floor((staleDays * 2) / 3)) return { status: 'AGING', icon: '🟡' };
  return { status: 'FRESH', icon: '🟢' };
}

// ── Shell secrets files (e.g. ~/.secrets.env) ────────────────────────────────
// The file is sourced by the user's shell at startup, so values must be inert: a token is
// written only if it is plain [A-Za-z0-9_] (true of every GitHub token format), and aliases
// are written as references to the primary variable.
//   sh:         https://www.gnu.org/software/bash/manual/html_node/Bourne-Shell-Builtins.html#index-export
//   fish:       https://fishshell.com/docs/current/cmds/set.html
//   csh/tcsh:   https://www.freebsd.org/cgi/man.cgi?query=tcsh (setenv, source)
//   powershell: https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_environment_variables

export const ENV_FORMATS = {
  sh: {
    matches: (key) => new RegExp(`^\\s*(?:export\\s+)?${key}=`),
    value: (key) => new RegExp(`^\\s*(?:export\\s+)?${key}=(.*)$`),
    primary: (key, value) => `export ${key}=${value}`,
    alias: (alias, key) => `export ${alias}="$${key}"`,
    source: (file) => `[ -f "${file}" ] && . "${file}"`,
  },
  fish: {
    matches: (key) => new RegExp(`^\\s*set\\s+(?:-[A-Za-z]+\\s+)*${key}(?:\\s|$)`),
    value: (key) => new RegExp(`^\\s*set\\s+(?:-[A-Za-z]+\\s+)*${key}\\s+(.*)$`),
    primary: (key, value) => `set -gx ${key} ${value}`,
    alias: (alias, key) => `set -gx ${alias} $${key}`,
    source: (file) => `test -f "${file}"; and source "${file}"`,
  },
  csh: {
    matches: (key) => new RegExp(`^\\s*setenv\\s+${key}(?:\\s|$)`),
    value: (key) => new RegExp(`^\\s*setenv\\s+${key}\\s+(.*)$`),
    primary: (key, value) => `setenv ${key} ${value}`,
    alias: (alias, key) => `setenv ${alias} "\${${key}}"`,
    source: (file) => `if ( -f "${file}" ) source "${file}"`,
  },
  powershell: {
    matches: (key) => new RegExp(`^\\s*\\$env:${key}\\s*=`, 'i'),
    value: (key) => new RegExp(`^\\s*\\$env:${key}\\s*=\\s*(.*)$`, 'i'),
    primary: (key, value) => `$env:${key} = '${value}'`,
    alias: (alias, key) => `$env:${alias} = $env:${key}`,
    source: (file) => `if (Test-Path "${file}") { . "${file}" }`,
  },
};

// Picks the file format for this machine: fish or csh/tcsh when that is the login shell;
// PowerShell on Windows unless a POSIX shell (Git Bash, MSYS, WSL) is running; otherwise sh
// (bash, zsh, sh, ksh, dash all read `export KEY=value`).
export function detectEnvFormat({ platform = process.platform, shell = process.env.SHELL || '' } = {}) {
  if (/fish$/.test(shell)) return 'fish';
  if (/t?csh$/.test(shell)) return 'csh';
  if (platform === 'win32' && !/(ba|z)?sh(\.exe)?$/i.test(shell)) return 'powershell';
  return 'sh';
}

export function defaultEnvFile(format, home) {
  if (format === 'powershell') return `${home}${home.includes('\\') ? '\\' : '/'}.secrets.ps1`;
  if (format === 'fish') return `${home}/.config/fish/conf.d/secrets.fish`;
  if (format === 'csh') return `${home}/.secrets.csh`;
  return `${home}/.secrets.env`;
}

export function isSafeEnvValue(value) {
  return /^[A-Za-z0-9_]+$/.test(value || '');
}

export function isEnvKey(key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key || '');
}

function formatSpec(format) {
  const spec = ENV_FORMATS[format];
  if (!spec) throw new Error(`Unknown format "${format}" (use sh, fish, csh or powershell)`);
  return spec;
}

// Returns the literal value assigned to `key` (last assignment wins, as in the shell), or
// null when it is unset or assigned from another variable.
export function readEnvAssignment(content, key, format = 'sh') {
  const raw = readEnvRaw(content, key, format);
  return raw === null || raw.includes('$') ? null : raw;
}

// The raw right-hand side of the last assignment of `key` (quotes stripped), or null.
export function readEnvRaw(content, key, format = 'sh') {
  const spec = formatSpec(format);
  let value = null;
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(spec.value(key));
    if (!match) continue;
    let raw = match[1].replace(/\s+#.*$/, '').trim();
    if (/^(['"]).*\1$/.test(raw)) raw = raw.slice(1, -1);
    value = raw;
  }
  return value;
}

// Keys (from `candidates`) that hold `token` literally, plus keys that only reference one of
// those ($KEY, ${KEY}, $env:KEY). Used to clean up after revoking a stored token.
export function keysHoldingToken(content, token, candidates, format = 'sh') {
  const holding = candidates.filter((k) => readEnvAssignment(content, k, format) === token);
  const refs = candidates.filter((k) => {
    if (holding.includes(k)) return false;
    const raw = readEnvRaw(content, k, format);
    return raw !== null && holding.some((h) => new RegExp(`^\\$(?:env:)?\\{?${h}\\}?$`, 'i').test(raw));
  });
  return [...holding, ...refs];
}

// Replaces every assignment of `primary` and `aliases` with one managed block, placed where
// the first of them was (or appended). The primary always comes first so the aliases'
// references resolve when the file is sourced. All other lines are left byte-for-byte,
// including the file's line endings.
export function upsertEnvToken(content, { primary, aliases = [], value, format = 'sh' }) {
  const spec = formatSpec(format);
  if (!isEnvKey(primary) || !aliases.every(isEnvKey)) throw new Error('Invalid environment variable name');
  if (!isSafeEnvValue(value)) throw new Error('Refusing to write a value with characters other than letters, digits and _');

  const eol = content.includes('\r\n') ? '\r\n' : (format === 'powershell' && content === '' ? '\r\n' : '\n');
  const keys = [primary, ...aliases];
  const lines = content === '' ? [] : content.replace(/\r?\n$/, '').split(/\r?\n/);
  const block = [spec.primary(primary, value), ...aliases.map((a) => spec.alias(a, primary))];

  const changes = [];
  const kept = [];
  let insertAt = -1;
  lines.forEach((line, index) => {
    const key = keys.find((k) => spec.matches(k).test(line));
    if (!key) {
      kept.push(line);
      return;
    }
    if (insertAt === -1) insertAt = kept.length;
    changes.push({ key, line: index + 1, action: 'replaced' });
  });
  if (insertAt === -1) insertAt = kept.length;
  for (const key of keys) {
    if (!changes.some((c) => c.key === key)) changes.push({ key, action: 'added' });
  }
  kept.splice(insertAt, 0, ...block);
  return { content: kept.join(eol) + eol, changes, created: content === '' };
}

// True when `rcContent` already loads `file` (by full path or a ~/$HOME form of it).
export function isFileLoaded(rcContent, file, home) {
  const rel = file.startsWith(home) ? file.slice(home.length).replace(/^[\\/]/, '') : null;
  const candidates = [file];
  if (rel) candidates.push(`~/${rel}`, `$HOME/${rel}`, `\${HOME}/${rel}`, `$HOME\\${rel}`, `~\\${rel}`, `$env:USERPROFILE\\${rel}`);
  return candidates.some((c) => rcContent.includes(c));
}

export function maskToken(value) {
  if (!value) return '(none)';
  const prefix = value.match(/^(ghp_|github_pat_|gho_|ghu_)/)?.[1] ?? '';
  return `${prefix}…****`;
}

// ── Platform helpers ─────────────────────────────────────────────────────────

// The profile PowerShell itself loads for the current user in every host. Asking PowerShell
// is the only reliable way: Documents may be redirected (e.g. to OneDrive), and Windows
// PowerShell 5.1 and PowerShell 7 use different folders.
// https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_profiles
export function getPowerShellProfile(run = execFileSync) {
  for (const exe of ['pwsh', 'powershell']) {
    try {
      const out = run(exe, ['-NoProfile', '-NonInteractive', '-Command', '$PROFILE.CurrentUserAllHosts'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (out) return out;
    } catch {
      // Try the next PowerShell edition.
    }
  }
  return null;
}

// Restricts a file to its owner. POSIX: mode 600. Windows: drop inherited ACEs and grant only
// the current user full control.
// https://learn.microsoft.com/windows-server/administration/windows-commands/icacls
export function restrictToOwner(file, { platform = process.platform, run = execFileSync } = {}) {
  if (platform !== 'win32') {
    fs.chmodSync(file, 0o600);
    return true;
  }
  const user = process.env.USERNAME;
  if (!user) return false;
  try {
    run('icacls', [file, '/inheritance:r', '/grant:r', `${user}:F`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ── Current gh account ───────────────────────────────────────────────────────

// The login gh is signed in as. Tries the stored gh login first (ignoring GH_TOKEN and
// GITHUB_TOKEN, which may hold the very token being replaced), then the environment token.
// Returns { login, source: 'gh login' | 'GH_TOKEN/GITHUB_TOKEN' } or null.
export function currentGhLogin(run = execFileSync) {
  const attempts = [
    { source: 'gh login', env: (() => { const e = { ...process.env }; delete e.GH_TOKEN; delete e.GITHUB_TOKEN; return e; })() },
    { source: 'GH_TOKEN/GITHUB_TOKEN', env: process.env },
  ];
  for (const { source, env } of attempts) {
    try {
      const call = gh(['api', 'user', '--jq', '.login']);
      const login = run(call.cmd, call.args, { env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (login) return { login, source };
    } catch {
      // Try the next credential source.
    }
  }
  return null;
}

// ── Clipboard ────────────────────────────────────────────────────────────────
// macOS: pbpaste/pbcopy. Windows: PowerShell Get-/Set-Clipboard. Linux: wl-paste/wl-copy
// (Wayland), xclip or xsel (X11).
// https://learn.microsoft.com/powershell/module/microsoft.powershell.management/get-clipboard

export function clipboardCommands(platform = process.platform, env = process.env) {
  if (platform === 'darwin') return [{ read: ['pbpaste', []], clear: ['pbcopy', []] }];
  if (platform === 'win32') {
    return ['pwsh', 'powershell'].map((exe) => ({
      read: [exe, ['-NoProfile', '-NonInteractive', '-Command', 'Get-Clipboard -Raw']],
      // Set-Clipboard rejects an empty value, so overwrite with a single space.
      clear: [exe, ['-NoProfile', '-NonInteractive', '-Command', "Set-Clipboard -Value ' '"]],
    }));
  }
  const commands = [];
  if (env.WAYLAND_DISPLAY) commands.push({ read: ['wl-paste', ['--no-newline']], clear: ['wl-copy', ['--clear']] });
  commands.push({ read: ['xclip', ['-selection', 'clipboard', '-o']], clear: ['xclip', ['-selection', 'clipboard', '-i']] });
  commands.push({ read: ['xsel', ['--clipboard', '--output']], clear: ['xsel', ['--clipboard', '--clear']] });
  return commands;
}

// Returns { text, clear } where clear() empties the clipboard, or null when no clipboard
// tool works (headless Linux, SSH sessions).
export function readClipboard({ platform = process.platform, env = process.env, run = execFileSync } = {}) {
  for (const { read, clear } of clipboardCommands(platform, env)) {
    try {
      const text = run(read[0], read[1], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
      return {
        text: text.trim(),
        clear: () => {
          try {
            run(clear[0], clear[1], { input: '', stdio: ['pipe', 'ignore', 'ignore'] });
            return true;
          } catch {
            return false;
          }
        },
      };
    } catch {
      // Tool missing or no display; try the next one.
    }
  }
  return null;
}

// ── Revocation ───────────────────────────────────────────────────────────────
// POST /credentials/revoke accepts ghp_, github_pat_, gho_, ghu_ and ghr_ tokens (up to 1000
// per call), must be called UNAUTHENTICATED (authenticated calls get 403), is limited to 60
// requests/hour, returns 202 Accepted, is irreversible, and notifies the token's owner. GitHub
// describes it as for credentials "the caller does not own" or tied to an account the caller
// lost access to. https://docs.github.com/en/rest/credentials/revoke
// GTU_API_URL overrides the API base (used by the test suite).

export const REVOCABLE_PREFIXES = ['ghp_', 'github_pat_', 'gho_', 'ghu_', 'ghr_'];

export function isRevocable(token) {
  return REVOCABLE_PREFIXES.some((p) => (token || '').startsWith(p));
}

export async function revokeCredentials(tokens, { fetchImpl = globalThis.fetch, apiUrl = process.env.GTU_API_URL || 'https://api.github.com' } = {}) {
  const response = await fetchImpl(`${apiUrl.replace(/\/$/, '')}/credentials/revoke`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'github-token-utilities',
    },
    body: JSON.stringify({ credentials: tokens }),
  });
  let message = '';
  try {
    message = (await response.json())?.message ?? '';
  } catch {
    // 202 responses have no useful body.
  }
  return { ok: response.status === 202, status: response.status, message };
}

// Revocation is asynchronous (202). Poll GET /user until the token is rejected.
export async function waitUntilRevoked(token, { verify = verifyToken, attempts = 10, delayMs = 3000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let i = 0; i < attempts; i++) {
    const check = verify(token);
    if (!check.ok && /invalid|revoked|expired/.test(check.error || '')) return true;
    if (i < attempts - 1) await sleep(delayMs);
  }
  return false;
}

// Removes every assignment of `keys` from a secrets file. Other lines are untouched.
export function removeEnvAssignments(content, keys, format = 'sh') {
  const spec = formatSpec(format);
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content === '' ? [] : content.replace(/\r?\n$/, '').split(/\r?\n/);
  const removed = [];
  const kept = lines.filter((line, index) => {
    const key = keys.find((k) => spec.matches(k).test(line));
    if (key) removed.push({ key, line: index + 1 });
    return !key;
  });
  return { content: kept.length ? kept.join(eol) + eol : '', removed };
}

// The token gh itself uses from its stored login (not the environment), or null.
export function storedGhToken(run = execFileSync) {
  const env = { ...process.env };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  try {
    const call = gh(['auth', 'token']);
    return run(call.cmd, call.args, { env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}
