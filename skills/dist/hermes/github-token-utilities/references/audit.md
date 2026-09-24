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
```

Scanning hundreds of repos takes a minute or two; say so before starting. Repos where the
user lacks admin rights can't have their secrets listed — they appear in `remote.noAccess`.

## Read the JSON

- `remote.findings[]`: `repo`, `secretName`, `updatedAt`, `ageDays`, `status`
  (`STALE` ≥ stale-days, `AGING` ≥ ⅔ of it, `FRESH`).
- `local[]`: `file`, `valid`, `login`, `scopes`, `expiresAt`, `status`, and for the secrets
  file `secretsFile: true` plus `variable`
  (`EXPIRED`, `INVALID`, `EXPIRING_SOON` ≤7d, `NEARING_EXPIRATION` ≤30d, `VALID`,
  `NO_EXPIRATION`), `loosePermissions`, `mode`.

## Report to the user

Lead with what needs action, most urgent first, then a one-line all-clear for the rest:

1. Local tokens that are `INVALID`/`EXPIRED` — useless files; suggest deleting after they
   confirm nothing still reads them.
2. `EXPIRING_SOON` / `NEARING_EXPIRATION` tokens, and `STALE` secrets — suggest a rotation for
   each (offer to start `rotate` for the first one). For the secrets-file entry, offer the
   terminal-token workflow instead.
3. `NO_EXPIRATION` tokens — a standing risk; suggest regenerating with an expiry.
4. `loosePermissions` — offer to run `chmod 600 <file>` (confirm first).
5. Broad scopes on a local token (e.g. `delete_repo`, `admin:org`) — mention that a narrower
   token is safer; see `references/scopes.md`.

Show a compact table rather than raw JSON. Never include token values — the report doesn't
contain any, and you should not go looking for them.
