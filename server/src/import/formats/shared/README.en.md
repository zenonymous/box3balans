# Shared formats

_Nederlands: [README.md](README.md)_

Export formats users have shared via _Help others read this file_ on the import page ([ADR 0012](../../../../../docs/en/adr/0012-formaten-delen-zonder-gegevens.md)). Every file is data, not code: the column settings of someone's import, with a made-up example in the same layout and what Box3balans reads from it. The app uses a shared format like a saved setting, after its own formats and the user's own settings.

## Adding a contribution

1. Download the file from the issue (`box3balans-formaat-….json`) and read all of it: `sample` must not contain anything that looks like real data (names, account numbers, addresses, descriptions). The test checks too, but only for patterns.
2. Put it here, with a name like `provider-export.json` and a matching `id`.
3. Add it to `FILES` in [`../shared.ts`](../shared.ts) (one import and one line).
4. Run `npx vitest run test/shared-formats.test.ts` in `server/`. It checks that:
   - every file in this folder is in `FILES`;
   - the schema is right;
   - no built-in format and no previously shared format claims the example;
   - the example is read exactly as `expected` says.

   If Box3balans now reads the example differently (an improvement of the import), update `expected`, after checking.

5. Mention the provider in `docs/aanbieders.md` (and `docs/en/aanbieders.md`) and in the release notes.

If a format is common or needs more than a column layout (for example a transaction split over two rows), turn it into a separate reader in `../` and remove the file here.
