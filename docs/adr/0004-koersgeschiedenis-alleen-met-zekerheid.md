# Koersgeschiedenis alleen uit een bron als vaststaat dat het dezelfde munt is

_English: [../en/adr/0004-koersgeschiedenis-alleen-met-zekerheid.md](../en/adr/0004-koersgeschiedenis-alleen-met-zekerheid.md)_

Hetzelfde tickersymbool hoort op verschillende beurzen of in verschillende jaren soms bij een andere munt. Een verkeerde koers op 31 december maakt box 3 ongemerkt fout, een ontbrekende koers valt op. Een tweede bron (Yahoo of Binance) wordt daarom alleen gebruikt als je eigen transacties bevestigen dat het om dezelfde munt gaat, en een ingeruilde munt volgt alleen een opvolger met een bekende, vaste ruilverhouding. Kan dat niet worden vastgesteld, dan blijft de koers leeg en staat de munt onder _Aandacht nodig_, in plaats van een gok.
