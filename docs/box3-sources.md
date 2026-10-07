# Box 3: gebruikte regels en hun bronnen

Gecontroleerd op 5 oktober 2026. Box 3 verandert vaak: controleer deze regels opnieuw voordat je op de cijfers van een jaar vertrouwt.

## Forfaitair rendement (belastingjaren vanaf 2023)

De officiële stappen en de cijfers voor 2023–2026 staan in `server/src/domain/box3.ts` (`DEFAULT_RATES`). Je kunt ze aanpassen in de app onder _Box 3 → Regels en tarieven_.

**Afronding** zoals in de rekenvoorbeelden van de Belastingdienst: bezittingen naar beneden en schulden naar boven op hele euro's; het forfaitaire rendement op bezittingen naar beneden en dat op schulden op de dichtstbijzijnde euro (€ 2.494,80 → € 2.495); het aandeel naar beneden op twee decimalen van een procent (82,456% → 82,45%); het voordeel en de belasting per persoon naar beneden op hele euro's. Fiscale partners krijgen elk hun eigen aandeel. De vijf voorbeelden voor 2025 staan als test in `server/test/box3.test.ts` en komen precies uit.

- Belastingdienst, _Hoe wordt mijn box 3-inkomen over 2025 berekend?_ (rekenvoorbeelden, gecontroleerd 7 oktober 2026): https://www.belastingdienst.nl/wps/wcm/connect/nl/box-3/content/berekening-box-3-inkomen-2025

**2027 zit er nog niet in.** De kerncijfers bij het Belastingplan 2027 (30 september 2026) noemen een heffingsvrij vermogen van € 60.098. Maar de brief van het kabinet van 29 september 2026 stelt voor dat te verlagen naar € 30.846 en het forfaitaire rendement op overige bezittingen met 1,5 procentpunt te verhogen, naar 7,87%, om de novelle hieronder te betalen. Volgens [belastingregels.md](belastingregels.md) komt 2027 erin zodra het Belastingplan is aangenomen (december), als voorlopig jaar. Tot die tijd kun je het zelf toevoegen onder _Regels en tarieven_.

- Holdwise, _Box 3 in 2027_: https://holdwise.nl/kennisbank/box-3-2027

## Wat in welke categorie valt, en van wie het is

Wat de app toepast (Box3balans: _Huishouden_ en _Rekeningen_):

- **Banktegoeden:** bank- en spaartegoeden in Nederland en daarbuiten, contant geld boven de vrijstelling (per persoon € 596 in 2023, € 653 in 2024, € 661 in 2025, € 672 in 2026; het dubbele voor partners die het hele jaar fiscale partner zijn), premiedepots, het niet-vrijgestelde deel van groene spaartegoeden.
- **Overige bezittingen** (beleggingen en andere bezittingen): aandelen, obligaties en andere beleggingen, het niet-vrijgestelde deel van groene beleggingen, overige vorderingen (zoals uitgeleend geld, behalve tussen fiscale partners of tussen ouders en minderjarige kinderen), een tweede woning, een verhuurde woning, overige onroerende zaken, cryptovaluta, kapitaalverzekeringen (met hun eigen vrijstellingen, die de app niet toepast).
- **Schulden:** schulden die niet bij de eigen woning horen, zoals consumptief krediet, studieschuld en leningen voor beleggingen of een tweede woning. Alleen het deel boven de schuldendrempel telt (€ 3.700 in 2024, € 3.800 in 2025 en 2026, per persoon).
- **Verhuurde woning:** met huurbescherming telt de WOZ-waarde voor een percentage dat afhangt van de jaarhuur als percentage van de WOZ-waarde: tot en met 1% → 73%; tot en met 2% → 79%; tot en met 3% → 84%; tot en met 4% → 90%; tot en met 5% → 95%; meer → 100%. Dezelfde tabel geldt voor 2023 tot en met 2026. Gebruikt wordt de WOZ-waarde met waardepeildatum 1 januari van het jaar vóór het belastingjaar.
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
- Rendementen zijn nominaal, zonder inflatiecorrectie, en rente telt in het jaar waarin die opkomt (niet wanneer die wordt uitbetaald).
- **Belasting:** het box 3-tarief (36% vanaf 2024) × het werkelijke rendement. Je betaalt nooit meer dan met het forfaitaire rendement: het laagste van de twee geldt.
- **Fiscale partners:** verdeeld naar hun aandeel in de gezamenlijke grondslag. Voor de belasting samen maakt dat niets uit: er is geen heffingsvrij deel en het tarief is vlak.
- **Groene beleggingen:** hun rendement is naar verhouding vrijgesteld. De app laat groene rekeningen en rekeningen "niet in box 3" buiten het werkelijk rendement; dat is een benadering.
- **Rekeningen met waarden per jaar:** de waarde op 1 januari van het jaar erna, min die op 1 januari, min geld erin, plus geld eruit, plus inkomsten. Rente of dividend dat op de rekening zelf binnenkomt, zit al in de eindwaarde en telt één keer. Bij een schuld telt alleen de betaalde rente (aflossen is geen rendement). Een minderjarig kind telt het hele jaar mee voor de ouders, ook als het in de loop van het jaar 18 wordt; de Belastingdienst rekent in dat geval alleen tot de dag van meerderjarigheid. Dat is een benadering.

Bronnen:

- Belastingdienst, _Wat is mijn werkelijk rendement?_: https://www.belastingdienst.nl/wps/wcm/connect/nl/box-3/content/wat-is-mijn-werkelijk-rendement
- Belastingdienst, _Werkelijk rendement in belastingaangifte 2025_: https://www.belastingdienst.nl/wps/wcm/connect/nl/box-3/content/werkelijk-rendement-belastingaangifte
- Belastingdienst, _Rekenvoorbeelden berekening werkelijk rendement_ (gecontroleerd 7 oktober 2026; voorbeelden 3, 4 en 8 staan als test in `server/test/box3-examples.test.ts`). De voorbeelden met een verhuurde woning rekenen de waardeverandering over de volle WOZ-waarde; Box3balans gebruikt de leegwaarde, net als voor het forfaitaire rendement. Welke van de twee klopt voor het werkelijk rendement is niet zeker: https://www.belastingdienst.nl/wps/wcm/connect/nl/box-3/content/rekenvoorbeelden-berekening-werkelijk-rendement
- Belastingdienst, veelgestelde vragen over de Opgaaf werkelijk rendement (geen heffingsvrij vermogen; partners): https://www.belastingdienst.nl/wps/wcm/connect/nl/box-3/content/veelgestelde-vragen-opgaaf-werkelijk-rendement
- SRA, overzicht van de tegenbewijsregeling 2017–2027 (bruto dividenden, geen schuldendrempel, partners, toerekening van rente): https://www.sra.nl/dossiers/dossier-hoge-raad-box-3/tegenbewijsregeling-box-3-2017-2027/box-3-een-overzichtsartikel-met-de-belangrijkste-verwijzingen-werkelijk-rendement-box-3-2017-2026

## Vanaf 2028: Wet werkelijk rendement box 3 (wetsvoorstel 36.748), nog geen wet

Stand op 5 oktober 2026:

- **Tweede Kamer:** nam het wetsvoorstel aan op 12 februari 2026.
- **Eerste Kamer:** stelde de stemming uit tot ze een novelle (wijzigingswet) heeft behandeld, verwacht vanaf januari 2027.
- **Novelle:** op 29 september 2026 bevestigde het kabinet dat die komt, met onder meer één jaar verliesverrekening naar achteren en een hoger heffingsvrij resultaat.

Regels van het wetsvoorstel zoals de Tweede Kamer het aannam (de standaardinstelling van de vooruitblik in de app):

- **Vermogensaanwasbelasting als hoofdregel:** elk jaar het directe rendement plus de gerealiseerde en ongerealiseerde waardeveranderingen, min kosten. Onroerend goed en aandelen in startende ondernemingen worden belast bij verkoop (vermogenswinstbelasting).
- **Kosten zijn aftrekbaar**, inclusief transactiekosten, accountkosten en betaalde rente. Dividendbelasting is niet aftrekbaar.
- **Tarief:** 36%.
- **Heffingsvrij resultaat:** € 1.800 per belastingplichtige.
- **Verliezen** boven € 500 schuiven door naar latere jaren. Terugwenteling naar een eerder jaar staat niet in het wetsvoorstel; de novelle voegt één jaar toe.
- **Groene beleggingen** houden een heffingskorting.

Opties die het kabinet voor de novelle onderzocht (juni–augustus 2026): een tarief van 35%, een heffingsvrij resultaat van € 1.900, en één jaar verliesverrekening naar achteren. De instelling "novelle" in de app gebruikt € 1.900 en één jaar terugwenteling bij 36%. **Deze details zijn niet definitief**, daarom is elke instelling aan te passen.

Niet beschreven in de bronnen, en aangenomen door de app:

- Een verlies van minstens de drempel schuift volledig door.
- Doorgeschoven verliezen worden verrekend met het resultaat dat overblijft na het heffingsvrije resultaat.

Bronnen:

- Eerste Kamer, wetsvoorstel 36.748: https://www.eerstekamer.nl/wetsvoorstel/36748_wet_werkelijk_rendement_box
- SRA, _Wet werkelijk rendement box 3 (voorlopig) nog niet aangenomen_: https://www.sra.nl/nieuwsoverzicht/2026/wet-werkelijk-rendement-box-3-voorlopig-nog-niet-aangenomen
- SRA, overzicht van het wetsvoorstel (tarief, € 1.800, € 500, aftrekbare kosten): https://www.sra.nl/dossiers/dossier-hoge-raad-box-3/box-3-vanaf-2027/box-3-een-overzichtsartikel-met-de-belangrijkste-verwijzingen-box-3-vanaf-2027
- Rijksoverheid, _Plannen werkelijk rendement box 3_: https://www.rijksoverheid.nl/onderwerpen/inkomstenbelasting/plannen-werkelijk-rendement-box-3
- Nextens, opties voor de novelle (22 juni 2026): https://www.nextens.nl/fiscaal-nieuws/nieuws/cat2/wet-werkelijk-rendement-box-3-krijgt-novelle-op-prinsjesdag/
