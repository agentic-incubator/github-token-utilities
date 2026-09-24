# Revoke

`revoke.mjs` permanently kills a GitHub token, confirms that GitHub now rejects it, and
removes local copies. The token value never appears in the conversation. The script reads it
from its source and prints only a masked form (`ghp_…****`).

## Know what this does before offering it

GitHub has no authenticated "revoke my own token" API. The script uses the public
credential-revocation endpoint (`POST /credentials/revoke`), which behaves like this:

- It is **irreversible**, and GitHub **emails the token's owner**.
- It is called unauthenticated and limited to 60 requests per hour per IP address.
- It works on `ghp_`, `github_pat_`, `gho_`, `ghu_` and `ghr_` tokens.
- GitHub documents it for credentials *the caller does not own*, such as leaked tokens.
  Using it on your own token works, but that is outside its stated purpose.

Tell the user this in one or two plain sentences. If they'd rather not use the endpoint,
offer `--web` instead. It opens GitHub's token settings page so they can click **Delete**
themselves, and it doesn't touch local files.

## 1. Pick the token (ask if it isn't clear)

| The user means… | Source flag |
|---|---|
| a token saved by the generator (`~/NAME.ght`) | `--from NAME` |
| the token their shell exports from the secrets file | `--stored` |
| the old token `store.mjs` just replaced (it's in `<secrets file>.bak`) | `--previous` |

`--stored` and `--previous` accept `--file PATH` and `--format sh|fish|csh|powershell` when the
secrets file isn't in the default place. Run `node ~/audit.mjs --no-remote --json` if you need
to see which local tokens exist and whether they're still valid.

## 2. Preview (you can run this)

```bash
node ~/revoke.mjs --from NAME --dry-run
```

The preview shows the masked token, whose account it is, its type, scopes and expiry, and
exactly what would be deleted locally. Some things to point out to the user:

- **"GitHub already rejects this token":** nothing will be revoked; only local cleanup is left.
- **The token is `gh`'s own login:** the script refuses without `--force`, because revoking it
  logs `gh` out. Only proceed if the user explicitly wants that.
- **"Your current shell exports this token":** commands using it will fail afterwards.
  **That includes your own session.** Warn the user, and suggest storing a new token first
  (`references/terminal.md`).

## 3. Revoke (confirm first)

In the user's terminal, the script asks them to type the account name. When you run it, get
an explicit yes in the conversation first, then pass `--yes`:

```bash
node ~/revoke.mjs --from NAME --yes
```

It then:
1. calls the endpoint;
2. waits until GitHub rejects the token (`--no-wait` skips this);
3. deletes the local copy: the `.ght` file, only the secrets-file variables holding that token
   (and references to them), or the `.bak` file. `--keep-files` keeps them.

If GitHub refuses (for example 403 from the rate limit), nothing local is deleted. Offer to
retry later or to use `--web`.

## Shortcut for terminal-token rotation

`node ~/store.mjs --generate --expiration 7 --revoke-previous` stores the new token and then
revokes the one it replaced, all in one step (see `references/terminal.md`).

## After revoking

- If the token was stored in a **repository secret**, workflows using it will now fail.
  Offer `references/rotate.md` to set a new one.
- For fine-grained tokens, it's worth also checking
  https://github.com/settings/personal-access-tokens so the entry is gone from the list.
