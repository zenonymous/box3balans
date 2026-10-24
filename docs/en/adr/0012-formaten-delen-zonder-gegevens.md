# Sharing formats without data

_Nederlands: [0012-formaten-delen-zonder-gegevens.md](../../adr/0012-formaten-delen-zonder-gegevens.md)_

A user with an export Box3balans doesn't know yet (a broker's CSV, or an annual statement as a PDF) can share the format without sharing their data. Box3balans makes a file for that on the user's own server; the user sees exactly what's in it, downloads it and attaches it to an issue themselves (the _Share a format_ form). The app sends nothing: no destination is added to [ADR 0011](0011-vaste-lijst-van-bestemmingen.md), and the button to GitHub is a plain link with no data in it.

**What stays is a fixed list; the rest is made up.** The code is in [`server/src/import/contribute.ts`](../../../server/src/import/contribute.ts).

- **A CSV:**
  - Stays: the header row, the words in the column with the transaction type, currency codes, words for asset classes and metals, and month names.
  - Made up, in the same form:
    - dates: in the same order, and equal days stay equal;
    - amounts: other values in the same notation, with the same sign;
    - ISINs and symbols: well-known funds and coins;
    - IDs: the same shape, never one from the file itself;
    - text: becomes `text-1`, `text-2`;
    - title rows: the same treatment.
  - How many rows: at most three per type, and at most forty in total.
- **An annual statement:**
  - Stays:
    - the text of the first page and of the pages with the ticked values;
    - ordinary words from statements;
    - the words of the ticked lines and of the provider's name;
    - years, and the days 1 January and 31 December.
  - Made up: every other number.
  - Struck out (`Xxxx`): every other word.

**The user can only remove more.** Every value that stays is in a list with a tick box; unticking makes that one made up too. Anything that looks like personal data is replaced without asking: a name from the household or the user name, an IBAN (with a valid check digit), an email address, a phone number or a BSN (Dutch citizen service number, eleven-test).

**A final check** looks for every word and every code from the file (except numbers, dates and what may stay) in the result. If one turns up, Box3balans starts again with other made-up values; if that fails five times, there's a message and no file.

**Tests:**

- Property-based tests (`test/fuzz.test.ts`) feed thousands of generated exports with random words in notes, title rows and extra columns. None of those words may end up in the shared file.
- A second property: a file with other amounts (of the same shape) and shifted dates gives exactly the same shared file with the same seed. So what you own doesn't shine through.

**Shared formats are data, not code.** A shared CSV format is a JSON file in [`server/src/import/formats/shared/`](../../../server/src/import/formats/shared/README.en.md):

- the column settings;
- the made-up example;
- what Box3balans reads from it.

How it's used:

- The app uses it like a saved setting, for files whose header row starts with it.
- It comes after Box3balans's own formats and after the user's own settings.
- The user sees that the format comes from another user, and can still adjust the columns.

So a file from a stranger can't execute anything. A test checks per file the schema, that no other format claims the example, that the example is read exactly as the file says, and that nothing in it looks like an IBAN, email address, phone number or BSN. For now an annual statement becomes a template by hand (in `yearStatement.ts`).

## What does become public

- That the user has an account with that provider, under their GitHub name.
- The header row, the words for the type and the year of a statement.
- Anyone who doesn't want that can use a separate GitHub account.

## Considered

- **Letting users anonymise it themselves** (as the forms asked at first): error-prone. An IBAN or a name in a description is easily overlooked, and the maintainer still has to write code afterwards.
- **Searching for personal data and leaving the rest:** a search list always misses something, such as a name that isn't in the household or an address in a free field. Hence the reverse approach: only what's on the list stays.
- **A pull request straight from the app:** the app would have to log in to GitHub, store a key and get GitHub as a destination. That undermines the promise that Box3balans only talks to price sources. A GitHub account is needed anyway, and an issue with the file achieves the same.
- **A workflow that turns an issue into a pull request by itself:** handy once contributions arrive. For now the maintainer adds the file themselves; that step is the same check.
- **A shared format as code (a separate reader per contribution):** more powerful, but code from strangers needs careful review and can do anything. What a column layout can't express, such as a transaction split over two rows, therefore still becomes a separate reader, with the example from the contribution as its test.
