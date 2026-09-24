#!/usr/bin/env node

import os from 'os';
import path from 'path';
import fs from 'fs';
import readline from 'readline';
import {
  ENV_FORMATS,
  defaultEnvFile,
  detectEnvFormat,
  expiryStatus,
  getPowerShellProfile,
  isEnvKey,
  isFileLoaded,
  isSafeEnvValue,
  maskToken,
  readEnvAssignment,
  restrictToOwner,
  upsertEnvToken,
  validateTokenName,
  verifyToken,
} from './gh-token-lib.mjs';

const DEFAULT_PRIMARY = 'GITHUB_TOKEN';
const DEFAULT_ALIASES = ['GITHUB_PERSONAL_ACCESS_TOKEN'];

const HELP = `
Usage: store-gh-token [options]

Stores a GitHub token in the secrets file your shell loads at startup, as
  GITHUB_TOKEN=<token>                               (the value)
  GITHUB_PERSONAL_ACCESS_TOKEN -> $GITHUB_TOKEN      (a reference)
Existing assignments of those names are replaced in place; the file is created
if missing. Other lines are left untouched. The token is never printed.

The file format follows your OS and shell:
  bash, zsh, sh, ksh, dash, Git Bash   ~/.secrets.env                       export KEY=value
  fish                                 ~/.config/fish/conf.d/secrets.fish   set -gx KEY value
  csh, tcsh                            ~/.secrets.csh                       setenv KEY value
  PowerShell (default on Windows)      ~\\.secrets.ps1                       $env:KEY = 'value'

Token source (default: hidden prompt):
  --from <name>          Use the token saved by gen-gh-token in ~/<name>.ght
  --token-stdin          Read the token from stdin

Options:
  --file <path>          Secrets file (default depends on --format)
  --format <fmt>         sh | fish | csh | powershell (default: detected from OS and $SHELL)
  --key <NAME>           Variable that holds the value (default ${DEFAULT_PRIMARY})
  --alias <NAME>         Variable that references it; repeatable
                         (default ${DEFAULT_ALIASES.join(', ')})
  --no-alias             Don't write any reference variables
  --max-days <n>         Refuse tokens valid for longer than n days (default 30)
  --force                Store even if the token has no expiry or exceeds --max-days
  --no-verify            Skip checking the token with GitHub (implies no expiry check)
  --ensure-loaded        Add a line to your shell startup file / PowerShell profile
                         that loads the secrets file, if none is there yet
  --no-backup            Don't keep <file>.bak of the previous version
  --dry-run              Show what would change; write nothing
  --yes                  Don't ask for confirmation
  -h, --help             Show this help
`;

function parseArgs(argv) {
  const opts = { aliases: null, maxDays: 30, verify: true, backup: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === '--from') opts.from = next();
    else if (arg === '--token-stdin') opts.tokenStdin = true;
    else if (arg === '--file') opts.file = next();
    else if (arg === '--format') opts.format = next();
    else if (arg === '--key') opts.primary = next();
    else if (arg === '--alias') (opts.aliases ??= []).push(next());
    else if (arg === '--no-alias') opts.aliases = [];
    else if (arg === '--max-days') opts.maxDays = parseInt(next(), 10);
    else if (arg === '--force') opts.force = true;
    else if (arg === '--no-verify') opts.verify = false;
    else if (arg === '--ensure-loaded') opts.ensureLoaded = true;
    else if (arg === '--no-backup') opts.backup = false;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--yes' || arg === '-y') opts.yes = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  opts.primary ??= DEFAULT_PRIMARY;
  opts.aliases ??= [...DEFAULT_ALIASES];
  opts.format ??= detectEnvFormat();
  if (!ENV_FORMATS[opts.format]) throw new Error('--format must be sh, fish, csh or powershell');
  if (!isEnvKey(opts.primary) || !opts.aliases.every(isEnvKey)) throw new Error('Variable names must match [A-Za-z_][A-Za-z0-9_]*');
  if (opts.aliases.includes(opts.primary)) throw new Error('--alias cannot be the same as --key');
  if (!Number.isInteger(opts.maxDays) || opts.maxDays <= 0) throw new Error('--max-days must be a positive integer');
  if (opts.from && opts.tokenStdin) throw new Error('Use either --from or --token-stdin, not both');
  if (opts.from) {
    const error = validateTokenName(opts.from);
    if (error) throw new Error(`--from: ${error}`);
  }
  return opts;
}

let rl = null;
let muted = false;

function getReadline() {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl._writeToOutput = (text) => {
      if (!muted) rl.output.write(text);
    };
  }
  return rl;
}

function question(prompt) {
  return new Promise((resolve) => getReadline().question(prompt, resolve));
}

async function hiddenQuestion(prompt) {
  process.stdout.write(prompt);
  muted = true;
  const answer = await question('');
  muted = false;
  process.stdout.write('\n');
  return answer.trim();
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

function expandHome(p, home) {
  return p === '~' ? home : p.replace(/^~(?=[\\/])/, home);
}

// The startup file that should load the secrets file, per format.
function startupFile(format, home) {
  if (format === 'fish') return null; // conf.d/*.fish is loaded automatically
  if (format === 'powershell') return getPowerShellProfile();
  const shell = path.basename(process.env.SHELL || '');
  if (format === 'csh') {
    // tcsh reads ~/.tcshrc if present, else ~/.cshrc; csh reads ~/.cshrc.
    const tcshrc = path.join(home, '.tcshrc');
    return shell === 'tcsh' && fs.existsSync(tcshrc) ? tcshrc : path.join(home, '.cshrc');
  }
  if (shell === 'zsh') return path.join(home, '.zshrc');
  if (shell === 'bash') return path.join(home, process.platform === 'darwin' ? '.bash_profile' : '.bashrc');
  return path.join(home, '.profile');
}

function loaderPath(file, home, format) {
  if (!file.startsWith(home)) return file;
  const rel = file.slice(home.length).replace(/^[\\/]/, '');
  return format === 'powershell' ? `$HOME\\${rel.replace(/\//g, '\\')}` : `$HOME/${rel}`;
}

function describeExpiry(check) {
  const status = expiryStatus({ expiresAt: check.expiresAt, type: check.type });
  if (status.status === 'NO_EXPIRATION') return { ...status, text: 'never expires' };
  if (status.status === 'UNKNOWN') return { ...status, text: 'expiry not reported by GitHub' };
  return { ...status, text: `expires ${check.expiresAt.toISOString().slice(0, 10)} (${status.days} days)` };
}

function writeAtomically(file, content) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  restrictToOwner(tmp);
  fs.renameSync(tmp, file);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return 0;
  }

  const home = os.homedir();
  const file = path.resolve(expandHome(opts.file ?? defaultEnvFile(opts.format, home), home));
  const spec = ENV_FORMATS[opts.format];
  if (opts.format === 'powershell' && !/\.ps1$/i.test(file)) {
    console.log('❌ PowerShell only dot-sources files ending in .ps1; choose a --file with that extension.\n');
    return 1;
  }

  console.log('\n🔐 Store GitHub token in your shell secrets file\n');
  console.log(`📄 File:   ${file} (${opts.format}${fs.existsSync(file) ? '' : ', will be created'})`);
  console.log(`🔑 Value:  ${opts.primary}`);
  if (opts.aliases.length) console.log(`↪️  Refs:   ${opts.aliases.map((a) => `${a} → $${opts.primary}`).join(', ')}`);
  console.log('');

  // 1. Get the new token without ever echoing it.
  let token;
  if (opts.from) {
    const source = path.join(home, `${opts.from}.ght`);
    if (!fs.existsSync(source)) {
      console.log(`❌ Token file not found: ${source}\n`);
      return 1;
    }
    token = fs.readFileSync(source, 'utf-8').trim();
  } else if (opts.tokenStdin) {
    token = await readStdin();
  } else {
    token = await hiddenQuestion('Paste the token to store (input hidden): ');
  }
  if (!token) {
    console.log('❌ No token provided.\n');
    return 1;
  }
  if (!isSafeEnvValue(token)) {
    console.log('❌ That value contains characters a GitHub token never has; refusing to write it into a file your shell executes.\n');
    return 1;
  }

  // 2. Verify it and enforce a short lifetime.
  if (opts.verify) {
    console.log('⏳ Verifying the new token with GitHub...');
    const check = verifyToken(token);
    if (!check.ok) {
      console.log(`❌ New token check failed: ${check.error}. Nothing was written.\n`);
      return 1;
    }
    const expiry = describeExpiry(check);
    console.log(`✅ ${check.type} token for ${check.login ?? '(unknown user)'}, ${expiry.text}`);
    if (check.scopes !== null) console.log(`   Scopes: ${check.scopes || '(none)'}`);
    const tooLong = expiry.status === 'NO_EXPIRATION' || (expiry.days !== null && expiry.days > opts.maxDays);
    if (tooLong && !opts.force) {
      console.log(`\n❌ This token lives longer than --max-days ${opts.maxDays}. Generate one with a shorter expiration,`);
      console.log('   or re-run with --force (or a larger --max-days) if that is intended.\n');
      return 1;
    }
    if (expiry.status === 'UNKNOWN') {
      console.log('   ⚠️  Could not confirm the expiry; check it on GitHub before relying on it.');
    }
    console.log('');
  }

  // 3. Plan the edit.
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
  const oldToken = [opts.primary, ...opts.aliases].map((k) => readEnvAssignment(existing, k, opts.format)).find(Boolean) || null;
  const plan = upsertEnvToken(existing, { primary: opts.primary, aliases: opts.aliases, value: token, format: opts.format });

  if (oldToken === token) {
    console.log(`ℹ️  ${file} already holds this token; only the variable layout will be normalized.\n`);
  }
  console.log(plan.created ? '📝 Will create the file with:' : '📝 Changes:');
  for (const change of plan.changes) {
    const where = change.line ? ` (line ${change.line})` : '';
    const what = change.key === opts.primary ? `= ${maskToken(token)}` : `→ $${opts.primary}`;
    console.log(`   ${change.action === 'replaced' ? '✏️ ' : '➕'} ${change.key} ${what}${where}`);
  }
  console.log('');

  let startup = null;
  let addLoader = false;
  if (opts.ensureLoaded) {
    startup = startupFile(opts.format, home);
    if (!startup) {
      console.log('ℹ️  fish loads conf.d/*.fish automatically; no startup change needed.\n');
    } else {
      const rc = fs.existsSync(startup) ? fs.readFileSync(startup, 'utf-8') : '';
      addLoader = !isFileLoaded(rc, file, home);
      console.log(addLoader
        ? `📝 Will add to ${startup}:\n   ${spec.source(loaderPath(file, home, opts.format))}\n`
        : `✅ ${startup} already loads ${file}\n`);
    }
  }

  if (opts.dryRun) {
    console.log('🧪 Dry run — nothing was written.\n');
    return 0;
  }

  if (!opts.yes) {
    if (!process.stdin.isTTY || opts.tokenStdin) {
      console.log('❌ Confirmation needed: re-run with --yes (or --dry-run to preview).\n');
      return 1;
    }
    const answer = await question('Write these changes? (y/n): ');
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('❌ Cancelled; nothing was written.\n');
      return 0;
    }
  }

  // 4. Write: backup, then atomic replace with owner-only permissions.
  if (existing && opts.backup) {
    const backup = `${file}.bak`;
    fs.writeFileSync(backup, existing, { mode: 0o600 });
    restrictToOwner(backup);
    console.log(`💾 Previous version saved to ${backup} (owner-only)`);
  }
  writeAtomically(file, plan.content);
  console.log(`✅ ${plan.created ? 'Created' : 'Updated'} ${file} (owner-only)`);

  if (addLoader) {
    const rc = fs.existsSync(startup) ? fs.readFileSync(startup, 'utf-8') : '';
    const eol = rc.includes('\r\n') ? '\r\n' : '\n';
    const line = spec.source(loaderPath(file, home, opts.format));
    fs.mkdirSync(path.dirname(startup), { recursive: true });
    fs.writeFileSync(startup, `${rc}${rc && !rc.endsWith(eol) ? eol : ''}${line}${eol}`);
    console.log(`✅ ${startup} now loads the secrets file`);
  }

  // 5. What about the token that was replaced?
  if (oldToken && oldToken !== token && isSafeEnvValue(oldToken) && opts.verify) {
    const old = verifyToken(oldToken);
    console.log(old.ok
      ? `\n⚠️  The replaced token (${maskToken(oldToken)}, ${old.login ?? 'unknown user'}) is STILL ACTIVE — revoke it at https://github.com/settings/tokens`
      : `\nℹ️  The replaced token is already invalid (${old.error}); nothing to revoke.`);
  }

  const reload = opts.format === 'powershell' ? `. "${file}"` : opts.format === 'sh' ? `. "${file}"` : `source "${file}"`;
  console.log(`\n🔄 Open a new terminal, or run:  ${reload}`);
  if (opts.from) console.log(`🧹 The token also remains in ~/${opts.from}.ght; delete it if you don't need a second copy.`);
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
