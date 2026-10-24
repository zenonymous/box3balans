# Geen koppelingen die inloggen bij brokers zonder officiële API

_English: [../en/adr/0005-geen-inlog-koppelingen.md](../en/adr/0005-geen-inlog-koppelingen.md)_

Koppelingen gebruiken alleen een sleutel of token met leesrechten, zoals bij Bitvavo, Kraken, Coinbase en de Flex Web Service van Interactive Brokers. Voor een broker zonder officiële API, zoals DEGIRO, zou Box3balans met je wachtwoord moeten inloggen: dat geeft volledige handelsrechten, de klantovereenkomst van DEGIRO verbiedt scripts en het delen van inloggegevens (art. 5.6 en 7.2.1), en de onofficiële API brak sinds 2022 minstens zes keer. Zulke brokers lees je in via hun exports. Het onderzoek staat in [degiro-koppeling.md](../degiro-koppeling.md).

## Overwogen

- **Inloggen met wachtwoord per keer, zonder het op te slaan:** hooguit als experiment; levert twee downloads per jaar op tegen de risico's hierboven.
- **Een aggregator zoals SnapTrade:** leest alleen, maar je wachtwoord ligt dan bij een derde, wat art. 7.2.1 uitdrukkelijk verbiedt.
