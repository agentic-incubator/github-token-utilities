#!/usr/bin/env node

import path from 'path';
import os from 'os';
import fs from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { gh as ghCommand, validateRepo, validateSecretName } from './gh-token-lib.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

const HELP = `
Usage: rotate-gh-token <owner/repo> <SECRET_NAME> [options]

Replaces a repository Actions secret with a new GitHub token. By default it runs
gen-gh-token to create the new token; use --existing to reuse a ~/<name>.ght file.
The token is passed to "gh secret set" on stdin, never on the command line.

Options:
  --existing <name>      Use ~/<name>.ght instead of generating a new token
  --type <type>          Passed to gen-gh-token: fine-grained or classic
  --scopes <list>        Passed to gen-gh-token (classic)
  --permissions <list>   Passed to gen-gh-token (fine-grained), e.g. secrets=read
  --owner <user|org>     Passed to gen-gh-token (fine-grained)
  --expiration <days>    Passed to gen-gh-token
  --no-open              Passed to gen-gh-token
  --yes                  Skip the confirmation prompt
  --dry-run              Show what would happen; change nothing
  -h, --help             Show this help
`;

function parseArgs(argv) {
  const opts = { positional: [], generatorArgs: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === '--existing') opts.existing = next();
    else if (['--type', '--scopes', '--permissions', '--owner', '--expiration'].includes(arg)) opts.generatorArgs.push(arg, next());
    else if (arg === '--no-open') opts.generatorArgs.push(arg);
    else if (arg === '--yes' || arg === '-y') opts.yes = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    else opts.positional.push(arg);
  }
  return opts;
}

let rl = null;

function question(prompt) {
  if (!rl) rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(prompt, resolve));
}

function closeReadline() {
  if (rl) rl.close();
  rl = null;
}

function gh(args, options = {}) {
  const call = ghCommand(args);
  return execFileSync(call.cmd, call.args, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], ...options });
}

function getSecretInfo(repo, secretName) {
  const secrets = JSON.parse(gh(['secret', 'list', '--repo', repo, '--json', 'name,updatedAt']));
  return secrets.find((s) => s.name.toUpperCase() === secretName.toUpperCase()) || null;
}

function defaultTokenName(repo, secretName) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const repoPart = repo.split('/')[1].replace(/[^a-zA-Z0-9_-]/g, '-');
  // Fine-grained token names are limited to 40 characters; keep the date suffix intact.
  const prefix = `rotate-${repoPart}-${secretName.toLowerCase()}`.slice(0, 40 - date.length - 1).replace(/-+$/, '');
  return `${prefix}-${date}`;
}

async function rotateToken() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return 0;
  }

  console.log('\n🔄 GitHub Token Rotation\n');

  let [repoName, secretName] = opts.positional;
  if (!repoName) repoName = (await question('Enter repository name (owner/repo): ')).trim();
  if (!secretName) secretName = (await question('Enter secret name to rotate (e.g., GH_TOKEN): ')).trim();

  const inputError = validateRepo(repoName) || validateSecretName(secretName);
  if (inputError) {
    console.log(`❌ ${inputError}\n`);
    return 1;
  }
  // GitHub stores secret names in uppercase.
  secretName = secretName.toUpperCase();
  if (opts.existing && !/^[a-zA-Z0-9_-]+$/.test(opts.existing)) {
    console.log('❌ --existing must be a token name (the part before .ght).\n');
    return 1;
  }

  console.log('⏳ Validating repository access...\n');
  let current;
  try {
    gh(['repo', 'view', repoName, '--json', 'nameWithOwner']);
    current = getSecretInfo(repoName, secretName);
  } catch (error) {
    console.error(`❌ Cannot access repository secrets for: ${repoName}`);
    console.error('   Check the name, that you have admin access, and `gh auth status`.\n');
    return 1;
  }

  const tokenName = opts.existing || defaultTokenName(repoName, secretName);
  const tokenFilePath = path.join(os.homedir(), `${tokenName}.ght`);

  console.log(`✅ Repository: ${repoName}`);
  console.log(current
    ? `✅ Secret ${secretName} exists (last updated ${current.updatedAt})`
    : `ℹ️  Secret ${secretName} does not exist yet — it will be created`);
  console.log(opts.existing
    ? `🔑 New value: existing token ~/${tokenName}.ght\n`
    : `🔑 New value: a new token generated as ~/${tokenName}.ght\n`);

  if (opts.existing && !fs.existsSync(tokenFilePath)) {
    console.error(`❌ Token file not found: ${tokenFilePath}\n`);
    return 1;
  }

  if (opts.dryRun) {
    console.log('🧪 Dry run — nothing was generated or changed.\n');
    return 0;
  }

  if (!opts.yes) {
    const confirm = await question(`Update ${secretName} in ${repoName}? (y/n): `);
    if (confirm.toLowerCase() !== 'y') {
      console.log('❌ Rotation cancelled.\n');
      return 0;
    }
  }
  // The generator needs the terminal to itself.
  closeReadline();

  if (!opts.existing) {
    console.log('\n🔐 Generating new token...\n');
    const generator = spawnSync(
      process.execPath,
      [path.join(SCRIPT_DIR, 'generator.mjs'), '--name', tokenName, '--yes', ...opts.generatorArgs],
      { stdio: 'inherit' }
    );
    if (generator.status !== 0 || !fs.existsSync(tokenFilePath)) {
      console.error('❌ Token generation failed; the secret was not changed.\n');
      return 1;
    }
  }

  const newToken = fs.readFileSync(tokenFilePath, 'utf-8').trim();
  if (!newToken) {
    console.error(`❌ Token file is empty: ${tokenFilePath}\n`);
    return 1;
  }

  console.log('⏳ Updating repository secret...\n');
  const setCall = ghCommand(['secret', 'set', secretName, '--repo', repoName]);
  const result = spawnSync(setCall.cmd, setCall.args, {
    input: newToken,
    encoding: 'utf-8',
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (result.status !== 0) {
    console.error(`❌ Failed to update ${secretName}. The new token is still in ~/${tokenName}.ght.\n`);
    return 1;
  }

  let updated = null;
  try {
    updated = getSecretInfo(repoName, secretName);
  } catch {
    // Verification is best-effort; gh already reported success.
  }

  console.log('━'.repeat(70));
  console.log('✨ Token Rotation Complete!\n');
  console.log(`Repository:  ${repoName}`);
  console.log(`Secret Name: ${secretName}${updated ? ` (updated ${updated.updatedAt})` : ''}`);
  console.log(`Token File:  ~/${tokenName}.ght\n`);
  console.log('⚠️  Next Steps:\n');
  console.log('1. Re-run a workflow that uses the secret to confirm the new token works');
  console.log('2. Revoke the old token at https://github.com/settings/tokens');
  console.log(`3. Keep ~/${tokenName}.ght only if you need it locally; otherwise: rm ~/${tokenName}.ght\n`);
  console.log('━'.repeat(70) + '\n');
  return 0;
}

rotateToken()
  .then((code) => {
    closeReadline();
    process.exitCode = code;
  })
  .catch((error) => {
    console.error('❌ Error:', error.message);
    closeReadline();
    process.exitCode = 1;
  });
