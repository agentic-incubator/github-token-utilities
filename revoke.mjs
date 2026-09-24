#!/usr/bin/env node

import os from 'os';
import path from 'path';
import fs from 'fs';
import readline from 'readline';
import { spawn } from 'child_process';
import {
  ENV_FORMATS,
  defaultEnvFile,
  detectEnvFormat,
  expiryStatus,
  isRevocable,
  isSafeEnvValue,
  keysHoldingToken,
  maskToken,
  readEnvAssignment,
  removeEnvAssignments,
  restrictToOwner,
  revokeCredentials,
  storedGhToken,
  validateTokenName,
  verifyToken,
  waitUntilRevoked,
} from './gh-token-lib.mjs';

const SECRETS_KEYS = ['GITHUB_TOKEN', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'GH_TOKEN'];

const HELP = `
Usage: revoke-gh-token <source> [options]

Permanently revokes a GitHub token, confirms GitHub rejects it, then removes the
local copy. The token is never printed.

Which token (pick one):
  --from <name>          The token in ~/<name>.ght (from gen-gh-token)
  --stored               The token your shell secrets file exports (see store-gh-token)
  --previous             The token store-gh-token last replaced (kept in <secrets file>.bak)
  --token-stdin          A token read from stdin

Options:
  --file <path>          Secrets file for --stored/--previous (default: per --format)
  --format <fmt>         sh | fish | csh | powershell (default: detected)
  --web                  Don't call the API: open GitHub's token settings page instead
  --keep-files           Don't delete the .ght file / secrets-file lines / .bak afterwards
  --no-wait              Don't wait for GitHub to confirm the token is dead
  --force                Allow revoking the token gh itself is signed in with
  --dry-run              Show which token would be revoked; change nothing
  --yes                  Don't ask for confirmation
  -h, --help             Show this help

How it works: GitHub has no authenticated "revoke my token" API. This uses the
public credential-revocation endpoint (POST /credentials/revoke), which must be
called unauthenticated, is limited to 60 requests an hour, emails the token's
owner, and cannot be undone. GitHub documents it for credentials you don't own;
use --web to delete the token from GitHub's settings page instead.
https://docs.github.com/en/rest/credentials/revoke
`;

function parseArgs(argv) {
  const opts = { wait: true, cleanup: true };
  const sources = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === '--from') { opts.from = next(); sources.push(arg); }
    else if (arg === '--stored') { opts.stored = true; sources.push(arg); }
    else if (arg === '--previous') { opts.previous = true; sources.push(arg); }
    else if (arg === '--token-stdin') { opts.tokenStdin = true; sources.push(arg); }
    else if (arg === '--file') opts.file = next();
    else if (arg === '--format') opts.format = next();
    else if (arg === '--web') opts.web = true;
    else if (arg === '--keep-files') opts.cleanup = false;
    else if (arg === '--no-wait') opts.wait = false;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--yes' || arg === '-y') opts.yes = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (opts.help) return opts;
  if (sources.length !== 1 && !opts.web) throw new Error('Choose exactly one of --from, --stored, --previous, --token-stdin (or --web)');
  if (sources.length > 1) throw new Error('Choose only one token source');
  opts.format ??= detectEnvFormat();
  if (!ENV_FORMATS[opts.format]) throw new Error('--format must be sh, fish, csh or powershell');
  if (opts.from) {
    const error = validateTokenName(opts.from);
    if (error) throw new Error(`--from: ${error}`);
  }
  return opts;
}

let rl = null;

function question(prompt) {
  if (!rl) rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, resolve));
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data.trim()));
    process.stdin.on('error', reject);
  });
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]]
      : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function settingsUrl(token) {
  return token?.startsWith('github_pat_')
    ? 'https://github.com/settings/personal-access-tokens'
    : 'https://github.com/settings/tokens';
}

function firstLiteral(content, format) {
  for (const key of SECRETS_KEYS) {
    const value = readEnvAssignment(content, key, format);
    if (value) return value;
  }
  return null;
}

// Resolves the chosen source to { token, label, cleanup() }.
async function resolveSource(opts, home) {
  const secretsFile = path.resolve((opts.file ?? defaultEnvFile(opts.format, home)).replace(/^~(?=[\\/])/, home));
  if (opts.from) {
    const file = path.join(home, `${opts.from}.ght`);
    if (!fs.existsSync(file)) throw new Error(`Token file not found: ${file}`);
    return {
      token: fs.readFileSync(file, 'utf-8').trim(),
      label: `~/${opts.from}.ght`,
      cleanupText: `delete ~/${opts.from}.ght`,
      cleanup: () => fs.rmSync(file),
    };
  }
  if (opts.stored) {
    if (!fs.existsSync(secretsFile)) throw new Error(`Secrets file not found: ${secretsFile}`);
    const content = fs.readFileSync(secretsFile, 'utf-8');
    const token = firstLiteral(content, opts.format);
    // Only the variables holding this token (and plain references to them) are removed.
    const keys = token ? keysHoldingToken(content, token, SECRETS_KEYS, opts.format) : [];
    return {
      token,
      label: `${secretsFile} (stored token)`,
      cleanupText: `remove ${keys.join(', ')} from ${secretsFile}`,
      cleanup: () => {
        const current = fs.readFileSync(secretsFile, 'utf-8');
        const { content: updated } = removeEnvAssignments(current, keys, opts.format);
        const tmp = `${secretsFile}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, updated, { mode: 0o600 });
        restrictToOwner(tmp);
        fs.renameSync(tmp, secretsFile);
      },
    };
  }
  if (opts.previous) {
    const backup = `${secretsFile}.bak`;
    if (!fs.existsSync(backup)) throw new Error(`No previous token: ${backup} not found (store-gh-token creates it)`);
    return {
      token: firstLiteral(fs.readFileSync(backup, 'utf-8'), opts.format),
      label: `${backup} (token replaced by store-gh-token)`,
      cleanupText: `delete ${backup}`,
      cleanup: () => fs.rmSync(backup),
    };
  }
  return { token: await readStdin(), label: 'stdin', cleanupText: null, cleanup: null };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  const home = os.homedir();
  console.log('\n🗑  Revoke a GitHub token\n');

  const noSource = !opts.from && !opts.stored && !opts.previous && !opts.tokenStdin;
  const source = noSource ? { token: null } : await resolveSource(opts, home);

  if (opts.web) {
    const url = settingsUrl(source.token);
    console.log(`🌐 Delete the token on GitHub: ${url}`);
    if (!opts.dryRun && openBrowser(url)) console.log('   (Opened in your browser.)');
    console.log('   Nothing was revoked or deleted locally.\n');
    return 0;
  }

  const { token, label } = source;
  if (!token) {
    console.log(`❌ No token found in ${label}.\n`);
    return 1;
  }
  if (!isRevocable(token) || !isSafeEnvValue(token)) {
    console.log('❌ That is not a GitHub token this endpoint can revoke (ghp_, github_pat_, gho_, ghu_, ghr_).\n');
    return 1;
  }

  // 1. Identify it.
  console.log(`🔎 Token: ${maskToken(token)} from ${label}`);
  const check = verifyToken(token);
  const alreadyDead = !check.ok && /invalid|revoked|expired/.test(check.error || '');
  if (check.ok) {
    const expiry = expiryStatus({ expiresAt: check.expiresAt, type: check.type });
    console.log(`   ${check.type} token for ${check.login ?? '(unknown user)'}${check.expiresAt ? `, expires ${check.expiresAt.toISOString().slice(0, 10)}` : expiry.status === 'NO_EXPIRATION' ? ', never expires' : ''}`);
    if (check.scopes !== null) console.log(`   Scopes: ${check.scopes || '(none)'}`);
  } else if (alreadyDead) {
    console.log('   GitHub already rejects this token (revoked or expired); nothing to revoke.');
  } else {
    console.log(`   ⚠️  Could not check it with GitHub (${check.error}); it may still be active.`);
  }

  // 2. Guards.
  if (!alreadyDead) {
    if (token === storedGhToken() && !opts.force) {
      console.log('\n❌ This is the token gh itself is signed in with; revoking it logs gh out.');
      console.log('   Re-run with --force if that is what you want.\n');
      return 1;
    }
    if (token === process.env.GITHUB_TOKEN || token === process.env.GH_TOKEN) {
      console.log('   ⚠️  Your current shell exports this token; commands using it will fail until you store a new one.');
    }
  }
  console.log('');

  const plan = [];
  if (!alreadyDead) plan.push('revoke it permanently via POST /credentials/revoke (GitHub emails the owner)');
  if (opts.cleanup && source.cleanupText) plan.push(source.cleanupText);
  if (plan.length === 0) {
    console.log('ℹ️  Nothing to do.\n');
    return 0;
  }
  console.log('📝 Will:');
  plan.forEach((p) => console.log(`   • ${p}`));
  console.log('');

  if (opts.dryRun) {
    console.log('🧪 Dry run — nothing was revoked or deleted.\n');
    return 0;
  }

  if (!opts.yes) {
    if (!process.stdin.isTTY || opts.tokenStdin) {
      console.log('❌ Confirmation needed: re-run with --yes (or --dry-run to preview).\n');
      return 1;
    }
    const expected = check.login || 'revoke';
    const answer = (await question(`Type "${expected}" to confirm: `)).trim();
    if (answer !== expected) {
      console.log('❌ Cancelled; nothing was revoked.\n');
      return 0;
    }
  }

  // 3. Revoke and confirm.
  if (!alreadyDead) {
    let result;
    try {
      result = await revokeCredentials([token]);
    } catch (error) {
      console.log(`❌ Could not reach GitHub: ${error.message}. Nothing was deleted locally.\n`);
      return 1;
    }
    if (!result.ok) {
      const hint = result.status === 403 ? ' (rate limit: 60 requests/hour per IP, or the request was authenticated)' : '';
      console.log(`❌ GitHub answered ${result.status}${hint}${result.message ? `: ${result.message}` : ''}. Nothing was deleted locally.`);
      console.log(`   You can delete the token manually at ${settingsUrl(token)}\n`);
      return 1;
    }
    console.log('✅ GitHub accepted the revocation.');
    if (opts.wait) {
      process.stdout.write('⏳ Waiting for GitHub to reject the token... ');
      const dead = await waitUntilRevoked(token);
      console.log(dead ? 'done.' : 'not yet.');
      if (!dead) {
        console.log(`⚠️  GitHub still accepts it. Check again later, or delete it at ${settingsUrl(token)}. Local copies were kept.\n`);
        return 1;
      }
    }
  }

  // 4. Clean up local copies.
  if (opts.cleanup && source.cleanup) {
    source.cleanup();
    console.log(`🧹 Done: ${source.cleanupText}`);
  }
  console.log('');
  return 0;
}

main()
  .then((code) => {
    if (rl) rl.close();
    process.exitCode = code;
  })
  .catch((error) => {
    console.error('❌ Error:', error.message);
    if (rl) rl.close();
    process.exitCode = 1;
  });
