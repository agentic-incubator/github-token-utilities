# Generate a token

[README](../README.md) › [Documentation](../README.md#documentation) › Guides › Generate

`gen-gh-token` creates a fine-grained or classic personal access token through GitHub's prefilled "new token" page, verifies it, and saves it to `~/<name>.ght`.

```bash
# Fine-grained (recommended): limited to repositories you choose on GitHub's page
gen-gh-token --type fine-grained --name acme-deploy \
  --permissions contents=write,workflows=write --owner acme --expiration 30

# Classic: coarse scopes; needed for GitHub Packages and some other cases
gen-gh-token --type classic --name ci-packages --scopes read:packages --expiration 30
```

What happens:

1. Your browser opens on GitHub's new-token page, prefilled with your choices.[^pat-docs][^pat-template]
2. You finish the page. For **fine-grained** tokens, choose the repositories under
   **Repository access**. For **classic** tokens, set **Expiration**, because GitHub doesn't
   prefill it.
3. You click **Generate token**, copy it, and paste it at the hidden prompt.
4. The tool checks the token against the GitHub API, shows the account, scopes and expiry,
   and saves it to `~/<name>.ght` with permissions `600`.

| Option | Applies to | Description |
|---|---|---|
| `--type fine-grained\|classic` | both | Token type (asked if omitted) |
| `--name <name>` | both | Letters, numbers, `-`, `_`. Fine-grained names are limited to 40 characters[^pat-docs] |
| `--expiration <days>` | both | Fine-grained: 1–366, prefilled on GitHub.[^pat-docs] Classic: you set it on the page |
| `--permissions <list>` | fine-grained | `name=read\|write\|admin`, comma-separated. Names are checked against GitHub's documented list[^pat-docs] |
| `--owner <user\|org>` | fine-grained | Resource owner (`target_name`); default is you |
| `--scopes <list>` | classic | Comma-separated scopes,[^oauth-scopes] or `default` (all 48 in the default set) or `none` |
| `--yes` | both | Skip the confirmation |
| `--force` | both | Overwrite an existing `~/<name>.ght` |
| `--no-open` | both | Print the URL instead of opening a browser (SSH/headless) |
| `--print-url` | both | Print the prefilled URL and exit; no token is handled |
| `--token-stdin` | both | Read the token from stdin; requires `--type`, `--name`, `--expiration` and `--yes` |

> [!CAUTION]
> The classic `default` set grants all 48 scopes it lists, including `delete_repo`, `admin:org` and
> `admin:enterprise`. A leaked token with those scopes can delete repositories and
> reconfigure organizations. GitHub recommends fine-grained tokens whenever they can do the
> job.[^pat-docs] Where you need classic, request only the scopes the task requires. The
> generator warns when high-risk scopes are selected.

> [!NOTE]
> The classic prefill link (`/settings/tokens/new?scopes=…&description=…`) is a long-standing
> but **undocumented** GitHub feature. GitHub's own changelog calls it a "hidden feature".[^template-changelog]
> The fine-grained template link is documented.[^pat-docs] If GitHub ever drops the classic
> parameters, the page opens empty and you fill it in by hand; the rest of the flow still works.

<details>
<summary>Choosing permissions and scopes</summary>

| The token needs to… | Fine-grained `--permissions` | Classic `--scopes` |
|---|---|---|
| Read code | `contents=read` | `repo` (private) / `public_repo` |
| Push commits, create releases | `contents=write` | `repo` |
| Push branches and open PRs | `contents=write,pull_requests=write` | `repo` |
| Edit `.github/workflows/*` | `contents=write,workflows=write` | `repo,workflow`[^workflow-scope] |
| Manage repo Actions secrets | `secrets=write` | `repo`[^secrets-api] |
| Read org membership | `members=read` | `read:org` |
| Pull / publish packages | — (not supported)[^packages] | `read:packages` / `write:packages` |

The full list of fine-grained permission names comes from GitHub's template-URL
documentation.[^pat-docs] Classic scopes are described in GitHub's scopes reference.[^oauth-scopes]

</details>

[^pat-docs]: GitHub Docs, *Managing your personal access tokens*: creation via the web UI; fine-grained template-URL parameters (`name` ≤ 40, `description`, `target_name`, `expires_in` 1–366, permission names); recommendation to prefer fine-grained tokens. <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens>
[^pat-template]: GitHub Changelog, 2025-08-26, *Template URLs for fine-grained PATs and updated permissions UI*. <https://github.blog/changelog/2025-08-26-template-urls-for-fine-grained-pats-and-updated-permissions-ui/>
[^oauth-scopes]: GitHub Docs, *Scopes for OAuth apps*: scope names and the `X-OAuth-Scopes` response header. <https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps>
[^template-changelog]: The same changelog entry describes deep-linking to classic PAT creation as "a hidden feature for PAT (Classic)". <https://github.blog/changelog/2025-08-26-template-urls-for-fine-grained-pats-and-updated-permissions-ui/>
[^workflow-scope]: The `workflow` scope is required to add or update workflow files; see *Scopes for OAuth apps*. <https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps>
[^secrets-api]: GitHub Docs, *REST API endpoints for GitHub Actions secrets*: required access and the `repo` scope. <https://docs.github.com/en/rest/actions/secrets>
[^packages]: GitHub Docs, *About permissions for GitHub Packages*: "GitHub Packages only supports authentication using a personal access token (classic)." <https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages>
