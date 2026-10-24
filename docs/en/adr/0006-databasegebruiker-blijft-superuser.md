# The app's database user stays a superuser

_Nederlands: [0006-databasegebruiker-blijft-superuser.md](../../adr/0006-databasegebruiker-blijft-superuser.md)_

In the installation with PostgreSQL, the user the app connects with is the superuser the image creates on first start. PostgreSQL refuses to take that user's privileges away (tested), so a restricted user requires a second role with its own password file, transferring all tables and a switch at startup, also for existing installations. Because the database is only for this app and has no port to the outside, that doesn't outweigh the extra work and the risk of mistakes during upgrades.

## Consequences

A bug in the app that would let SQL be executed has full rights on the database. The defence is therefore in the app itself: queries go through Drizzle with parameters, and SQL is never built as text from input.
