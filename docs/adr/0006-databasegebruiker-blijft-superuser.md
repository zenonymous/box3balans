# De databasegebruiker van de app blijft superuser

In de installatie met PostgreSQL is de gebruiker waarmee de app verbindt de superuser die het image bij de eerste start aanmaakt. PostgreSQL weigert die gebruiker zijn rechten af te nemen (getest), dus een beperkte gebruiker vraagt een tweede rol met een eigen wachtwoordbestand, het overdragen van alle tabellen en een wisseling bij het opstarten, ook voor bestaande installaties. Omdat de database alleen voor deze app is en geen poort naar buiten heeft, weegt dat niet op tegen het extra werk en de kans op fouten bij upgrades.

## Gevolgen

Een fout in de app die SQL zou laten uitvoeren, heeft volledige rechten op de database. De verdediging zit daarom in de app zelf: queries gaan via Drizzle met parameters, en SQL wordt nooit als tekst samengesteld uit invoer.
