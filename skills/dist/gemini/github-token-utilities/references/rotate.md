# Rotate

Rotation replaces the value of one repository Actions secret with a fresh token. The
script passes the token to `gh secret set` on stdin, so it never appears in a command line.

## 1. Identify the target

You need `owner/repo` and the secret name. If the user doesn't know, run an audit
(`node ~/audit.mjs --json`) and let them pick from the stale/aging findings.

Secret names can't start with `GITHUB_` (GitHub reserves it); `GH_TOKEN` is the usual choice.

## 2. Preview (no confirmation needed — it changes nothing)

```bash
node ~/rotate.mjs OWNER/REPO SECRET_NAME --dry-run
```

This checks repo access and reports whether the secret exists and when it was last set.
If it fails with an access error, the user needs admin rights on that repo — see
`references/troubleshooting.md`.

## 3. Decide the new token's shape

Ask (in one question if you can):

- **What does the workflow use this token for?** Recommend a token type and the narrowest
  permissions from `references/scopes.md`. A fine-grained token limited to this one repository is usually
  the right answer for a single repo's secret. If they don't know, look at how the secret is used:
  `gh search code "secrets.SECRET_NAME" --repo OWNER/REPO` or read the workflow files in
  `.github/workflows/` if the repo is checked out locally.
- **Expiration** — 30 or 90 days are good defaults; shorter is safer.

## 4. Create the new token — the user runs this

Build the complete command and ask the user to run it in their own terminal. Use a
descriptive token name (at most 40 characters for fine-grained tokens) so the file is
recognisable later:

```bash
node ~/generator.mjs --type fine-grained --name rotate-REPO-SECRET --permissions contents=write --expiration 30 --yes
# or: --type classic --scopes repo,workflow
```

Explain what they'll see, as in `references/generate.md` step 2. For a fine-grained token, remind them to
select `OWNER/REPO` under **Repository access**.

Wait for them to say it's done. Confirm the file exists and is valid without reading it:

```bash
node ~/audit.mjs --no-remote --json
```

Look for the new file with `valid: true` (and, for classic tokens, the expected `scopes`).

## 5. Update the secret — confirm, then you run it

Tell the user exactly what will change ("replace `SECRET_NAME` in `OWNER/REPO` with the token
in `~/NAME.ght`"), get a yes, then:

```bash
node ~/rotate.mjs OWNER/REPO SECRET_NAME --existing NAME --yes
```

## 6. Verify and finish

- `gh secret list --repo OWNER/REPO --json name,updatedAt` — the secret's `updatedAt` should be
  just now.
- Offer to re-run a workflow that uses the secret to prove the token works (list with
  `gh workflow list --repo OWNER/REPO`; run only after they pick one and confirm).
- Remind them to **revoke the old token**. Rotation doesn't revoke it, and the old value stays
  live until they do. GitHub never reveals a secret's value, so the script can't find the old
  token by itself. If they still have it locally (`~/OLD.ght`), offer
  `node ~/revoke.mjs --from OLD` (`references/revoke.md`); otherwise point them to
  https://github.com/settings/tokens.
- The new token file can stay (useful for the next rotation audit) or be deleted
  (`rm ~/NAME.ght`) if they don't need a local copy — their choice, confirm before deleting.

## One-shot alternative

If the user prefers a single command in their terminal, `rotate.mjs` can generate and set in
one go (it prompts for confirmation and the token paste itself):

```bash
node ~/rotate.mjs OWNER/REPO SECRET_NAME --type fine-grained --permissions contents=write --expiration 30
```

Afterwards, still do step 6.
