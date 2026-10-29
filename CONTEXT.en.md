# Box3balans

_Nederlands: [CONTEXT.md](CONTEXT.md)_

Keeps track of what a Dutch household owns and owes, and uses that to calculate box 3: what there was on the reference date (peildatum), the tax, and the actual return. The terms follow the Dutch tax return, so the Dutch term comes first; the word the code uses is in brackets. The app and its translations use these terms too.

## Box 3

**Box 3** (box 3):
The Dutch income tax on savings and investments. Box3balans only calculates box 3.
_Avoid_: wealth tax, vermogensbelasting, vermogensrendementsheffing

**Belastingjaar** — tax year (tax year):
The calendar year box 3 is calculated for.

**Peildatum** — reference date (peildatum):
1 January of the tax year: what you own and owe then counts for box 3. It is the position at the end of 31 December, at the last closing price on or before that day.
_Avoid_: 31 December as the reference date, waardepeildatum

**Banktegoeden** — bank balances (bank):
Money in current and savings accounts, and cash. The box 3 category with the lowest deemed return.
_Avoid_: savings (as a category)

**Overige bezittingen** — other assets (other):
Everything in box 3 that isn't a bank balance or a debt: shares, funds, crypto, precious metals, a second home, money lent to others.
_Avoid_: investments (as a category)

**Schulden** — debts (debt):
What you owe that counts in box 3, such as a student loan. Only the part above the debt threshold counts.

**Schuldendrempel** — debt threshold (debt threshold):
The part of the debts that doesn't count, per person.

**Groene beleggingen** — green investments (green):
Investments in designated green funds; exempt up to an amount per person, with a small tax credit.

**Vrijgesteld** — exempt (exempt):
Assets that belong in box 3 but aren't taxed, such as green investments up to the exemption.

**Niet in box 3** — not in box 3 (excluded):
Assets outside box 3, such as a pension or the home you live in.
_Avoid_: exempt (that's something else)

**Forfaitair rendement** — deemed return (deemed return):
The return the Belastingdienst (Dutch tax authority) assumes per category, as a fixed percentage per tax year.
_Avoid_: fictitious return, fictief rendement

**Rendementsgrondslag** — return base:
Assets minus debts on the reference date.

**Heffingsvrij vermogen** — tax-free allowance (allowance):
The part of the return base you pay no tax on, per person.
_Avoid_: exemption, vrijstelling (that term is for green investments)

**Grondslag sparen en beleggen** — savings and investment base:
The return base minus the tax-free allowance. Decides which share of the deemed return is taxed.

**Voordeel uit sparen en beleggen** — benefit from savings and investments:
The taxable income from box 3: the deemed return in proportion to the base. The box 3 rate applies to this.

**Werkelijk rendement** — actual return (actual return):
What the assets really earned in a tax year: income plus change in value, minus costs.
_Avoid_: real return, echt rendement

**Tegenbewijsregeling** — rebuttal scheme:
The scheme that lets you pay box 3 over the actual return when it is lower than the deemed return. From tax year 2025 in the tax return itself, before that with the _Opgaaf werkelijk rendement_ form.

**Belastingregels** — tax rules (rules):
The percentages and amounts of a tax year. A year is provisional until the percentages for bank balances and debts are final.

**Leegwaarderatio** — vacant-value ratio:
The percentage of the WOZ value (municipal property valuation) at which a let home counts in box 3, depending on the rent.

**Buitenland** — abroad (foreign):
Assets abroad simply count, but the tax return asks about them separately.

**Ingehouden belasting** — tax withheld (tax withheld):
Tax already taken off dividend or interest: Dutch dividend tax, or withholding tax abroad. Dividend and interest count gross; the tax return offsets the tax, foreign tax up to the treaty rate.

**Dossier** (dossier):
The printable overview of a tax year: box 3, the actual return, the values on the reference date and where every amount comes from.

**Vooruitblik** — preview (future / 2028):
An estimate of box 3 under the proposed system from 2028 (Wet werkelijk rendement box 3, the actual-return act). Not a calculation for the tax return.
_Avoid_: new system (as if it already applies)

**Vastgoedbijtelling** — real estate addition (propertyPct):
In the preview: what a home or other real estate yields each year when it isn't let all year and the rent is lower, a percentage of the WOZ value. The gain on sale comes on top in the year it's sold, or when it leaves box 3.

## Household

**Huishouden** — household (household):
You, your fiscal partner and your minor children, as far as their assets count for your box 3.

**Fiscaal partner** — fiscal partner (partner):
The partner you add box 3 up with and split the base with as you like. Each has their own tax-free allowance. Can differ per tax year.

**Eigenaar** — owner (owner):
Whose an account is: you, your partner, joint (with your share), or a child.

**Minderjarig kind** — minor child (child):
A child under 18. Their assets count for the parent with custody.

## Accounts and assets

**Rekening** — account (account):
A place where you hold or owe something: a bank, broker, exchange, wallet, vault, at home, a home, money lent to others, an insurance policy or a debt. Every account has a type and an owner.
_Avoid_: portfolio, depot (for one account)

**Bijhouden met transacties** — tracked with transactions (tracking: transactions):
An account where every transaction is recorded; positions and results follow from them.

**Waarden per jaar** — values per year (tracking: yearly):
An account where, per tax year, only the value on the reference date, money in and out, income and costs are recorded. For savings accounts, homes, loans and debts.

**Belegging** — asset (asset):
Something you record transactions for, with a price source: a share, fund, coin, precious metal or a currency.
_Avoid_: instrument, security

**Soort** — asset class (asset class):
The grouping of assets: stocks, ETFs and funds, crypto, precious metals, cash and other.

**Positie** — position (holding):
How much of an asset you have, added up over your accounts, with its value and result.
_Avoid_: holding (in Dutch texts), bezit (for one asset)

**Gesloten positie** — closed position (closed):
A position that has been sold completely.

**Geld** — cash (cash):
Currency in an account, such as euros at a broker or exchange. Which box 3 category it falls in depends on the type of account.
_Avoid_: liquidity, liquiditeiten

**Fysiek edelmetaal** — physical precious metal (physical item):
Coins and bars you keep yourself, valued at the spot price of their fine weight.

**Plek** — place (physical account):
An account of the physical type where physical precious metal is kept, such as a safe at home or a bank safe-deposit box.
_Avoid_: storage location (in new texts)

**Edelmetaal in een kluis** — vaulted precious metal (vault):
Precious metal a provider keeps for you, such as Goldrepublic, tracked in grams with transactions.

**Fijngewicht** — fine weight:
The weight of pure metal: gross weight times purity.

## Transactions and results

**Transactie** — transaction (transaction):
An event on an account that changes the quantity of an asset or brings in income: buy, sell, deposit, withdrawal, transfer, reward, dividend, fee or split.

**Overboeking** — transfer (transfer):
An asset moving between two of your own accounts. Not a buy or sell: the cost basis moves along.
_Avoid_: move, verplaatsing

**Storting** and **opname** — deposit and withdrawal (deposit, withdrawal):
Money or an asset coming in from outside or going out, without a result.

**Beloning** — reward (reward):
Staking or interest received in an asset; counts as income at its value on that day.

**Aankoopwaarde** — cost basis (cost basis):
What you paid for what you own now, including transaction costs. By default the average purchase price; FIFO is possible too.
_Avoid_: cost price, kostprijs, inleg

**Ongerealiseerd resultaat** — unrealised result (unrealized):
How much more or less a position is worth than its cost basis.

**Gerealiseerd resultaat** — realised result (realized):
Profit or loss on what you sold: the proceeds minus costs and the cost basis of the part sold.

**Inkomsten** — income (income):
Dividend after dividend tax withheld, plus rewards.

**Tijdgewogen rendement** — time-weighted return (time-weighted return):
The return of the investments themselves, regardless of when you put money in or took it out. Comparable with a benchmark.

**Geldgewogen rendement** — money-weighted return (money-weighted return):
The return on your money, in which it counts when you put money in or took it out.

## Prices

**Koersbron** — price source (price source):
Where an asset's price comes from, such as Yahoo Finance, CoinGecko, Bitvavo, the ECB or the spot price, or entered by hand.

**Slotkoers** — closing price (close):
The price at the end of a day. Box 3 and the history use closing prices.

**Ingeruilde munt** — swapped coin (swapped coin):
A coin that was replaced by a successor, such as FTM by S. It is valued as the successor, times the fixed swap ratio.
_Avoid_: migrated coin

## Bringing data in and checking it

**Koppeling** — connection (connection):
A link with an exchange or broker through a read-only key, which fetches transactions and balances.
_Avoid_: integration

**Wallet** (wallet):
An account for addresses on a blockchain, whose transactions come from the chain.

**Import** (import):
Reading transactions from a file, with a column layout.

**Herkend formaat** — recognised format (format):
An export of a particular broker or exchange whose columns the import recognises by itself.

**Portefeuille-overzicht** — portfolio statement (statement):
What a broker says an account held on one day, such as DEGIRO's _Portefeuille_ export. Compared with what the transactions up to that day add up to; the cash on it counts too.
_Avoid_: snapshot, position report

**Jaaroverzicht** — annual statement (year statement):
The overview a bank, broker or platform sends after a year has ended, usually as a PDF, with the value on 1 January and sometimes the income, deposits and withdrawals. Can be read into the values per year; a **template** (sjabloon) per provider says where each value is.
_Avoid_: annual report, tax report

**Afwijkend saldo** — balance mismatch (mismatch):
A balance an exchange or broker reports that doesn't match what the transactions add up to. Usually history is missing.

**Saldocorrectie** — balance correction:
A transaction that corrects a balance mismatch when the missing history can't be found.

**Aandacht nodig** — needs attention (attention):
What you should look at: balance mismatches, assets without a price, withdrawals without a destination and the like.
