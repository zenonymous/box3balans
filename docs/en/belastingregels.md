# Updating the tax rules

_Nederlands: [belastingregels.md](../belastingregels.md)_

The box 3 figures Box3balans calculates with are in [`server/src/rules/box3.json`](../../server/src/rules/box3.json), separate from the code: per year the deemed-return percentages, the tax-free allowance (heffingsvrij vermogen), the debt threshold, the rate, the limit and tax credit for green investments, whether the figures are final, and the source. Next to that the table with the vacant-value ratio (leegwaarderatio) for let homes, and `checkedAt`: the date everything was last checked.

The app shows that date on the Box 3 page (under _Rules & rates_), with a link to the source per year. If `checkedAt` is more than 400 days old, _Needs attention_ shows a message that there may be newer figures. Users can adjust every rate themselves; their adjustments take precedence over the file.

## When

| Moment                                               | What                                                                                                                                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prinsjesdag (budget day, third Tuesday of September) | The Belastingplan (tax plan) names the proposed figures for the next year. Note them with their source in [`box3-sources.md`](box3-sources.md), but don't build them in yet: they can still change.                                        |
| December                                             | The Belastingplan has been adopted: add the year with `"final": false`. Tax-free allowance, debt threshold, rate, green limit and the percentage for other assets are then fixed; those for bank balances and debts are still provisional. |
| After the year has ended (January–February)          | The Belastingdienst announces the final percentages for bank balances and debts. Update them and set `"final": true`.                                                                                                                      |
| With every change                                    | Set `checkedAt` to the date of the check and put the source with the year.                                                                                                                                                                 |

Also check whether the rules themselves change, not just the figures: for example the end of the exemption for green investments (from 2028) or the system based on actual return (bill 36.748, with the amendment (novelle) that taxes capital gains from 2028). Such changes need code and tests, not just the file. Put sources and explanations in [`box3-sources.md`](box3-sources.md).

## How

1. Change `server/src/rules/box3.json`. Amounts and percentages are stored as text (`"1.37"`), so nothing gets rounded.
2. Run `npm test`. The file is checked at startup: a typo gives a clear error instead of a wrong tax. The Belastingdienst's worked examples are tests in `server/test/box3.test.ts`; add those for the new year once they're published ("Hoe wordt mijn box 3-inkomen over <jaar> berekend?").
3. Make a new version (see [releasen.md](releasen.md)) and write in the release notes which figures are new.
