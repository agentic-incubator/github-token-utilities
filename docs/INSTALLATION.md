# Installation

[README](../README.md) › [Documentation](../README.md#documentation) › Installation

How to install the command-line tools, either from a GitHub Release or from a clone, and how shell aliases are set up.

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



## From a release

Every [release](https://github.com/agentic-incubator/github-token-utilities/releases) publishes:

| Asset | Use |
|---|---|
| `github-token-utilities-<version>.tgz` | `npm install -g` it to get `gen-gh-token`, `audit-gh-tokens`, `rotate-gh-token`, `store-gh-token` and `revoke-gh-token` on your `PATH`. No npm registry is involved.[^npm-install] |
| `github-token-utilities-<version>.zip` | The same files as a plain archive |
| `github-token-utilities-skill-<host>-<version>.zip` | One per agent host. Unzip into that host's skills folder (see [AI agent skills](AGENT-SKILLS.md)) |
| `SHA256SUMS` | Checksums for all of the above |

```bash
V=3.4.0
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

## From source

```bash
git clone https://github.com/agentic-incubator/github-token-utilities.git ~/.local/share/github-token-utilities
cd ~/.local/share/github-token-utilities
node setup.mjs --dry-run   # preview: which files are copied, which shell config changes
node setup.mjs             # apply
```

Setup copies `generator.mjs`, `audit.mjs`, `rotate.mjs`, `store.mjs`, `revoke.mjs` and
`gh-token-lib.mjs` into your home directory. It then adds the `gen-gh-token`,
`audit-gh-tokens`, `rotate-gh-token`, `store-gh-token` and `revoke-gh-token` aliases to the startup file of your shell, which it
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
> You don't have to install by hand. With one of the [agent skills](AGENT-SKILLS.md)
> installed, ask your agent to "set up the GitHub token utilities". It clones the repo, shows
> you the dry run, and applies it only after you confirm.

[^node-releases]: Node.js release schedule: Node 20 reached end-of-life on 2026-04-30; 22 is supported until 2027-04-30. <https://github.com/nodejs/Release#release-schedule>
[^gh-auth-login]: GitHub CLI manual, *gh auth login*. <https://cli.github.com/manual/gh_auth_login>
[^gh-env]: GitHub CLI manual, *gh help environment*: `GH_TOKEN`, then `GITHUB_TOKEN`, take precedence over stored credentials. <https://cli.github.com/manual/gh_help_environment>
[^npm-install]: npm Docs, *npm install*: installing from a tarball URL. <https://docs.npmjs.com/cli/commands/npm-install>
[^bash-startup]: GNU Bash manual, *Bash Startup Files* (login shells read `~/.bash_profile`, interactive non-login shells `~/.bashrc`). <https://www.gnu.org/software/bash/manual/html_node/Bash-Startup-Files.html>
[^fish-config]: fish documentation, *Configuration files*: `~/.config/fish/conf.d/*.fish` runs at the startup of every shell. <https://fishshell.com/docs/current/language.html#configuration-files>
[^tcsh]: tcsh(1): `setenv`, `source`, and startup files ("first `~/.tcshrc` or, if `~/.tcshrc` is not found, `~/.cshrc`"). <https://man.freebsd.org/cgi/man.cgi?query=tcsh>
[^ps-profiles]: Microsoft Learn, *about_Profiles* (`$PROFILE.CurrentUserAllHosts`). <https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_profiles>
