# Compatibility

[README](../README.md) › [Documentation](../README.md#documentation) › Reference › Compatibility

Supported platforms, shells and agent hosts, and the exact versions verified.

Version **3.3.0**. See [CHANGELOG.md](CHANGELOG.md) for what changed.

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
[Dependabot](../.github/dependabot.yml) checks them (and npm) every week and opens grouped
update PRs that bump each SHA and its version comment together.[^dependabot]

[^node-releases]: Node.js release schedule: Node 20 reached end-of-life on 2026-04-30; 22 is supported until 2027-04-30. <https://github.com/nodejs/Release#release-schedule>
[^dependabot]: GitHub Docs, *Dependabot options reference* (`package-ecosystem`, `schedule.interval`, `groups`). <https://docs.github.com/en/code-security/dependabot/working-with-dependabot/dependabot-options-reference>
