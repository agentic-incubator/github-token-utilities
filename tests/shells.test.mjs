// Sources a generated secrets file in each real shell that is installed and checks both
// variables come out right. Shells that aren't installed are skipped, not faked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { upsertEnvToken } from '../gh-token-lib.mjs';

const TOKEN = 'ghp_FAKE_test_token_for_shell_tests';
const PRE_EXISTING = { sh: 'export OTHER=keep\n', fish: 'set -gx OTHER keep\n', csh: 'setenv OTHER keep\n', powershell: "$env:OTHER = 'keep'\r\n" };

const SHELLS = [
  { shell: 'bash', format: 'sh', args: (f) => ['-c', `. "${f}"; printf '%s|%s|%s' "$GITHUB_TOKEN" "$GITHUB_PERSONAL_ACCESS_TOKEN" "$OTHER"`] },
  { shell: 'zsh', format: 'sh', args: (f) => ['-f', '-c', `. "${f}"; printf '%s|%s|%s' "$GITHUB_TOKEN" "$GITHUB_PERSONAL_ACCESS_TOKEN" "$OTHER"`] },
  { shell: 'sh', format: 'sh', args: (f) => ['-c', `. "${f}"; printf '%s|%s|%s' "$GITHUB_TOKEN" "$GITHUB_PERSONAL_ACCESS_TOKEN" "$OTHER"`] },
  { shell: 'dash', format: 'sh', args: (f) => ['-c', `. "${f}"; printf '%s|%s|%s' "$GITHUB_TOKEN" "$GITHUB_PERSONAL_ACCESS_TOKEN" "$OTHER"`] },
  { shell: 'ksh', format: 'sh', args: (f) => ['-c', `. "${f}"; printf '%s|%s|%s' "$GITHUB_TOKEN" "$GITHUB_PERSONAL_ACCESS_TOKEN" "$OTHER"`] },
  { shell: 'fish', format: 'fish', args: (f) => ['--no-config', '-c', `source "${f}"; printf '%s|%s|%s' $GITHUB_TOKEN $GITHUB_PERSONAL_ACCESS_TOKEN $OTHER`] },
  { shell: 'csh', format: 'csh', args: (f) => ['-f', '-c', `source "${f}"; printf '%s|%s|%s' "$GITHUB_TOKEN" "$GITHUB_PERSONAL_ACCESS_TOKEN" "$OTHER"`] },
  { shell: 'tcsh', format: 'csh', args: (f) => ['-f', '-c', `source "${f}"; printf '%s|%s|%s' "$GITHUB_TOKEN" "$GITHUB_PERSONAL_ACCESS_TOKEN" "$OTHER"`] },
  { shell: 'pwsh', format: 'powershell', args: (f) => ['-NoProfile', '-NonInteractive', '-Command', `. '${f}'; Write-Output ('{0}|{1}|{2}' -f $env:GITHUB_TOKEN, $env:GITHUB_PERSONAL_ACCESS_TOKEN, $env:OTHER)`] },
];

function installed(shell) {
  const probe = process.platform === 'win32' ? spawnSync('where', [shell]) : spawnSync('sh', ['-c', `command -v ${shell}`]);
  return probe.status === 0;
}

for (const { shell, format, args } of SHELLS) {
  // On Windows only PowerShell is exercised; POSIX shells there (Git Bash, WSL) are covered on Linux/macOS.
  const skip = process.platform === 'win32' && format !== 'powershell' ? 'POSIX shells run on Linux/macOS' : !installed(shell) && `${shell} not installed`;
  test(`${shell} loads the ${format} secrets file with the value and the reference`, { skip }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtu-shell-'));
    try {
      // PowerShell only dot-sources files with a .ps1 extension.
      const file = path.join(dir, format === 'powershell' ? 'secrets.ps1' : `secrets.${format}`);
      const { content } = upsertEnvToken(PRE_EXISTING[format], {
        primary: 'GITHUB_TOKEN',
        aliases: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
        value: TOKEN,
        format,
      });
      fs.writeFileSync(file, content);
      const env = { PATH: process.env.PATH, HOME: dir, SystemRoot: process.env.SystemRoot };
      const result = spawnSync(shell, args(file), { encoding: 'utf-8', env });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), `${TOKEN}|${TOKEN}|keep`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

// setup.mjs writes aliases in each shell's own syntax and startup file; load that file in
// the real shell and ask it for the alias.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ALIAS_SHELLS = [
  { shell: 'bash', rc: process.platform === 'darwin' ? '.bash_profile' : '.bashrc', args: (rc) => ['-c', `. "${rc}"; alias store-gh-token`] },
  { shell: 'zsh', rc: '.zshrc', args: (rc) => ['-f', '-c', `source "${rc}"; alias store-gh-token`] },
  { shell: 'ksh', rc: '.kshrc', args: (rc) => ['-c', `. "${rc}"; alias store-gh-token`] },
  { shell: 'tcsh', rc: '.tcshrc', args: (rc) => ['-f', '-c', `source "${rc}"; alias store-gh-token`] },
  { shell: 'csh', rc: '.cshrc', args: (rc) => ['-f', '-c', `source "${rc}"; alias store-gh-token`] },
  { shell: 'fish', rc: '.config/fish/conf.d/github-token-utilities.fish', args: (rc) => ['--no-config', '-c', `source "${rc}"; functions -q store-gh-token`] },
];

for (const { shell, rc, args } of ALIAS_SHELLS) {
  const skip = process.platform === 'win32' ? 'POSIX shells only' : !installed(shell) && `${shell} not installed`;
  test(`setup writes ${shell} aliases that ${shell} accepts`, { skip }, () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gtu-setup-'));
    try {
      const env = { PATH: process.env.PATH, HOME: home, SHELL: `/bin/${shell}` };
      const setup = spawnSync(process.execPath, [path.join(ROOT, 'setup.mjs')], { encoding: 'utf-8', env });
      assert.equal(setup.status, 0, setup.stdout + setup.stderr);
      const rcPath = path.join(home, rc);
      assert.ok(fs.existsSync(rcPath), `${rc} was not written`);
      const result = spawnSync(shell, args(rcPath), { encoding: 'utf-8', env });
      assert.equal(result.status, 0, result.stderr);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
}
