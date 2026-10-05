# Box 3: rules used and where they come from

Checked on 5 October 2026. Box 3 changes often; recheck these before relying on a year's numbers.

## Deemed return (forfaitair, tax years 2023 onwards)

The official steps and the 2023–2026 figures are in `server/src/domain/box3.ts` (`DEFAULT_RATES`). They are editable in the app under _Box 3 → Rules & rates_.

**2027 is not built in yet.** The Belastingplan 2027's key figures (30 September 2026) list a tax-free amount of €60,098. But the cabinet's letter of 29 September 2026 proposes lowering it to €30,846 and raising the deemed return on other assets by 1.5 points, to 7.87%, to pay for the novelle below. Add 2027 under _Rules & rates_ once it's final.

- Holdwise, _Box 3 in 2027_: https://holdwise.nl/kennisbank/box-3-2027

## Tegenbewijsregeling: actual return instead of deemed (Wet tegenbewijsregeling box 3)

When your actual return is lower than the deemed one, you can be taxed on the actual return. You submit it with the _Opgaaf werkelijk rendement_ (OWR), available since 8 July 2025.

What the app applies (Kluishuis: _Box 3 → year → Actual return_):

- **Actual return** = direct return (interest, dividends **gross**, rent, other income such as staking rewards) + indirect return (all value changes, realised and unrealised, of every box 3 asset held during the year, not only those held on 1 January), − **actual interest paid on box 3 debts**.
- **Costs are not deductible**, except interest on debts. Transaction fees and account fees don't reduce it, and dividend tax withheld doesn't either: dividends count gross.
- **No tax-free allowance** (heffingsvrij vermogen) and no debt threshold.
- **A negative total counts as €0.** Losses don't carry over to other years.
- Returns are nominal, without inflation correction, with interest counted on an accrual basis.
- **Tax:** the box 3 rate (36% from 2024) × the actual return. You never pay more than with the deemed return, so the lower of the two applies.
- **Fiscal partners:** split by their shares of the joint grondslag. This changes nothing for the combined tax: there's no allowance and the rate is flat.
- **Green investments:** their return is exempt pro rata. The app leaves green and "not in box 3" accounts out of the actual return, which is an approximation.

Sources:

- Belastingdienst, _Wat is mijn werkelijk rendement?_: https://www.belastingdienst.nl/wps/wcm/connect/nl/box-3/content/wat-is-mijn-werkelijk-rendement
- Belastingdienst, FAQ on the Opgaaf werkelijk rendement (no tax-free allowance; partners): https://www.belastingdienst.nl/wps/wcm/connect/nl/box-3/content/veelgestelde-vragen-opgaaf-werkelijk-rendement
- SRA, summary of the tegenbewijsregeling 2017–2027 (gross dividends, no debt threshold, partners, accrual): https://www.sra.nl/dossiers/dossier-hoge-raad-box-3/tegenbewijsregeling-box-3-2017-2027/box-3-een-overzichtsartikel-met-de-belangrijkste-verwijzingen-werkelijk-rendement-box-3-2017-2026

## From 2028: Wet werkelijk rendement box 3 (bill 36.748), not law yet

Status on 5 October 2026:

- **Tweede Kamer:** passed the bill on 12 February 2026.
- **Eerste Kamer:** postponed its vote until it has dealt with a novelle (amending bill), expected from January 2027.
- **Novelle:** on 29 September 2026 the cabinet confirmed it is coming, with one year of loss carry-back and a higher tax-free result among its contents.

Rules of the bill as passed by the Tweede Kamer (the app's default preview):

- **Capital accrual tax (vermogensaanwas) as the main rule:** each year's direct return plus realised and unrealised value changes, minus costs. Real estate and shares in start-ups are taxed on realisation instead (capital gains).
- **Costs are deductible**, including transaction costs, account fees and interest paid. Dividend tax is not deductible.
- **Rate:** 36%.
- **Tax-free result:** €1,800 per taxpayer.
- **Losses** above €500 carry forward to later years. Carrying them back is not in the bill; the novelle adds one year.
- **Green investments** keep a tax credit.

Options the cabinet studied for the novelle (June–August 2026): a 35% rate, a €1,900 tax-free result, and one year of loss carry-back. The app's "novelle" preset uses €1,900 and one year of carry-back at 36%. **These details aren't final**, which is why every parameter is editable.

Not specified by the sources, and assumed by the app:

- A loss of at least the threshold carries forward in full.
- Losses carried forward are set off against the result left after the tax-free amount.

Sources:

- Eerste Kamer, bill 36.748: https://www.eerstekamer.nl/wetsvoorstel/36748_wet_werkelijk_rendement_box
- SRA, _Wet werkelijk rendement box 3 (voorlopig) nog niet aangenomen_: https://www.sra.nl/nieuwsoverzicht/2026/wet-werkelijk-rendement-box-3-voorlopig-nog-niet-aangenomen
- SRA, summary of the bill (rate, €1,800, €500, deductible costs): https://www.sra.nl/dossiers/dossier-hoge-raad-box-3/box-3-vanaf-2027/box-3-een-overzichtsartikel-met-de-belangrijkste-verwijzingen-box-3-vanaf-2027
- Rijksoverheid, _Plannen werkelijk rendement box 3_: https://www.rijksoverheid.nl/onderwerpen/inkomstenbelasting/plannen-werkelijk-rendement-box-3
- Nextens, options for the novelle (22 June 2026): https://www.nextens.nl/fiscaal-nieuws/nieuws/cat2/wet-werkelijk-rendement-box-3-krijgt-novelle-op-prinsjesdag/
