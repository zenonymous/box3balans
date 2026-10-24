# Een vaste lijst van bestemmingen, afgedwongen in de app

_English: [../en/adr/0011-vaste-lijst-van-bestemmingen.md](../en/adr/0011-vaste-lijst-van-bestemmingen.md)_

Box3balans mag alleen verbinding maken met de adressen in [`server/src/lib/net.ts`](../../server/src/lib/net.ts), per functie met wat er naar buiten gaat. Bij het starten komt er een controle voor elke `fetch` in het proces: alleen HTTPS, alleen adressen op de lijst, en een doorverwijzing alleen als het nieuwe adres er ook op staat. Al het andere wordt geweigerd. Elk verzoek wordt bijgehouden voor _Instellingen → Netwerk_ (de laatste in het geheugen, aantallen per dag 90 dagen, weigeringen de laatste 50).

Andere wegen naar buiten (`node:http`, `node:net`, `undici` en dergelijke) verbiedt een lintregel in `server/src`. Een test faalt als de code een adres noemt dat niet op de lijst staat, en houdt de lijst gelijk met [docs/privacy.md](../privacy.md) en met de lijst van de afgeschermde opzet ([`deploy/egress/allowed-hosts.txt`](../../deploy/egress/allowed-hosts.txt)).

Op dezelfde pagina zet je bestemmingen uit (tot helemaal offline); de guard weigert ze dan, en koersverversing, koersgeschiedenis en synchronisaties slaan ze over. Een stap in de CI (`scripts/check-network.sh`) draait het image van elke wijziging in de afgeschermde opzet en faalt bij een verbinding met een adres dat niet op de lijst staat.

Zo kan iemand die Box3balans wil controleren één bestand lezen in plaats van de hele code, en ziet een gebruiker in de app wat er is verstuurd.

## Overwogen

- **Alleen documenteren:** eerlijk, maar niet controleerbaar, en het veroudert bij elke nieuwe koersbron.
- **Alleen de afgeschermde opzet (een proxy op netwerkniveau):** het sterkst, want onafhankelijk van de code van Box3balans, maar een extra container die niet iedereen wil. Daarom optioneel ernaast: [docs/privacy.md](../privacy.md#afgeschermd-draaien).
