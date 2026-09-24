# Quick Start

About five minutes from nothing to your first audit. See the [README](README.md) for the full
reference and [docs/EVIDENCE.md](docs/EVIDENCE.md) for the sources behind each behavior.

## 1. Prerequisites

- [Node.js](https://nodejs.org/) 22 or later
- [git](https://git-scm.com/)
- [GitHub CLI](https://cli.github.com/), signed in:

  ```bash
  gh auth login
  gh auth status   # should say "Logged in to github.com"
  ```

> [!WARNING]
> If `gh auth status` reports that the token in `GITHUB_TOKEN` (or `GH_TOKEN`) is invalid,
> that environment variable is overriding your login. Run `unset GITHUB_TOKEN GH_TOKEN`
> and check again.

## 2. Install

```bash
git clone https://github.com/agentic-incubator/github-token-utilities.git ~/.local/share/github-token-utilities
node ~/.local/share/github-token-utilities/setup.mjs --dry-run   # preview
node ~/.local/share/github-token-utilities/setup.mjs             # apply
```

Open a new terminal so the aliases load. On Windows, run the same commands in PowerShell
using `"$env:LOCALAPPDATA\github-token-utilities"` as the folder.

> [!TIP]
> Prefer an AI agent to do this with you? Install the skill for your agent (step 6), then ask
> it to "set up the GitHub token utilities".

## 3. Audit what you have

```bash
audit-gh-tokens
```

You get two tables:
- **Repository secrets** that look like GitHub tokens, with when each was last set
  (🔴 `STALE` at 90+ days).
- **Local `~/*.ght` token files**, with validity and expiry.

Nothing is changed.

## 4. Generate a token

```bash
gen-gh-token --type fine-grained --name my-first-token --permissions contents=read --expiration 30
```

1. GitHub opens with the token details prefilled.
2. Pick the repositories it may access, then click **Generate token**.
3. Copy the token and paste it at the hidden prompt.

The token is checked with GitHub and saved to `~/my-first-token.ght` (readable only by you).

> [!IMPORTANT]
> GitHub shows a new token only once. If you lose it before pasting, generate another and
> delete the unused one at <https://github.com/settings/personal-access-tokens>.

## 5. Rotate a repository secret

```bash
rotate-gh-token OWNER/REPO GH_TOKEN --dry-run                 # see what would change
rotate-gh-token OWNER/REPO GH_TOKEN --existing my-first-token # replace the secret
```

> [!CAUTION]
> Rotating does not revoke the old token. Delete it on GitHub once the new one works.

## 6. Keep a short-lived token in your terminal (optional)

```bash
store-gh-token --generate --expiration 7 --ensure-loaded
```

This opens GitHub for the account `gh` is signed in as, with every classic scope prefilled.
Set the expiration, click **Generate token** and copy it, then press Enter. The token is read
from your clipboard and never shown. The command writes `GITHUB_TOKEN` (and `GITHUB_PERSONAL_ACCESS_TOKEN`, which references it) into
`~/.secrets.env`. fish, csh/tcsh and PowerShell users get their own format and file
automatically. Repeat before the token expires; `audit-gh-tokens --no-remote` warns a week
ahead.

## 7. Add the AI agent skill (optional)

From the clone:

```bash
cd ~/.local/share/github-token-utilities
npm run install:skills -- --host claude   # or codex, opencode, gemini, hermes, grok, all
```

Then ask your agent something like *"audit my GitHub tokens"* or *"rotate GH_TOKEN in
acme/api"*.

## Next steps

- `gen-gh-token --help`, `audit-gh-tokens --help`, `rotate-gh-token --help`, `store-gh-token --help`
- [README → Choosing permissions and scopes](README.md#generate-a-token)
- [README → Troubleshooting](README.md#troubleshooting)
