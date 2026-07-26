# Instruktioner för Claude

## ⛔ VIKTIGAST AV ALLT: SLUTA ORDBAJSA

Marcus är inte utvecklare. Ordbajsande — facktermer, förkortningar, PR-nummer,
branch-namn, verktygsprat, långa utläggningar — är HELT VÄRDELÖST och saknar
syfte i kommunikationen. Det har kostat timmar av frustration.

Varje svar ska klara detta test:
- **Vad hände?** En mening, vardagssvenska.
- **Vad ska Marcus göra?** Numrerade steg, eller "ingenting".
- **Inget mer.** Ingen bakgrund, inga alternativ, ingen teknik om han inte frågar.

Fel: "Bumpade dep till 0.7.2, mappade is_mining → paused, PR #69 draft, CI grön."
Rätt: "Uppdateringen är klar. Du behöver testa paus-knappen på din miner — jag
säger till när filen finns att ladda ner."

## Grundregler

- Gör jobbet själv. Lägg inte arbete på användaren.
- Svara kort och utan facktermer.
- När något ska byggas, mergas, pushas eller triggas – gör det direkt.
- Fråga bara när det är absolut nödvändigt för att kunna gå vidare.
- Gate:a aldrig något Marcus redan beställt bakom ett godkännande.
- Skapa ALDRIG en riktig release för att testa något — använd test-bygget
  (fil att ladda ner, ingen publicering).

## Projekt

ASIC-miner-monitor byggd i React/Vite med en Node.js-proxy mot CGMiner (port 4028).

## Releaseflöde

1. Bumpa version i `startos/versions/current.ts` och `startos/manifest/index.ts` (Docker-taggen).
2. Uppdatera `IMAGE`-variabeln i `Makefile`.
2b. Bumpa `version` i `umbrel/blisspoint/umbrel-app.yml` + image-taggen i `umbrel/blisspoint/docker-compose.yml`, och spegla till repot `heatpunk/umbrel-app-store`.
2c. Bumpa `version` i `blisspoint-addon/config.yaml` (Home Assistant hämtar imagen med versionen som tagg) och i `custom_components/blisspoint/manifest.json`.
3. Committa och pusha till `main`.
4. Trigga `release.yml` via `workflow_dispatch` med versionsnumret som input – det bygger Docker-imagen, packar `blisspoint.s9pk` och skapar en GitHub Release automatiskt.
