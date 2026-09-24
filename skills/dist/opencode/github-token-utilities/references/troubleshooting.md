# Troubleshooting

Match the symptom, explain the cause in one sentence, then offer the fix.

| Symptom | Cause | Fix |
|---|---|---|
| `gh auth status` says "The token in GITHUB_TOKEN is invalid" (or `GH_TOKEN`) | An environment variable overrides the `gh` login, and its token is expired or revoked | `unset GITHUB_TOKEN` (and/or `GH_TOKEN`) for this session; then find and fix where it's exported (shell config, `.env`, direnv) |
| `gh is not authenticated` from audit | No `gh` login | User runs `gh auth login` in their own terminal |
| `node ~/audit.mjs: No such file` | Toolkit not set up (or set up under another user) | Run setup (`references/setup.md`) |
| `command not found: gen-gh-token` in the user's terminal | Shell config not reloaded after setup | Open a new terminal, or `source ~/.zshrc` / `~/.bashrc` |
| Audit lists repos under `noAccess` | Listing secrets needs admin access to the repo | Expected for repos they don't administer; skip or ask an admin |
| Rotate: "Cannot access repository secrets" | Wrong `owner/repo`, no admin rights, or `gh` login lacks `repo` scope | Check the name with `gh repo view OWNER/REPO`; check `gh auth status` scopes; `gh auth refresh -s repo` |
| Rotate: "GitHub reserves the GITHUB_ prefix" | Actions secret names can't start with `GITHUB_` | Use `GH_TOKEN` (and update the workflow to reference it) |
| Generator: "Token check failed: invalid, revoked or expired" | Wrong/partial paste, or the token was deleted | Re-copy it from GitHub (it's only shown once — if lost, generate a new one) |
| Generator: "doesn't look like a personal access token" | Pasted something other than a `ghp_…`/`github_pat_…` value | Re-copy the token itself |
| Generator: file already exists | `~/NAME.ght` present | Choose another name, or add `--force` (old token stays live on GitHub until revoked) |
| Audit shows `NO_EXPIRATION` | Token created without an expiry | Regenerate with an expiration and revoke the old one |
| Audit shows `loosePermissions` | File readable by other users | `chmod 600 ~/NAME.ght` (confirm first) |
| API calls return 403 mentioning a PAT policy | The organization restricts that token type or its lifetime | Try the other token type (see `references/scopes.md`), a shorter expiration, or ask an org admin; fine-grained tokens may need org approval |
| Browser doesn't open | Headless/SSH session, or no default browser | Re-run with `--no-open` and open the printed URL manually |
| store: "lives longer than --max-days" | The token's expiry is further out than allowed (default 30 days) or it never expires | Generate one with a shorter expiration; `--max-days N` or `--force` only if the user explicitly wants that |
| store: "PowerShell only dot-sources files ending in .ps1" | `--file` points at a non-`.ps1` file with `--format powershell` | Use a `.ps1` path |
| New terminals still have the old `GITHUB_TOKEN` | The shell startup file doesn't load the secrets file | Re-run store with `--ensure-loaded` (the dry run shows which startup file it edits) |
| Windows: profile/secrets file doesn't run | PowerShell execution policy blocks scripts | User runs `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| revoke: "GitHub answered 403" | The unauthenticated revocation endpoint allows 60 requests/hour per IP | Wait and retry, or `--web` to delete it on GitHub's settings page |
| revoke: "GitHub still accepts it" | Revocation is asynchronous and hasn't finished | Re-run `node ~/audit.mjs --no-remote` in a minute; local copies were kept |
| revoke: "logs gh out" | The token is `gh`'s own login token | Use `--force` only if the user wants to sign `gh` out; they'll need `gh auth login` |
| Windows: `test`/`printenv` not found | Pre-flight commands are POSIX | Use PowerShell equivalents: `Test-Path ~/audit.mjs`, `if ($env:GITHUB_TOKEN) { 'GITHUB_TOKEN is set' }` |

If none match, show the user the exact error line (never any token value) and read the
relevant script's `--help`.
