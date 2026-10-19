# Gedeelde formaten

Exportformaten die gebruikers hebben gedeeld via _Help anderen dit bestand in te lezen_ op de importpagina ([ADR 0012](../../../../../docs/adr/0012-formaten-delen-zonder-gegevens.md)). Elk bestand is data, geen code: de kolominstellingen van iemands import, met een verzonnen voorbeeld in dezelfde opmaak en wat Box3balans daaruit leest. De app gebruikt een gedeeld formaat als een opgeslagen instelling, na de eigen formaten en de eigen instellingen van de gebruiker.

## Een bijdrage toevoegen

1. Download het bestand uit het issue (`box3balans-formaat-….json`) en lees het helemaal: `sample` mag niets bevatten dat op echte gegevens lijkt (namen, rekeningnummers, adressen, omschrijvingen). De test kijkt ook, maar alleen naar patronen.
2. Zet het hier neer, met een naam als `aanbieder-export.json` en een passende `id`.
3. Voeg het toe aan `FILES` in [`../shared.ts`](../shared.ts) (één import en één regel).
4. Draai `npx vitest run test/shared-formats.test.ts` in `server/`. Die controleert dat:
   - elk bestand in deze map in `FILES` staat;
   - het schema klopt;
   - geen ingebouwd formaat en geen eerder gedeeld formaat het voorbeeld claimt;
   - het voorbeeld precies zo gelezen wordt als `expected` zegt.

   Leest Box3balans het voorbeeld inmiddels anders (een verbetering van de import), werk dan `expected` bij, na controle.

5. Noem de aanbieder in `docs/aanbieders.md` en in de release notes.

Komt een formaat vaak voor of heeft het meer nodig dan een kolomindeling (bijvoorbeeld een transactie verdeeld over twee regels), maak er dan een eigen lezer van in `../` en haal het bestand hier weg.
