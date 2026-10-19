# Formaten delen zonder gegevens

Een gebruiker met een export die Box3balans nog niet kent (een CSV van een broker, of een jaaroverzicht als pdf) kan het formaat delen zonder zijn gegevens te delen. Box3balans maakt daarvoor op de eigen server een bestand; de gebruiker ziet precies wat erin staat, downloadt het en hangt het zelf aan een issue (formulier _Formaat delen_). De app verstuurt niets: er komt geen bestemming bij in [ADR 0011](0011-vaste-lijst-van-bestemmingen.md), en de knop naar GitHub is een gewone link zonder gegevens erin.

**Wat er blijft, is een vaste lijst; de rest is verzonnen.** De code staat in [`server/src/import/contribute.ts`](../../server/src/import/contribute.ts).

- **Een CSV:**
  - Blijft: de kopregel, de woorden in de kolom met de soort, valutacodes, woorden voor soorten bezit en metalen, en maandnamen.
  - Verzonnen, in dezelfde vorm:
    - datums: in dezelfde volgorde, en gelijke dagen blijven gelijk;
    - bedragen: andere waarden in dezelfde notatie, met hetzelfde teken;
    - ISIN's en symbolen: bekende fondsen en munten;
    - ID's: dezelfde vorm, nooit een van het bestand zelf;
    - tekst: wordt `text-1`, `text-2`;
    - titelregels: zelfde behandeling.
  - Hoeveel regels: hoogstens drie per soort, en hoogstens veertig in totaal.
- **Een jaaroverzicht:**
  - Blijft:
    - de tekst van de eerste pagina en van de pagina's met de aangevinkte waarden;
    - gewone woorden uit overzichten;
    - de woorden van de aangevinkte regels en van de naam van de aanbieder;
    - jaartallen, en de dagen 1 januari en 31 december.
  - Verzonnen: elk ander getal.
  - Doorgestreept (`Xxxx`): elk ander woord.

**De gebruiker kan alleen meer weghalen.** Elke waarde die blijft, staat in een lijst met een vinkje; uitvinken maakt ook die verzonnen. Wat op persoonlijke gegevens lijkt, wordt zonder vragen vervangen: een naam uit het huishouden of de gebruikersnaam, een IBAN (met geldige controle), een e-mailadres, een telefoonnummer of een BSN (elfproef).

**Een laatste controle** zoekt elk woord en elke code uit het bestand (behalve getallen, datums en wat mag blijven) in het resultaat. Duikt er een op, dan begint Box3balans opnieuw met andere verzonnen waarden; lukt dat vijf keer niet, dan komt er een melding en geen bestand.

**Tests:**

- Property-based tests (`test/fuzz.test.ts`) geven duizenden gegenereerde exports met willekeurige woorden in notities, titelregels en extra kolommen. Geen van die woorden mag in het gedeelde bestand terechtkomen.
- Een tweede eigenschap: een bestand met andere bedragen (van dezelfde vorm) en verschoven datums geeft met hetzelfde zaadje precies hetzelfde gedeelde bestand. Wat je bezit, schijnt er dus niet doorheen.

**Gedeelde formaten zijn data, geen code.** Een gedeeld CSV-formaat is een JSON-bestand in [`server/src/import/formats/shared/`](../../server/src/import/formats/shared/README.md):

- de kolominstellingen;
- het verzonnen voorbeeld;
- wat Box3balans daaruit leest.

Hoe het gebruikt wordt:

- De app gebruikt het als een opgeslagen instelling, voor bestanden waarvan de kopregel ermee begint.
- Het komt na de eigen formaten van Box3balans en na de eigen instellingen van de gebruiker.
- De gebruiker ziet dat het formaat van een andere gebruiker komt, en kan de kolommen nog aanpassen.

Een bestand van een onbekende kan zo niets uitvoeren. Een test controleert per bestand het schema, dat geen ander formaat het voorbeeld claimt, dat het voorbeeld precies zo gelezen wordt als het bestand zegt, en dat er niets in staat dat op een IBAN, e-mailadres, telefoonnummer of BSN lijkt. Een jaaroverzicht wordt voorlopig met de hand een sjabloon (in `yearStatement.ts`).

## Wat er wel openbaar wordt

- Dat de gebruiker een rekening heeft bij die aanbieder, onder zijn GitHub-naam.
- De kopregel, de woorden voor de soort en het jaar van een overzicht.
- Wie dat niet wil, kan een apart GitHub-account gebruiken.

## Overwogen

- **De gebruiker zelf laten anonimiseren** (zoals de formulieren eerst vroegen): foutgevoelig. Een IBAN of een naam in een omschrijving is snel over het hoofd gezien, en de beheerder moet daarna toch nog code schrijven.
- **Zoeken naar persoonlijke gegevens en de rest laten staan:** een zoeklijst mist altijd iets, zoals een naam die niet in het huishouden staat of een adres in een vrij veld. Daarom de omgekeerde aanpak: alleen wat op de lijst staat, blijft.
- **Een pull request rechtstreeks uit de app:** daarvoor zou de app moeten inloggen bij GitHub, een sleutel bewaren en GitHub als bestemming krijgen. Dat ondermijnt de belofte dat Box3balans alleen koersbronnen spreekt. Een GitHub-account is toch nodig, en een issue met het bestand levert hetzelfde op.
- **Een workflow die van een issue vanzelf een pull request maakt:** handig zodra er bijdragen komen. Voorlopig zet de beheerder het bestand er zelf in; die stap is dezelfde controle.
- **Een gedeeld formaat als code (een eigen lezer per bijdrage):** krachtiger, maar code van onbekenden vraagt een zorgvuldige review en kan van alles doen. Wat een kolomindeling niet kan uitdrukken, zoals een transactie verdeeld over twee regels, wordt daarom alsnog een eigen lezer, met het voorbeeld uit de bijdrage als test.
