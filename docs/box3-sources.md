# Box 3: gebruikte regels en hun bronnen

Gecontroleerd op 5 oktober 2026. Box 3 verandert vaak: controleer deze regels opnieuw voordat je op de cijfers van een jaar vertrouwt.

## Forfaitair rendement (belastingjaren vanaf 2023)

De officiële stappen en de cijfers voor 2023–2026 staan in `server/src/domain/box3.ts` (`DEFAULT_RATES`). Je kunt ze aanpassen in de app onder _Box 3 → Rules & rates_.

**2027 zit er nog niet in.** De kerncijfers bij het Belastingplan 2027 (30 september 2026) noemen een heffingsvrij vermogen van € 60.098. Maar de brief van het kabinet van 29 september 2026 stelt voor dat te verlagen naar € 30.846 en het forfaitaire rendement op overige bezittingen met 1,5 procentpunt te verhogen, naar 7,87%, om de novelle hieronder te betalen. Voeg 2027 toe onder _Rules & rates_ zodra het definitief is.

- Holdwise, _Box 3 in 2027_: https://holdwise.nl/kennisbank/box-3-2027

## Tegenbewijsregeling: werkelijk in plaats van forfaitair rendement (Wet tegenbewijsregeling box 3)

Is je werkelijke rendement lager dan het forfaitaire, dan kun je over het werkelijke rendement belast worden. Je geeft het door met de _Opgaaf werkelijk rendement_ (OWR), beschikbaar sinds 8 juli 2025.

Wat de app toepast (Kluishuis: _Box 3 → jaar → Actual return_):

- **Werkelijk rendement** = direct rendement (rente, dividenden **bruto**, huur, andere inkomsten zoals stakingbeloningen) + indirect rendement (alle waardeveranderingen, gerealiseerd en ongerealiseerd, van elke box 3-bezitting die je in het jaar had, niet alleen die op 1 januari) − **werkelijk betaalde rente op box 3-schulden**.
- **Kosten zijn niet aftrekbaar**, behalve rente op schulden. Transactie- en accountkosten verlagen het niet, en ingehouden dividendbelasting ook niet: dividenden tellen bruto.
- **Geen heffingsvrij vermogen** en geen schuldendrempel.
- **Een negatief totaal telt als € 0.** Verliezen schuiven niet door naar andere jaren.
- Rendementen zijn nominaal, zonder inflatiecorrectie, en rente telt in het jaar waarin die opkomt (niet wanneer die wordt uitbetaald).
- **Belasting:** het box 3-tarief (36% vanaf 2024) × het werkelijke rendement. Je betaalt nooit meer dan met het forfaitaire rendement: het laagste van de twee geldt.
- **Fiscale partners:** verdeeld naar hun aandeel in de gezamenlijke grondslag. Voor de belasting samen maakt dat niets uit: er is geen heffingsvrij deel en het tarief is vlak.
- **Groene beleggingen:** hun rendement is naar verhouding vrijgesteld. De app laat groene rekeningen en rekeningen "niet in box 3" buiten het werkelijk rendement; dat is een benadering.

Bronnen:

- Belastingdienst, _Wat is mijn werkelijk rendement?_: https://www.belastingdienst.nl/wps/wcm/connect/nl/box-3/content/wat-is-mijn-werkelijk-rendement
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
