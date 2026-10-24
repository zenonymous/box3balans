# The landing page lives on the gh-pages branch

_Nederlands: [0008-landingspagina-op-gh-pages.md](../../adr/0008-landingspagina-op-gh-pages.md)_

The page for box3balans.nl (`index.html`, `CNAME`, images) lives on its own `gh-pages` branch with no history shared with `main`, and GitHub Pages publishes that branch directly. It doesn't belong in `main` and isn't merged. Moving it to a folder in `main` with a workflow to publish it was proposed in October 2026 and rejected by the owner; don't propose it again without a new reason.
