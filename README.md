# GitHub Token Utilities

[![CI](https://github.com/agentic-incubator/github-token-utilities/actions/workflows/ci.yml/badge.svg)](https://github.com/agentic-incubator/github-token-utilities/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/agentic-incubator/github-token-utilities)](https://github.com/agentic-incubator/github-token-utilities/releases/latest)
![node >= 22](https://img.shields.io/badge/node-%E2%89%A5%2022-339933)
[![license MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

Command-line tools and AI-agent skills for managing GitHub personal access tokens (PATs) on
macOS, Linux and Windows. They generate tokens with the narrowest access, audit where tokens
live, rotate repository secrets, keep a short-lived token in your terminal, and revoke tokens
you no longer need. Token values never show up in your shell history, your terminal or an
agent conversation.

> [!IMPORTANT]
> GitHub has no API for creating a personal access token.[^pat-docs] The tools open GitHub's
> own "new token" page with your choices prefilled. You click **Generate token** once, and
> everything else is automated.

## What's included

| Command | What it does | Guide |
|---|---|---|
| `gen-gh-token` | Create a fine-grained or classic token, verify it, and save it to `~/<name>.ght` | [Generate](docs/GENERATE.md) |
| `audit-gh-tokens` | Find stale token secrets across your repos, and check local tokens for validity and expiry | [Audit](docs/AUDIT.md) |
| `rotate-gh-token` | Replace the token stored in a repository Actions secret | [Rotate](docs/ROTATE.md) |
| `store-gh-token` | Keep a short-lived `GITHUB_TOKEN` in your shell's secrets file (bash, zsh, fish, csh, PowerShell and others) | [Store](docs/STORE.md) |
| `revoke-gh-token` | Permanently revoke a token and remove local copies | [Revoke](docs/REVOKE.md) |
| Agent skill | Walks you through all of the above in Claude Code, Codex, OpenCode, Gemini CLI, Hermes Agent and Grok Build | [Agent skills](docs/AGENT-SKILLS.md) |

## Get started

You need Node.js 22 or later, and the [GitHub CLI](https://cli.github.com/) signed in with
`gh auth login`.

```bash
V=3.2.2
npm install -g "https://github.com/agentic-incubator/github-token-utilities/releases/download/v$V/github-token-utilities-$V.tgz"

audit-gh-tokens                                  # what do I have, and what's stale?
store-gh-token --generate --expiration 7         # a fresh 7-day token for this terminal
```

[Installation](docs/INSTALLATION.md) covers the other ways to install: from source, on
Windows, with shell aliases, and how to verify downloads. New here? The
[Quick start](docs/QUICKSTART.md) walks through everything in about five minutes.

## Documentation

**Get started**

- [Quick start](docs/QUICKSTART.md): from nothing to your first audit
- [Installation](docs/INSTALLATION.md): from a release or from source, shell aliases, updating

**Guides**

- [Generate a token](docs/GENERATE.md): fine-grained vs classic, choosing permissions and scopes
- [Audit tokens](docs/AUDIT.md): stale repository secrets and local token health
- [Rotate a repository secret](docs/ROTATE.md): replace a secret's token safely
- [Store a terminal token](docs/STORE.md): a short-lived `GITHUB_TOKEN` in your shell, in one command
- [Revoke a token](docs/REVOKE.md): how revocation works, and its caveats
- [AI agent skills](docs/AGENT-SKILLS.md): installing and using the skill in six agent hosts

**Reference**

- [Compatibility](docs/COMPATIBILITY.md): platforms, shells, hosts and the versions verified
- [Security model](docs/SECURITY-MODEL.md): how token values are kept out of harm's way
- [Troubleshooting](docs/TROUBLESHOOTING.md): symptoms and fixes
- [Evidence](docs/EVIDENCE.md): the public source behind every behavior the tools rely on

**Project**

- [Development](docs/DEVELOPMENT.md): tests, skill builds, releasing
- [Project structure](docs/PROJECT-STRUCTURE.md): a map of the repository
- [Changelog](docs/CHANGELOG.md)

## License

[MIT](LICENSE)

[^pat-docs]: GitHub Docs, *Managing your personal access tokens*. <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens>
