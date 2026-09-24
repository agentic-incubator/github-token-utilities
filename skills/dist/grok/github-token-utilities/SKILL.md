---
name: github-token-utilities
description: "Audit, rotate and generate GitHub personal access tokens. Sets up and drives the github-token-utilities toolkit. Use whenever the user wants to create a GitHub token or PAT, find which repos hold token secrets like GH_TOKEN or GH_PAT, check for stale, expiring or invalid tokens, rotate or replace a repository Actions secret, install or update these token scripts, or mentions gen-gh-token, audit-gh-tokens or rotate-gh-token - even if they don't name the toolkit."
license: MIT
compatibility: "Requires Node.js 22+, git, and the GitHub CLI (gh) authenticated to github.com. Works on macOS, Linux and Windows; bash, zsh, sh, ksh, dash, fish, csh/tcsh and PowerShell."
metadata:
  author: "agentic-incubator"
  version: "3.2.0"
  repository: "https://github.com/agentic-incubator/github-token-utilities"
  short-description: "Audit, rotate and generate GitHub tokens"
---

# GitHub Token Utilities

This skill drives the [github-token-utilities](https://github.com/agentic-incubator/github-token-utilities) toolkit, a set of Node scripts
that manage GitHub personal access tokens (PATs):

| Action | Script (after setup) | What it does |
|---|---|---|
| **audit** | `node ~/audit.mjs` | Finds token-like Actions secrets across repos, shows when each was last set, and checks local `~/*.ght` token files for validity, expiry and permissions |
| **rotate** | `node ~/rotate.mjs` | Replaces a repo's Actions secret with a new token |
| **generate** | `node ~/generator.mjs` | Opens a prefilled GitHub "new token" page, takes the pasted token, verifies it, saves it to `~/<name>.ght` (mode 600) |
| **revoke** | `node ~/revoke.mjs` | Permanently revokes a token (`--from NAME`, `--stored`, `--previous`), confirms GitHub rejects it, and removes local copies |
| **store** | `node ~/store.mjs` | Writes a token into the shell secrets file loaded at startup (`GITHUB_TOKEN` plus a `GITHUB_PERSONAL_ACCESS_TOKEN` reference), for bash/zsh/sh, fish, csh/tcsh or PowerShell |

Your job is to be a calm guide: figure out which action the user needs, check the
toolkit is installed, explain each step in plain words before doing it, and get
explicit confirmation before anything that changes their machine or their repos.

## How to work in Grok Build

- **Asking the user:** Use the `ask_user_question` tool for choices and confirmations.
- **Running commands:** Use the `bash` tool.
- **Commands the user must run themselves:** Ask the user to run the command in a separate terminal window, then tell you when it finishes.
- **Reference files** live in this skill's `references/` folder; paths are relative to the
  folder containing this file. Read only the one for the action you are doing.

## Token safety — the reason this skill exists

A PAT is a password with an API. The whole design keeps token values out of this
conversation, because anything in the conversation can end up in logs, transcripts or
model context. So:

- Never `cat`, print, copy, or otherwise read a `~/*.ght` file or a token value, and never
  put a token in a command line (it would show up in shell history and `ps`). The scripts
  read token files themselves and only report metadata (user, scopes, expiry).
- Never ask the user to paste a token into the chat. If they paste one anyway, tell them
  plainly it should now be treated as exposed, and offer to help revoke and regenerate it.
- Steps that need a token pasted (generate, and rotate when it generates) are run **by the
  user in their own terminal**, using a complete command you prepare for them.
- Confirm before: cloning, running setup, setting/overwriting a repo secret, deleting token
  files, changing file permissions, or revoking a token (irreversible). Show the dry-run output first where one exists.

## Step 0 — Pick the action

If the request is clear ("rotate GH_TOKEN in acme/api"), go straight to it. If not, ask
which of these they want, with a one-line description of each:

1. **Audit** — "what tokens do I have and which are stale/expiring?" (safe, read-only; a good
   first step when unsure)
2. **Rotate** — "replace the token stored in a repo secret"
3. **Generate** — "make a new token"
4. **Terminal token** — "refresh the short-lived GITHUB_TOKEN my shell loads"
5. **Revoke** — "kill this token", "revoke the old one", "I leaked a token"
6. **Set up / update** the toolkit

## Step 1 — Pre-flight (every time, before any action)

Run these read-only checks together and summarize the result in one short list.

macOS / Linux (any shell; run them with `sh -c` if the user's shell is fish or csh):

```bash
node --version
gh --version
gh auth status
test -f ~/audit.mjs && test -f ~/rotate.mjs && test -f ~/generator.mjs && echo "toolkit: installed" || echo "toolkit: missing"
printenv GH_TOKEN >/dev/null && echo "GH_TOKEN is set"; printenv GITHUB_TOKEN >/dev/null && echo "GITHUB_TOKEN is set"
```

Windows (PowerShell):

```powershell
node --version; gh --version; gh auth status
if ((Test-Path ~/audit.mjs) -and (Test-Path ~/rotate.mjs) -and (Test-Path ~/generator.mjs)) { 'toolkit: installed' } else { 'toolkit: missing' }
if ($env:GH_TOKEN) { 'GH_TOKEN is set' }; if ($env:GITHUB_TOKEN) { 'GITHUB_TOKEN is set' }
```

Interpret them:

- **Node missing or older than 22** → point them to https://nodejs.org (current LTS). Stop until fixed.
- **gh missing** → https://cli.github.com. Stop until fixed.
- **gh not logged in** → they run `gh auth login` in their own terminal (it is interactive).
- **`GH_TOKEN`/`GITHUB_TOKEN` set and `gh auth status` fails** → that variable overrides their
  `gh` login. This is the most common hidden cause of failures. Explain it and suggest
  `unset GITHUB_TOKEN` (or `GH_TOKEN`) for the session, or fixing wherever it is exported.
  Don't print the variable's value.
- **Toolkit missing** → go to setup (read [references/setup.md](references/setup.md)), then come back.

## Step 2 — Do the action

Read the matching reference file and follow it:

| Action | Reference |
|---|---|
| Set up, update, or uninstall | [references/setup.md](references/setup.md) |
| Audit | [references/audit.md](references/audit.md) |
| Rotate | [references/rotate.md](references/rotate.md) |
| Generate | [references/generate.md](references/generate.md) |
| Terminal token (store in the shell secrets file) | [references/terminal.md](references/terminal.md) |
| Revoke | [references/revoke.md](references/revoke.md) |
| Choosing scopes (used by rotate and generate) | [references/scopes.md](references/scopes.md) |
| Anything fails | [references/troubleshooting.md](references/troubleshooting.md) |

## Step 3 — Close the loop

End every action with a short recap: what changed (or "nothing changed" for audit and dry
runs), what the user still needs to do by hand (e.g. revoke the old token on
https://github.com/settings/tokens), and the natural next action — usually an audit after a
rotate, or a rotate after an audit finds something stale.
