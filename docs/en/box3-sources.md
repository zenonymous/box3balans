# Box 3: the rules used and their sources

_Nederlands: [box3-sources.md](../box3-sources.md)_

Checked on 8 October 2026. Box 3 changes often: check these rules again before you rely on the figures for a year. The sources are Dutch; their titles are kept as they are.

## Deemed return (tax years from 2023)

The official steps and the figures for 2023–2026 are in `server/src/domain/box3.ts` (`DEFAULT_RATES`). You can adjust them in the app under _Box 3 → Rules & rates_.

**Rounding** as in the Belastingdienst's worked examples: assets down and debts up to whole euros; the deemed return on assets down and the one on debts to the nearest euro (€2,494.80 → €2,495; **assumption**: rounding up gives the same in that example, and an example that tells the two apart hasn't been found yet; the difference is at most €1 of return); the share down to two decimals of a percent (82.456% → 82.45%); the benefit and the tax per person down to whole euros. Fiscal partners each get their own share. The five examples for 2025 are a test in `server/test/box3.test.ts` and come out exactly.

- Belastingdienst, _Hoe wordt mijn box 3-inkomen over 2025 berekend?_ (worked examples, checked 7 October 2026): https://www.belastingdienst.nl/wps/wcm/connect/nl/box-3/content/berekening-box-3-inkomen-2025

**2027 is included as a proposal** (since 0.1.11; `"proposal": true` in `box3.json`), with the figures from the cabinet letter below. The app says so with the calculation too: the tax-free allowance and the percentage for other assets are a proposal, the other figures those of 2026. Status on 9 October 2026:

- **Belastingplan 2027** (tax plan; Prinsjesdag, 15 September 2026; bill 37.022): box 3 isn't in the package itself. The key figures assumed a tax-free allowance of €60,098 and a rate of 36%; the usual update brings the deemed return on other assets to 6.37% (was 6.00%).
- **Cabinet letter of 29 September 2026** (House of Representatives 2026Z20444): from 2027 the tax-free allowance goes back to the 2020 level, **€30,846** per person, and the deemed return for other assets, including rental income and benefits from own use of real estate, goes **up by 1.5 percentage points** (so to 7.87%). That helps pay for the amendment (novelle) below.
- **Not adopted yet:** the House of Representatives still has to vote, and the amounts can still change in the debate.
- **Green investments:** the exemption and the tax credit end on 1 January 2028, not already in 2027 as first planned. The amounts for 2027 follow with the fixed figures.
- The percentages for bank balances and debts for 2027 are only final after the year has ended.

Earlier than [belastingregels.md](belastingregels.md) prescribes: 2027 has already been added, so the year is ready. The debt threshold, the green exemption and the percentages for bank balances and debts are those of 2026 until the 2027 figures are known. **Check in December** once the Belastingplan has been adopted, and replace the 2027 source with the adopted text or the Belastingdienst's page ([#4](https://github.com/zenonymous/box3balans/issues/4)). Anyone who wants other figures adjusts them under _Rules & rates_.

- Kabinet, _Voorstellen op box 3, koopkracht werkenden en sociale zekerheid_ (29 September 2026, copy to the Senate): https://www.eerstekamer.nl/brief_in/20260930/voorstellen_op_box_3_koopkracht/f=/vn1fdr15xiz6.pdf
- Eerste Kamer (Senate), _Belastingplan 2027 (37.022)_: https://www.eerstekamer.nl/wetsvoorstel/37022_belastingplan_2027
- Deloitte, _Pakket Belastingplan 2027: tarieven en heffingskortingen_ (deemed return 6.37%): https://www.deloitte.com/nl/nl/services/tax/blogs/pakket-belastingplan-2027-tarieven-heffingskortingen.html
- Rendement, _Vrijstelling groene beleggingen vervalt pas per 2028_: https://www.rendement.nl/inkomen-uit-sparen-en-beleggen/nieuws/vrijstelling-groene-beleggingen-vervalt-pas-per-2028.html
- Holdwise, _Box 3 in 2027_: https://holdwise.nl/kennisbank/box-3-2027

## What falls in which category, and whose it is

What the app applies (Box3balans: _Household_ and _Accounts_):

- **Banktegoeden (bank balances):** bank and savings balances in the Netherlands and abroad, cash above the exemption (per person €596 in 2023, €653 in 2024, €661 in 2025, €672 in 2026; double for partners who are fiscal partners all year), premium deposits, the non-exempt part of green savings.
- **Overige bezittingen (other assets)** (investments and other assets): shares, bonds and other investments, the non-exempt part of green investments, other receivables (such as money lent to others, except between fiscal partners or between parents and minor children), a second home, a let home, other real estate, cryptocurrencies, capital insurance policies (with their own exemptions, which the app doesn't apply).
- **Schulden (debts):** debts that don't belong to the home you live in, such as consumer credit, student debt and loans for investments or a second home. Only the part above the debt threshold counts (€3,700 in 2024, €3,800 in 2025 and 2026, per person).
- **Let home:** with rent protection the WOZ value counts at a percentage that depends on the annual rent as a percentage of the WOZ value: up to and including 1% → 73%; up to and including 2% → 79%; up to and including 3% → 84%; up to and including 4% → 90%; up to and including 5% → 95%; more → 100%. The same table applies for 2023 up to and including 2026 (in `box3.json` per first year, so a new table can be added). If you let the home for a rent far below the normal one, for example to your child or your own company, 100% always counts (in the app: _to family, well below the usual rent_). The WOZ value with valuation date 1 January of the year before the tax year is used.
- **Fiscal partners** may split the joint savings and investment base as they like, as long as the total is 100%.
- **Minor children:** their assets count for the parent with custody; if both parents have custody, half each. Anyone who is 18 or older on 1 January files their own return.

Sources:

- Belastingdienst, _Hoe wordt het box 3-inkomen over 2025 berekend?_ (categories, split between partners): https://www.belastingdienst.nl/wps/wcm/connect/nl/box-3/content/berekening-box-3-inkomen-2025
- Belastingdienst, _Bezittingen en schulden box 3_ per year (vacant-value ratio, WOZ valuation date, cash, children, debt threshold): https://www.belastingdienst.nl/wps/wcm/connect/fisin/fisin2026/bezittingen_en_schulden_box_3_ (and `fisin2023`, `fisin2024`, `fisin2025`)

## Tegenbewijsregeling: actual instead of deemed return (Wet tegenbewijsregeling box 3)

If your actual return is lower than the deemed return, you can be taxed on the actual return. For **2024 and earlier** you report it with the _Opgaaf werkelijk rendement_ (OWR) form in Mijn Belastingdienst, available since 8 July 2025. **From 2025** the income tax return itself asks whether you want to report your actual return; the Belastingdienst then calculates both ways and uses the more favourable one.

What the app applies (Box3balans: _Box 3 → year → Actual return_):

- **Actual return** = direct return (interest, dividends **gross**, rent, other income such as staking rewards) + indirect return (all changes in value, realised and unrealised, of every box 3 asset you had during the year, not only those on 1 January) − **interest actually paid on box 3 debts**.
- **Costs aren't deductible**, except interest on debts. Transaction and account costs don't reduce it, and neither does dividend tax withheld: dividends count gross.
- **No tax-free allowance** and no debt threshold.
- **A negative total counts as €0.** Losses don't carry over to other years.
- Returns are nominal, without inflation correction, and interest counts in the year it accrues (not when it's paid out). **Approximation in the app:** a transaction counts in the year of its date. Interest over December credited early in January then counts a year late; the app warns about interest on 1 to 7 January.
- **Tax:** the box 3 rate (36% from 2024) × the actual return. You never pay more than with the deemed return: the lower of the two applies.
- **Tax credit for green investments:** a credit on the income tax as a whole, so with both ways. The app therefore deducts it on both sides before comparing (**assumption**: the Belastingdienst doesn't mention it separately for the actual return).
- **Fiscal partners:** split by their share in the joint base. For the tax together that makes no difference: there's no tax-free part and the rate is flat.
- **Green investments:** their return is exempt proportionally. The app leaves green accounts and accounts "not in box 3" out of the actual return; that's an approximation.
- **Accounts with values per year:** the value on 1 January of the next year, minus the one on 1 January, minus money in, plus money out, plus income. Interest or dividend that comes in on the account itself is already in the end value and counts once. For a debt only the interest paid counts (repaying isn't a return). A minor child counts for the parents the whole year, even if they turn 18 during the year; the Belastingdienst only counts until the day they come of age in that case. That's an approximation. For the running year, without a value on the next 1 January, the end value for now is the one on 1 January plus money in, minus money out, plus the income credited.
- **Withholding tax on interest from abroad:** the interest counts gross, like dividend; what the country withheld is shown with the tax withheld. The tax return asks, for each account abroad, for the gross interest and the withholding tax, and offsets it up to a maximum (the treaty rate); anything above that you reclaim in that country. If you live abroad, you offset nothing. The app records no withholding tax on rent or on interest paid: real estate abroad is exempted, not credited.

Sources:

- Belastingdienst, _Te verrekenen belasting_ (withholding on foreign savings, offset up to a maximum): https://www.belastingdienst.nl/wps/wcm/connect/fisin/fisin2025/te_verrekenen_belasting
- Raisin, _Belasting_ (per country the withholding tax, the part you can offset and where it goes in the return; second-hand): https://www.raisin.com/nl-nl/belasting/
- Belastingdienst, _Wat is mijn werkelijk rendement?_: https://www.belastingdienst.nl/wps/wcm/connect/nl/box-3/content/wat-is-mijn-werkelijk-rendement
- Belastingdienst, _Werkelijk rendement in belastingaangifte 2025_: https://www.belastingdienst.nl/wps/wcm/connect/nl/box-3/content/werkelijk-rendement-belastingaangifte
- Belastingdienst, _Rekenvoorbeelden berekening werkelijk rendement_ (checked 7 October 2026; examples 3, 4 and 8 are a test in `server/test/box3-examples.test.ts`). The examples with a let home calculate the change in value over the full WOZ value; Box3balans uses the vacant value, just as for the deemed return. Which of the two is right for the actual return isn't certain: https://www.belastingdienst.nl/wps/wcm/connect/nl/box-3/content/rekenvoorbeelden-berekening-werkelijk-rendement
- Belastingdienst, frequently asked questions about the Opgaaf werkelijk rendement (no tax-free allowance; partners): https://www.belastingdienst.nl/wps/wcm/connect/nl/box-3/content/veelgestelde-vragen-opgaaf-werkelijk-rendement
- SRA, overview of the rebuttal scheme 2017–2027 (gross dividends, no debt threshold, partners, allocation of interest): https://www.sra.nl/dossiers/dossier-hoge-raad-box-3/tegenbewijsregeling-box-3-2017-2027/box-3-een-overzichtsartikel-met-de-belangrijkste-verwijzingen-werkelijk-rendement-box-3-2017-2026

## From 2028: Wet werkelijk rendement box 3 (bill 36.748), not law yet

Status on 8 October 2026:

- **House of Representatives:** adopted the bill on 12 February 2026.
- **Senate:** postponed the vote until it has dealt with an amendment (novelle).
- **Amendment** (cabinet letter of 29 September 2026): instead of taxing the change in value every year (capital accrual), from 2028 there will be a **capital gains tax**, tax on sale, for all financial instruments such as shares, bonds and options. According to the cabinet that's about 90% of the assets with changes in value in box 3. Other assets follow in 2030. The **tax-free result becomes €1,000** (€1,800 in the bill). The Senate has to adopt the amendment before 31 December 2026. Banks can't yet supply data for the pre-filled tax return in the first year.

Rules of the bill as the House of Representatives adopted it (the default setting of the preview in the app):

- **Capital accrual tax as the main rule:** every year the direct return plus the realised and unrealised changes in value, minus costs. Real estate and shares in start-ups are taxed on sale (capital gains tax).
- **Costs are deductible**, including transaction costs, account costs and interest paid. Dividend tax isn't deductible.
- **Rate:** 36%.
- **Tax-free result:** €1,800 per taxpayer.
- **Losses** above €500 carry forward to later years. Carrying back to an earlier year isn't in the bill; the letter of 29 September says nothing about it.
- **Green investments** keep a tax credit.

Before the letter of 29 September, the cabinet looked into options such as a rate of 35%, a tax-free result of €1,900 and carrying losses back one year. So besides the bill, the preview in the app has the setting _Cabinet letter of 29 Sep 2026_: €1,000 tax-free result, 36% and no carry-back (the letter doesn't mention it). **The preview doesn't simulate tax on sale of financial instruments yet** ([issue #11](https://github.com/zenonymous/box3balans/issues/11)); for investments you don't sell, it therefore shows more tax than the amendment would levy. Every setting can be adjusted.

Not described in the sources, and assumed by the app:

- A loss of at least the threshold carries forward in full.
- Losses carried forward are set off against the result left after the tax-free result.

Sources:

- Eerste Kamer, bill 36.748: https://www.eerstekamer.nl/wetsvoorstel/36748_wet_werkelijk_rendement_box
- Kabinet, _Voorstellen op box 3, koopkracht werkenden en sociale zekerheid_ (29 September 2026): https://www.eerstekamer.nl/brief_in/20260930/voorstellen_op_box_3_koopkracht/f=/vn1fdr15xiz6.pdf
- SRA, _Wet werkelijk rendement box 3 (voorlopig) nog niet aangenomen_: https://www.sra.nl/nieuwsoverzicht/2026/wet-werkelijk-rendement-box-3-voorlopig-nog-niet-aangenomen
- SRA, overview of the bill (rate, €1,800, €500, deductible costs): https://www.sra.nl/dossiers/dossier-hoge-raad-box-3/box-3-vanaf-2027/box-3-een-overzichtsartikel-met-de-belangrijkste-verwijzingen-box-3-vanaf-2027
- Rijksoverheid, _Plannen werkelijk rendement box 3_: https://www.rijksoverheid.nl/onderwerpen/inkomstenbelasting/plannen-werkelijk-rendement-box-3
- Nextens, options for the amendment (22 June 2026): https://www.nextens.nl/fiscaal-nieuws/nieuws/cat2/wet-werkelijk-rendement-box-3-krijgt-novelle-op-prinsjesdag/
