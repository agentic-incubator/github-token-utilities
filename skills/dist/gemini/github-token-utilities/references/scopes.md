# Choosing a token type and permissions

Grant the least access that works: a leaked token can do everything it's allowed to, on
every repository it can reach.

## Fine-grained or classic?

GitHub recommends **fine-grained** tokens whenever they can do the job. They are limited to
the repositories the user picks and to individual permissions, and orgs can require approval
for them. Choose **classic** only when fine-grained can't do the job:

- the token must work across many repos or orgs the user doesn't want to enumerate;
- GitHub Packages (npm, Maven, NuGet, RubyGems, GHCR). These registries authenticate with
  classic tokens;
- an organization blocks fine-grained tokens, or an API the user needs doesn't support them.

If unsure, suggest fine-grained and explain the one extra step: on GitHub's page they choose
which repositories the token can access. That choice can't be prefilled.

## Fine-grained: common jobs → `--permissions`

| The token needs to… | `--permissions` |
|---|---|
| Read code | `contents=read` |
| Push commits / create releases | `contents=write` |
| Push branches and open PRs | `contents=write,pull_requests=write` |
| Change files under `.github/workflows/` | `contents=write,workflows=write` |
| Comment on or triage issues | `issues=write` |
| Trigger or cancel workflow runs | `actions=write` |
| Manage the repo's Actions secrets | `secrets=write` |
| Read org membership | `members=read` |

`metadata=read` is always included by GitHub. Levels are `read`, `write` and `admin`. The
generator rejects permission names that GitHub's prefill link doesn't support. Pass
`--owner ORG` when the token must act on an organization's repositories. The organization may
then need to approve it before it works.

## Classic: common jobs → `--scopes`

| The token needs to… | `--scopes` |
|---|---|
| Read/write code, issues and PRs in private repos; most API use from Actions | `repo` |
| Same, public repos only | `public_repo` |
| Push changes to `.github/workflows/*` | `repo,workflow` |
| Read org/team membership | `repo,read:org` |
| Pull packages | `read:packages` |
| Publish packages / push to GHCR | `write:packages` (add `repo` for packages linked to private repos) |
| Create gists | `gist` |

Avoid these unless the user explicitly needs them and understands them: `delete_repo`,
`admin:org`, `admin:enterprise`, `admin:repo_hook`, `admin:org_hook`, `admin:public_key`,
`admin:gpg_key`, `admin:ssh_signing_key`, `user`, `audit_log`, `delete:packages`. The generator
warns when any of these are selected. Its `default` set includes all 51 scopes, which is
almost never right; steer users away from it.

## Expiration

30 days is a good default, and 7 days suits one-off work. Fine-grained tokens can last at
most 366 days, and orgs may set a shorter maximum. Tokens without an expiry are flagged by
every audit.
