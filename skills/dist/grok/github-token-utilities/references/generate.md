# Generate

GitHub has no API for creating personal access tokens, so a person has to click
**Generate token** on github.com. The generator keeps that step short. It opens GitHub's
"new token" page with the details already filled in. It then takes the pasted token as hidden
input, verifies it against the GitHub API, and saves it to `~/<name>.ght` with permissions
`600`. It never prints the token.

## 1. Gather choices in conversation

Ask these together if your question tool allows several at once:

- **What is it for?** Use `references/scopes.md` to pick fine-grained vs classic and the narrowest
  permissions or scopes. Recommend a set and say why.
- **Name.** Use letters, numbers, `-` and `_`; fine-grained names are limited to 40
  characters. The name becomes the file name and the token's name on GitHub, so it should
  describe the use (`ci-release`, `acme-api-deploy`).
- **Expiration.** Default 30 days (see `references/scopes.md`).
- **Owner** (fine-grained only). If the token must work on an organization's repositories,
  get the org name.

If `~/<name>.ght` already exists, ask whether to pick a new name or overwrite. Overwriting
needs `--force`, and the old token stays live on GitHub until it is revoked.

## 2. Hand the user the command

Show the full command and ask them to run it in their own terminal.

Fine-grained:

```bash
node ~/generator.mjs --type fine-grained --name NAME --permissions contents=write,workflows=write --expiration 30 --yes
# add --owner ORG for an organization's repositories
```

Classic:

```bash
node ~/generator.mjs --type classic --name NAME --scopes repo,workflow --expiration 30 --yes
```

Tell them what will happen:

1. The browser opens on GitHub with the details prefilled.
2. They finish the page:
   - **Fine-grained:** choose the repositories under **Repository access**.
   - **Classic:** set **Expiration** to match; GitHub can't prefill it for classic tokens.
3. They click **Generate token** and copy it. GitHub shows it only once.
4. They paste it at the hidden `Paste the new token here` prompt.
5. The script shows which account the token belongs to and its expiry, then saves it.

Useful variations:

- **Browser won't open** (SSH session, headless box): add `--no-open` and open the printed
  URL on any machine signed in to GitHub.
- **Just the link:** you can safely run the same command with `--print-url` in place of
  `--yes`. It prints the URL and exits without handling any token.

## 3. Confirm it worked (you can run this)

```bash
node ~/audit.mjs --no-remote --json
```

Find the new file. `valid` should be `true`. For classic tokens, `scopes` should match what
was requested; if not, the user changed boxes on GitHub, so ask whether that was intended.
For fine-grained tokens `scopes` is `null` because GitHub doesn't report permissions this
way, and `status` may be `UNKNOWN` (see the note in the output). That's expected.

## 4. Explain how to use it

Show usage that keeps the token out of shell history:

```bash
export GITHUB_TOKEN="$(cat ~/NAME.ght)"                  # current shell session only
gh secret set GH_TOKEN --repo OWNER/REPO < ~/NAME.ght     # store it as a repo secret
```

Storing a token in a repo secret is exactly what `rotate` does, with verification. Offer it
if that's their goal.
