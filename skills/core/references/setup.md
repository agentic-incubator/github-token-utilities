# Setup, update, uninstall

The toolkit lives in a git clone. `setup.mjs` then copies the three scripts to the home
directory and adds shell aliases (`gen-gh-token`, `audit-gh-tokens`, `rotate-gh-token`) for the
user's own terminal. You always call the scripts by path (`node ~/audit.mjs`), because the
shells you run commands in usually don't load the user's shell config, so aliases won't exist.

Clone location (use it unless the user prefers another):

- macOS / Linux: `~/.local/share/github-token-utilities`
- Windows (PowerShell): `$env:LOCALAPPDATA\github-token-utilities`

## Install

1. **Explain and confirm.** Tell the user exactly what will happen, then ask to proceed:
   - clone `{{REPO_URL}}` into the location above
   - copy `generator.mjs`, `audit.mjs`, `rotate.mjs`, `store.mjs` and `gh-token-lib.mjs` into
     their home directory (overwriting older copies of those files)
   - add four aliases (`gen-gh-token`, `audit-gh-tokens`, `rotate-gh-token`, `store-gh-token`)
     to the startup file for their shell: `~/.zshrc`; `~/.bash_profile` (macOS) or `~/.bashrc`
     (Linux) for bash; `~/.config/fish/conf.d/github-token-utilities.fish`; `~/.tcshrc` or
     `~/.cshrc`; `~/.kshrc`/`~/.profile`; or the PowerShell profile on Windows. Existing aliases
     are left alone. The dry run names the exact file.
2. **Clone** (or update, if the folder already exists):

   ```bash
   DIR="$HOME/.local/share/github-token-utilities"
   if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone --depth 1 {{REPO_GIT}} "$DIR"; fi
   ```

   Windows (PowerShell):

   ```powershell
   $Dir = Join-Path $env:LOCALAPPDATA 'github-token-utilities'
   if (Test-Path (Join-Path $Dir '.git')) { git -C $Dir pull --ff-only } else { git clone --depth 1 {{REPO_GIT}} $Dir }
   ```

   If the folder exists but is not a git clone, stop and ask — don't overwrite it.
3. **Preview**, and show the user the output:

   ```bash
   node "$HOME/.local/share/github-token-utilities/setup.mjs" --dry-run
   # Windows: node "$env:LOCALAPPDATA\github-token-utilities\setup.mjs" --dry-run
   ```

4. **Apply** once they confirm the preview:

   ```bash
   node "$HOME/.local/share/github-token-utilities/setup.mjs"
   # Windows: node "$env:LOCALAPPDATA\github-token-utilities\setup.mjs"
   ```

5. **Verify**: `test -f ~/audit.mjs && node ~/audit.mjs --help | head -3`
6. Tell them to open a new terminal (or `source` the config file setup named) before using
   the aliases themselves. Then offer an audit as a first step.

## Update

Same as install: step 2 (`git pull --ff-only`), then steps 3–5. Re-running setup is safe:
it refreshes the three scripts and skips aliases that already exist. If `git pull` reports
local changes or a non-fast-forward, stop and show the user rather than forcing anything.

## Uninstall

Confirm first, and list exactly what will be removed:

- `~/generator.mjs`, `~/audit.mjs`, `~/rotate.mjs`, `~/store.mjs`, `~/gh-token-lib.mjs`
- the four alias lines in the shell config (show the lines; edit the file only after they agree)
- the clone folder

**Never delete `~/*.ght` token files or the shell secrets file as part of uninstall.** They are the user's credentials;
if they want them gone, handle that as a separate, explicit request — and remind them to
revoke the tokens on GitHub first, because deleting the file doesn't revoke anything.
