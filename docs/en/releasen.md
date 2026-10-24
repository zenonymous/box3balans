# Making releases (for maintainers)

_Nederlands: [releasen.md](../releasen.md)_

## Once, when publishing on GitHub

Done for `zenonymous/box3balans`. If you publish your own fork with your own images, do the same for that repository:

1. Replace `zenonymous` with the GitHub name (or organisation) of the repository, in all files:

   ```bash
   grep -rl --exclude-dir=node_modules --exclude-dir=.git --exclude=releasen.md '/zenonymous/' . | xargs sed -i '' 's#/zenonymous/#/<github-name>/#g'
   ```

   (On Linux without `''` after `-i`.) Then check with `grep -rn /zenonymous/ --exclude-dir=node_modules --exclude=releasen.md .` that nothing is left.

2. Create the repository and push `main`. The **CI** workflow tests every push and publishes `ghcr.io/<github-name>/box3balans:edge`.
3. After the first run, check that the package is public, or nobody can download the image. With a public repository it is right away (that's how it went for `zenonymous/box3balans`); if not: GitHub → your profile → **Packages** → `box3balans` → **Package settings** → **Change visibility** → Public.
4. Under **Settings → Security**, turn on **Private vulnerability reporting**, so [SECURITY.md](../../SECURITY.md) works.
5. Optional: protect `main` (**Settings → Branches**) so pull requests have to pass CI first.

## Releasing a new version

Versions follow [semantic versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

- **PATCH** (1.2.3 → 1.2.4): bugs fixed.
- **MINOR** (1.2 → 1.3): new features, without users having to do anything.
- **MAJOR** (1 → 2): users have to do something, such as a new PostgreSQL major version (backup and restore) or a changed compose file. Put that at the top of the release notes.

1. Make sure CI on `main` is green.
2. Create the tag and push it:

   ```bash
   git tag v1.3.0
   git push origin v1.3.0
   ```

   CI then publishes `:1.3.0`, `:1.3` and `:latest`, for Intel/AMD and ARM. A pre-release such as `v1.4.0-rc.1` only gets its own tag; `latest` stays where it is.

3. Create a release from the tag on GitHub (**Releases → Draft a new release**, **Generate release notes**) and write above it, in plain language, what changes for users. The in-app check for new versions (for those who turn it on) looks at the newest published release, not at tags and not at pre-releases: without a release nobody sees the new version.

4. After that the **Release files** workflow attaches the source code, the SBOM and the checksums with their signatures to the release (see [SECURITY.md](../../SECURITY.md#verifying-downloads)); for an earlier release you start it by hand, with the tag.
5. The **Online demo** workflow puts the [online demo](https://box3balans.nl/demo/) of this version in `demo/` on the `gh-pages` branch ([ADR 0010](adr/0010-online-demo-zonder-server.md)). It also runs on 1 January, so the years in the demo move along, and can be started by hand (**Actions → Online demo → Run workflow**); it always builds the newest release.

## App catalogues

The templates are in [`deploy/`](../../deploy): for Unraid (Community Applications) and for CasaOS and ZimaOS. They use the `:latest` image, so a new release comes along by itself; CI checks on every push that they're still valid.

- **Unraid:** the template points to `main` with `TemplateURL`. Submitting to Community Applications is done by the maintainer following their instructions; the [Discussions](https://github.com/zenonymous/box3balans/discussions/categories/q-a) serve as the support page.
- **CasaOS:** the file already works via _Custom Install → Import_. Inclusion in the CasaOS App Store goes through a pull request on their AppStore repository.

## Every year: tax rules

The box 3 figures are in `server/src/rules/box3.json`. When and how to update them (Prinsjesdag, December, after the year has ended) is in [belastingregels.md](belastingregels.md). Then release a version, so everyone gets the new figures. Changes in the law (such as the system from 2028) need code and tests: also update [box3-sources.md](box3-sources.md) and the preview.
