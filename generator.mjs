#!/usr/bin/env node

import os from 'os';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import readline from 'readline';
import {
  FINE_GRAINED_MAX_DAYS,
  buildClassicUrl,
  buildFineGrainedUrl,
  parsePermissions,
  tokenType,
  validateTokenName,
  verifyToken,
} from './gh-token-lib.mjs';

const DEFAULT_SCOPES = [
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

const SCOPE_DESCRIPTIONS = {
  repo: 'Full control of private repositories',
  'repo:status': 'Access repository status',
  repo_deployment: 'Access deployment status',
  public_repo: 'Access public repositories',
  'repo:invite': 'Access repository invitations',
  security_events: 'Read and write security events',
  workflow: 'Update GitHub Action workflows',
  'write:packages': 'Upload packages to GitHub Package Registry',
  'read:packages': 'Download packages from GitHub Package Registry',
  'delete:packages': 'Delete packages from GitHub Package Registry',
  'admin:org': 'Full control of orgs and teams',
  'write:org': 'Read and write org and team membership',
  'read:org': 'Read org and team membership',
  'manage_runners:org': 'Manage org runners and runner groups',
  'admin:public_key': 'Full control of user public keys',
  'write:public_key': 'Write user public keys',
  'read:public_key': 'Read user public keys',
  'admin:repo_hook': 'Full control of repository hooks',
  'write:repo_hook': 'Write repository hooks',
  'read:repo_hook': 'Read repository hooks',
  'admin:org_hook': 'Full control of organization hooks',
  gist: 'Create gists',
  notifications: 'Access notifications',
  user: 'Update all user data',
  'read:user': 'Read all user profile data',
  'user:email': 'Access user email addresses',
  'user:follow': 'Follow and unfollow users',
  delete_repo: 'Delete repositories',
  'write:discussion': 'Read and write team discussions',
  'read:discussion': 'Read team discussions',
  'admin:enterprise': 'Full control of enterprises',
  'manage_runners:enterprise': 'Manage enterprise runners and runner groups',
  'read:enterprise': 'Read enterprise profile data',
  audit_log: 'Full control of audit log',
  'read:audit_log': 'Read audit logs',
  codespace: 'Full control of Codespaces',
  copilot: 'Full control of GitHub Copilot settings',
  'manage_billing:copilot': 'Manage Copilot Business seat assignments',
  'write:network_configurations': 'Write hosted compute network configurations',
  'read:network_configurations': 'Read hosted compute network configurations',
  project: 'Full control of projects',
  'read:project': 'Read project access',
  'admin:gpg_key': 'Full control of public user GPG keys',
  'write:gpg_key': 'Write public user GPG keys',
  'read:gpg_key': 'Read public user GPG keys',
  'admin:ssh_signing_key': 'Full control of public user SSH signing keys',
  'write:ssh_signing_key': 'Write public user SSH signing keys',
  'read:ssh_signing_key': 'Read public user SSH signing keys',
};

const SCOPE_CATEGORIES = {
  'Repositories': ['repo', 'repo:status', 'repo_deployment', 'public_repo', 'repo:invite'],
  'Workflows & Automation': ['workflow', 'security_events'],
  'Package Management': ['write:packages', 'read:packages', 'delete:packages'],
  'Organization & Teams': ['admin:org', 'write:org', 'read:org', 'manage_runners:org'],
  'Keys & Security': [
    'admin:public_key', 'write:public_key', 'read:public_key',
    'admin:gpg_key', 'write:gpg_key', 'read:gpg_key',
    'admin:ssh_signing_key', 'write:ssh_signing_key', 'read:ssh_signing_key',
  ],
  'Webhooks & Hooks': ['admin:repo_hook', 'write:repo_hook', 'read:repo_hook', 'admin:org_hook'],
  'User & Account': ['gist', 'notifications', 'user', 'read:user', 'user:email', 'user:follow', 'delete_repo'],
  'Discussions': ['write:discussion', 'read:discussion'],
  'Enterprise': ['admin:enterprise', 'manage_runners:enterprise', 'read:enterprise'],
  'Auditing': ['audit_log', 'read:audit_log'],
  'Advanced': ['codespace', 'copilot', 'manage_billing:copilot', 'write:network_configurations', 'read:network_configurations', 'project', 'read:project'],
};


// Scopes that grant destructive or account-wide power. Warn before including them.
const HIGH_RISK_SCOPES = [
  'delete_repo', 'admin:org', 'admin:enterprise', 'admin:org_hook', 'admin:repo_hook',
  'admin:public_key', 'admin:gpg_key', 'admin:ssh_signing_key', 'user', 'audit_log',
  'delete:packages', 'manage_billing:copilot',
];

const EXPIRATION_CHOICES = { '1': 7, '2': 30, '3': 60, '4': 90, '5': 180, '6': 365 };

const HELP = `
Usage: gen-gh-token [options]

Creates a GitHub personal access token. GitHub has no API for creating PATs, so
this opens GitHub's prefilled "new token" page; you click "Generate token", paste
the result here, and it is verified and saved to ~/<name>.ght with mode 600.
The token is never printed.

Options (any omitted option is asked interactively):
  --type <type>          "fine-grained" (recommended by GitHub) or "classic"
  --name <name>          Token name (letters, numbers, - and _). Saved as ~/<name>.ght
  --expiration <days>    Lifetime in days (fine-grained: 1-366, prefilled on GitHub)

  Classic tokens:
  --scopes <list>        Comma-separated scopes, or "default" (all 51) or "none"

  Fine-grained tokens:
  --permissions <list>   e.g. contents=write,workflows=write (levels: read, write, admin)
  --owner <user|org>     Resource owner (default: you)

  --yes                  Skip the "Ready to generate?" confirmation
  --force                Overwrite an existing ~/<name>.ght without asking
  --no-open              Don't open a browser; just print the URL
  --print-url            Print the prefilled URL and exit (no token handling)
  --token-stdin          Read the token from stdin instead of a hidden prompt
  -h, --help             Show this help
`;

function parseArgs(argv) {
  const opts = { open: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === '--type') opts.type = next();
    else if (arg === '--name') opts.name = next();
    else if (arg === '--scopes') opts.scopes = next();
    else if (arg === '--permissions') opts.permissions = next();
    else if (arg === '--owner') opts.owner = next();
    else if (arg === '--expiration') opts.expiration = next();
    else if (arg === '--yes' || arg === '-y') opts.yes = true;
    else if (arg === '--force') opts.force = true;
    else if (arg === '--no-open') opts.open = false;
    else if (arg === '--print-url') opts.printUrl = true;
    else if (arg === '--token-stdin') opts.tokenStdin = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (opts.type && !['classic', 'fine-grained'].includes(opts.type)) {
    throw new Error('--type must be "classic" or "fine-grained"');
  }
  if (opts.type === 'fine-grained' && opts.scopes !== undefined) {
    throw new Error('--scopes applies to classic tokens; use --permissions for fine-grained');
  }
  if (opts.type === 'classic' && (opts.permissions !== undefined || opts.owner !== undefined)) {
    throw new Error('--permissions and --owner apply to fine-grained tokens');
  }
  if (!opts.type && opts.scopes !== undefined) opts.type = 'classic';
  if (!opts.type && (opts.permissions !== undefined || opts.owner !== undefined)) opts.type = 'fine-grained';
  if (opts.owner !== undefined && !/^[A-Za-z0-9_.-]+$/.test(opts.owner)) {
    throw new Error('--owner must be a GitHub user or organization name');
  }
  return opts;
}

let rl = null;
let muted = false;

function getReadline() {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // Suppress echo while the token is being pasted.
    rl._writeToOutput = (text) => {
      if (!muted) rl.output.write(text);
    };
  }
  return rl;
}

function closeReadline() {
  if (rl) rl.close();
}

function question(prompt) {
  return new Promise((resolve) => getReadline().question(prompt, resolve));
}

async function secretQuestion(prompt) {
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

function getHomeDirectory() {
  return os.homedir();
}

function parseScopes(value) {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'default') return [...DEFAULT_SCOPES];
  if (normalized === 'none' || normalized === '') return [];
  return [...new Set(value.split(',').map((s) => s.trim()).filter(Boolean))];
}

function displayDefaultScopes() {
  console.log('\n📋 Default Scopes\n');
  Object.entries(SCOPE_CATEGORIES).forEach(([category, scopes]) => {
    console.log(`${category}:`);
    scopes.forEach((scope) => {
      console.log(`  • ${scope}`);
    });
    console.log('');
  });
}

function warnAboutScopes(scopes) {
  const unknown = scopes.filter((s) => !SCOPE_DESCRIPTIONS[s]);
  if (unknown.length > 0) {
    console.log(`⚠️  Unrecognized scope(s): ${unknown.join(', ')} — GitHub will ignore them.\n`);
  }
  const risky = scopes.filter((s) => HIGH_RISK_SCOPES.includes(s));
  if (risky.length > 0) {
    console.log(`⚠️  High-risk scope(s) included: ${risky.join(', ')}`);
    console.log('   Grant only what the token actually needs.\n');
  }
}

async function selectExpiration() {
  console.log('\n⏰ Token Expiration\n');
  console.log('Choose token expiration:');
  console.log('1. 7 days');
  console.log('2. 30 days (default)');
  console.log('3. 60 days');
  console.log('4. 90 days');
  console.log('5. 6 months');
  console.log('6. 1 year\n');

  const choice = await question('Enter your choice (1-6): ');
  return EXPIRATION_CHOICES[choice] || 30;
}

async function selectScopes() {
  console.log('\n🎯 Scope Selection\n');
  console.log('Choose how to configure scopes:');
  console.log('1. Use default scopes (51 total — very broad, includes delete_repo and admin:*)');
  console.log('2. Customize scopes interactively');
  console.log('3. Start with no scopes\n');

  const choice = await question('Enter your choice (1-3): ');

  if (choice === '1') {
    displayDefaultScopes();
    console.log(`✅ Selected ${DEFAULT_SCOPES.length} default scopes\n`);
    return [...DEFAULT_SCOPES];
  } else if (choice === '2') {
    return await customizeScopes();
  } else if (choice === '3') {
    console.log('\n⚪ Starting with no scopes\n');
    return [];
  } else {
    console.log('❌ Invalid choice. Using default scopes.\n');
    displayDefaultScopes();
    return [...DEFAULT_SCOPES];
  }
}

async function customizeScopes() {
  const scopes = [...DEFAULT_SCOPES];
  let continueCustomizing = true;

  console.log(`\n🔧 Scope Customization (Starting with ${scopes.length} default scopes)\n`);

  while (continueCustomizing) {
    console.log(`📊 Current Selection: ${scopes.length} scopes\n`);
    console.log('1. View current scopes');
    console.log('2. Remove a scope');
    console.log('3. Add a scope');
    console.log('4. View available scopes');
    console.log('5. Remove all scopes');
    console.log('6. Done customizing\n');

    const action = await question('Choose an action (1-6): ');

    if (action === '1') {
      console.log('\n📌 Currently Selected Scopes:\n');
      scopes.forEach((scope, i) => {
        console.log(`  ${i + 1}. ${scope}`);
        const desc = SCOPE_DESCRIPTIONS[scope];
        if (desc) console.log(`     → ${desc}`);
      });
      console.log('');
    } else if (action === '2') {
      const indexStr = await question('Enter scope number to remove (or press Enter to cancel): ');
      if (indexStr) {
        const index = parseInt(indexStr, 10) - 1;
        if (index >= 0 && index < scopes.length) {
          const removed = scopes.splice(index, 1);
          console.log(`✅ Removed: ${removed[0]}\n`);
        } else {
          console.log('❌ Invalid number\n');
        }
      }
    } else if (action === '3') {
      const scopeName = (await question('Enter scope name to add: ')).trim();
      if (!scopeName) {
        console.log(`⚠️  Skipped empty input\n`);
      } else if (scopes.includes(scopeName)) {
        console.log(`⚠️  Scope already selected\n`);
      } else {
        scopes.push(scopeName);
        const desc = SCOPE_DESCRIPTIONS[scopeName];
        console.log(`✅ Added: ${scopeName}`);
        if (desc) console.log(`   → ${desc}\n`);
      }
    } else if (action === '4') {
      console.log('\n📚 All Available Scopes by Category:\n');
      Object.entries(SCOPE_CATEGORIES).forEach(([category, categoryScopes]) => {
        console.log(`${category}:`);
        categoryScopes.forEach((scope) => {
          const selected = scopes.includes(scope) ? '✓' : ' ';
          console.log(`  [${selected}] ${scope}`);
          const desc = SCOPE_DESCRIPTIONS[scope];
          if (desc) console.log(`      → ${desc}`);
        });
        console.log('');
      });
    } else if (action === '5') {
      scopes.length = 0;
      console.log('✅ Cleared all scopes\n');
    } else if (action === '6') {
      continueCustomizing = false;
    } else {
      console.log('❌ Invalid choice\n');
    }
  }

  console.log(`\n✅ Scope customization complete\n📊 Final selection: ${scopes.length} scopes\n`);
  return scopes;
}

function summarize(plan) {
  console.log(`\n🔐 Token: "${plan.name}" (${plan.type})\n`);
  console.log(`📅 Expiration: ${plan.days} days`);
  if (plan.type === 'fine-grained') {
    console.log(`🏢 Resource owner: ${plan.owner || '(you)'}`);
    const entries = Object.entries(plan.permissions);
    console.log(`📌 Permissions (${entries.length}):`);
    if (entries.length === 0) console.log('  (read-only public data)');
    entries.forEach(([name, level]) => console.log(`  • ${name}: ${level}`));
  } else {
    const { scopes } = plan;
    console.log(`📌 Scopes (${scopes.length}):`);
    if (scopes.length === 0) {
      console.log('  (no scopes selected)');
    } else if (scopes.length > 10) {
      Object.entries(SCOPE_CATEGORIES).forEach(([category, categoryScopes]) => {
        const selectedInCategory = categoryScopes.filter((s) => scopes.includes(s));
        if (selectedInCategory.length > 0) {
          console.log(`  ${category}: ${selectedInCategory.length}/${categoryScopes.length}`);
        }
      });
    } else {
      scopes.forEach((scope) => console.log(`  • ${scope}`));
    }
  }
  console.log('');
}

async function selectType() {
  console.log('\n🧭 Token Type\n');
  console.log('1. Fine-grained (recommended — limited to chosen repositories and permissions)');
  console.log('2. Classic (broad scopes; needed for some APIs and some org setups)\n');
  const choice = await question('Enter your choice (1-2): ');
  return choice.trim() === '2' ? 'classic' : 'fine-grained';
}

async function selectPermissions() {
  console.log('\n🎯 Fine-grained Permissions\n');
  console.log('Enter repository/account permissions as name=level, comma-separated.');
  console.log('Levels: read, write, admin. Examples:');
  console.log('  contents=read                       read code');
  console.log('  contents=write,pull_requests=write  push branches and open PRs');
  console.log('  contents=write,workflows=write      update .github/workflows files');
  console.log('  secrets=write                       manage Actions secrets');
  console.log('You pick which repositories it can access on the GitHub page.\n');
  for (;;) {
    const answer = (await question('Permissions (Enter for none): ')).trim();
    try {
      return parsePermissions(answer);
    } catch (error) {
      console.log(`❌ ${error.message}\n`);
    }
  }
}

function openBrowser(url) {
  const platform = os.platform();
  const [cmd, args] =
    platform === 'darwin' ? ['open', [url]]
      : platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
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

function saveToken(token, tokenName) {
  const fileName = `${tokenName}.ght`;
  const filePath = path.join(getHomeDirectory(), fileName);
  fs.writeFileSync(filePath, token, { mode: 0o600 });
  // writeFileSync only applies mode on creation; enforce it on overwrite too.
  if (os.platform() !== 'win32') fs.chmodSync(filePath, 0o600);
  console.log(`✅ Token saved to: ${filePath} (mode 600)`);
  console.log('\n📌 To use this token:\n');
  console.log(`   export GITHUB_TOKEN=$(cat ~/${fileName})`);
  console.log('   gh api user\n');
  return filePath;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return 0;
  }

  if (opts.tokenStdin && (!opts.type || !opts.name || opts.expiration === undefined || !opts.yes)) {
    console.log('❌ --token-stdin requires --type, --name, --expiration and --yes (stdin is reserved for the token).\n');
    return 1;
  }

  console.log('\n🚀 GitHub Token Generator\n');

  const type = opts.type ?? (await selectType());

  const tokenName = opts.name ?? (await question('Enter a name for this token (e.g., "automation", "ci-cd"): ')).trim();
  const nameError = validateTokenName(tokenName, type);
  if (nameError) {
    console.log(`❌ ${nameError}\n`);
    return 1;
  }

  const filePath = path.join(getHomeDirectory(), `${tokenName}.ght`);
  if (!opts.printUrl && fs.existsSync(filePath) && !opts.force) {
    if (opts.yes || opts.tokenStdin) {
      console.log(`❌ ~/${tokenName}.ght already exists. Re-run with --force to overwrite.\n`);
      return 1;
    }
    const overwrite = await question(`⚠️  File ${tokenName}.ght already exists. Overwrite? (y/n): `);
    if (overwrite.toLowerCase() !== 'y') {
      console.log('❌ Generation cancelled.\n');
      return 0;
    }
  }

  let days;
  if (opts.expiration !== undefined) {
    days = parseInt(opts.expiration, 10);
    if (!Number.isInteger(days) || days <= 0) {
      console.log('❌ --expiration must be a positive number of days.\n');
      return 1;
    }
  } else {
    days = await selectExpiration();
  }
  if (type === 'fine-grained' && days > FINE_GRAINED_MAX_DAYS) {
    console.log(`❌ Fine-grained tokens can last at most ${FINE_GRAINED_MAX_DAYS} days.\n`);
    return 1;
  }

  const plan = { type, name: tokenName, days };
  if (type === 'fine-grained') {
    plan.owner = opts.owner;
    plan.permissions = opts.permissions !== undefined ? parsePermissions(opts.permissions) : await selectPermissions();
    plan.url = buildFineGrainedUrl({ name: tokenName, owner: plan.owner, days, permissions: plan.permissions });
  } else {
    plan.scopes = opts.scopes !== undefined ? parseScopes(opts.scopes) : await selectScopes();
    warnAboutScopes(plan.scopes);
    plan.url = buildClassicUrl(tokenName, plan.scopes);
  }

  if (opts.printUrl) {
    console.log(plan.url);
    return 0;
  }

  summarize(plan);
  if (!opts.yes) {
    const proceed = await question('Ready to generate? (y/n): ');
    if (proceed.toLowerCase() !== 'y') {
      console.log('❌ Generation cancelled.\n');
      return 0;
    }
  }

  const expiresOn = new Date(Date.now() + days * 86400000).toISOString().split('T')[0];
  console.log('\n🌐 Create the token on GitHub:\n');
  console.log(`   ${plan.url}\n`);
  if (type === 'fine-grained') {
    console.log('   1. Name, expiration and permissions are prefilled — review them.');
    console.log('   2. Under "Repository access", choose the repositories this token may use.');
  } else {
    console.log('   1. The note and scopes are prefilled — review them.');
    console.log(`   2. Set Expiration to ${days} days (≈ ${expiresOn}). GitHub can't prefill this for classic tokens.`);
  }
  console.log('   3. Click "Generate token" and copy it. GitHub shows it only once.\n');
  if (opts.open && !opts.tokenStdin) {
    if (openBrowser(plan.url)) console.log('   (Opened in your browser.)\n');
  }

  const token = opts.tokenStdin
    ? await readStdin()
    : await secretQuestion('Paste the new token here (input hidden): ');
  if (!token) {
    console.log('❌ No token entered.\n');
    return 1;
  }
  const pastedType = tokenType(token);
  if (pastedType === 'unknown') {
    console.log("⚠️  This doesn't look like a personal access token (expected ghp_ or github_pat_).\n");
  } else if (pastedType !== type) {
    console.log(`⚠️  You pasted a ${pastedType} token, but a ${type} token was planned. Continuing.\n`);
  }

  console.log('⏳ Verifying token with GitHub...\n');
  const check = verifyToken(token);
  if (!check.ok) {
    console.log(`❌ Token check failed: ${check.error}. Nothing was saved.\n`);
    return 1;
  }
  console.log(`✅ Token works for: ${check.login ?? '(unknown user)'}`);
  if (check.scopes !== null) console.log(`   Scopes: ${check.scopes || '(none)'}`);
  if (check.expiresAt) console.log(`   Expires: ${check.expiresAt.toISOString()}`);
  else if (check.type === 'classic') console.log('   Expires: never — consider regenerating with an expiration');
  console.log('');

  saveToken(token, tokenName);
  console.log('✨ Done!\n');
  return 0;
}

main()
  .then((code) => {
    closeReadline();
    process.exitCode = code;
  })
  .catch((error) => {
    console.error('❌ Error:', error.message);
    closeReadline();
    process.exitCode = 1;
  });
