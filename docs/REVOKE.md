# Revoke a token

[README](../README.md) › [Documentation](../README.md#documentation) › Guides › Revoke

`revoke-gh-token` permanently revokes a token, confirms that GitHub rejects it, and removes local copies.

```bash
revoke-gh-token --from old-ci --dry-run   # preview: which account, scopes, expiry; what gets deleted
revoke-gh-token --from old-ci             # ~/old-ci.ght
revoke-gh-token --stored                  # the token your shell secrets file exports
revoke-gh-token --previous                # the token store-gh-token last replaced (from the .bak)
revoke-gh-token --from old-ci --web       # open GitHub's token page instead of calling the API
```

What it does:

1. **Identifies the token.** It shows the account, type, scopes and expiry, with the value
   masked, and asks you to type the account name to confirm (`--yes` skips this).
2. **Checks for dangerous cases:**
   - it refuses to revoke `gh`'s own login token, which would sign `gh` out, unless you pass
     `--force`;
   - it warns if your current shell exports the token.
3. **Revokes it** through GitHub's credential-revocation API,[^revoke-api] then polls until
   GitHub rejects the token.
4. **Removes local copies.** The `.ght` file, only the secrets-file variables that held
   this token (plus references to them), or the `.bak` file. `--keep-files` keeps them.

If the token is already dead, it skips the API call and just cleans up. If GitHub refuses the
call, nothing local is deleted.

> [!CAUTION]
> Revocation **cannot be undone**, and GitHub **emails the token's owner**. GitHub has no
> authenticated "revoke my own token" API. The only endpoint is `POST /credentials/revoke`,
> which must be called *unauthenticated*, allows 60 requests an hour, and is documented for
> credentials the caller *doesn't* own.[^revoke-api] It accepts your own tokens too, but if you'd
> rather stay within its documented purpose, use `--web` and click **Delete** on GitHub.

> [!TIP]
> To rotate your terminal token and kill the old one in one go, run
> `store-gh-token --generate --expiration 7 --revoke-previous`.

[^revoke-api]: GitHub Docs, *REST API endpoints for revocation*: `POST /credentials/revoke` accepts `ghp_`/`github_pat_`/`gho_`/`ghu_`/`ghr_` tokens; authenticated requests return 403; 60 requests/hour; returns 202; owners are notified; revoked credentials can't be reactivated; intended for credentials the caller doesn't own. <https://docs.github.com/en/rest/credentials/revoke>
