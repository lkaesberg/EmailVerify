# Allowed-email API

Keep your server's allowed-email list in sync from your own systems — a student
information system, an HR export, a CRM, a nightly cron job — instead of uploading
a CSV by hand every time someone joins or leaves.

!!! info "Included with the Pro subscription"
    The API is available to servers on the **Pro** subscription. The one-time
    CSV unlock does *not* include it: the API is a live service we host and
    rate-limit, so access follows the subscription and stops when it lapses.

    Everything the API does can also be done by hand with `/emaillist upload`,
    `/emaillist remove` and `/emaillist clear`.

---

## 1. Get a token

In your Discord server, run:

```
/api token generate
```

The reply is ephemeral — only you can see it — and contains the token exactly
once.

!!! warning "The token is shown once and never again"
    Only a hash of the token is stored, so nobody, including us, can read it back.
    Lose it and you run `/api token generate` again, which issues a new token and
    **invalidates the old one**.

    Treat it like a password. Anyone holding it can change this server's
    allowed-email list. Keep it in a secret store or an environment variable, never
    in a committed file.

Related commands:

| Command | What it does |
| --- | --- |
| `/api token generate` | Issues a new token and invalidates the previous one |
| `/api token status` | Shows when the token was created and last used — never the token |
| `/api token revoke` | Disables the token; every request then returns `401` |

## 2. Check it works

Every request authenticates with the token in an `Authorization` header:

```bash
curl -H "Authorization: Bearer evk_YOUR_TOKEN_HERE" \
  https://stats.getemailverified.com/api/v1/me
```

```json
{
  "guildId": "123456789012345678",
  "guildName": "CHS Student Council",
  "tier": "tier2",
  "allowedEmails": 412
}
```

The token identifies your server, so no server ID is needed in any request.

---

## Endpoints

Base URL: `https://stats.getemailverified.com/api/v1`

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/me` | Token and connection check |
| `GET` | `/emails` | How many addresses are on the list |
| `POST` | `/emails` | Add one address, or many |
| `DELETE` | `/emails/{address}` | Remove one address |
| `DELETE` | `/emails?confirm=true` | Remove every address |

### Add addresses

One address and many addresses use the same endpoint — send `email` for one, or
`emails` for a batch of up to **10,000**.

=== "Add one"

    ```bash
    curl -X POST https://stats.getemailverified.com/api/v1/emails \
      -H "Authorization: Bearer $EMAILVERIFY_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"email": "ada@example.edu"}'
    ```

=== "Add many"

    ```bash
    curl -X POST https://stats.getemailverified.com/api/v1/emails \
      -H "Authorization: Bearer $EMAILVERIFY_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"emails": ["ada@example.edu", "grace@example.edu", "alan@example.edu"]}'
    ```

```json
{ "added": 3, "skipped": 0, "invalid": [], "total": 415 }
```

- `added` — addresses newly written to the list
- `skipped` — already on the list; adding twice is harmless
- `invalid` — rejected as malformed, and listed back so you can log them
- `total` — size of the list afterwards

Adding is idempotent, so a nightly "push the full roster" job is safe to re-run.

### Remove one address

```bash
curl -X DELETE \
  -H "Authorization: Bearer $EMAILVERIFY_TOKEN" \
  https://stats.getemailverified.com/api/v1/emails/ada@example.edu
```

```json
{ "removed": 1, "total": 414 }
```

An address that isn't on the list returns `404 not_in_list`. If the address
contains characters that are awkward in a URL, percent-encode it (`+` becomes
`%2B`).

### Remove every address

Clearing the whole list requires `?confirm=true`, so a mistyped `DELETE` against
the collection can't wipe it by accident:

```bash
curl -X DELETE \
  -H "Authorization: Bearer $EMAILVERIFY_TOKEN" \
  "https://stats.getemailverified.com/api/v1/emails?confirm=true"
```

```json
{ "removed": 414, "total": 0 }
```

!!! danger "An empty list is not the same as no list"
    While an allowed-email list exists, **only** addresses on it can verify. Clearing
    it to zero entries removes the list entirely, which returns the server to
    domain-only checking — not to "nobody can verify".

### Count the list

```bash
curl -H "Authorization: Bearer $EMAILVERIFY_TOKEN" \
  https://stats.getemailverified.com/api/v1/emails
```

```json
{
  "count": 414,
  "stored": "md5",
  "note": "Addresses are stored hashed and cannot be listed back."
}
```

---

## Why you can't read the list back

Addresses are stored as MD5 hashes of the lowercased address — the same way
`/emaillist upload` has always stored them — so the bot never holds a readable
copy of your members' email addresses.

That means:

- **Adding** works: we hash what you send and store the hash.
- **Removing** works: we hash what you send and delete the matching hash.
- **Counting** works.
- **Listing** is impossible, by design. Your own system stays the source of truth.

## Errors

Every error has the same shape:

```json
{ "error": { "code": "invalid_token", "message": "Unknown or revoked token. ..." } }
```

| Status | `code` | Meaning |
| --- | --- | --- |
| `400` | `invalid_body` | Body wasn't `{"email": ...}` or `{"emails": [...]}` |
| `400` | `invalid_address` | The address in the path isn't a valid address |
| `400` | `no_valid_addresses` | Every address in the batch was malformed |
| `400` | `confirmation_required` | Bulk delete without `?confirm=true` |
| `401` | `missing_token` | No `Authorization: Bearer` header |
| `401` | `invalid_token` | Token unknown or revoked — generate a new one |
| `403` | `tier2_required` | The Pro subscription isn't active on this server |
| `404` | `not_in_list` | That address wasn't on the list |
| `404` | `guild_not_configured` | The server has never run `/setup` |
| `413` | `payload_too_large` | Body over 1 MB — split the batch |
| `429` | `rate_limited` | Over 60 requests/minute; see `Retry-After` |
| `503` | `entitlement_check_failed` | We couldn't reach Discord to confirm the subscription; retry |

### Rate limit

**60 requests per minute per server.** Responses carry `X-RateLimit-Remaining`,
and a `429` carries `Retry-After` in seconds.

Batch rather than loop: 5,000 addresses in one `POST` is a single request, whereas
5,000 single-address calls will spend most of an hour being rate-limited.

---

## A worked example

Sync a roster nightly, so people who left lose access and new joiners gain it:

```bash
#!/usr/bin/env bash
set -euo pipefail

API="https://stats.getemailverified.com/api/v1"
AUTH="Authorization: Bearer ${EMAILVERIFY_TOKEN:?set EMAILVERIFY_TOKEN}"

# roster.txt: one address per line, exported from your source of truth.
emails=$(jq -R -s 'split("\n") | map(select(length > 0))' < roster.txt)

# Replace the list wholesale: clear, then add the current roster.
curl -fsS -X DELETE -H "$AUTH" "$API/emails?confirm=true" > /dev/null
curl -fsS -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"emails\": $emails}" "$API/emails"
```

For an incremental sync instead, `POST` the additions and `DELETE` the departures
individually — both are cheaper than a full replace and leave the list usable
throughout, with no window where nobody can verify.

## Self-hosting

If you run your own instance, the API is served by the same Express app as the
stats endpoints (port `8181`) under `/api/v1`. Set `apiBaseUrl` in
`config/config.json` so `/api token generate` shows your own host in its examples.

When `monetization.enabled` is `false`, there is no subscription to check and the
API is available to every server on your instance.
