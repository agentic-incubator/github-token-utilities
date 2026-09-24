#!/usr/bin/env node

import os from 'os';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getPowerShellProfile } from './gh-token-lib.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
// gh-token-lib.mjs is shared by the other three and must sit next to them.
const SCRIPTS = ['generator.mjs', 'audit.mjs', 'rotate.mjs', 'store.mjs', 'revoke.mjs', 'gh-token-lib.mjs'];
const DRY_RUN = process.argv.includes('--dry-run');

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  console.log(`
Usage: node setup.mjs [--dry-run]

Copies generator.mjs, audit.mjs, rotate.mjs, store.mjs, revoke.mjs and
gh-token-lib.mjs to your home directory and adds the gen-gh-token,
audit-gh-tokens, rotate-gh-token, store-gh-token and revoke-gh-token aliases to
your shell config (your PowerShell profile on Windows). Re-running is safe:
existing aliases are left alone.

  --dry-run   Show what would be copied and which file would change; change nothing
`);
  process.exit(0);
}

function getHomeDirectory() {
  return os.homedir();
}

function getPlatform() {
  return os.platform();
}

function getShell() {
  const shell = process.env.SHELL || process.env.COMSPEC || '';
  return path.basename(shell);
}

function getShellConfigFiles() {
  const platform = getPlatform();
  const homeDir = getHomeDirectory();

  if (platform === 'win32') {
    // Ask PowerShell where its profile is: Documents may be redirected (e.g. OneDrive) and
    // PowerShell 7 and Windows PowerShell 5.1 use different folders.
    // https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_profiles
    const profile = getPowerShellProfile() || path.join(homeDir, 'Documents', 'PowerShell', 'profile.ps1');
    return {
      type: 'powershell',
      files: [profile],
      aliases: [
        { name: 'gen-gh-token', command: 'function gen-gh-token { node $HOME/generator.mjs @args }' },
        { name: 'audit-gh-tokens', command: 'function audit-gh-tokens { node $HOME/audit.mjs @args }' },
        { name: 'rotate-gh-token', command: 'function rotate-gh-token { node $HOME/rotate.mjs @args }' },
        { name: 'store-gh-token', command: 'function store-gh-token { node $HOME/store.mjs @args }' },
        { name: 'revoke-gh-token', command: 'function revoke-gh-token { node $HOME/revoke.mjs @args }' },
      ],
    };
  }

  // POSIX-family shells: pick the startup file and alias syntax for the user's login shell.
  const shell = getShell();
  const commands = [
    ['gen-gh-token', 'generator.mjs'],
    ['audit-gh-tokens', 'audit.mjs'],
    ['rotate-gh-token', 'rotate.mjs'],
    ['store-gh-token', 'store.mjs'],
    ['revoke-gh-token', 'revoke.mjs'],
  ];

  if (shell === 'fish') {
    // conf.d/*.fish is loaded automatically: https://fishshell.com/docs/current/language.html#configuration-files
    return {
      type: 'fish',
      files: [path.join(homeDir, '.config', 'fish', 'conf.d', 'github-token-utilities.fish')],
      aliases: commands.map(([name, file]) => ({ name, command: `alias ${name} 'node ~/${file}'` })),
    };
  }
  if (shell === 'csh' || shell === 'tcsh') {
    // tcsh reads ~/.tcshrc if present, otherwise ~/.cshrc; csh reads ~/.cshrc.
    return {
      type: 'csh',
      files: shell === 'tcsh' ? [path.join(homeDir, '.tcshrc'), path.join(homeDir, '.cshrc')] : [path.join(homeDir, '.cshrc')],
      aliases: commands.map(([name, file]) => ({ name, command: `alias ${name} 'node ~/${file}'` })),
    };
  }

  // bash, zsh, sh, ksh, dash: interactive startup files per shell.
  let files;
  if (shell === 'zsh') files = [path.join(homeDir, '.zshrc')];
  else if (shell === 'bash') {
    // macOS Terminal starts login shells (~/.bash_profile); Linux terminals start non-login shells (~/.bashrc).
    files = platform === 'darwin'
      ? [path.join(homeDir, '.bash_profile'), path.join(homeDir, '.bashrc')]
      : [path.join(homeDir, '.bashrc'), path.join(homeDir, '.bash_profile')];
  } else if (shell === 'ksh') files = [path.join(homeDir, '.kshrc'), path.join(homeDir, '.profile')];
  else files = [path.join(homeDir, '.profile')];

  return {
    type: 'shell',
    files,
    aliases: commands.map(([name, file]) => ({ name, command: `alias ${name}="node ~/${file}"` })),
  };
}

async function copyScripts() {
  const homeDir = getHomeDirectory();

  console.log('\n📦 Step 1: Copying scripts...\n');

  for (const script of SCRIPTS) {
    const srcPath = path.join(SCRIPT_DIR, script);
    const destPath = path.join(homeDir, script);

    if (!fs.existsSync(srcPath)) {
      console.error(`❌ Error: ${script} not found in the same directory.`);
      return false;
    }

    if (DRY_RUN) {
      console.log(`🧪 would copy ${script} → ${destPath}${fs.existsSync(destPath) ? ' (overwrite)' : ''}`);
      continue;
    }

    try {
      fs.copyFileSync(srcPath, destPath);

      // Make executable on Unix-like systems
      if (getPlatform() !== 'win32') {
        fs.chmodSync(destPath, 0o755);
      }

      console.log(`✅ ${script} → ${destPath}`);
    } catch (error) {
      console.error(`❌ Error copying ${script}: ${error.message}`);
      return false;
    }
  }

  return true;
}

async function addAliases() {
  console.log('\n🔗 Step 2: Adding shell aliases...\n');

  const config = getShellConfigFiles();
  const homeDir = getHomeDirectory();

  // Find an existing config file or create one
  let configFile = null;

  for (const file of config.files) {
    if (fs.existsSync(file)) {
      configFile = file;
      break;
    }
  }

  // If no config file exists, use the first one and create it
  if (!configFile) {
    configFile = config.files[0];
    console.log(`📝 ${DRY_RUN ? 'Would create' : 'Creating'} shell config: ${configFile}\n`);
    if (DRY_RUN) {
      config.aliases.forEach((alias) => console.log(`🧪 would add: ${alias.command}`));
      return true;
    }

    // Ensure directory exists
    const configDir = path.dirname(configFile);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
  }

  try {
    // Read existing content
    let content = '';
    if (fs.existsSync(configFile)) {
      content = fs.readFileSync(configFile, 'utf-8');
    }

    let aliasesAdded = [];
    let aliasesExist = [];

    // Add each alias
    for (const alias of config.aliases) {
      if (content.includes(alias.name)) {
        aliasesExist.push(alias.name);
      } else {
        content += `\n${alias.command}`;
        aliasesAdded.push(alias.name);
      }
    }

    if (DRY_RUN) {
      aliasesAdded.forEach((name) => {
        const alias = config.aliases.find((a) => a.name === name);
        console.log(`🧪 would add to ${configFile}: ${alias.command}`);
      });
      if (aliasesExist.length > 0) console.log(`⚠️  Already exist: ${aliasesExist.join(', ')}`);
      return true;
    }

    // Write back if any aliases were added
    if (aliasesAdded.length > 0) {
      fs.writeFileSync(configFile, content, 'utf-8');
      aliasesAdded.forEach((name) => {
        console.log(`✅ ${name}`);
      });
    }

    if (aliasesExist.length > 0) {
      console.log(`⚠️  Already exist: ${aliasesExist.join(', ')}`);
    }

    console.log(`\n📍 Updated: ${configFile}\n`);
    return true;
  } catch (error) {
    console.error(`❌ Error adding aliases: ${error.message}`);
    return false;
  }
}

async function verifySetup() {
  console.log('\n✔️  Step 3: Verifying setup...\n');

  const homeDir = getHomeDirectory();

  for (const script of SCRIPTS) {
    const scriptPath = path.join(homeDir, script);
    if (!fs.existsSync(scriptPath)) {
      console.error(`❌ ${script} not found at: ${scriptPath}`);
      return false;
    }
    console.log(`✅ ${script} verified`);
  }

  return true;
}

async function main() {
  console.log('\n🚀 GitHub Token Utilities Setup\n');
  console.log(`📍 Platform: ${getPlatform()}`);
  console.log(`📍 Home Directory: ${getHomeDirectory()}`);
  console.log(`📍 Shell: ${getShell() || 'default'}\n`);
  if (DRY_RUN) console.log('🧪 Dry run — nothing will be changed.\n');

  // Step 1: Copy scripts
  const scriptsCopied = await copyScripts();
  if (!scriptsCopied) {
    console.error('❌ Setup failed.');
    process.exit(1);
  }

  // Step 2: Add aliases
  const aliasesAdded = await addAliases();
  if (!aliasesAdded) {
    console.warn('⚠️  Warning: Could not add aliases. You may need to add them manually.\n');
  }

  if (DRY_RUN) {
    console.log('\n🧪 Dry run complete. Re-run without --dry-run to apply.\n');
    return;
  }

  // Step 3: Verify
  const verified = await verifySetup();
  if (!verified) {
    console.error('❌ Setup verification failed.');
    process.exit(1);
  }

  // Done
  console.log('\n✨ Setup Complete!\n');
  console.log('🎯 Available Commands:\n');
  console.log('  gen-gh-token       Generate a new GitHub token');
  console.log('  audit-gh-tokens    Audit repositories for token secrets');
  console.log('  rotate-gh-token    Rotate a token in a repository secret');
  console.log('  store-gh-token     Store a token in your shell secrets file');
  console.log('  revoke-gh-token    Permanently revoke a token and remove local copies\n');

  console.log('🔧 Next Steps:\n');

  const platform = getPlatform();
  if (platform === 'win32') {
    console.log('1. Restart PowerShell or open a new PowerShell window');
    console.log('2. Run: gen-gh-token\n');
  } else {
    console.log('1. Reload your shell config:');
    const shell = getShell();
    if (shell.includes('zsh')) {
      console.log('   source ~/.zshrc\n');
    } else {
      console.log('   source ~/.bashrc  (or ~/.bash_profile)\n');
    }
    console.log('2. Or restart your terminal');
    console.log('3. Run: gen-gh-token\n');
  }

  console.log('📖 Documentation: See README.md for detailed usage\n');

}

main().catch((error) => {
  console.error('❌ Setup error:', error.message);
  process.exit(1);
});
