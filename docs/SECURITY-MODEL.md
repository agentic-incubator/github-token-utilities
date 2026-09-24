# Security model

[README](../README.md) › [Documentation](../README.md#documentation) › Reference › Security model

How the tools keep token values out of shell history, terminals, files other people can read, and agent conversations.

| Concern | How it's handled |
|---|---|
| Token in shell history or `ps` output | Tokens are never passed as arguments. Secrets are written with `gh secret set` reading stdin;[^gh-secret-set] verification passes the token to `gh` in the `GH_TOKEN` environment variable.[^gh-env] |
| Token printed to the terminal | Paste input is hidden, and no script prints a token value. Tests assert both. |
| Token file readable by others | Token and secrets files are owner-only: mode `600` on macOS/Linux (re-applied on overwrite), an owner-only ACL on Windows.[^icacls] The audit flags looser permissions. |
| Code injection through the shell secrets file | Only `[A-Za-z0-9_]` values are written, and references use the shell's own variable syntax. The file is replaced atomically, with a backup. |
| Long-lived terminal tokens | `store-gh-token` refuses tokens that never expire or outlive `--max-days`. |
| Revoking the wrong token | `revoke-gh-token` shows the account and scopes, requires typing the account name, refuses `gh`'s own login token, and deletes local copies only after GitHub confirms the token is dead. |
| Replaced tokens staying active | `store-gh-token` reports whether the replaced token is still active, and `--revoke-previous` revokes it. |
| Broad tokens | Fine-grained tokens are the recommended default,[^pat-docs] and the generator warns on high-risk classic scopes. |
| Stale `GITHUB_TOKEN` hijacking `gh` | Token verification removes `GITHUB_TOKEN` from the child environment, and the skills check for the variable first. |
| Injection through repository or secret names | Inputs are validated against GitHub's naming rules,[^secrets] and `gh` is called with argument arrays, never through a shell. |

[^gh-secret-set]: GitHub CLI manual, *gh secret set*: `--body` "reads from standard input if not specified". <https://cli.github.com/manual/gh_secret_set>
[^gh-env]: GitHub CLI manual, *gh help environment*: `GH_TOKEN`, then `GITHUB_TOKEN`, take precedence over stored credentials. <https://cli.github.com/manual/gh_help_environment>
[^icacls]: Microsoft Learn, *icacls* (`/inheritance:r`, `/grant:r`). <https://learn.microsoft.com/windows-server/administration/windows-commands/icacls>
[^pat-docs]: GitHub Docs, *Managing your personal access tokens*: creation via the web UI; fine-grained template-URL parameters (`name` ≤ 40, `description`, `target_name`, `expires_in` 1–366, permission names); recommendation to prefer fine-grained tokens. <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens>
[^secrets]: GitHub Docs, *Secrets reference*: naming rules (letters, numbers, underscores; no leading digit; no `GITHUB_` prefix; case-insensitive) and that values are not readable. <https://docs.github.com/en/actions/reference/security/secrets>
