/** Dutch server messages, keyed by the English text in the code (grouped by where a message is first found). */
export const NL: Record<string, string> = {
  // app.ts
  "Missing CSRF header": "CSRF-header ontbreekt",
  "Not logged in": "Niet ingelogd",
  "Invalid input": "Ongeldige invoer",
  "That already exists": "Dat bestaat al",
  "It is still used by other records": "Het wordt nog door andere gegevens gebruikt",
  "Internal error": "Interne fout",
  "Database unavailable": "Database niet beschikbaar",
  "Not found": "Niet gevonden",
  // domain/attention.ts
  "{list} and {n} more": "{list} en nog {n}",
  "{n} h ago": "{n} uur geleden",
  "{n} days ago": "{n} dagen geleden",
  "{name}: the last sync failed": "{name}: de laatste sync is mislukt",
  "Unknown error": "Onbekende fout",
  Wallets: "Wallets",
  Connections: "Koppelingen",
  "{list} compared with what the chain reports. Usually missing history; fix it or adjust.":
    "{list} vergeleken met wat de blockchain meldt. Meestal ontbrekende geschiedenis; herstel het of corrigeer.",
  "{list} compared with what the exchange reports. Usually missing history; fix it or adjust.":
    "{list} vergeleken met wat de exchange meldt. Meestal ontbrekende geschiedenis; herstel het of corrigeer.",
  Review: "Bekijken",
  "{name}: history still importing": "{name}: geschiedenis wordt nog geïmporteerd",
  "Rate-limited sources load older history over several syncs.":
    "Bronnen met een limiet laden oudere geschiedenis over meerdere syncs.",
  "{name} hasn't synced for {ago}": "{name} is sinds {ago} niet gesynchroniseerd",
  "Syncs should run every {n} h.": "Syncs horen elke {n} uur te lopen.",
  Prices: "Koersen",
  "{list}: valued at €0 until a price is found or entered.":
    "{list}: gewaardeerd op € 0 tot er een koers gevonden of ingevuld is.",
  Assets: "Beleggingen",
  "{list}: not updated in the last refreshes.": "{list}: niet bijgewerkt bij de laatste verversingen.",
  "{list}. Charts value them at cost where history is missing.":
    "{list}. Grafieken waarderen ze tegen aankoopwaarde waar geschiedenis ontbreekt.",
  "Negative balance: {quantity} {symbol} in {account}": "Negatief saldo: {quantity} {symbol} in {account}",
  "Buys are paid from cash that was never deposited. Add the deposits, or stop booking cash for these trades.":
    "Aankopen worden betaald uit geld dat nooit is gestort. Voeg de stortingen toe, of boek geen geld meer bij deze transacties.",
  "More was sold, sent or spent than was bought or received. Some history is missing (an earlier buy or deposit).":
    "Er is meer verkocht, verstuurd of uitgegeven dan gekocht of ontvangen. Er ontbreekt geschiedenis (een eerdere aankoop of storting).",
  Transactions: "Transacties",
  "{list}: booked at €0 because no price was known for that day, which overstates gains when sold. Edit them to enter the value.":
    "{list}: geboekt op € 0 omdat er voor die dag geen koers bekend was, waardoor de winst bij verkoop te hoog uitvalt. Bewerk ze om de waarde in te vullen.",
  "{list}. Box 3 counts what you had on 1 January: take it from the year statement (jaaroverzicht) or, for a home, the WOZ assessment.":
    "{list}. Box 3 telt wat je op 1 januari had: haal het uit het jaaroverzicht of, voor een woning, de WOZ-beschikking.",
  Accounts: "Rekeningen",
  "{list}. If they went to a wallet of yours, track that wallet so the purchase cost moves along; otherwise they count as disposals.":
    "{list}. Als ze naar een eigen wallet gingen, volg die wallet dan zodat de aankoopwaarde meegaat; anders tellen ze als afgestoten.",
  "The last automatic backup failed": "De laatste automatische back-up is mislukt",
  Backups: "Back-ups",
  "No automatic backup since {ago}": "Geen automatische back-up sinds {ago}",
  "No backups": "Geen back-ups",
  "Automatic backups are off (BACKUP_INTERVAL_HOURS=0) and there are no manual ones.":
    "Automatische back-ups staan uit (BACKUP_INTERVAL_HOURS=0) en er zijn geen handmatige.",
  "Backups aren't encrypted": "Back-ups zijn niet versleuteld",
  "Anyone with a copy can read all your data. Set BACKUP_PASSPHRASE in .env and restart.":
    "Iedereen met een kopie kan al je gegevens lezen. Zet BACKUP_PASSPHRASE in .env en herstart.",
  "{name}: {n} balance difference": "{name}: {n} saldoverschil",
  "{name}: {n} balance differences": "{name}: {n} saldoverschillen",
  "Prices couldn't be updated for {n} asset": "Koers van {n} belegging kon niet worden bijgewerkt",
  "Prices couldn't be updated for {n} assets": "Koersen van {n} beleggingen konden niet worden bijgewerkt",
  "No price for {n} holding": "Geen koers voor {n} positie",
  "No price for {n} holdings": "Geen koers voor {n} posities",
  "Stale price for {n} holding": "Verouderde koers voor {n} positie",
  "Stale price for {n} holdings": "Verouderde koersen voor {n} posities",
  "Price history couldn't be loaded for {n} asset": "Koersgeschiedenis van {n} belegging kon niet worden geladen",
  "Price history couldn't be loaded for {n} assets": "Koersgeschiedenis van {n} beleggingen kon niet worden geladen",
  "{n} deposit or reward without a value": "{n} storting of beloning zonder waarde",
  "{n} deposits or rewards without a value": "{n} stortingen of beloningen zonder waarde",
  "{n} account without a value on 1 January {year}": "{n} rekening zonder waarde op 1 januari {year}",
  "{n} accounts without a value on 1 January {year}": "{n} rekeningen zonder waarde op 1 januari {year}",
  "{n} crypto withdrawal from exchanges not linked to a deposit":
    "{n} crypto-opname van exchanges niet gekoppeld aan een storting",
  "{n} crypto withdrawals from exchanges not linked to a deposit":
    "{n} crypto-opnames van exchanges niet gekoppeld aan een storting",
  // domain/benchmark.ts
  "MSCI World (iShares IWDA)": "MSCI World (iShares IWDA)",
  "FTSE All-World (Vanguard VWCE)": "FTSE All-World (Vanguard VWCE)",
  "S&P 500 (iShares CSPX)": "S&P 500 (iShares CSPX)",
  Gold: "Goud",
  Bitcoin: "Bitcoin",
  // domain/box3.ts
  "No price for {symbol} on or before {day}; it is counted as €0.":
    "Geen koers voor {symbol} op of vóór {day}; het telt als € 0.",
  "{symbol} is valued at its close of {priceDay}, the latest price before {day}.":
    "{symbol} is gewaardeerd tegen de slotkoers van {priceDay}, de laatste koers vóór {day}.",
  "{account} has a negative {symbol} balance on {day}; check its history.":
    "{account} heeft op {day} een negatief {symbol}-saldo; controleer de geschiedenis.",
  "{name}: no value on 1 January {year}. Enter it under Accounts → Values per year.":
    "{name}: geen waarde op 1 januari {year}. Vul die in onder Rekeningen → Waarden per jaar.",
  "No box 3 rates for {year}. Add them under “Rules & rates” to estimate the tax.":
    "Geen box 3-tarieven voor {year}. Voeg ze toe onder “Regels en tarieven” om de belasting te schatten.",
  "The {year} rates are provisional; the final bank and debt percentages follow after the year.":
    "De tarieven voor {year} zijn voorlopig; de definitieve percentages voor banktegoeden en schulden volgen na afloop van het jaar.",
  // domain/box3Actual.ts
  "{name}: no value on 1 January {day}, so its return for {year} is left out.":
    "{name}: geen waarde op 1 januari {day}, dus het rendement over {year} telt niet mee.",
  // import/bank.ts
  "No date and amount columns found. Is this a transaction export from your bank?":
    "Geen kolommen met datum en bedrag gevonden. Is dit een export van mutaties van je bank?",
  "Skipped a line that couldn't be read: {line}": "Een regel die niet te lezen was is overgeslagen: {line}",
  "No statements found in this CAMT.053 file": "Geen afschriften gevonden in dit CAMT.053-bestand",
  "Statement for {account} up to {day} doesn't add up to its closing balance.":
    "Het afschrift van {account} tot {day} komt niet uit op het eindsaldo.",
  "Statement for the account up to {day} doesn't add up to its closing balance.":
    "Het afschrift van de rekening tot {day} komt niet uit op het eindsaldo.",
  "No transactions found in this file": "Geen mutaties gevonden in dit bestand",
  // import/plan.ts
  Quantity: "Aantal",
  Price: "Koers",
  Total: "Totaal",
  "Dividend amount": "Dividendbedrag",
  "Tax withheld": "Ingehouden belasting",
  "an earlier import": "een eerdere import",
  "an exchange sync": "een exchange-sync",
  "a wallet sync": "een wallet-sync",
  "entered by hand": "met de hand ingevoerd",
  "{field} “{value}” is not a number": "{field} “{value}” is geen getal",
  "No date column chosen": "Geen datumkolom gekozen",
  "Date “{value}” can't be read": "Datum “{value}” is niet te lezen",
  "No quantity to tell buy from sell": "Geen aantal om aankoop van verkoop te onderscheiden",
  "Type “{value}” is skipped": "Soort “{value}” wordt overgeslagen",
  "Unknown type “{value}”: choose what it means": "Onbekende soort “{value}”: kies wat het betekent",
  "No type": "Geen soort",
  "Currency “{value}” isn't a currency code": "Valuta “{value}” is geen valutacode",
  "“{value}” isn't a currency": "“{value}” is geen valuta",
  "“{value}” isn't gold, silver, platinum or palladium": "“{value}” is geen goud, zilver, platina of palladium",
  "No asset symbol": "Geen symbool",
  "Price in {currency}: only trades priced in a currency like EUR":
    "Koers in {currency}: alleen transacties met een koers in een valuta zoals EUR",
  "No asset symbol or ISIN": "Geen symbool of ISIN",
  "No quantity": "Geen aantal",
  "Needs a price or a total": "Heeft een koers of een totaal nodig",
  "Buying or selling a currency isn't supported; use deposit/withdrawal":
    "Valuta kopen of verkopen wordt niet ondersteund; gebruik storting/opname",
  "Dividend without an amount": "Dividend zonder bedrag",
  "A dividend needs the security it was paid on": "Een dividend heeft het effect nodig waarop het is uitgekeerd",
  "Split needs the ratio as quantity (e.g. 4 for 4-for-1)":
    "Een splitsing heeft de verhouding als aantal nodig (bijv. 4 voor 4-op-1)",
  "Already imported": "Al geïmporteerd",
  "Imported before and deleted since": "Eerder geïmporteerd en daarna verwijderd",
  "Looks like transaction #{id} ({source})": "Lijkt op transactie #{id} ({source})",
  "No exchange rate for {currency} on {day}": "Geen wisselkoers voor {currency} op {day}",
  "Line {line}: no market price for {symbol} on {day}; booked at €0.":
    "Regel {line}: geen marktkoers voor {symbol} op {day}; geboekt op € 0.",
  "Line {line} skipped: {error}": "Regel {line} overgeslagen: {error}",
  // lib/errors.ts
  "{what} not found": "{what} niet gevonden",
  // lib/validation.ts
  "Must be a non-negative number": "Moet een getal van 0 of meer zijn",
  "Must be a 3-letter currency code": "Moet een valutacode van 3 letters zijn",
  "Must be YYYY-MM-DD": "Moet JJJJ-MM-DD zijn",
  // routes/accounts.ts
  "Must be a number": "Moet een getal zijn",
  "This account has transactions; add a new account for values per year instead":
    "Deze rekening heeft transacties; voeg in plaats daarvan een nieuwe rekening toe voor waarden per jaar",
  "Choose which child the account belongs to": "Kies van welk kind de rekening is",
  "This account is kept with transactions, not values per year":
    "Deze rekening wordt bijgehouden met transacties, niet met waarden per jaar",
  "Each year can appear only once": "Elk jaar mag maar één keer voorkomen",
  "Account has transactions or items; archive it instead":
    "De rekening heeft transacties of stukken; archiveer hem in plaats daarvan",
  // routes/activity.ts
  Wallet: "Wallet",
  Fee: "Kosten",
  Account: "Rekening",
  Buy: "Aankoop",
  Sell: "Verkoop",
  Deposit: "Storting",
  Withdrawal: "Opname",
  "Transfer in": "Overboeking in",
  "Transfer out": "Overboeking uit",
  Dividend: "Dividend",
  Reward: "Beloning",
  Split: "Splitsing",
  "Values per year · {account}": "Waarden per jaar · {account}",
  "account #{id}": "rekening #{id}",
  you: "jij",
  partner: "partner",
  child: "kind",
  "asset #{id}": "belegging #{id}",
  item: "stuk",
  "Photo of {product}": "Foto van {product}",
  "Photo of an item": "Foto van een stuk",
  "CSV import": "CSV-import",
  "Connection {provider}": "Koppeling {provider}",
  "History entry": "Geschiedenisregel",
  "Only deleted transactions and metal items can be restored":
    "Alleen verwijderde transacties en edelmetaalstukken kunnen worden teruggezet",
  "It's already there": "Het staat er al",
  "Its account no longer exists": "De rekening bestaat niet meer",
  "Its asset no longer exists": "De belegging bestaat niet meer",
  // routes/assets.ts
  Asset: "Belegging",
  "Running costs must be between 0 and 5%": "Lopende kosten moeten tussen 0 en 5% liggen",
  "Search failed: {error}": "Zoeken mislukt: {error}",
  "A Yahoo ticker is required": "Een Yahoo-ticker is verplicht",
  "Could not price {ref} on Yahoo: {error}": "Kon geen koers voor {ref} vinden op Yahoo: {error}",
  "A CoinGecko id is required": "Een CoinGecko-id is verplicht",
  "This asset already exists": "Deze belegging bestaat al",
  "{ref} is already used by “{name}”": "{ref} wordt al gebruikt door “{name}”",
  "Only manually priced assets accept a price": "Alleen beleggingen met een handmatige koers accepteren een koers",
  "Built-in metal assets cannot be deleted": "Ingebouwde edelmetalen kunnen niet worden verwijderd",
  "Asset has transactions; hide it instead": "De belegging heeft transacties; verberg hem in plaats daarvan",
  "This cash balance is used to settle trades; hide it instead":
    "Dit saldo wordt gebruikt om transacties te verrekenen; verberg het in plaats daarvan",
  // routes/auth.ts
  "Password must be at least 12 characters": "Het wachtwoord moet minstens 12 tekens hebben",
  "Already set up": "Al ingesteld",
  "Invalid username or password": "Onjuiste gebruikersnaam of wachtwoord",
  "Current password is incorrect": "Het huidige wachtwoord klopt niet",
  // routes/backups.ts
  "Invalid backup name": "Ongeldige naam voor een back-up",
  "Backup not found": "Back-up niet gevonden",
  "Type RESTORE to confirm": "Typ RESTORE om te bevestigen",
  "Wait for running syncs to finish": "Wacht tot lopende syncs klaar zijn",
  "Restore failed, nothing was changed: {error}": "Terugzetten mislukt, er is niets gewijzigd: {error}",
  // routes/box3.ts
  "The peildatum of that year hasn't happened yet": "De peildatum van dat jaar is nog niet geweest",
  // routes/household.ts
  Person: "Persoon",
  "Use YYYY-MM-DD": "Gebruik JJJJ-MM-DD",
  "You're already in the household": "Je staat al in het huishouden",
  "There's already a partner": "Er is al een partner",
  // routes/imports.ts
  "The uploaded file has expired; choose it again": "Het geüploade bestand is verlopen; kies het opnieuw",
  "That isn't a CSV text file": "Dat is geen CSV-tekstbestand",
  Import: "Import",
  // routes/integrations.ts
  "Could not reach {provider}: {error}": "Kon {provider} niet bereiken: {error}",
  "This account already has a connection": "Deze rekening heeft al een koppeling",
  Connection: "Koppeling",
  // routes/metals.ts
  "Weight must be > 0": "Het gewicht moet > 0 zijn",
  "Purity must be between 0 and 1 (e.g. 0.9999)": "De zuiverheid moet tussen 0 en 1 liggen (bijv. 0,9999)",
  "Unknown storage location": "Onbekende opslaglocatie",
  Item: "Stuk",
  "Sale date and sale price must be given together": "Verkoopdatum en verkoopprijs moeten samen worden ingevuld",
  "Photo is too large (max 4 MB)": "De foto is te groot (max. 4 MB)",
  "That isn't a JPEG, PNG or WebP image": "Dat is geen JPEG-, PNG- of WebP-afbeelding",
  "At most {n} photos per item": "Maximaal {n} foto's per stuk",
  Photo: "Foto",
  // routes/transactions.ts
  Transaction: "Transactie",
  "Split ratio must be > 0": "De splitsingsverhouding moet > 0 zijn",
  "Quantity must be > 0": "Het aantal moet > 0 zijn",
  "Dividend amount must be > 0": "Het dividendbedrag moet > 0 zijn",
  "Date is in the future": "De datum ligt in de toekomst",
  "No FX rate for {currency}; enter it manually ({error})":
    "Geen wisselkoers voor {currency}; vul hem zelf in ({error})",
  "Unknown asset": "Onbekende belegging",
  "Use /api/transactions/transfer to record transfers":
    "Gebruik /api/transactions/transfer om overboekingen vast te leggen",
  "Choose two different accounts": "Kies twee verschillende rekeningen",
  "This transaction is not part of a transfer": "Deze transactie hoort niet bij een overboeking",
  // routes/wallets.ts
  "Unknown account": "Onbekende rekening",
  "A sync is already running": "Er loopt al een sync",
  "Wait for the running sync to finish": "Wacht tot de lopende sync klaar is",
  "Unsupported chain {chain}": "Blockchain {chain} wordt niet ondersteund",
  "Invalid address": "Ongeldig adres",
  "Script types only apply to Bitcoin-like chains": "Adressoorten gelden alleen voor blockchains zoals Bitcoin",
  "This address is already tracked in that account": "Dit adres wordt al gevolgd in die rekening",
  Address: "Adres",
  // sync/assets.ts
  "No price feed found for {symbol}; created it as a manually priced asset.":
    "Geen koersbron gevonden voor {symbol}; aangemaakt als belegging met een handmatige koers.",
  // sync/importer.ts
  "Skipped {kind} {id}: {error}": "{kind} {id} overgeslagen: {error}",
  "No EUR price for {symbol} on {day}; reward {id} booked at €0.":
    "Geen EUR-koers voor {symbol} op {day}; beloning {id} geboekt op € 0.",
  "No EUR price to value trade {id} ({pair}); booked at €0.":
    "Geen EUR-koers om transactie {id} ({pair}) te waarderen; geboekt op € 0.",
  // sync/providers/bitvavo.ts
  "API secret": "API-geheim",
  "Log in to bitvavo.com → Settings → API → Create new API key.":
    "Log in op bitvavo.com → Instellingen → API → Nieuwe API-sleutel aanmaken.",
  "Give it only the “View” permission. Do not enable trading or withdrawals.":
    "Geef alleen de rechten “Bekijken”. Zet handelen en opnemen niet aan.",
  "Optionally restrict it to your server's public IP address.":
    "Beperk hem eventueel tot het openbare IP-adres van je server.",
  "Copy the key and the secret (the secret is shown only once).":
    "Kopieer de sleutel en het geheim (het geheim wordt maar één keer getoond).",
  "Couldn't read the fixed-staking balance ({error}); staked assets may show as a difference.":
    "Kon het saldo van vaste staking niet lezen ({error}); gestakete tegoeden kunnen als verschil verschijnen.",
  // sync/providers/coinbase.ts
  "Coinbase: the private key could not be read. Paste the full PEM including the BEGIN/END lines.":
    "Coinbase: de privésleutel kon niet worden gelezen. Plak de volledige PEM inclusief de BEGIN- en END-regels.",
  "API key name": "Naam van de API-sleutel",
  "Open the Coinbase Developer Platform (portal.cdp.coinbase.com) → API Keys → Create API key, signed in with your Coinbase account.":
    "Open het Coinbase Developer Platform (portal.cdp.coinbase.com) → API Keys → Create API key, ingelogd met je Coinbase-account.",
  "Under advanced settings choose the ECDSA signature algorithm (Ed25519 keys are not accepted by the Coinbase App API).":
    "Kies bij de geavanceerde instellingen het ondertekeningsalgoritme ECDSA (Ed25519-sleutels worden niet geaccepteerd door de Coinbase App API).",
  "Grant only “View” permissions on your Coinbase App portfolio. No trade or transfer permissions.":
    "Geef alleen “View”-rechten op je Coinbase App-portfolio. Geen rechten om te handelen of over te maken.",
  "Paste the key name (organizations/…/apiKeys/…) and the full private key including the BEGIN/END lines.":
    "Plak de naam van de sleutel (organizations/…/apiKeys/…) en de volledige privésleutel inclusief de BEGIN- en END-regels.",
  "Your Coinbase native currency is not EUR; set it to EUR in Coinbase settings so trades can be valued exactly.":
    "Je standaardvaluta bij Coinbase is niet EUR; zet die op EUR in de instellingen van Coinbase, zodat transacties exact gewaardeerd kunnen worden.",
  // sync/providers/ibkr.ts
  "IBKR: the statement was not ready after a minute; try again later.":
    "IBKR: het overzicht was na een minuut nog niet klaar; probeer het later opnieuw.",
  "Flex Web Service token": "Flex Web Service-token",
  "Flex Query ID": "Flex Query ID",
  "Client Portal → Performance & Reports → Flex Queries → create an Activity Flex Query.":
    "Client Portal → Performance & Reports → Flex Queries → maak een Activity Flex Query aan.",
  "Sections: Trades (Execution level), Cash Transactions (Detail), Open Positions (Summary) and Cash Report. Select all fields in each.":
    "Secties: Trades (Execution level), Cash Transactions (Detail), Open Positions (Summary) en Cash Report. Selecteer in elk alle velden.",
  "Format XML, period “Last 365 Calendar Days”. Save and note the Query ID.":
    "Formaat XML, periode “Last 365 Calendar Days”. Sla op en noteer de Query ID.",
  "Flex Queries page → Flex Web Service Configuration → enable it and generate a token.":
    "Pagina Flex Queries → Flex Web Service Configuration → zet het aan en maak een token aan.",
  "The Flex service only covers up to 365 days per query; import older history via CSV.":
    "De Flex-service beslaat maximaal 365 dagen per query; importeer oudere geschiedenis via CSV.",
  "Skipped {n} {category} trade: only stocks and ETFs are tracked.":
    "{n} {category}-transactie overgeslagen: alleen aandelen en ETF's worden bijgehouden.",
  "Skipped {n} {category} trades: only stocks and ETFs are tracked.":
    "{n} {category}-transacties overgeslagen: alleen aandelen en ETF's worden bijgehouden.",
  // sync/providers/kraken.ts
  "API key": "API-sleutel",
  "Private key": "Privésleutel",
  "Log in to kraken.com → Settings → API → Create API key.": "Log in op kraken.com → Settings → API → Create API key.",
  "Enable only: “Query Funds” and “Query Ledger Entries”. Leave every trading, deposit and withdrawal permission off.":
    "Zet alleen “Query Funds” en “Query Ledger Entries” aan. Laat alle rechten voor handelen, storten en opnemen uit.",
  "Copy the API key and the private key.": "Kopieer de API-sleutel en de privésleutel.",
  // wallets/ankr.ts
  "{chain} needs a free Ankr API key: set ANKR_API_KEY (see the README) and restart.":
    "{chain} heeft een gratis Ankr API-sleutel nodig: zet ANKR_API_KEY (zie de README) en herstart.",
  "Ankr refused the API key ({error}). Check ANKR_API_KEY.":
    "Ankr weigerde de API-sleutel ({error}). Controleer ANKR_API_KEY.",
  // wallets/bitcoin.ts
  "Not a valid extended public key (checksum failed)": "Geen geldige extended public key (controlegetal klopt niet)",
  "Not a valid extended public key": "Geen geldige extended public key",
  "Unsupported extended key type for {chain} (multisig and private keys are not accepted)":
    "Niet-ondersteunde soort extended key voor {chain} (multisig en privésleutels worden niet geaccepteerd)",
  "That is a private key. Only paste the public key (xpub/ypub/zpub).":
    "Dat is een privésleutel. Plak alleen de publieke sleutel (xpub/ypub/zpub).",
  "bc1… / 1… / 3… address, or an xpub/ypub/zpub": "bc1…- / 1…- / 3…-adres, of een xpub/ypub/zpub",
  "ltc1… / L… / M… address, or an xpub/ypub/zpub/Ltub/Mtub": "ltc1…- / L…- / M…-adres, of een xpub/ypub/zpub/Ltub/Mtub",
  // wallets/cardano.ts
  "stake1… stake address, or any addr1… address of the wallet": "stake1…-stakeadres, of een addr1…-adres van de wallet",
  "Not a valid Cardano stake address": "Geen geldig Cardano-stakeadres",
  "Testnet addresses aren't tracked": "Testnetadressen worden niet gevolgd",
  "Use a stake1… address or a Shelley addr1… address (old Byron addresses aren't supported)":
    "Gebruik een stake1…-adres of een Shelley-addr1…-adres (oude Byron-adressen worden niet ondersteund)",
  "Not a valid Cardano address": "Geen geldig Cardano-adres",
  // wallets/dogecoin.ts
  "Not a valid {chain} address": "Geen geldig {chain}-adres",
  "{n} used address found from the extended key": "{n} gebruikt adres gevonden via de extended key",
  "{n} used addresses found from the extended key": "{n} gebruikte adressen gevonden via de extended key",
  "D… address, or a dgub/xpub extended public key": "D…-adres, of een dgub/xpub extended public key",
  "BlockCypher's free limit (100 requests an hour) was reached; the rest of the history follows in the next sync.":
    "De gratis limiet van BlockCypher (100 verzoeken per uur) is bereikt; de rest van de geschiedenis volgt bij de volgende sync.",
  // wallets/evm.ts
  "0x… address (same address works on every EVM chain)": "0x…-adres (hetzelfde adres werkt op elke EVM-blockchain)",
  "Not a valid EVM address (0x followed by 40 hex characters)":
    "Geen geldig EVM-adres (0x gevolgd door 40 hexadecimale tekens)",
  // wallets/service.ts
  "{n} token not identified yet (CoinGecko rate limit); it is added on the next sync.":
    "{n} token nog niet herkend (limiet van CoinGecko); die wordt bij de volgende sync toegevoegd.",
  "{n} tokens not identified yet (CoinGecko rate limit); they are added on the next sync.":
    "{n} tokens nog niet herkend (limiet van CoinGecko); die worden bij de volgende sync toegevoegd.",
  // wallets/solana.ts
  "Solana wallet address (base58)": "Solana-walletadres (base58)",
  "Not a valid Solana address": "Geen geldig Solana-adres",
  // wallets/tron.ts
  "TronGrid returned an unexpected next-page link": "TronGrid gaf een onverwachte link naar de volgende pagina",
  "T… address": "T…-adres",
  "Not a valid Tron address (starts with T)": "Geen geldig Tron-adres (begint met T)",
  // wallets/xrp.ts
  "r… classic address": "r…-adres (classic)",
  "Not a valid XRP address (starts with r)": "Geen geldig XRP-adres (begint met r)",
  // lib/errors.ts (demo)
  "Not available in the demo": "Niet beschikbaar in de demo",
  // built-in assets
  Silver: "Zilver",
  Platinum: "Platina",
  Palladium: "Palladium",
  Euro: "Euro",
  "{name} (vaulted)": "{name} (in kluis)",
  "{name} (physical)": "{name} (fysiek)",
  // import/formats
  "Rabobank Beleggen transactions": "Rabobank Beleggen mutaties",
  "Other lines (corporate actions, product changes)": "Overige regels (corporate actions, productwijzigingen)",
  "Trade Republic transactions": "Trade Republic transacties",
  "Trading 212 history": "Trading 212 geschiedenis",
  "Dividend tax in another currency was left out (line {line}).":
    "Dividendbelasting in een andere valuta is weggelaten (regel {line}).",
  "Cash movements (deposits, withdrawals, currency exchange)": "Geldbewegingen (stortingen, opnames, valutawissel)",
  "BUX history": "BUX geschiedenis",
  "Costs without a trade (subscription, service fees)": "Kosten zonder transactie (abonnement, servicekosten)",
  "Saxo transaction overview": "Saxo transactieoverzicht",
  "Cash movements and account costs": "Geldbewegingen en rekeningkosten",
  "Revolut stocks statement": "Revolut aandelenoverzicht",
  "Bitvavo transaction history": "Bitvavo transactiegeschiedenis",
  "Cancelled or pending": "Geannuleerd of in behandeling",
  "Lines without an amount": "Regels zonder bedrag",
  "Trading fee": "Transactiekosten",
  "Network fee": "Netwerkkosten",
  "Staking moves and other lines": "Staking-verplaatsingen en overige regels",
  "Coinbase transaction report": "Coinbase transactierapport",
  "Conversions without details": "Omzettingen zonder details",
  "Conversions to the same coin (e.g. ETH to ETH2)": "Omzettingen naar dezelfde munt (bijv. ETH naar ETH2)",
  "Euro deposits and withdrawals": "Stortingen en opnames in euro's",
  "Moves within Coinbase (staking, Coinbase Pro)": "Verplaatsingen binnen Coinbase (staking, Coinbase Pro)",
  "Kraken ledgers": "Kraken ledgers",
  "{n} trade between two coins (not against euros) was left out: connect Kraken with an API key to include it.":
    "{n} transactie tussen twee munten (niet tegen euro's) is weggelaten: koppel Kraken met een API-sleutel om die mee te nemen.",
  "{n} trades between two coins (not against euros) were left out: connect Kraken with an API key to include them.":
    "{n} transacties tussen twee munten (niet tegen euro's) zijn weggelaten: koppel Kraken met een API-sleutel om ze mee te nemen.",
  "DEGIRO account statement": "DEGIRO rekeningoverzicht",
  "Lines without a date": "Regels zonder datum",
  "A DEGIRO cost in {currency} was counted as EUR.": "Een DEGIRO-kostenpost in {currency} is als EUR geteld.",
  "Platform costs (connection fees)": "Platformkosten (aansluitingskosten)",
  "Interest on cash": "Rente op geld",
  "Dividend tax on {date} without a dividend was left out.":
    "Dividendbelasting op {date} zonder dividend is weggelaten.",
  "DEGIRO transactions": "DEGIRO transacties",
  "Lines without a date or quantity": "Regels zonder datum of aantal",
  "Left out: {reason} ({n})": "Weggelaten: {reason} ({n})",
  "Kluishuis template": "Kluishuis-sjabloon",
};
