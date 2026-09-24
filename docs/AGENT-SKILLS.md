# AI agent skills

[README](../README.md) › [Documentation](../README.md#documentation) › Guides › Agent skills

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
> - **Grok Build:** only markdown links (`[x](../references/x.md)`) are resolved to bundled files,[^grok-skills]
>   so the skill links its reference files that way.

[^agentskills-spec]: Agent Skills specification: `SKILL.md` frontmatter fields and limits, directory layout. <https://agentskills.io/specification>
[^claude-skills]: Claude Code Docs, *Skills*. <https://code.claude.com/docs/en/skills>
[^codex-skills]: OpenAI Codex, *Build skills* (`~/.agents/skills`, `$skill-name`) <https://developers.openai.com/codex/skills>. Deprecated `$CODEX_HOME/skills` path: `codex-rs/ext/skills/src/host_roots.rs` in <https://github.com/openai/codex>
[^opencode-skills]: OpenCode Docs, *Skills*. <https://opencode.ai/docs/skills/>
[^opencode-tools]: OpenCode Docs, *Tools*. <https://opencode.ai/docs/tools/>
[^gemini-skills]: Gemini CLI Docs, *Skills*. <https://geminicli.com/docs/cli/skills/>
[^gemini-ask]: Gemini CLI Docs, *ask_user tool*. <https://geminicli.com/docs/tools/ask-user/>
[^gemini-shell]: Gemini CLI Docs, *Shell tool*. <https://geminicli.com/docs/tools/shell/>
[^hermes-skills]: Hermes Agent Docs, *Skills*. <https://hermes-agent.nousresearch.com/docs/user-guide/features/skills>
[^hermes-tools]: Hermes Agent Docs, *Tools*. <https://hermes-agent.nousresearch.com/docs/user-guide/features/tools>
[^grok-skills]: xAI Docs, *Skills, plugins and marketplaces* (Grok Build). <https://docs.x.ai/build/features/skills-plugins-marketplaces>
[^grok-config]: xai-org/grok-build, *Configuration* user guide (tools). <https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/05-configuration.md>
[^codex-request-input]: openai/codex issue #11536: `request_user_input` availability outside Plan mode. <https://github.com/openai/codex/issues/11536>
[^gemini-trust]: Gemini CLI Docs, *Trusted Folders*: project-specific configuration, including skills, is disabled in untrusted folders. <https://geminicli.com/docs/cli/trusted-folders/>
[^hermes-index]: `SKILL_PROMPT_DESC_LIMIT = 60` in `agent/skill_utils.py`, <https://github.com/NousResearch/hermes-agent>
[^hermes-create]: Hermes Agent Docs, *Creating skills*: frontmatter fields <https://hermes-agent.nousresearch.com/docs/developer-guide/creating-skills>. Missing `version`/`author`/`license` is a linter warning: `tools/skill_linter.py` in <https://github.com/NousResearch/hermes-agent>
