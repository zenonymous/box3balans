# Pdf's worden in de browser gelezen

Een jaaroverzicht als pdf wordt in de browser gelezen, met pdf.js, dat pas laadt als je een pdf kiest. Alleen de tekst per pagina gaat naar de server, die daarin de waarden zoekt (met een sjabloon per aanbieder, of door bedragen naast een peildatum te zoeken) en niets bewaart. De pdf zelf verlaat je apparaat niet en komt niet in de database of de back-ups; wat blijft, zijn de waarden die je aanvinkt, met de bestandsnaam en de pagina als bron.

Zo blijft de server zonder pdf-bibliotheek (en het Docker-image even groot), en werken de sjablonen en hun tests op tekst, net als de voorbeelden die gebruikers delen (`pdftotext -layout`).

## Overwogen

- **De pdf op de server lezen:** het oorspronkelijke plan in [aanbieders.md](../aanbieders.md#route-het-pdf-jaaroverzicht). Vraagt de hele pdf te uploaden en pdf.js (of iets anders) in het server-image, zonder dat het iets oplevert.
- **De pdf als bijlage bewaren**, zoals foto's bij edelmetaal: handig als bewijs in het dossier, maar een jaaroverzicht staat vol persoonsgegevens. Kan later als keuze van de gebruiker.
