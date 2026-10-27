# Contributing to Box3balans

_Nederlands: [CONTRIBUTING.md](CONTRIBUTING.md)_

Glad you want to help! Box3balans is a hobby project for everyone in the Netherlands who wants to keep track of their investments and box 3 themselves, on their own hardware. Contributions in Dutch and English are both welcome.

**A question?** Ask it in [Discussions](https://github.com/zenonymous/box3balans/discussions/categories/q-a), not as an issue: issues are for bugs, export formats and concrete proposals. Discuss a loose idea in [Ideas](https://github.com/zenonymous/box3balans/discussions/categories/ideas) first.

## Where you help most

- **The format of your export or annual statement.** If Box3balans doesn't know your broker's, bank's or exchange's CSV or your annual statement (PDF) yet, choose _Help others read this file_ (or _… this statement …_) in the app. Box3balans makes a file with made-up data in the layout of yours; you see what's in it and share it with the _Share a format_ form under [Issues](https://github.com/zenonymous/box3balans/issues/new/choose). See [Sharing your format](docs/en/importeren.md#sharing-your-format). You can also send an anonymised example yourself, with the forms _Export file from a broker, bank or exchange_ and _Annual statement (PDF) from a provider_; never send the PDF itself.
- **Reporting bugs**, with the version (bottom left in the app) and how to reproduce it. Never share real amounts, account numbers, wallet addresses or API keys. Report a security problem privately, not as an issue: see [SECURITY.md](SECURITY.md#reporting-a-vulnerability).
- **Checking tax rules.** Does a calculation not match what the Belastingdienst says? Report it with a link to the source. The rules and their sources are in [`docs/box3-sources.md`](docs/box3-sources.md) ([English](docs/en/box3-sources.md)), the figures in [`server/src/rules/box3.json`](server/src/rules/box3.json).
- **Code.** New here? Start with a [_good first issue_](https://github.com/zenonymous/box3balans/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22): small, well-defined tasks, such as tests for a page, that need no account or real data. See the [roadmap](docs/en/ROADMAP.md) for what else is planned. For bigger changes, open an issue first, so we can agree on the approach before you put a lot of time into it.

## Development environment

You need Node.js 22 or newer; Docker isn't needed. Without `DATABASE_URL` the server uses a built-in PostgreSQL (PGlite) in `server/.data/`.

```bash
npm install
echo "APP_SECRET=$(openssl rand -hex 32)" > server/.env
npm run dev:server     # API on http://localhost:8080 (also serves web/dist when it's built)
npm run dev:web        # Vite on http://localhost:5173, forwards /api to :8080
```

Create a user in the app. Load sample data with `SESSION=<value of the pd_session cookie> npx tsx server/scripts/sample-data.ts`.

## Before you open a pull request

**A pull request is accepted when:**

1. the GitHub workflow passes (formatting, ESLint, typecheck, tests, ShellCheck, actionlint and the Docker image), and new or changed calculations have a test with a worked example;
2. it follows the [agreements](#agreements) below, and fits the deliberate choices in [docs/adr/](docs/en/adr/) (or there was an issue about it first);
3. it contains no personal data, and you agree to the [licence](#licence).

`npm install` also sets up git hooks (Husky). Before every commit the changed files are formatted (Prettier) and checked (ESLint, with type information), and the typecheck runs: a few seconds together. Before every push the tests run, about half a minute. If you really must in an emergency, skip them with `--no-verify`; the GitHub workflow checks everything again.

Running everything yourself in one go:

```bash
npm run lint
npm run typecheck
npm test
npm run coverage          # the tests with how much code they reach; at least 80% together
npx prettier --check .    # or: npm run format
```

The GitHub workflow does the same, checks the shell scripts with ShellCheck and the workflow itself with actionlint, and then builds the Docker image. If you have ShellCheck and actionlint installed (for example `brew install shellcheck actionlint`), run those two with `npm run lint:scripts`.

Does the app change visibly? Then remake the screenshots in the README: start the demo (`npm run demo`) and run `npm run screenshots`. That needs Chrome, Chromium, Brave or Edge.

## Agreements

- **Terms and decisions:** the words the app and the code use, with their meaning, are in [CONTEXT.md](CONTEXT.md) ([English](CONTEXT.en.md)). Choices made deliberately (and why) are in [docs/adr/](docs/en/adr/). If you want to deviate from them, start with an issue.
- **Documentation in two languages:** every Markdown document has a Dutch and an English version (`README.md` and `README.en.md`, `docs/x.md` and `docs/en/x.md`). Change both; if you can only write one language, say so in the pull request and the other will be filled in. `test/docs-english.test.ts` checks that every Dutch document has an English one.
- **AI help** is fine, as the maintainer uses it too (see the [README](README.en.md#built-with-ai-assistance)). Say so in the pull request, keep your assistant's `Co-Authored-By` line in the commit, and only submit what you understand and have tested yourself.
- **Money and quantities** are calculated with `decimal.js` and stored as `NUMERIC` in the database, never as plain numbers with rounding errors.
- **Tests don't use the internet.** All external APIs get fake responses via `fakeFetch` in `server/test/helpers.ts`; a test that goes out anyway fails. Note: `fakeFetch` picks the **longest** matching URL, so give your own fake response the full host and path if a default response matches it too.
- **Calculations get a test with a worked example**, with a comment explaining how you arrive at the expected number.
- **Tests work on any day of the year.** Calculate dates in a test from today (`daysAgo(100)`), and pick them so they don't fall on a month or year boundary. `scripts/test-dates.sh` runs the server tests as if it were a few tricky moments (New Year, the first and last day of a month, daylight saving time, a leap day), in UTC and in Dutch time. Run it after a change that calculates with dates.
- **Page tests** (`web/src/pages/*.dom.test.tsx`, with Testing Library and happy-dom) check what a page says for a fixed server response, and what it sends when you fill something in. The demo household's responses are in `web/src/test/demo.fixture.json`; refresh them with `npm run build:online-demo && npm run fixtures:demo`. Calculations belong on the server, not in the page.
- **Look at the pages after a change to the interface.** `npm run check:pages` opens every page with the demo (`npm run demo`) on a phone and a computer screen, light and dark, and reports console errors, a page that scrolls sideways and text that falls outside its card or is cut off. With paths after it (`npm run check:pages -- / /holdings`), only those pages.
- **Tax rules get a source** in `docs/box3-sources.md`: what the rule is, where it's written, and from when it applies. The figures themselves are in `server/src/rules/box3.json`; a new year goes in once the Belastingplan (tax plan) is adopted, with `"final": false` until the percentages for bank balances and debts are final (see [docs/en/belastingregels.md](docs/en/belastingregels.md)).
- **Templates for annual statements** are in `server/src/import/yearStatement.ts` (`TEMPLATES`), each with a test on a text sample with made-up data. A template recognises the document by fixed texts and says per value which label the amount follows.
- **Shared formats** (a file from _Share a format_) are data: a JSON file in `server/src/import/formats/shared/`, not code. Read a contribution completely before adding it; the steps are in [the README there](server/src/import/formats/shared/README.en.md), and `test/shared-formats.test.ts` checks every file. An annual statement from _Share a format_ becomes a template as above, with the shared text as its test.
- **Database changes:** change `server/src/db/schema.ts` and create a migration with `npm run db:generate -w server`. Migrations run automatically at startup and must keep old backups restorable.
- **Texts in the app** are written in English in `t("…")` (web) or `tr("…")` (server), with the Dutch translation in `web/src/i18n/nl.ts` or `server/src/i18n/nl.ts`. Use the terms from the tax return (banktegoeden, overige bezittingen, schulden, peildatum, heffingsvrij vermogen). The text must be a literal between double quotes, so the test that checks for missing translations finds it; counts go through `tn()`/`trn()`. Keep texts short and concrete.
- **Privacy:** Box3balans sends nothing to its makers and collects no usage data. New external services only for public data (such as prices), and list them in the README.
- **No personal data** in test files, examples or screenshots.

## Licence

Box3balans is licensed under the [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). By submitting a contribution you agree that it falls under the same licence.

## Conduct

Be kind and patient, also when you disagree. Everyone does this in their free time.
