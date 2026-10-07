# Uitgaven maken (voor beheerders)

## Eenmalig, bij het publiceren op GitHub

1. Vervang de plaatshouder `OWNER` door de GitHub-naam (of organisatie) van de repository, in alle bestanden:

   ```bash
   grep -rl --exclude-dir=node_modules --exclude-dir=.git --exclude=releasen.md '/OWNER/' . | xargs sed -i '' 's#/OWNER/#/<github-naam>/#g'
   ```

   (Op Linux zonder `''` na `-i`.) Controleer daarna met `grep -rn /OWNER/ --exclude-dir=node_modules --exclude=releasen.md .` dat er niets meer staat.

2. Maak de repository aan en push `main`. De workflow **CI** test elke push en publiceert `ghcr.io/<github-naam>/box3balans:edge`.
3. Zet het package openbaar: GitHub → je profiel → **Packages** → `box3balans` → **Package settings** → **Change visibility** → Public. Een nieuw package is standaard privé, en dan kan niemand het image downloaden.
4. Zet onder **Settings → Security** de optie **Private vulnerability reporting** aan, zodat [SECURITY.md](../SECURITY.md) werkt.
5. Optioneel: bescherm `main` (**Settings → Branches**) zodat pull requests eerst door CI moeten.

## Een nieuwe versie uitbrengen

Versies volgen [semantic versioning](https://semver.org/lang/nl/): `MAJOR.MINOR.PATCH`.

- **PATCH** (1.2.3 → 1.2.4): fouten opgelost.
- **MINOR** (1.2 → 1.3): nieuwe mogelijkheden, zonder dat gebruikers iets hoeven te doen.
- **MAJOR** (1 → 2): gebruikers moeten iets doen, zoals een nieuwe PostgreSQL-hoofdversie (back-up en terugzetten) of een aangepast compose-bestand. Zet dat bovenaan de release notes.

1. Zorg dat CI op `main` groen is.
2. Maak de tag en push hem:

   ```bash
   git tag v1.3.0
   git push origin v1.3.0
   ```

   CI publiceert dan `:1.3.0`, `:1.3` en `:latest`, voor Intel/AMD en ARM. Een proefversie zoals `v1.4.0-rc.1` krijgt alleen zijn eigen tag; `latest` blijft staan.

3. Maak op GitHub een release van de tag (**Releases → Draft a new release**, **Generate release notes**) en schrijf erboven in gewone taal wat er voor gebruikers verandert. De controle op nieuwe versies in de app (voor wie die aanzet) kijkt naar de nieuwste gepubliceerde release, niet naar tags en niet naar proefversies: zonder release ziet niemand de nieuwe versie.

## Elk jaar: belastingregels

De box 3-cijfers staan in `server/src/rules/box3.json`. Wanneer en hoe je ze bijwerkt (Prinsjesdag, december, na afloop van het jaar) staat in [belastingregels.md](belastingregels.md). Breng daarna een versie uit, zodat iedereen de nieuwe cijfers krijgt. Wetswijzigingen (zoals het stelsel vanaf 2028) vragen om code en tests: werk ook [box3-sources.md](box3-sources.md) en de vooruitblik bij.
