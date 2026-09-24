# Terminal token (short-lived, broad access)

Use this when the user wants their terminal to have a powerful `GITHUB_TOKEN` without keeping
a long-lived one. The token lives in a shell secrets file that the shell loads at startup:

| Shell | File (default) | What `store-gh-token` writes |
|---|---|---|
| bash, zsh, sh, ksh, dash, Git Bash | `~/.secrets.env` | `export GITHUB_TOKEN=…` and `export GITHUB_PERSONAL_ACCESS_TOKEN="$GITHUB_TOKEN"` |
| fish | `~/.config/fish/conf.d/secrets.fish` | `set -gx GITHUB_TOKEN …` and `set -gx GITHUB_PERSONAL_ACCESS_TOKEN $GITHUB_TOKEN` |
| csh, tcsh | `~/.secrets.csh` | `setenv GITHUB_TOKEN …` and `setenv GITHUB_PERSONAL_ACCESS_TOKEN "${GITHUB_TOKEN}"` |
| PowerShell (Windows default) | `~\.secrets.ps1` | `$env:GITHUB_TOKEN = '…'` and `$env:GITHUB_PERSONAL_ACCESS_TOKEN = $env:GITHUB_TOKEN` |

The script picks the format from the OS and `$SHELL`; `--format` and `--file` override.

**Never open, print or edit the secrets file yourself.** It usually holds other credentials
too. Only `store.mjs` and `audit.mjs` touch it, and they never print values.

## 1. See what's there now (you can run this)

```bash
node ~/audit.mjs --no-remote --json
```

Find the entry with `"secretsFile": true`: `status`, `expiresAt`, `scopes`, `login`. If the
user's file lives somewhere else, add `--secrets-file PATH`. No such entry means the file or
the variable doesn't exist yet; `store.mjs` will create it.

## 2. Agree on the token

- **Type:** classic. It's the only kind that can span every org and GitHub Packages. See
  `references/scopes.md`.
- **Scopes:** if the user wants "everything", `--scopes default` grants all 51. Mention once,
  without lecturing, that dropping `delete_repo`, `admin:enterprise` and `admin:org` removes the
  most destructive powers. Then respect their choice.
- **Expiration:** 7 days is a good rhythm for a broad token; `store.mjs` refuses anything over
  30 days unless given `--max-days N` or `--force`, which is the point of this workflow.

## 3. User creates the token (their terminal)

```bash
node ~/generator.mjs --type classic --name terminal --scopes default --expiration 7 --yes
```

For classic tokens GitHub can't prefill the expiration, so remind them to set **Expiration**
to 7 days on the page.

## 4. Store it (preview, confirm, then you run it)

```bash
node ~/store.mjs --from terminal --dry-run
```

Show the user the plan. It lists which variables will be added or replaced, with masked
values. If the file currently defines `GITHUB_PERSONAL_ACCESS_TOKEN` first and `GITHUB_TOKEN`
as a reference to it, the script reverses that automatically, because the value must be
defined before it is referenced. After a yes:

```bash
node ~/store.mjs --from terminal --yes
```

Add `--ensure-loaded` if the user's shell doesn't already load the file at startup (the
dry run says which startup file it would edit).

The script keeps `<file>.bak` (owner-only) and says whether the **replaced token is still
active**. If it is, the user should revoke it at https://github.com/settings/tokens.

## 5. Finish

- New terminals pick up the token. For the current one, have the user run
  `. ~/.secrets.env` (or `source ~/.secrets.csh`, or `. ~\.secrets.ps1` in PowerShell).
- **Your own session still has the old token in its environment.** If the old token gets
  revoked, `gh` commands you run will fail until the user restarts this agent session.
  Say this before they revoke it.
- The token also remains in `~/terminal.ght`. Offer to delete that copy (`rm ~/terminal.ght`,
  after confirming) so there is only one.
- Suggest repeating this before expiry. An audit shows `EXPIRING_SOON` 7 days ahead.
