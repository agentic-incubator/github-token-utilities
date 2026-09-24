# Store a terminal token

[README](../README.md) › [Documentation](../README.md#documentation) › Guides › Store

`store-gh-token` keeps a short-lived token in the secrets file your shell loads at startup, as `GITHUB_TOKEN` plus a `GITHUB_PERSONAL_ACCESS_TOKEN` reference.

The quickest way to get a powerful token that doesn't live long is one command. It creates a
token for the account `gh` is signed in as, and stores it:

```bash
store-gh-token --generate --expiration 7
```

1. It shows the account `gh` is signed in as. It asks the stored `gh` login first, because the
   `GITHUB_TOKEN` your shell exports may be the old token being replaced.
2. It opens GitHub's new-token page with all 48 default classic scopes and a dated note
   prefilled. Narrow it with `--scopes repo,workflow,…`.
3. You set **Expiration** (GitHub can't prefill it for classic tokens), click **Generate
   token** and copy it, then press Enter.
4. It reads the token from the clipboard and clears the clipboard, so you never paste or see
   it.[^clipboard] Where no clipboard is available (SSH, headless Linux) it falls back to a
   hidden prompt; `--no-clipboard` forces that.
5. It verifies the token and **refuses it if it belongs to a different account** than `gh`
   (for example, a browser signed in elsewhere) or outlives `--max-days`.
6. It adds or replaces the variables as described below.

> [!IMPORTANT]
> "Current user" means the account `gh` is signed in as. GitHub has no API that creates a
> personal access token,[^pat-docs] so that one click on GitHub's page can't be skipped. Every
> other step is automated. The alternative, reusing `gh`'s own OAuth token, was rejected
> deliberately: it never expires on a schedule (it's only revoked after a year of
> non-use)[^token-expiry], and it is `gh`'s own login credential.

If you also want a copy in `~/<name>.ght`, use the two-step form:

```bash
gen-gh-token --type classic --name terminal --scopes default --expiration 7
store-gh-token --from terminal --dry-run   # preview: which lines change (values masked)
store-gh-token --from terminal             # apply
```

`store-gh-token` writes the value to `GITHUB_TOKEN` and makes `GITHUB_PERSONAL_ACCESS_TOKEN`
a **reference** to it, in your shell's syntax:

| Shell | Default file | Written as |
|---|---|---|
| bash, zsh, sh, ksh, dash, Git Bash | `~/.secrets.env` | `export GITHUB_TOKEN=…`[^bash-export]<br>`export GITHUB_PERSONAL_ACCESS_TOKEN="$GITHUB_TOKEN"` |
| fish | `~/.config/fish/conf.d/secrets.fish` | `set -gx GITHUB_TOKEN …`[^fish-set]<br>`set -gx GITHUB_PERSONAL_ACCESS_TOKEN $GITHUB_TOKEN` |
| csh, tcsh | `~/.secrets.csh` | `setenv GITHUB_TOKEN …`[^tcsh]<br>`setenv GITHUB_PERSONAL_ACCESS_TOKEN "${GITHUB_TOKEN}"` |
| PowerShell (Windows default) | `~\.secrets.ps1` | `$env:GITHUB_TOKEN = '…'`[^ps-env]<br>`$env:GITHUB_PERSONAL_ACCESS_TOKEN = $env:GITHUB_TOKEN` |

The format is detected from your OS and `$SHELL`; override with `--format sh|fish|csh|powershell`
and `--file PATH`. Rename the variables with `--key` and `--alias` (repeatable), or drop the
reference with `--no-alias`.

How it edits the file:

- **Missing file:** created with only these lines, readable by you alone.
- **Existing file:** every other line is kept byte-for-byte, including comments and line
  endings. Every existing assignment of the managed variables, duplicates included, is
  replaced by one block at the position of the first. The value always comes before the
  reference, so a file that had them the other way round is fixed.
- **Before writing:** the new token is verified with GitHub. It is **refused if it never
  expires or lives longer than `--max-days`** (default 30); `--force` overrides.
- **After writing:** the previous version is kept as `<file>.bak`. The token that was replaced
  is checked, and you're told if it is still active and should be revoked.
- `--ensure-loaded` adds a line to your shell startup file (or PowerShell profile) that loads
  the secrets file, if nothing loads it yet.

> [!IMPORTANT]
> The secrets file is **executed** by your shell at startup, so the tool writes a value only if
> it consists solely of letters, digits and `_`, as every GitHub token does. Anything else is
> rejected, to keep command substitution such as `$(…)` out of the file.

> [!NOTE]
> - The file is made readable only by you: mode `600` on macOS and Linux, and on Windows an
>   ACL granting only your account access (`icacls /inheritance:r /grant:r`).[^icacls]
> - PowerShell dot-sources only `.ps1` files,[^ps-scripts] so `--file` must end in `.ps1` there.
> - Already-open terminals keep the old value until they reload the file: `. ~/.secrets.env`,
>   `source ~/.secrets.csh`, or `. ~\.secrets.ps1`.

> [!TIP]
> `audit-gh-tokens --no-remote` also checks the token in your secrets file and flags it
> `EXPIRING_SOON` a week ahead, which is a good reminder to repeat these two commands.

[^clipboard]: macOS `pbpaste`/`pbcopy`; Windows PowerShell `Get-Clipboard`/`Set-Clipboard` <https://learn.microsoft.com/powershell/module/microsoft.powershell.management/get-clipboard>; Linux `wl-paste` (Wayland), `xclip` or `xsel` (X11).
[^pat-docs]: GitHub Docs, *Managing your personal access tokens*: creation via the web UI; fine-grained template-URL parameters (`name` ≤ 40, `description`, `target_name`, `expires_in` 1–366, permission names); recommendation to prefer fine-grained tokens. <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens>
[^token-expiry]: GitHub Docs, *Token expiration and revocation*: tokens unused for a year are revoked; GitHub App user tokens expire after 8 hours. <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation>
[^bash-export]: GNU Bash manual, *Bourne Shell Builtins → export*. <https://www.gnu.org/software/bash/manual/html_node/Bourne-Shell-Builtins.html>
[^fish-set]: fish documentation, *set* (`-g` global, `-x` export). <https://fishshell.com/docs/current/cmds/set.html>
[^tcsh]: tcsh(1): `setenv`, `source`, and startup files ("first `~/.tcshrc` or, if `~/.tcshrc` is not found, `~/.cshrc`"). <https://man.freebsd.org/cgi/man.cgi?query=tcsh>
[^ps-env]: Microsoft Learn, *about_Environment_Variables*. <https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_environment_variables>
[^icacls]: Microsoft Learn, *icacls* (`/inheritance:r`, `/grant:r`). <https://learn.microsoft.com/windows-server/administration/windows-commands/icacls>
[^ps-scripts]: Microsoft Learn, *about_Scripts*: scripts use the `.ps1` extension, dot sourcing runs them in the current scope, and Windows' default execution policy blocks scripts. <https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_scripts>
