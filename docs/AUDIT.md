# Audit tokens

[README](../README.md) › [Documentation](../README.md#documentation) › Guides › Audit

`audit-gh-tokens` finds token-like Actions secrets across your repositories and checks the tokens stored on your machine. With `--all-secrets` it lists every secret instead, across your account and the organizations you own. It is read-only.

```bash
audit-gh-tokens                 # your repositories + local token files
audit-gh-tokens my-org          # an organization's repositories
audit-gh-tokens --no-remote     # local token files only
audit-gh-tokens --json          # machine-readable report
audit-gh-tokens --all-secrets   # every secret in your account and the orgs you own
```

**Repository secrets.** The audit lists every non-archived repository for the owner with
`gh repo list`[^gh-repo-list] and reads each repository's Actions secrets with
`gh secret list --json name,updatedAt`.[^gh-secret-list] It reports secrets whose names look
like GitHub tokens (`GH_TOKEN`, `GH_PAT`, `PAT`, `*_TOKEN` with a `GH_`/`GIT_` prefix, and so
on; extend the match with `--match <regex>`). Each one is marked `STALE` (last set ≥ 90 days
ago, adjustable with `--stale-days`), `AGING` or `FRESH`.

**All secrets.** By default the audit is about GitHub tokens: it scans one owner and keeps
only token-like repository Actions secrets. `--all-secrets` makes it an inventory of every
secret instead:

- no name filter (token-like names are still flagged, as `tokenLike` / 🔑);
- for each repository, its Actions, Agents, Dependabot and Codespaces secrets
  (`gh secret list --app`) and the secrets of each deployment environment
  (`gh secret list --env`);[^gh-secret-list]
- for each organization, its organization-level secrets (`gh secret list --org`), and your
  own Codespaces user secrets (`gh secret list --user`);
- without an owner argument, your account **and every organization you own** (your role
  is `admin`, shown as *Owner* on GitHub[^org-memberships]); with one, just that owner.

Organizations where you are only a member are skipped and named in the report. Only
organization owners can list organization secrets, and a member usually lacks the admin
access to a repository that listing its secrets needs,[^secrets-api] so scanning them
would mostly produce errors. To scan one anyway, pass it as the owner:
`audit-gh-tokens that-org --all-secrets`.

**Token scopes.** Two listings need scopes that `gh auth login` doesn't request by default:
organization secrets need `admin:org`,[^org-secrets] and your Codespaces secrets need
`codespace`.[^codespaces-secrets] Before scanning, the audit reads your `gh` token's scopes
from the `X-OAuth-Scopes` header[^oauth-scopes] and skips any listing the token can't
perform, instead of letting it fail. The report names what was skipped and how to include it:

```text
ℹ️  Not scanned — your gh token lacks these scopes: organization secrets (admin:org), Codespaces user secrets (codespace)
   To include them: gh auth refresh -h github.com -s admin:org,codespace
```

`admin:org` grants full control of your organizations, not just read access to their secrets.
Consider removing it after the audit with `gh auth refresh -h github.com -r admin:org`.
Fine-grained tokens don't report scopes, so with one of those every listing is attempted.

This makes several API calls per repository, so it is slower and uses more of your rate
limit. A listing that still fails (for example a fine-grained token without the right
permission) is reported as incomplete rather than silently dropped. A 404 (for example Codespaces not enabled for an organization, or a repository
without environments) means there is nothing to list and is not reported.

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
[^org-secrets]: GitHub Docs, *REST API endpoints for GitHub Actions secrets*, "List organization secrets": classic tokens and OAuth app tokens need the `admin:org` scope. <https://docs.github.com/en/rest/actions/secrets#list-organization-secrets>
[^codespaces-secrets]: GitHub Docs, *REST API endpoints for Codespaces user secrets*, "List secrets for the authenticated user": classic tokens and OAuth app tokens need the `codespace` or `codespace:secrets` scope. <https://docs.github.com/en/rest/codespaces/secrets#list-secrets-for-the-authenticated-user>
[^org-memberships]: GitHub Docs, *REST API endpoints for organization members*: "List organization memberships for the authenticated user" returns each membership's `role` (`admin` or `member`) and `state`. <https://docs.github.com/en/rest/orgs/members#list-organization-memberships-for-the-authenticated-user>
[^secrets]: GitHub Docs, *Secrets reference*: naming rules (letters, numbers, underscores; no leading digit; no `GITHUB_` prefix; case-insensitive) and that values are not readable. <https://docs.github.com/en/actions/reference/security/secrets>
[^secrets-api]: GitHub Docs, *REST API endpoints for GitHub Actions secrets*: required access and the `repo` scope. <https://docs.github.com/en/rest/actions/secrets>
[^oauth-scopes]: GitHub Docs, *Scopes for OAuth apps*: scope names and the `X-OAuth-Scopes` response header. <https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps>
[^expiry-header]: GitHub Changelog, 2021-07-26, *Expiration options for personal access tokens*: introduces the `GitHub-Authentication-Token-Expiration` header. <https://github.blog/changelog/2021-07-26-expiration-options-for-personal-access-tokens/>
[^go-github-3708]: google/go-github issue #3708: fine-grained PATs return the current server time in the expiration header. <https://github.com/google/go-github/issues/3708>
