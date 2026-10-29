# Box 3: gebruikte regels en hun bronnen

_English: [en/box3-sources.md](en/box3-sources.md)_

Gecontroleerd op 8 oktober 2026. Box 3 verandert vaak: controleer deze regels opnieuw voordat je op de cijfers van een jaar vertrouwt.

## Forfaitair rendement (belastingjaren vanaf 2023)

De officiële stappen en de cijfers voor 2023–2026 staan in `server/src/domain/box3.ts` (`DEFAULT_RATES`). Je kunt ze aanpassen in de app onder _Box 3 → Regels en tarieven_.

**Afronding** zoals in de rekenvoorbeelden van de Belastingdienst: bezittingen naar beneden en schulden naar boven op hele euro's; het forfaitaire rendement op bezittingen naar beneden en dat op schulden op de dichtstbijzijnde euro (€ 2.494,80 → € 2.495; **aanname**: naar boven afronden geeft in dat voorbeeld hetzelfde, en een voorbeeld dat de twee uit elkaar houdt is nog niet gevonden; het verschil is hooguit € 1 rendement); het aandeel naar beneden op twee decimalen van een procent (82,456% → 82,45%); het voordeel en de belasting per persoon naar beneden op hele euro's. Fiscale partners krijgen elk hun eigen aandeel. De vijf voorbeelden voor 2025 staan als test in `server/test/box3.test.ts` en komen precies uit.

- Belastingdienst, _Hoe wordt mijn box 3-inkomen over 2025 berekend?_ (rekenvoorbeelden, gecontroleerd 7 oktober 2026): https://www.belastingdienst.nl/wps/wcm/connect/nl/box-3/content/berekening-box-3-inkomen-2025

**2027 staat erin als voorstel** (sinds 0.1.11; `"proposal": true` in `box3.json`), met de cijfers uit de kabinetsbrief hieronder. De app zegt dat ook bij de berekening: het heffingsvrij vermogen en het percentage voor overige bezittingen zijn een voorstel, de andere cijfers die van 2026. Stand op 9 oktober 2026:

- **Belastingplan 2027** (Prinsjesdag, 15 september 2026; wetsvoorstel 37.022): box 3 staat niet in het pakket zelf. De kerncijfers gingen uit van een heffingsvrij vermogen van € 60.098 en een tarief van 36%; de gewone actualisatie brengt het forfaitaire rendement op overige bezittingen op 6,37% (was 6,00%).
- **Brief van het kabinet van 29 september 2026** (Tweede Kamer 2026Z20444): per 2027 gaat het heffingsvrij vermogen terug naar het niveau van 2020, **€ 30.846** per persoon, en het forfait voor overige bezittingen, inclusief huurinkomsten en voordelen uit eigen gebruik van onroerende zaken, gaat **1,5 procentpunt omhoog** (dus naar 7,87%). Dat betaalt mee aan de novelle hieronder.
- **Nog niet aangenomen:** de Tweede Kamer moet nog stemmen, en de bedragen kunnen in het debat nog veranderen.
- **Groene beleggingen:** de vrijstelling en de heffingskorting vervallen per 1 januari 2028, niet al in 2027 zoals eerst gepland. De bedragen voor 2027 volgen met de vaste cijfers.
- De percentages voor banktegoeden en schulden over 2027 zijn pas na afloop van het jaar definitief.

Eerder dan [belastingregels.md](belastingregels.md) voorschrijft: 2027 is al toegevoegd, zodat het jaar klaarstaat. De schuldendrempel, de groene vrijstelling en de percentages voor banktegoeden en schulden zijn die van 2026 tot de cijfers van 2027 bekend zijn. **In december controleren** zodra het Belastingplan is aangenomen, en de bron van 2027 vervangen door de aangenomen tekst of de pagina van de Belastingdienst ([#4](https://github.com/zenonymous/box3balans/issues/4)). Wie andere cijfers wil, past ze aan onder _Regels en tarieven_.

- Kabinet, _Voorstellen op box 3, koopkracht werkenden en sociale zekerheid_ (29 september 2026, afschrift aan de Eerste Kamer): https://www.eerstekamer.nl/brief_in/20260930/voorstellen_op_box_3_koopkracht/f=/vn1fdr15xiz6.pdf
- Eerste Kamer, _Belastingplan 2027 (37.022)_: https://www.eerstekamer.nl/wetsvoorstel/37022_belastingplan_2027
- Deloitte, _Pakket Belastingplan 2027: tarieven en heffingskortingen_ (forfait 6,37%): https://www.deloitte.com/nl/nl/services/tax/blogs/pakket-belastingplan-2027-tarieven-heffingskortingen.html
- Rendement, _Vrijstelling groene beleggingen vervalt pas per 2028_: https://www.rendement.nl/inkomen-uit-sparen-en-beleggen/nieuws/vrijstelling-groene-beleggingen-vervalt-pas-per-2028.html
- Holdwise, _Box 3 in 2027_: https://holdwise.nl/kennisbank/box-3-2027

## Wat in welke categorie valt, en van wie het is

Wat de app toepast (Box3balans: _Huishouden_ en _Rekeningen_):

- **Banktegoeden:** bank- en spaartegoeden in Nederland en daarbuiten, contant geld boven de vrijstelling (per persoon € 596 in 2023, € 653 in 2024, € 661 in 2025, € 672 in 2026; het dubbele voor partners die het hele jaar fiscale partner zijn), premiedepots, het niet-vrijgestelde deel van groene spaartegoeden.
- **Overige bezittingen** (beleggingen en andere bezittingen): aandelen, obligaties en andere beleggingen, het niet-vrijgestelde deel van groene beleggingen, overige vorderingen (zoals uitgeleend geld, behalve tussen fiscale partners of tussen ouders en minderjarige kinderen), een tweede woning, een verhuurde woning, overige onroerende zaken, cryptovaluta, kapitaalverzekeringen (met hun eigen vrijstellingen, die de app niet toepast).
- **Schulden:** schulden die niet bij de eigen woning horen, zoals consumptief krediet, studieschuld en leningen voor beleggingen of een tweede woning. Alleen het deel boven de schuldendrempel telt (€ 3.700 in 2024, € 3.800 in 2025 en 2026, per persoon).
- **Verhuurde woning:** met huurbescherming telt de WOZ-waarde voor een percentage dat afhangt van de jaarhuur als percentage van de WOZ-waarde: tot en met 1% → 73%; tot en met 2% → 79%; tot en met 3% → 84%; tot en met 4% → 90%; tot en met 5% → 95%; meer → 100%. Dezelfde tabel geldt voor 2023 tot en met 2026 (in `box3.json` per eerste jaar, zodat een nieuwe tabel erbij kan). Verhuur je de woning voor een huur ver onder de gewone, bijvoorbeeld aan je kind of je eigen bv, dan telt altijd 100% (in de app: _aan familie, ver onder de gewone huur_). Gebruikt wordt de WOZ-waarde met waardepeildatum 1 januari van het jaar vóór het belastingjaar.
- **Fiscale partners** mogen de gezamenlijke grondslag sparen en beleggen verdelen zoals ze willen, als het totaal 100% is.
- **Minderjarige kinderen:** hun bezittingen tellen voor de ouder met gezag; hebben beide ouders gezag, dan ieder de helft. Wie op 1 januari 18 of ouder is, doet zelf aangifte.

Bronnen:

- Belastingdienst, _Hoe wordt het box 3-inkomen over 2025 berekend?_ (categorieën, verdeling tussen partners): https://www.belastingdienst.nl/wps/wcm/connect/nl/box-3/content/berekening-box-3-inkomen-2025
- Belastingdienst, _Bezittingen en schulden box 3_ per jaar (leegwaarderatio, WOZ-waardepeildatum, contant geld, kinderen, schuldendrempel): https://www.belastingdienst.nl/wps/wcm/connect/fisin/fisin2026/bezittingen_en_schulden_box_3_ (en `fisin2023`, `fisin2024`, `fisin2025`)

## Tegenbewijsregeling: werkelijk in plaats van forfaitair rendement (Wet tegenbewijsregeling box 3)

Is je werkelijke rendement lager dan het forfaitaire, dan kun je over het werkelijke rendement belast worden. Over **2024 en eerder** geef je het door met het formulier _Opgaaf werkelijk rendement_ (OWR) in Mijn Belastingdienst, beschikbaar sinds 8 juli 2025. **Vanaf 2025** vraagt de aangifte inkomstenbelasting zelf of je je werkelijk rendement wilt opgeven; de Belastingdienst rekent dan beide manieren uit en gebruikt de gunstigste.

Wat de app toepast (Box3balans: _Box 3 → jaar → Werkelijk rendement_):

- **Werkelijk rendement** = direct rendement (rente, dividenden **bruto**, huur, andere inkomsten zoals stakingbeloningen) + indirect rendement (alle waardeveranderingen, gerealiseerd en ongerealiseerd, van elke box 3-bezitting die je in het jaar had, niet alleen die op 1 januari) − **werkelijk betaalde rente op box 3-schulden**.
- **Kosten zijn niet aftrekbaar**, behalve rente op schulden. Transactie- en accountkosten verlagen het niet, en ingehouden dividendbelasting ook niet: dividenden tellen bruto.
- **Geen heffingsvrij vermogen** en geen schuldendrempel.
- **Een negatief totaal telt als € 0.** Verliezen schuiven niet door naar andere jaren.
- Rendementen zijn nominaal, zonder inflatiecorrectie, en rente telt in het jaar waarin die opkomt (niet wanneer die wordt uitbetaald). **Benadering in de app:** een transactie telt in het jaar van haar datum. Rente over december die begin januari wordt bijgeschreven, telt dan een jaar te laat; de app waarschuwt bij rente op 1 tot en met 7 januari.
- **Belasting:** het box 3-tarief (36% vanaf 2024) × het werkelijke rendement. Je betaalt nooit meer dan met het forfaitaire rendement: het laagste van de twee geldt.
- **Heffingskorting groene beleggingen:** een heffingskorting op de inkomstenbelasting als geheel, dus bij beide manieren. De app trekt haar daarom aan beide kanten af voordat ze vergelijkt (**aanname**: de Belastingdienst noemt haar niet apart bij het werkelijk rendement).
- **Fiscale partners:** verdeeld naar hun aandeel in de gezamenlijke grondslag. Voor de belasting samen maakt dat niets uit: er is geen heffingsvrij deel en het tarief is vlak.
- **Groene beleggingen:** hun rendement is naar verhouding vrijgesteld. De app laat groene rekeningen en rekeningen "niet in box 3" buiten het werkelijk rendement; dat is een benadering.
- **Rekeningen met waarden per jaar:** de waarde op 1 januari van het jaar erna, min die op 1 januari, min geld erin, plus geld eruit, plus inkomsten. Rente of dividend dat op de rekening zelf binnenkomt, zit al in de eindwaarde en telt één keer. Bij een schuld telt alleen de betaalde rente (aflossen is geen rendement). Een minderjarig kind telt het hele jaar mee voor de ouders, ook als het in de loop van het jaar 18 wordt; de Belastingdienst rekent in dat geval alleen tot de dag van meerderjarigheid. Dat is een benadering. Voor het lopende jaar, zonder waarde op 1 januari erna, is de eindwaarde voorlopig die op 1 januari plus geld erin, min geld eruit, plus de bijgeschreven inkomsten.
- **Bronbelasting op rente uit het buitenland:** de rente telt bruto, net als dividend; wat het land inhield, staat bij de ingehouden belasting. De aangifte vraagt bij elke buitenlandse rekening naar de bruto rente en de ingehouden bronbelasting, en verrekent die tot een maximum (het verdragstarief); meer vraag je terug in dat land. Woon je in het buitenland, dan verreken je niets. Op huur en op betaalde rente legt de app geen bronbelasting vast: voor onroerend goed in het buitenland geldt vrijstelling, geen verrekening.

Bronnen:

- Belastingdienst, _Te verrekenen belasting_ (bronheffing op buitenlandse spaartegoeden, tot een maximum te verrekenen): https://www.belastingdienst.nl/wps/wcm/connect/fisin/fisin2025/te_verrekenen_belasting
- Raisin, _Belasting_ (per land de bronbelasting, het verrekenbare deel en waar het in de aangifte staat; tweedehands): https://www.raisin.com/nl-nl/belasting/
- Belastingdienst, _Wat is mijn werkelijk rendement?_: https://www.belastingdienst.nl/wps/wcm/connect/nl/box-3/content/wat-is-mijn-werkelijk-rendement
- Belastingdienst, _Werkelijk rendement in belastingaangifte 2025_: https://www.belastingdienst.nl/wps/wcm/connect/nl/box-3/content/werkelijk-rendement-belastingaangifte
- Belastingdienst, _Rekenvoorbeelden berekening werkelijk rendement_ (gecontroleerd 7 oktober 2026; voorbeelden 3, 4 en 8 staan als test in `server/test/box3-examples.test.ts`). De voorbeelden met een verhuurde woning rekenen de waardeverandering over de volle WOZ-waarde; Box3balans gebruikt de leegwaarde, net als voor het forfaitaire rendement. Welke van de twee klopt voor het werkelijk rendement is niet zeker: https://www.belastingdienst.nl/wps/wcm/connect/nl/box-3/content/rekenvoorbeelden-berekening-werkelijk-rendement
- Belastingdienst, veelgestelde vragen over de Opgaaf werkelijk rendement (geen heffingsvrij vermogen; partners): https://www.belastingdienst.nl/wps/wcm/connect/nl/box-3/content/veelgestelde-vragen-opgaaf-werkelijk-rendement
- SRA, overzicht van de tegenbewijsregeling 2017–2027 (bruto dividenden, geen schuldendrempel, partners, toerekening van rente): https://www.sra.nl/dossiers/dossier-hoge-raad-box-3/tegenbewijsregeling-box-3-2017-2027/box-3-een-overzichtsartikel-met-de-belangrijkste-verwijzingen-werkelijk-rendement-box-3-2017-2026

## Vanaf 2028: Wet werkelijk rendement box 3 (wetsvoorstel 36.748), nog geen wet

Stand op 8 oktober 2026:

- **Tweede Kamer:** nam het wetsvoorstel aan op 12 februari 2026.
- **Eerste Kamer:** stelde de stemming uit tot ze een novelle (wijzigingswet) heeft behandeld.
- **Novelle** (brief van het kabinet van 29 september 2026): in plaats van elk jaar de waardeverandering te belasten (vermogensaanwas), komt er per 2028 een **vermogenswinstbelasting**, belasting bij verkoop, voor alle financiële instrumenten zoals aandelen, obligaties en opties. Volgens het kabinet is dat circa 90% van het vermogen met waardeontwikkeling in box 3. In 2030 volgen de overige bezittingen. Het **heffingsvrij resultaat wordt € 1.000** (in het wetsvoorstel € 1.800). De novelle moet vóór 31 december 2026 door de Eerste Kamer zijn aangenomen. Banken kunnen in het eerste jaar nog geen gegevens aanleveren voor de vooraf ingevulde aangifte.

Regels van het wetsvoorstel zoals de Tweede Kamer het aannam (de standaardinstelling van de vooruitblik in de app):

- **Vermogensaanwasbelasting als hoofdregel:** elk jaar het directe rendement plus de gerealiseerde en ongerealiseerde waardeveranderingen, min kosten. Onroerend goed en aandelen in startende ondernemingen worden belast bij verkoop (vermogenswinstbelasting).
- **Onroerende zaken:** de winst telt bij verkoop, of als de zaak box 3 op een andere manier verlaat. Voor wat je op 1 januari 2028 al had, is de verkrijgingsprijs de waarde op dat moment, bij een woning de WOZ-waarde (art. 10a.31). Elk jaar telt de huur als de zaak het hele of nagenoeg het hele jaar verhuurd is, of als de huur hoger is dan de **vastgoedbijtelling**; anders telt de vastgoedbijtelling: **3,35%** van de waarde, bij een woning de WOZ-waarde, naar rato van de dagen dat je de zaak had (art. 5.15, 5.19 en 5.20). Een samenvatting van het wetsvoorstel noemt 3,55%, maar de tekst die de Tweede Kamer aannam zegt 3,35%.
- **Kosten zijn aftrekbaar**, inclusief transactiekosten, accountkosten en betaalde rente. Dividendbelasting is niet aftrekbaar.
- **Tarief:** 36%.
- **Heffingsvrij resultaat:** € 1.800 per belastingplichtige.
- **Verliezen** boven € 500 schuiven door naar latere jaren. Terugwenteling naar een eerder jaar staat niet in het wetsvoorstel; de brief van 29 september zegt daar niets over.
- **Groene beleggingen** houden een heffingskorting.

Vóór de brief van 29 september onderzocht het kabinet opties als een tarief van 35%, een heffingsvrij resultaat van € 1.900 en één jaar verliesverrekening naar achteren. De vooruitblik in de app heeft daarom naast het wetsvoorstel de instelling _Kabinetsbrief 29 sep 2026_: € 1.000 heffingsvrij resultaat, 36% en geen terugwenteling (de brief noemt die niet). **Belasting bij verkoop van financiële instrumenten bootst de vooruitblik nog niet na** ([issue #11](https://github.com/zenonymous/box3balans/issues/11)); voor beleggingen die je niet verkoopt, toont hij dus meer belasting dan de novelle zou heffen. Elke instelling is aan te passen.

Niet beschreven in de bronnen, en aangenomen door de app:

- De winst op een woning telt vanaf de WOZ-waarde van het jaar na het eerste dat je invulde. Voor wat je op 1 januari 2028 al had, neemt het wetsvoorstel de WOZ-waarde met waardepeildatum 1 januari 2028, en dat is de WOZ-waarde van 2029. Voor een woning die je in die jaren kocht, telt de aankoopprijs.
- Bij een woning vul je bij _Gekocht of verbeterd_ de aankoopprijs met de kosten van de aankoop in, en wat je aan verbeteringen uitgaf; bij _Verkocht voor_ de verkoopprijs min de kosten van de verkoop (art. 5.22 en 5.23). De woning is verkocht in het jaar waarna haar waarde op 1 januari 0 is.
- Een woning die box 3 verlaat, bijvoorbeeld omdat ze je eigen woning wordt, telt als verkocht aan het eind van het jaar ervoor, tegen haar waarde op de 1 januari daarna (art. 5.31). Een verandering in het deel dat je van een woning hebt, telt niet als verkoop.
- Een woning die verhuurd is met huurbescherming, is het hele jaar verhuurd. Andere huur telt alleen als die hoger is dan de vastgoedbijtelling, ook als de woning zonder huurbescherming het hele jaar verhuurd was.
- De vastgoedbijtelling telt over het hele jaar, ook in het jaar van verkoop: de app kent de datum van verkoop niet. In het jaar van aankoop is de waarde op 1 januari 0, dus telt ze dan niet. In het lopende jaar telt het deel van het jaar dat voorbij is.
- De kosten van een woning, zoals onderhoud, gaan elk jaar af, ook als de vastgoedbijtelling telt, zoals samenvattingen van het wetsvoorstel het beschrijven. Artikel 5.38 noemt alleen kosten voor de huur.
- Een verlies van minstens de drempel schuift volledig door.
- Doorgeschoven verliezen worden verrekend met het resultaat dat overblijft na het heffingsvrije resultaat.

Bronnen:

- Eerste Kamer, wetsvoorstel 36.748: https://www.eerstekamer.nl/wetsvoorstel/36748_wet_werkelijk_rendement_box
- Wetsvoorstel zoals de Tweede Kamer het aannam (Kamerstukken I 36.748, A), artikelen 5.15, 5.19, 5.20 en 10a.31: https://zoek.officielebekendmakingen.nl/kst-36748-A.html
- Kabinet, _Voorstellen op box 3, koopkracht werkenden en sociale zekerheid_ (29 september 2026): https://www.eerstekamer.nl/brief_in/20260930/voorstellen_op_box_3_koopkracht/f=/vn1fdr15xiz6.pdf
- SRA, _Wet werkelijk rendement box 3 (voorlopig) nog niet aangenomen_: https://www.sra.nl/nieuwsoverzicht/2026/wet-werkelijk-rendement-box-3-voorlopig-nog-niet-aangenomen
- SRA, overzicht van het wetsvoorstel (tarief, € 1.800, € 500, aftrekbare kosten): https://www.sra.nl/dossiers/dossier-hoge-raad-box-3/box-3-vanaf-2027/box-3-een-overzichtsartikel-met-de-belangrijkste-verwijzingen-box-3-vanaf-2027
- Rijksoverheid, _Plannen werkelijk rendement box 3_: https://www.rijksoverheid.nl/onderwerpen/inkomstenbelasting/plannen-werkelijk-rendement-box-3
- Nextens, opties voor de novelle (22 juni 2026): https://www.nextens.nl/fiscaal-nieuws/nieuws/cat2/wet-werkelijk-rendement-box-3-krijgt-novelle-op-prinsjesdag/
