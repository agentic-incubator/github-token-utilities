# Audit tokens

[README](../README.md) › [Documentation](../README.md#documentation) › Guides › Audit

`audit-gh-tokens` finds token-like Actions secrets across your repositories and checks the tokens stored on your machine. It is read-only.

```bash
audit-gh-tokens                 # your repositories + local token files
audit-gh-tokens my-org          # an organization's repositories
audit-gh-tokens --no-remote     # local token files only
audit-gh-tokens --json          # machine-readable report
```

**Repository secrets.** The audit lists every non-archived repository for the owner with
`gh repo list`[^gh-repo-list] and reads each repository's Actions secrets with
`gh secret list --json name,updatedAt`.[^gh-secret-list] It reports secrets whose names look
like GitHub tokens (`GH_TOKEN`, `GH_PAT`, `PAT`, `*_TOKEN` with a `GH_`/`GIT_` prefix, and so
on; extend the match with `--match <regex>`). Each one is marked `STALE` (last set ≥ 90 days
ago, adjustable with `--stale-days`), `AGING` or `FRESH`.

> [!NOTE]
> GitHub never reveals the value of an Actions secret,[^secrets] so no tool can read the
> expiry of the token stored inside one. "Last set" is the most reliable signal
> available, and a secret that hasn't been set in months is due for rotation either way.
> Listing a repository's secrets requires admin access to it;[^secrets-api] repositories you
> can't read are listed separately.

**Local tokens.** For each `~/*.ght` file, and for the token in your shell secrets file (see
[Store a terminal token](STORE.md); override with `--secrets-file`/`--format`),
the audit calls `GET /user` with that token and reads:

- the `X-OAuth-Scopes` response header for classic scopes;[^oauth-scopes]
- the `GitHub-Authentication-Token-Expiration` response header for the expiry.[^expiry-header]

Each token is marked `VALID`, `NEARING_EXPIRATION` (≤ 30 days), `EXPIRING_SOON` (≤ 7 days),
`EXPIRED`, `INVALID` or `NO_EXPIRATION`. Files readable by other users are flagged.

> [!WARNING]
> For fine-grained tokens, GitHub has been reported to return the *current time* in the
> expiration header instead of the real expiry.[^go-github-3708] When that happens the audit
> shows `UNKNOWN` rather than a wrong date. Check those tokens under
> **Settings → Developer settings → Personal access tokens**.

[^gh-repo-list]: GitHub CLI manual, *gh repo list*: `[<owner>]`, `--no-archived`, `--limit`. <https://cli.github.com/manual/gh_repo_list>
[^gh-secret-list]: GitHub CLI manual, *gh secret list*: JSON fields include `name` and `updatedAt`. <https://cli.github.com/manual/gh_secret_list>
[^secrets]: GitHub Docs, *Secrets reference*: naming rules (letters, numbers, underscores; no leading digit; no `GITHUB_` prefix; case-insensitive) and that values are not readable. <https://docs.github.com/en/actions/reference/security/secrets>
[^secrets-api]: GitHub Docs, *REST API endpoints for GitHub Actions secrets*: required access and the `repo` scope. <https://docs.github.com/en/rest/actions/secrets>
[^oauth-scopes]: GitHub Docs, *Scopes for OAuth apps*: scope names and the `X-OAuth-Scopes` response header. <https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps>
[^expiry-header]: GitHub Changelog, 2021-07-26, *Expiration options for personal access tokens*: introduces the `GitHub-Authentication-Token-Expiration` header. <https://github.blog/changelog/2021-07-26-expiration-options-for-personal-access-tokens/>
[^go-github-3708]: google/go-github issue #3708: fine-grained PATs return the current server time in the expiration header. <https://github.com/google/go-github/issues/3708>
