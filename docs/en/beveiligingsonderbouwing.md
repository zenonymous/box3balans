# Assurance case

_Nederlands: [beveiligingsonderbouwing.md](../beveiligingsonderbouwing.md)_

Why Box3balans does what it promises on security: what it has to protect, against whom, where the trust boundaries are, which design principles it follows and how it counters the common kinds of weaknesses. And what it doesn't do. How it fits together is in [architectuur.md](architectuur.md); reporting a vulnerability goes through [SECURITY.md](../../SECURITY.md#security-in-english).

## What it promises (security requirements)

1. **Your financial data stays with you.** Amounts, balances and transactions don't leave the server; what does go out (symbols, ISINs, wallet addresses, requests signed with your own key) is listed in [privacy.md](privacy.md) and can be seen and switched off in the app.
2. **Only you get in.** One user, with a strong password and optionally two-step verification; a new installation only accepts its first user with the setup code from the log.
3. **Exchange keys are protected.** Stored encrypted, never sent back or logged, and preferably read-only (Coinbase keys are checked for that).
4. **Backups are unreadable without the passphrase**, and restoring happens completely or not at all.
5. **A release can be verified:** the image and the files are signed and provably built from this source code.

## What there is to protect

- A household's financial overview: assets, debts, transactions, names and dates of birth of family members.
- Exchange and broker API keys, and the two-step verification secret.
- The password, sessions and recovery codes.
- The backups, and the app key and passphrase that go with them.
- The integrity of the calculation: a wrong box 3 is harm too.

## Threat model

| Who                                                                   | What they'd want or be able to do                                                                                     |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Someone on the same network (housemate, guest, infected device)       | Sign in, take over a new installation, read traffic.                                                                  |
| A website you visit                                                   | Send requests to Box3balans through your browser (CSRF), or create the first user via DNS rebinding.                  |
| A malicious file (a CSV, bank export or PDF text)                     | Have code executed, read files outside the intended folder, or make a spreadsheet calculate when an export is opened. |
| A price source, block explorer or exchange (or whoever is in between) | Infer what you hold, or send back wrong data.                                                                         |
| A vulnerable or malicious dependency                                  | Send data out or execute code in the server.                                                                          |
| Someone with a copy of a backup                                       | Read your data.                                                                                                       |
| Someone with access to the server or the disk                         | Everything: the app doesn't fully protect against that (see _What it doesn't do_).                                    |
| Someone distributing a forged release                                 | Get you to run a modified image.                                                                                      |

## Trust boundaries

1. **Browser ↔ server.** Everything the browser sends is untrusted: the server checks the session, the CSRF header and the input on every request.
2. **Server ↔ internet.** Outgoing only via `fetch`, only HTTPS, only to the fixed list in `server/src/lib/net.ts`, redirects included. Answers from outside are untrusted and checked before they change anything.
3. **Files you import.** Untrusted: they're read as text, never executed, and only saved after you've seen the preview.
4. **Server ↔ database.** Trusted, but only through parameterised queries (Drizzle); the database has no port to the outside.
5. **Server ↔ disk.** The app key, the passphrase and the backups are in their own folders, readable only by the app user; backup names are checked.
6. **The command line in the container** (`docker compose exec`) is trusted: whoever has it already has the server.
7. **The build pipeline** (GitHub Actions) builds and signs the releases; what goes into it is pinned to versions.

## Design principles, and how they're applied

Following Saltzer and Schroeder:

- **Economy of mechanism:** one process, one user, one database, no accounts for others ([ADR 0001](adr/0001-zelf-hosten.md)); the outgoing connections are on one list in one file.
- **Fail-safe defaults:** backups encrypted, the update check off, two-step verification available, read-only keys advised; an unknown host is refused, an unknown coin gets no guessed price ([ADR 0004](adr/0004-koersgeschiedenis-alleen-met-zekerheid.md)).
- **Complete mediation:** every API request goes through the same hook in `app.ts` (session, CSRF header, public routes on a fixed list); every `fetch` through the same network guard.
- **Open design:** the source code, the list of destinations and this assurance case are public; security doesn't depend on keeping the design secret.
- **Separation of privilege:** signing in can take a password plus a code from an authenticator app; turning two-step verification off needs both.
- **Least privilege:** the app runs as a normal user in the container; exchange keys with read permissions only; the browser may only talk to its own server (CSP `connect-src 'self'`).
- **Least common mechanism:** no shared service or cloud; every installation stands on its own.
- **Psychological acceptability:** the app explains per connection which permissions are needed, shows what went out, and reminds you of the passphrase.

## Common weaknesses, and how they're countered

| Kind (OWASP / CWE)                                | Countermeasure                                                                                                                                                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Injection (SQL, CWE-89)                           | Only Drizzle with parameters; SQL is never built as text from input ([ADR 0006](adr/0006-databasegebruiker-blijft-superuser.md)).                                                                     |
| Cross-site scripting (CWE-79)                     | React escapes all text; a strict Content-Security-Policy (scripts only from the site itself).                                                                                                         |
| Cross-site request forgery (CWE-352)              | Every request that changes something needs the `X-Requested-With: portfolio` header (which another site can't send without a CORS preflight); session cookies are `SameSite=Strict` and `HttpOnly`.   |
| Weak authentication (CWE-287, CWE-307)            | argon2id; rate limits on signing in, setup and changing the password; a growing pause after five wrong codes; sessions as random tokens, stored hashed; a new password ends all sessions.             |
| Missing access control (CWE-862)                  | All routes under `/api/` need a session, except a fixed list of public routes; there's one user, so no permissions between users.                                                                     |
| Exposure of sensitive data (CWE-200, CWE-312)     | API keys and the TOTP secret encrypted (AES-256-GCM, HKDF of the app key); backups encrypted (AES-256-GCM, scrypt); passwords, cookies and keys aren't logged.                                        |
| Server-side request forgery (CWE-918)             | Outgoing only to the fixed list, also after a redirect; a lint rule forbids other ways to connect; CI fails on a connection to a host not on the list.                                                |
| Path traversal (CWE-22)                           | Backup names must match the app's pattern exactly before a path is made from them.                                                                                                                    |
| Insecure deserialisation / XXE (CWE-502, CWE-611) | JSON only, checked with zod; XML (CAMT.053) with fast-xml-parser, which doesn't fetch or read external entities.                                                                                      |
| Formula injection in CSV exports (CWE-1236)       | Cells that would start as a formula are defused.                                                                                                                                                      |
| Weak cryptography (CWE-327)                       | Only standard algorithms (argon2id, AES-256-GCM, scrypt, HKDF, SHA-256); outgoing only TLS with certificate verification.                                                                             |
| Vulnerable or malicious dependencies (CWE-1395)   | Lockfile; new versions only after two weeks; Dependabot and `npm audit`; workflows pinned to commits; OpenSSF Scorecard; the network guard also keeps a dependency that uses `fetch` within the list. |
| Forged releases                                   | Images and files signed with Sigstore (cosign), with an SBOM and SLSA provenance; how to verify is in [SECURITY.md](../../SECURITY.md#verifying-images).                                              |

## How this is kept true

- **Tests** for the security properties: the network guard (no host outside the list, not even in the code), the CSRF check, the sign-in and two-step verification rules, encrypting and restoring backups, the setup code, backup names. A test that goes to the internet fails.
- **Static analysis:** CodeQL (security rules) and ESLint with type information on every change.
- **CI** runs the image in a sealed-off setup and fails on a connection to a host not on the list.
- **Reviews:** two security audits (October 2026) and a security review of the server for releases that change it.

## What it doesn't do (residual risks)

- **Access to the server is access to everything.** Whoever has the server or the disk can read the stored API keys with the app key. Hence the advice: read-only keys, and keep the app key off the server.
- **The app itself speaks HTTP**, meant to sit behind a VPN or a reverse proxy with HTTPS. Don't expose it to the internet; with `COOKIE_SECURE=true` HSTS is added.
- **No list of allowed host names** against DNS rebinding; the setup code covers the moment it mattered ([ADR 0007](adr/0007-dns-rebinding-alleen-gedocumenteerd.md)).
- **The database user is a superuser** ([ADR 0006](adr/0006-databasegebruiker-blijft-superuser.md)); the defence is in the parameterised queries.
- **Connections outside `fetch`** (by a dependency) are only stopped by the [sealed-off setup](privacy.md#running-it-sealed-off), at network level.
- **One maintainer, a lot of AI help.** Most of the code was written with an AI assistant and reviewed by the maintainer (see the [README](../../README.en.md#built-with-ai-assistance)); the tests, static analysis and reviews above apply to it just the same.
