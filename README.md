# GitHub Token Utilities

[![CI](https://github.com/agentic-incubator/github-token-utilities/actions/workflows/ci.yml/badge.svg)](https://github.com/agentic-incubator/github-token-utilities/actions/workflows/ci.yml)
![version 3.1.0](https://img.shields.io/badge/version-3.1.0-blue)
![node >= 22](https://img.shields.io/badge/node-%E2%89%A5%2022-339933)
[![license MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Command-line tools and AI-agent skills for managing GitHub personal access tokens (PATs):
**generate** them with the narrowest access, **audit** where they are stored and whether they
are stale or expiring, **rotate** the ones kept in repository Actions secrets, and **store** a
short-lived token in the secrets file your shell loads at startup. Works on macOS, Linux and
Windows.

The same workflows are packaged as an [Agent Skill](https://agentskills.io/specification)
for **Claude Code, OpenAI Codex CLI, OpenCode, Gemini CLI, Hermes Agent and Grok Build**. The
skill can install the toolkit for you and then walk you through each action, asking for
confirmation before it changes anything.

> [!IMPORTANT]
> GitHub has no API for creating a personal access token.[^pat-docs] `gen-gh-token` therefore
> opens GitHub's own "new token" page with your choices prefilled. You click **Generate token**
> and paste the result, and the tool verifies and stores it. No tool, including this one,
> can mint a PAT without that browser step.

## Contents

- [What's included](#whats-included)
- [Requirements](#requirements)
- [Install](#install)
  - [From a release](#from-a-release)
  - [From source](#from-source)
- [Usage](#usage)
  - [Generate a token](#generate-a-token)
  - [Audit tokens](#audit-tokens)
  - [Rotate a repository secret](#rotate-a-repository-secret)
  - [Store a terminal token](#store-a-terminal-token)
- [Compatibility](#compatibility)
- [AI agent skills](#ai-agent-skills)
- [Security model](#security-model)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Evidence and references](#evidence-and-references)
- [License](#license)

## What's included

| Command (alias) | Script | Purpose |
|---|---|---|
| `gen-gh-token` | [`generator.mjs`](generator.mjs) | Create a fine-grained or classic PAT, verify it, and save it to `~/<name>.ght` (mode `600`) |
| `audit-gh-tokens` | [`audit.mjs`](audit.mjs) | Find token-like Actions secrets across your repos, and check local `~/*.ght` tokens and your shell secrets file for validity, expiry and file permissions |
| `rotate-gh-token` | [`rotate.mjs`](rotate.mjs) | Replace a repository Actions secret with a new token |
| `store-gh-token` | [`store.mjs`](store.mjs) | Write a token into your shell secrets file (`GITHUB_TOKEN` + `GITHUB_PERSONAL_ACCESS_TOKEN`), for bash/zsh/sh/ksh/dash, fish, csh/tcsh or PowerShell |
| — | [`setup.mjs`](setup.mjs) | Copy the scripts to your home directory and add the shell aliases |
| — | [`gh-token-lib.mjs`](gh-token-lib.mjs) | Shared helpers (validation, URL building, token verification) |
| — | [`skills/`](skills/) | The agent skill: one source, six generated host variants |

## Requirements

- **Node.js 22 or later** (the oldest Node line still supported[^node-releases])
- **git**, to clone the repository
- **GitHub CLI (`gh`)**, installed and signed in with `gh auth login`.[^gh-auth-login] All GitHub
  API calls go through `gh`.

> [!WARNING]
> If `GH_TOKEN` or `GITHUB_TOKEN` is set in your environment, `gh` uses it instead of your
> stored login.[^gh-env] An expired value makes every command fail with an authentication
> error even though `gh auth login` succeeded. Check with `gh auth status`, and `unset` the
> variable if it is stale.

## Install

### From a release

Every [release](https://github.com/agentic-incubator/github-token-utilities/releases) publishes:

| Asset | Use |
|---|---|
| `github-token-utilities-<version>.tgz` | `npm install -g` it to get `gen-gh-token`, `audit-gh-tokens`, `rotate-gh-token` and `store-gh-token` on your `PATH`. No npm registry is involved.[^npm-install] |
| `github-token-utilities-<version>.zip` | The same files as a plain archive |
| `github-token-utilities-skill-<host>-<version>.zip` | One per agent host. Unzip into that host's skills folder (see [AI agent skills](#ai-agent-skills)) |
| `SHA256SUMS` | Checksums for all of the above |

```bash
V=3.1.0
npm install -g "https://github.com/agentic-incubator/github-token-utilities/releases/download/v$V/github-token-utilities-$V.tgz"

# Optional: verify the download was built by this repository's release workflow
gh release download "v$V" -R agentic-incubator/github-token-utilities -p "*.tgz" -p SHA256SUMS
sha256sum -c --ignore-missing SHA256SUMS   # macOS: shasum -a 256 -c --ignore-missing SHA256SUMS
gh attestation verify "github-token-utilities-$V.tgz" -R agentic-incubator/github-token-utilities
```

Installing a skill from a release, for example for Claude Code:

```bash
gh release download "v$V" -R agentic-incubator/github-token-utilities -p "*-skill-claude-*.zip"
unzip -o "github-token-utilities-skill-claude-$V.zip" -d ~/.claude/skills/
```

> [!NOTE]
> An npm install puts the commands on your `PATH` directly, so you don't need `setup.mjs`.
> The agent skills expect the scripts in your home directory (`node ~/audit.mjs`), so if you
> use the skills, run `setup.mjs` from a clone (below) or let the skill do it.

### From source

```bash
git clone https://github.com/agentic-incubator/github-token-utilities.git ~/.local/share/github-token-utilities
cd ~/.local/share/github-token-utilities
node setup.mjs --dry-run   # preview: which files are copied, which shell config changes
node setup.mjs             # apply
```

Setup copies `generator.mjs`, `audit.mjs`, `rotate.mjs`, `store.mjs` and `gh-token-lib.mjs`
into your home directory. It then adds the `gen-gh-token`, `audit-gh-tokens`,
`rotate-gh-token` and `store-gh-token` aliases to the startup file of your shell, which it
detects from `$SHELL`:

| Shell | Startup file setup edits |
|---|---|
| zsh | `~/.zshrc` |
| bash | `~/.bash_profile` on macOS, `~/.bashrc` on Linux[^bash-startup] |
| ksh | `~/.kshrc`, else `~/.profile` |
| sh, dash, or anything else | `~/.profile` |
| fish | `~/.config/fish/conf.d/github-token-utilities.fish`[^fish-config] |
| tcsh / csh | `~/.tcshrc`, else `~/.cshrc`[^tcsh] |
| PowerShell (Windows) | the profile PowerShell reports for the current user[^ps-profiles] |

The line it writes differs only by shell family. Here is `store-gh-token` as an example:

| Shells | Line added |
|---|---|
| zsh, bash, ksh, sh, dash | `alias store-gh-token="node ~/store.mjs"` |
| fish, tcsh, csh | `alias store-gh-token 'node ~/store.mjs'` (no `=`) |
| PowerShell | `function store-gh-token { node $HOME/store.mjs @args }` |

Re-running setup is safe: it refreshes the scripts and skips aliases that already exist.

```powershell
# Windows (PowerShell)
git clone https://github.com/agentic-incubator/github-token-utilities.git "$env:LOCALAPPDATA\github-token-utilities"
node "$env:LOCALAPPDATA\github-token-utilities\setup.mjs" --dry-run
node "$env:LOCALAPPDATA\github-token-utilities\setup.mjs"
```

> [!NOTE]
> Open a new terminal, or `source` the file setup reports, before using the aliases.
> To update later, run `git pull` in the clone and then `node setup.mjs` again.

> [!TIP]
> You don't have to install by hand. With one of the [agent skills](#ai-agent-skills)
> installed, ask your agent to "set up the GitHub token utilities". It clones the repo, shows
> you the dry run, and applies it only after you confirm.

## Usage

Every script accepts `--help`. Any option you leave out is asked for interactively, so
running a command with no arguments starts a guided session.

### Generate a token

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

### Audit tokens

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
[Store a terminal token](#store-a-terminal-token); override with `--secrets-file`/`--format`),
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

### Rotate a repository secret

```bash
rotate-gh-token acme/api GH_TOKEN --dry-run                   # preview; changes nothing
rotate-gh-token acme/api GH_TOKEN --existing acme-api-deploy  # use a token you already generated
rotate-gh-token acme/api GH_TOKEN --type fine-grained --permissions contents=write --expiration 30
```

`rotate-gh-token` checks your access to the repository and shows whether the secret exists
and when it was last set. After you confirm, it either runs the generator or uses the token
in `~/<name>.ght` (`--existing`). It then writes the token to the secret with
`gh secret set`, passing the value on **standard input**.[^gh-secret-set]

> [!IMPORTANT]
> Rotation does **not** revoke the old token. It stays valid until you delete it at
> <https://github.com/settings/tokens>. GitHub has no API for revoking your own PAT;
> the credential-revocation endpoint is meant for tokens you *don't* own.[^revoke-api]

> [!NOTE]
> Actions secret names can contain only letters, numbers and underscores. They can't start
> with a number or with `GITHUB_`, and they're case-insensitive.[^secrets] The tool checks
> names before calling GitHub, so use `GH_TOKEN` rather than `GITHUB_TOKEN`.

### Store a terminal token

For a powerful token in your terminal that doesn't live long, run one command. It creates a
token for the account `gh` is signed in as and stores it in the secrets file your shell loads
at startup:

```bash
store-gh-token --generate --expiration 7
```

1. It shows the account `gh` is signed in as. It asks the stored `gh` login first, because the
   `GITHUB_TOKEN` your shell exports may be the old token being replaced.
2. It opens GitHub's new-token page with all 48 default classic scopes and a dated note
   prefilled. Narrow it with `--scopes repo,workflow,…`.
3. You set **Expiration** (GitHub can't prefill it for classic tokens), click **Generate
   token** and copy it, then press Enter.
4. It reads the token from the clipboard and clears the clipboard, so you never paste or see
   it.[^clipboard] Where no clipboard is available (SSH, headless Linux) it falls back to a
   hidden prompt; `--no-clipboard` forces that.
5. It verifies the token and **refuses it if it belongs to a different account** than `gh`
   (for example, a browser signed in elsewhere) or outlives `--max-days`.
6. It adds or replaces the variables as described below.

> [!IMPORTANT]
> "Current user" means the account `gh` is signed in as. GitHub has no API that creates a
> personal access token,[^pat-docs] so that one click on GitHub's page can't be skipped. Every
> other step is automated. The alternative, reusing `gh`'s own OAuth token, was rejected
> deliberately: it never expires on a schedule (it's only revoked after a year of
> non-use)[^token-expiry], and it is `gh`'s own login credential.

If you also want a copy in `~/<name>.ght`, use the two-step form:

```bash
gen-gh-token --type classic --name terminal --scopes default --expiration 7
store-gh-token --from terminal --dry-run   # preview: which lines change (values masked)
store-gh-token --from terminal             # apply
```

`store-gh-token` writes the value to `GITHUB_TOKEN` and makes `GITHUB_PERSONAL_ACCESS_TOKEN`
a **reference** to it, in your shell's syntax:

| Shell | Default file | Written as |
|---|---|---|
| bash, zsh, sh, ksh, dash, Git Bash | `~/.secrets.env` | `export GITHUB_TOKEN=…`[^bash-export]<br>`export GITHUB_PERSONAL_ACCESS_TOKEN="$GITHUB_TOKEN"` |
| fish | `~/.config/fish/conf.d/secrets.fish` | `set -gx GITHUB_TOKEN …`[^fish-set]<br>`set -gx GITHUB_PERSONAL_ACCESS_TOKEN $GITHUB_TOKEN` |
| csh, tcsh | `~/.secrets.csh` | `setenv GITHUB_TOKEN …`[^tcsh]<br>`setenv GITHUB_PERSONAL_ACCESS_TOKEN "${GITHUB_TOKEN}"` |
| PowerShell (Windows default) | `~\.secrets.ps1` | `$env:GITHUB_TOKEN = '…'`[^ps-env]<br>`$env:GITHUB_PERSONAL_ACCESS_TOKEN = $env:GITHUB_TOKEN` |

The format is detected from your OS and `$SHELL`; override with `--format sh|fish|csh|powershell`
and `--file PATH`. Rename the variables with `--key` and `--alias` (repeatable), or drop the
reference with `--no-alias`.

How it edits the file:

- **Missing file:** created with only these lines, readable by you alone.
- **Existing file:** every other line is kept byte-for-byte, including comments and line
  endings. Every existing assignment of the managed variables, duplicates included, is
  replaced by one block at the position of the first. The value always comes before the
  reference, so a file that had them the other way round is fixed.
- **Before writing:** the new token is verified with GitHub. It is **refused if it never
  expires or lives longer than `--max-days`** (default 30); `--force` overrides.
- **After writing:** the previous version is kept as `<file>.bak`. The token that was replaced
  is checked, and you're told if it is still active and should be revoked.
- `--ensure-loaded` adds a line to your shell startup file (or PowerShell profile) that loads
  the secrets file, if nothing loads it yet.

> [!IMPORTANT]
> The secrets file is **executed** by your shell at startup, so the tool writes a value only if
> it consists solely of letters, digits and `_`, as every GitHub token does. Anything else is
> rejected, to keep command substitution such as `$(…)` out of the file.

> [!NOTE]
> - The file is made readable only by you: mode `600` on macOS and Linux, and on Windows an
>   ACL granting only your account access (`icacls /inheritance:r /grant:r`).[^icacls]
> - PowerShell dot-sources only `.ps1` files,[^ps-scripts] so `--file` must end in `.ps1` there.
> - Already-open terminals keep the old value until they reload the file: `. ~/.secrets.env`,
>   `source ~/.secrets.csh`, or `. ~\.secrets.ps1`.

> [!TIP]
> `audit-gh-tokens --no-remote` also checks the token in your secrets file and flags it
> `EXPIRING_SOON` a week ahead, which is a good reminder to repeat these two commands.

## Compatibility

Version **3.1.0**. See [CHANGELOG.md](CHANGELOG.md) for what changed.

| Component | Supported | Verified with |
|---|---|---|
| Node.js | 22 and later[^node-releases] | 22 and 24 in CI; 26.4.0 locally |
| GitHub CLI (`gh`) | current releases | 2.101.0 |
| Operating systems | macOS, Linux, Windows | CI on `macos-latest`, `ubuntu-latest`, `windows-latest` |
| Shells (secrets file and aliases) | bash, zsh, sh, ksh, dash, fish, csh, tcsh, PowerShell | Each one loads a generated file in `tests/shells.test.mjs`: all of them in CI, and all except fish locally |
| Agent Skills spec | [agentskills.io](https://agentskills.io/specification) | reference validator `skills-ref` 0.1.1 (`agentskills` on PyPI) |
| Claude Code | skills | 2.1.281, full load test |
| OpenAI Codex CLI | skills | 0.156.1, full load test |
| OpenCode | skills | 1.18.32, skill discovery only |
| Gemini CLI | skills | 0.60.0, skill discovery only |
| Hermes Agent | skills | checked against the spec and its source code only |
| Grok Build | skills | checked against the spec and its source code only |

The GitHub Actions used in CI are pinned to commit SHAs: `actions/checkout` v7.0.1,
`actions/setup-node` v7.0.0, `astral-sh/setup-uv` v10.2.0.
[Dependabot](.github/dependabot.yml) checks them (and npm) every week and opens grouped
update PRs that bump each SHA and its version comment together.[^dependabot]

## AI agent skills

The `skills/` directory holds an [Agent Skills](https://agentskills.io/specification)
package.[^agentskills-spec] The skill checks prerequisites, installs or updates the toolkit on
request, and guides you through audit, rotate and generate. It explains each step and asks
before anything that changes your machine or your repositories.

One source (`skills/core/`) is rendered into a variant per host (`skills/dist/<host>/`). The
variants differ only where the hosts differ: where the skill is installed, which tool the
agent uses to ask you questions and to run commands, and a few frontmatter fields.

| Host | Installs to (user-wide) | Asks you with | Runs commands with | Invoke |
|---|---|---|---|---|
| Claude Code | `~/.claude/skills/`[^claude-skills] | `AskUserQuestion` | `Bash` | `/github-token-utilities` |
| OpenAI Codex CLI | `~/.agents/skills/`[^codex-skills] | plain text (see note) | `exec_command` | `$github-token-utilities` |
| OpenCode | `~/.config/opencode/skills/`[^opencode-skills] | `question`[^opencode-tools] | `bash` | ask for it by name |
| Gemini CLI | `~/.gemini/skills/`[^gemini-skills] | `ask_user`[^gemini-ask] | `run_shell_command`[^gemini-shell] | ask for it by name |
| Hermes Agent | `~/.hermes/skills/`[^hermes-skills] | `clarify`[^hermes-tools] | `terminal` | `/github-token-utilities` |
| Grok Build | `~/.grok/skills/`[^grok-skills] | `ask_user_question`[^grok-config] | `bash` | `/github-token-utilities` |

Install one or more variants from a clone of this repository:

```bash
npm run install:skills -- --host claude                   # one host, user-wide
npm run install:skills -- --host claude,gemini,opencode   # several
npm run install:skills -- --host all --project ~/code/app # into a project instead
npm run install:skills -- --host codex --dry-run          # preview
npm run install:skills -- --host claude --uninstall       # remove
```

Then ask your agent, for example, *"audit my GitHub tokens"*, *"rotate GH_TOKEN in
acme/api"* or *"make me a token that can push to acme/web"*.

> [!IMPORTANT]
> The skills are designed so that **token values never enter the conversation**. The agent
> never reads `~/*.ght` files or puts tokens on a command line. Steps that need a token
> pasted are handed to you to run in your own terminal, and the agent confirms the result
> with `audit-gh-tokens --no-remote`, which reports metadata only. If you paste a token into
> the chat anyway, the skill tells you to treat it as exposed and helps you replace it.

> [!NOTE]
> - **Codex:** the structured question tool (`request_user_input`) is only available in Plan
>   mode,[^codex-request-input] so the Codex variant asks in plain text.
>   `~/.codex/skills` still loads but is deprecated in favor of `~/.agents/skills`.[^codex-skills]
> - **Shared folder:** OpenCode, Gemini CLI and Grok Build also read `~/.agents/skills`, so
>   installing the Codex variant alongside theirs can make the skill appear twice. The
>   installer warns when that applies.
> - **Gemini CLI:** project-level skills (`.gemini/skills/`) load only when the folder is
>   *trusted*;[^gemini-trust] user-level installs load everywhere.
> - **Hermes:** its skill index shows only the first ~57 characters of the description,[^hermes-index]
>   so the description leads with "Audit, rotate and generate GitHub personal access tokens."
>   Version and tags live under `metadata`. Hermes lints a missing top-level `version` only as a
>   warning,[^hermes-create] while a top-level `version` would fail the spec's validator.
> - **Grok Build:** only markdown links (`[x](references/x.md)`) are resolved to bundled files,[^grok-skills]
>   so the skill links its reference files that way.

## Security model

| Concern | How it's handled |
|---|---|
| Token in shell history or `ps` output | Tokens are never passed as arguments. Secrets are written with `gh secret set` reading stdin;[^gh-secret-set] verification passes the token to `gh` in the `GH_TOKEN` environment variable.[^gh-env] |
| Token printed to the terminal | Paste input is hidden, and no script prints a token value. Tests assert both. |
| Token file readable by others | Token and secrets files are owner-only: mode `600` on macOS/Linux (re-applied on overwrite), an owner-only ACL on Windows.[^icacls] The audit flags looser permissions. |
| Code injection through the shell secrets file | Only `[A-Za-z0-9_]` values are written, and references use the shell's own variable syntax. The file is replaced atomically, with a backup. |
| Long-lived terminal tokens | `store-gh-token` refuses tokens that never expire or outlive `--max-days`. |
| Broad tokens | Fine-grained tokens are the recommended default,[^pat-docs] and the generator warns on high-risk classic scopes. |
| Stale `GITHUB_TOKEN` hijacking `gh` | Token verification removes `GITHUB_TOKEN` from the child environment, and the skills check for the variable first. |
| Injection through repository or secret names | Inputs are validated against GitHub's naming rules,[^secrets] and `gh` is called with argument arrays, never through a shell. |

## Troubleshooting

| Symptom | Fix |
|---|---|
| `gh is not authenticated`, or `The token in GITHUB_TOKEN is invalid` | `unset GITHUB_TOKEN GH_TOKEN`, then `gh auth status`; sign in with `gh auth login` if needed[^gh-env] |
| `command not found: gen-gh-token` | Open a new terminal or `source ~/.zshrc` (or `~/.bashrc`) |
| Audit lists repos under "could not read secrets" | Listing secrets requires admin access to the repository[^secrets-api] |
| `GitHub reserves the GITHUB_ prefix` | Use a name like `GH_TOKEN`, and update the workflow to match[^secrets] |
| `Token check failed: invalid, revoked or expired` | Copy the token again; if it's lost, generate a new one. GitHub shows a token only once |
| Audit shows `NO_EXPIRATION` | Regenerate with an expiry and revoke the old token |
| API calls return 403 mentioning a PAT policy | Your organization restricts that token type or its lifetime; use the other type, or ask an admin[^org-pat-policy] |
| Browser doesn't open | Re-run with `--no-open` and open the printed URL |
| `store-gh-token`: "lives longer than --max-days" | Generate a token with a shorter expiration, or pass `--max-days N` / `--force` |
| New terminal still has the old `GITHUB_TOKEN` | Your startup file doesn't load the secrets file; re-run `store-gh-token` with `--ensure-loaded` |
| Windows: the profile or secrets file doesn't load | PowerShell's execution policy blocks scripts by default on Windows;[^ps-scripts] run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |

## Development

```bash
npm test                # unit + end-to-end tests (a fake `gh` is used; nothing touches GitHub)
npm run build:skills    # render skills/core into skills/dist/<host>/
npm run check:skills    # validate every variant and fail if dist/ is out of date
```

```bash
npm run validate:skills # --check, then the spec's reference validator on every variant (needs uv)
```

Edit the skill only in `skills/core/` (`SKILL.md.tmpl`, `references/`) and in
`skills/hosts.json`. The files in `skills/dist/` are generated. The build validates each
variant against the Agent Skills rules[^agentskills-spec]:

- frontmatter uses only the spec's top-level keys (`name`, `description`, `license`,
  `compatibility`, `metadata`, `allowed-tools`) in YAML block style, which is what the
  reference validator (`skills-ref`) accepts;[^skills-ref]
- `name` is lowercase with single hyphens, at most 64 characters, and matches its folder;
- `description` is at most 1024 characters and `compatibility` at most 500;
- `SKILL.md` stays under 500 lines;
- every referenced file exists.

See [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) for a map of the repository.

### Releasing

1. Bump `version` in `package.json`, and add a matching `## [x.y.z]` section to
   `CHANGELOG.md`. Its text becomes the release notes.
2. `npm run build:skills && npm test`, then commit and push to `main`.
3. Tag and push:

   ```bash
   git tag v3.1.0 && git push origin v3.1.0
   ```

[`release.yml`](.github/workflows/release.yml) then runs the full CI matrix. It fails if the
tag doesn't match `package.json` or the CHANGELOG has no matching section. Otherwise it
builds the assets with `npm run package`, signs build provenance,[^attest] and creates the
GitHub Release.[^gh-release] Tags with a hyphen (`v3.2.0-rc.1`) are marked as prereleases.
You can build the same assets locally with `npm run package`; they go in `release/`, which is
git-ignored.

## Evidence and references

Every behavior this toolkit relies on is traced to a public source in
**[docs/EVIDENCE.md](docs/EVIDENCE.md)**, which also marks whether that behavior is documented,
only observed in practice, or undocumented. The sources cited above:

[^pat-docs]: GitHub Docs, *Managing your personal access tokens*: creation via the web UI; fine-grained template-URL parameters (`name` ≤ 40, `description`, `target_name`, `expires_in` 1–366, permission names); recommendation to prefer fine-grained tokens. <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens>
[^pat-template]: GitHub Changelog, 2025-08-26, *Template URLs for fine-grained PATs and updated permissions UI*. <https://github.blog/changelog/2025-08-26-template-urls-for-fine-grained-pats-and-updated-permissions-ui/>
[^template-changelog]: The same changelog entry describes deep-linking to classic PAT creation as "a hidden feature for PAT (Classic)". <https://github.blog/changelog/2025-08-26-template-urls-for-fine-grained-pats-and-updated-permissions-ui/>
[^oauth-scopes]: GitHub Docs, *Scopes for OAuth apps*: scope names and the `X-OAuth-Scopes` response header. <https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps>
[^workflow-scope]: The `workflow` scope is required to add or update workflow files; see *Scopes for OAuth apps*. <https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps>
[^expiry-header]: GitHub Changelog, 2021-07-26, *Expiration options for personal access tokens*: introduces the `GitHub-Authentication-Token-Expiration` header. <https://github.blog/changelog/2021-07-26-expiration-options-for-personal-access-tokens/>
[^go-github-3708]: google/go-github issue #3708: fine-grained PATs return the current server time in the expiration header. <https://github.com/google/go-github/issues/3708>
[^secrets]: GitHub Docs, *Secrets reference*: naming rules (letters, numbers, underscores; no leading digit; no `GITHUB_` prefix; case-insensitive) and that values are not readable. <https://docs.github.com/en/actions/reference/security/secrets>
[^secrets-api]: GitHub Docs, *REST API endpoints for GitHub Actions secrets*: required access and the `repo` scope. <https://docs.github.com/en/rest/actions/secrets>
[^packages]: GitHub Docs, *About permissions for GitHub Packages*: "GitHub Packages only supports authentication using a personal access token (classic)." <https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages>
[^org-pat-policy]: GitHub Docs, *Setting a personal access token policy for your organization*. <https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization>
[^revoke-api]: GitHub Docs, *REST API endpoints for revocation*: `POST /credentials/revoke` is unauthenticated and intended for credentials the caller doesn't own. <https://docs.github.com/en/rest/credentials/revoke>
[^gh-env]: GitHub CLI manual, *gh help environment*: `GH_TOKEN`, then `GITHUB_TOKEN`, take precedence over stored credentials. <https://cli.github.com/manual/gh_help_environment>
[^gh-auth-login]: GitHub CLI manual, *gh auth login*. <https://cli.github.com/manual/gh_auth_login>
[^gh-secret-set]: GitHub CLI manual, *gh secret set*: `--body` "reads from standard input if not specified". <https://cli.github.com/manual/gh_secret_set>
[^gh-secret-list]: GitHub CLI manual, *gh secret list*: JSON fields include `name` and `updatedAt`. <https://cli.github.com/manual/gh_secret_list>
[^gh-repo-list]: GitHub CLI manual, *gh repo list*: `[<owner>]`, `--no-archived`, `--limit`. <https://cli.github.com/manual/gh_repo_list>
[^node-releases]: Node.js release schedule: Node 20 reached end-of-life on 2026-04-30; 22 is supported until 2027-04-30. <https://github.com/nodejs/Release#release-schedule>
[^bash-export]: GNU Bash manual, *Bourne Shell Builtins → export*. <https://www.gnu.org/software/bash/manual/html_node/Bourne-Shell-Builtins.html>
[^bash-startup]: GNU Bash manual, *Bash Startup Files* (login shells read `~/.bash_profile`, interactive non-login shells `~/.bashrc`). <https://www.gnu.org/software/bash/manual/html_node/Bash-Startup-Files.html>
[^fish-set]: fish documentation, *set* (`-g` global, `-x` export). <https://fishshell.com/docs/current/cmds/set.html>
[^fish-config]: fish documentation, *Configuration files*: `~/.config/fish/conf.d/*.fish` runs at the startup of every shell. <https://fishshell.com/docs/current/language.html#configuration-files>
[^tcsh]: tcsh(1): `setenv`, `source`, and startup files ("first `~/.tcshrc` or, if `~/.tcshrc` is not found, `~/.cshrc`"). <https://man.freebsd.org/cgi/man.cgi?query=tcsh>
[^ps-env]: Microsoft Learn, *about_Environment_Variables*. <https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_environment_variables>
[^ps-profiles]: Microsoft Learn, *about_Profiles* (`$PROFILE.CurrentUserAllHosts`). <https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_profiles>
[^ps-scripts]: Microsoft Learn, *about_Scripts*: scripts use the `.ps1` extension, dot sourcing runs them in the current scope, and Windows' default execution policy blocks scripts. <https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_scripts>
[^icacls]: Microsoft Learn, *icacls* (`/inheritance:r`, `/grant:r`). <https://learn.microsoft.com/windows-server/administration/windows-commands/icacls>
[^dependabot]: GitHub Docs, *Dependabot options reference* (`package-ecosystem`, `schedule.interval`, `groups`). <https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference>
[^clipboard]: macOS `pbpaste`/`pbcopy`; Windows PowerShell `Get-Clipboard`/`Set-Clipboard` <https://learn.microsoft.com/powershell/module/microsoft.powershell.management/get-clipboard>; Linux `wl-paste` (Wayland), `xclip` or `xsel` (X11).
[^token-expiry]: GitHub Docs, *Token expiration and revocation*: tokens unused for a year are revoked; GitHub App user tokens expire after 8 hours. <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation>
[^npm-install]: npm Docs, *npm install*: installing from a tarball URL. <https://docs.npmjs.com/cli/commands/npm-install>
[^attest]: GitHub Docs, *Using artifact attestations to establish provenance for builds*; `actions/attest-build-provenance`. <https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds>
[^gh-release]: GitHub CLI manual, *gh release create* (`--verify-tag`, `--notes-file`, `--prerelease`). <https://cli.github.com/manual/gh_release_create>
[^agentskills-spec]: Agent Skills specification: `SKILL.md` frontmatter fields and limits, directory layout. <https://agentskills.io/specification>
[^claude-skills]: Claude Code Docs, *Skills*. <https://code.claude.com/docs/en/skills>
[^codex-skills]: OpenAI Codex, *Build skills* (`~/.agents/skills`, `$skill-name`) <https://developers.openai.com/codex/skills>. Deprecated `$CODEX_HOME/skills` path: `codex-rs/ext/skills/src/host_roots.rs` in <https://github.com/openai/codex>
[^codex-request-input]: openai/codex issue #11536: `request_user_input` availability outside Plan mode. <https://github.com/openai/codex/issues/11536>
[^opencode-skills]: OpenCode Docs, *Skills*. <https://opencode.ai/docs/skills/>
[^opencode-tools]: OpenCode Docs, *Tools*. <https://opencode.ai/docs/tools/>
[^gemini-skills]: Gemini CLI Docs, *Skills*. <https://geminicli.com/docs/cli/skills/>
[^gemini-trust]: Gemini CLI Docs, *Trusted Folders*: project-specific configuration, including skills, is disabled in untrusted folders. <https://geminicli.com/docs/cli/trusted-folders/>
[^gemini-ask]: Gemini CLI Docs, *ask_user tool*. <https://geminicli.com/docs/tools/ask-user/>
[^gemini-shell]: Gemini CLI Docs, *Shell tool*. <https://geminicli.com/docs/tools/shell/>
[^hermes-skills]: Hermes Agent Docs, *Skills*. <https://hermes-agent.nousresearch.com/docs/user-guide/features/skills>
[^hermes-tools]: Hermes Agent Docs, *Tools*. <https://hermes-agent.nousresearch.com/docs/user-guide/features/tools>
[^hermes-create]: Hermes Agent Docs, *Creating skills*: frontmatter fields <https://hermes-agent.nousresearch.com/docs/developer-guide/creating-skills>. Missing `version`/`author`/`license` is a linter warning: `tools/skill_linter.py` in <https://github.com/NousResearch/hermes-agent>
[^hermes-index]: `SKILL_PROMPT_DESC_LIMIT = 60` in `agent/skill_utils.py`, <https://github.com/NousResearch/hermes-agent>
[^skills-ref]: Agent Skills reference validator (`skills-ref`; on PyPI the command is `agentskills`): allowed keys, strictyaml parsing. <https://github.com/agentskills/agentskills/tree/main/skills-ref>
[^grok-skills]: xAI Docs, *Skills, plugins and marketplaces* (Grok Build). <https://docs.x.ai/build/features/skills-plugins-marketplaces>
[^grok-config]: xai-org/grok-build, *Configuration* user guide (tools). <https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/05-configuration.md>

## License

[MIT](LICENSE)
