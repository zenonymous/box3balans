# De belastingregels bijwerken

De box 3-cijfers waarmee Box3balans rekent, staan in [`server/src/rules/box3.json`](../server/src/rules/box3.json), los van de code: per jaar de forfaitaire percentages, het heffingsvrij vermogen, de schuldendrempel, het tarief, de grens en heffingskorting voor groene beleggingen, of de cijfers definitief zijn, en de bron. Daarnaast de tabel met de leegwaarderatio voor verhuurde woningen, en `checkedAt`: de datum waarop alles voor het laatst is gecontroleerd.

De app toont die datum op de pagina Box 3 (onder _Regels en tarieven_), met per jaar een link naar de bron. Is `checkedAt` meer dan 400 dagen oud, dan verschijnt bij _Aandacht nodig_ een melding dat er nieuwere cijfers kunnen zijn. Gebruikers kunnen elk tarief zelf aanpassen; hun aanpassingen gaan voor op het bestand.

## Wanneer

| Moment                                    | Wat                                                                                                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prinsjesdag (derde dinsdag van september) | Het Belastingplan noemt de voorgestelde cijfers voor het volgende jaar. Noteer ze met bron in [`box3-sources.md`](box3-sources.md), maar bouw ze nog niet in: ze kunnen nog veranderen.                                                                |
| December                                  | Het Belastingplan is aangenomen: voeg het jaar toe met `"final": false`. Heffingsvrij vermogen, schuldendrempel, tarief, groene grens en het percentage voor overige bezittingen staan dan vast; die voor banktegoeden en schulden zijn nog voorlopig. |
| Na afloop van het jaar (januari–februari) | De Belastingdienst maakt de definitieve percentages voor banktegoeden en schulden bekend. Werk ze bij en zet `"final": true`.                                                                                                                          |
| Bij elke wijziging                        | Zet `checkedAt` op de datum van controle en zet de bron bij het jaar.                                                                                                                                                                                  |

Controleer ook of de regels zelf veranderen, niet alleen de cijfers: bijvoorbeeld het eind van de vrijstelling voor groene beleggingen (per 2028) of het stelsel op basis van werkelijk rendement (wetsvoorstel 36.748, met de novelle die vanaf 2028 vermogenswinst belast). Zulke wijzigingen vragen om code en tests, niet alleen om het bestand. Zet bronnen en uitleg in [`box3-sources.md`](box3-sources.md).

## Hoe

1. Pas `server/src/rules/box3.json` aan. Bedragen en percentages staan als tekst (`"1.37"`), zodat er niet wordt afgerond.
2. Draai `npm test`. Bij het starten wordt het bestand gecontroleerd: een typfout geeft een duidelijke fout in plaats van een verkeerde belasting. De rekenvoorbeelden van de Belastingdienst staan als test in `server/test/box3.test.ts`; voeg die van het nieuwe jaar toe zodra ze er zijn ("Hoe wordt mijn box 3-inkomen over <jaar> berekend?").
3. Maak een nieuwe versie (zie [releasen.md](releasen.md)) en schrijf in de release notes welke cijfers er nieuw zijn.
