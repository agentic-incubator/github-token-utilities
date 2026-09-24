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
- **Scopes:** if the user wants "everything", `--scopes default` grants all 48 scopes in its default set. Mention once,
  without lecturing, that dropping `delete_repo`, `admin:enterprise` and `admin:org` removes the
  most destructive powers. Then respect their choice.
- **Expiration:** 7 days is a good rhythm for a broad token; `store.mjs` refuses anything over
  30 days unless given `--max-days N` or `--force`, which is the point of this workflow.

## 3. Create and store in one step (the user runs this)

Preview first. This is safe to run yourself; nothing is created or written:

```bash
node ~/store.mjs --generate --expiration 7 --dry-run --no-open --token-stdin < /dev/null
```

It stops at the token step, after showing which account `gh` is signed in as, the prefilled
GitHub link, and the file and variables it would write. (PowerShell: pipe `$null |` into it
instead of `< /dev/null`.) Then hand the user the real command to run in their own
terminal, because it waits for them to press Enter and reads their clipboard:

```bash
node ~/store.mjs --generate --expiration 7
# add --ensure-loaded if their shell doesn't load the secrets file yet
# narrower: --scopes repo,workflow,read:org,write:packages
```

What they'll see:

1. It prints the GitHub account `gh` is signed in as. It checks the stored `gh` login first,
   because the `GITHUB_TOKEN` exported by the secrets file may be the old token being replaced.
2. The browser opens on GitHub's new-token page with all 48 default scopes (or `--scopes`)
   and a dated note prefilled.
3. They set **Expiration** to 7 days, click **Generate token**, click the copy icon, then
   press Enter in the terminal.
4. The token is read from the clipboard, and the clipboard is cleared. The token is never
   shown. If no clipboard tool works, as over SSH or on a headless Linux box, they paste
   it at a hidden prompt instead.
5. The token is verified. It is **refused if it belongs to a different account** than `gh`,
   for example when the browser was signed in to another account, or if it lives longer
   than `--max-days` (30).
6. `GITHUB_TOKEN` is added or replaced, and `GITHUB_PERSONAL_ACCESS_TOKEN` is pointed at
   it. The old file is backed up, and they're told if the replaced token is still active.

The two-step alternative still works: `node ~/generator.mjs --type classic --name terminal
--scopes default --expiration 7 --yes`, then `node ~/store.mjs --from terminal --yes`. Use it
when they also want a `~/terminal.ght` copy.

## 4. Confirm (you can run this)

```bash
node ~/audit.mjs --no-remote --json
```

The `"secretsFile": true` entry should be `VALID`, with the expected `login` and an
`expiresAt` about 7 days out.

## 5. Finish

- New terminals pick up the token. For the current one, have the user run
  `. ~/.secrets.env` (or `source ~/.secrets.csh`, or `. ~\.secrets.ps1` in PowerShell).
- **Your own session still has the old token in its environment.** If the old token gets
  revoked, `gh` commands you run will fail until the user restarts this agent session.
  Say this before they revoke it.
- If they used the two-step path, the token also remains in `~/terminal.ght`. Offer to
  delete that copy (`rm ~/terminal.ght`, after confirming) so there is only one.
- Suggest repeating this before expiry. An audit shows `EXPIRING_SOON` 7 days ahead.
