# Audit

Audit is read-only and safe to run without confirmation. It does two things:

- **Repository secrets** — lists every non-archived repo for an owner, finds Actions secrets
  whose names look like GitHub tokens (`GH_TOKEN`, `GH_PAT`, `PAT`, `*_TOKEN` with a GH/GIT
  prefix, …) and reports when each was last set. GitHub never reveals secret values, so the
  real expiry of a token inside a secret can't be known; "last set" is the honest signal.
- **Local tokens** — for each `~/*.ght`, and for the token in the user's shell secrets file
  (`~/.secrets.env`, `~/.secrets.csh`, fish `conf.d/secrets.fish` or `~\.secrets.ps1`; see
  `references/terminal.md`), asks GitHub (with that token) who it belongs to, its scopes and
  its expiry, and flags files readable by other users.

## Run it

Ask whose repos to scan only if it's ambiguous (their own account is the default; an org
name works too). Then run with `--json` so you can reason over the result:

```bash
node ~/audit.mjs --json                 # your own repos + local tokens
node ~/audit.mjs my-org --json          # an organization's repos
node ~/audit.mjs --json --no-remote     # local token files only (fast)
node ~/audit.mjs --json --stale-days 60 # stricter staleness threshold
node ~/audit.mjs --json --no-local      # repository secrets only
node ~/audit.mjs --json --match '^DEPLOY_KEY$|_BOT_TOKEN$'  # also treat these secret names as tokens
node ~/audit.mjs my-org --json --limit 200                  # cap the number of repos scanned
node ~/audit.mjs --json --all-secrets --no-local            # every secret, all your orgs
```

**All secrets.** When the user wants an inventory of *every* secret rather than just GitHub
tokens (or asks why fewer secrets came back than expected), use `--all-secrets`. It drops
the name filter and lists, for each non-archived repo, its Actions, Agents, Dependabot and
Codespaces secrets plus each deployment environment's secrets; for each org, the org-level
secrets; and the user's Codespaces secrets. With no owner it scans the user's account **and
every org they own** (org role `admin`); orgs where they are only a member are skipped and
listed in `remote.skippedOrgs` (to include one, pass it as the owner). The default mode
scans one owner only. It makes several `gh`
calls per repo, so warn that it is slower and uses more API rate limit.

The built-in name pattern catches the usual GitHub token names. If the user's workflows use
their own names (for example `RELEASE_BOT`), add them with `--match <regex>`. For the shell
secrets file, `--secrets-file PATH` and `--format sh|fish|csh|powershell` point at a
non-default file.

Scanning hundreds of repos takes a minute or two; say so before starting. Repos where the
user lacks admin rights can't have their secrets listed — they appear in `remote.noAccess`.

## Read the JSON

- `remote.findings[]`: `repo`, `secretName`, `updatedAt`, `ageDays`, `status`
  (`STALE` ≥ stale-days, `AGING` ≥ ⅔ of it, `FRESH`).
- With `--all-secrets`, `remote` also has `mode: "all-secrets"`, `owners[]`, `skippedOrgs[]`,
  `tokenScopes` (the gh token's classic scopes, or `null` for a fine-grained token),
  `skippedScopes[]` (`listing`, `scope`: listings deliberately not attempted because the
  token lacks the scope — `admin:org` for organization secrets, `codespace` for Codespaces
  user secrets) and `incomplete[]` (`target`, `error`: listings that were attempted and
  failed), and each finding adds `scope` (`repository`, `environment`, `organization`,
  `user`), `owner`, `environment`, `app` (`actions`, `agents`, `dependabot`, `codespaces`),
  `tokenLike` and, for org secrets, `visibility`. `repo` is `null` for org/user secrets.
- `local[]`: `file`, `valid`, `login`, `scopes`, `expiresAt`, `status`, and for the secrets
  file `secretsFile: true` plus `variable`
  (`EXPIRED`, `INVALID`, `EXPIRING_SOON` ≤7d, `NEARING_EXPIRATION` ≤30d, `VALID`,
  `NO_EXPIRATION`), `loosePermissions`, `mode`.

## Report to the user

Lead with what needs action, most urgent first, then a one-line all-clear for the rest:

1. Local tokens that are `INVALID`/`EXPIRED` — useless files; suggest deleting after they
   confirm nothing still reads them (`node ~/revoke.mjs --from NAME` does this safely: it
   skips the API for a dead token and only removes the file).
2. `EXPIRING_SOON` / `NEARING_EXPIRATION` tokens, and `STALE` secrets — suggest a rotation for
   each (offer to start `rotate` for the first one). For the secrets-file entry, offer the
   terminal-token workflow instead.
3. `NO_EXPIRATION` tokens — a standing risk; suggest regenerating with an expiry.
4. `loosePermissions` — offer to run `chmod 600 <file>` (confirm first).
5. Broad scopes on a local token (e.g. `delete_repo`, `admin:org`) — mention that a narrower
   token is safer; see `references/scopes.md`.

For an `--all-secrets` run, group the table by owner/repo, call out `tokenLike` and `STALE`
secrets first, and mention `skippedOrgs`, `skippedScopes`, `noAccess` and `incomplete` so the
user knows what wasn't seen. For `skippedScopes`, offer
`gh auth refresh -h github.com -s admin:org,codespace` (only the scopes listed), and point
out that `admin:org` is full org control, removable afterwards with
`gh auth refresh -h github.com -r admin:org`. Don't run it for them: it opens a browser. Only
token-like repository Actions secrets can be rotated with `rotate`.

Show a compact table rather than raw JSON. Never include token values — the report doesn't
contain any, and you should not go looking for them.
