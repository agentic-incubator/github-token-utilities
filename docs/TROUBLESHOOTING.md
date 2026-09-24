# Troubleshooting

[README](../README.md) › [Documentation](../README.md#documentation) › Reference › Troubleshooting

Common symptoms and fixes. Every command also has `--help`.

| Symptom | Fix |
|---|---|
| `gh is not authenticated`, or `The token in GITHUB_TOKEN is invalid` | `unset GITHUB_TOKEN GH_TOKEN`, then `gh auth status`; sign in with `gh auth login` if needed[^gh-env] |
| `command not found: gen-gh-token` | Open a new terminal or `source ~/.zshrc` (or `~/.bashrc`) |
| Audit lists repos under "could not read secrets" | Listing secrets requires admin access to the repository[^secrets-api] |
| `GitHub reserves the GITHUB_ prefix` | Use a name like `GH_TOKEN`, and update the workflow to match[^secrets] |
| `Token check failed: invalid, revoked or expired` | Copy the token again; if it's lost, generate a new one. GitHub shows a token only once |
| Audit shows `NO_EXPIRATION` | Regenerate with an expiry and revoke the old token |
| API calls return 403 mentioning a PAT policy | Your organization restricts that token type or its lifetime; use the other type, or ask an admin[^org-pat-policy] |
| Browser doesn't open | Re-run with `--no-open` and open the printed URL |
| `store-gh-token`: "lives longer than --max-days" | Generate a token with a shorter expiration, or pass `--max-days N` / `--force` |
| New terminal still has the old `GITHUB_TOKEN` | Your startup file doesn't load the secrets file; re-run `store-gh-token` with `--ensure-loaded` |
| `revoke-gh-token`: "GitHub answered 403" | The revocation endpoint allows 60 unauthenticated requests an hour per IP; wait, or use `--web`[^revoke-api] |
| `revoke-gh-token`: "GitHub still accepts it" | Revocation is asynchronous; check again shortly with `audit-gh-tokens --no-remote` (local copies were kept) |
| Windows: the profile or secrets file doesn't load | PowerShell's execution policy blocks scripts by default on Windows;[^ps-scripts] run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |

[^gh-env]: GitHub CLI manual, *gh help environment*: `GH_TOKEN`, then `GITHUB_TOKEN`, take precedence over stored credentials. <https://cli.github.com/manual/gh_help_environment>
[^secrets-api]: GitHub Docs, *REST API endpoints for GitHub Actions secrets*: required access and the `repo` scope. <https://docs.github.com/en/rest/actions/secrets>
[^secrets]: GitHub Docs, *Secrets reference*: naming rules (letters, numbers, underscores; no leading digit; no `GITHUB_` prefix; case-insensitive) and that values are not readable. <https://docs.github.com/en/actions/reference/security/secrets>
[^org-pat-policy]: GitHub Docs, *Setting a personal access token policy for your organization*. <https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization>
[^revoke-api]: GitHub Docs, *REST API endpoints for revocation*: `POST /credentials/revoke` accepts `ghp_`/`github_pat_`/`gho_`/`ghu_`/`ghr_` tokens; authenticated requests return 403; 60 requests/hour; returns 202; owners are notified; revoked credentials can't be reactivated; intended for credentials the caller doesn't own. <https://docs.github.com/en/rest/credentials/revoke>
[^ps-scripts]: Microsoft Learn, *about_Scripts*: scripts use the `.ps1` extension, dot sourcing runs them in the current scope, and Windows' default execution policy blocks scripts. <https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_scripts>
