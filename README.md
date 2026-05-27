# Forex Macro Dashboard — v8.0

Tableau de bord macroéconomique pour 8 devises majeures (USD, EUR, GBP, JPY, CHF, CAD, AUD, NZD).

## Installation

### 1. Installer Node.js

Télécharger **Node.js LTS** sur [nodejs.org](https://nodejs.org) (inclut npm).

### 2. Installer les dépendances

```bash
cd forex-dashboard
npm install
```

### 3. Configurer les clés API

Le fichier `.env.local` est déjà créé avec tes clés FRED et Bytez.
Ajouter ta clé OANDA quand disponible :

```
OANDA_API_KEY=ta_clé_oanda_ici
```

**Clé FRED gratuite** : [fred.stlouisfed.org](https://fred.stlouisfed.org) → My Account → API Keys  
**Compte OANDA gratuit** : [oanda.com](https://oanda.com) → demo → API Access → Generate token

### 4. Lancer en local

```bash
npm run dev
```

Ouvrir **http://localhost:3000**

## Données rate expectations (banques centrales non-USD)

```bash
pip install requests beautifulsoup4
python scripts/investinglive_scraper.py --n 1 --output json --save data/rate_expectations.json
```

Un snapshot de démonstration (mai 2026) est inclus dans `data/rate_expectations.json`.

## Structure

```
forex-dashboard/
├── app/
│   ├── page.tsx                    ← dashboard principal
│   ├── layout.tsx
│   ├── globals.css
│   └── api/
│       ├── fred/route.ts           ← proxy FRED (cache 1h)
│       ├── fx/route.ts             ← Frankfurter ECB (taux spot)
│       ├── cot/route.ts            ← CFTC COT parser
│       ├── sentiment/route.ts      ← OANDA retail sentiment
│       ├── expectations/route.ts   ← rate_expectations.json
│       ├── narrative/route.ts      ← Bytez LLM (Llama 3.1)
│       ├── yields/route.ts         ← obligations 10Y (FRED, ECB, BoE, BoC)
│       └── drivers/route.ts        ← Gold, Brent, VIX, HY/IG spreads
├── components/
│   ├── CurrencyCard.tsx            ← card par devise
│   ├── DriversBar.tsx              ← barre globale des drivers
│   └── NarrativeButton.tsx         ← bouton analyse IA Bytez
├── lib/
│   ├── types.ts                    ← types TypeScript
│   ├── constants.ts                ← séries FRED corrigées, COT codes
│   └── scoring.ts                  ← algorithme §4 + §6 (divergences)
├── scripts/
│   └── investinglive_scraper.py    ← scraper rate expectations
├── data/
│   └── rate_expectations.json      ← snapshot mensuel BC
└── .env.local                      ← clés API (gitignored)
```

## Sources de données intégrées

| Catégorie | Source | Clé |
|-----------|--------|-----|
| Taux directeurs, CPI, PIB, Retail Sales, Emploi | FRED | oui |
| FX Spot | Frankfurter (ECB) | non |
| Obligations 10Y USD | FRED DGS10 | oui |
| Obligations 10Y EUR | ECB Data Portal | non |
| Obligations 10Y GBP | BoE API IUDMNPY | non |
| Obligations 10Y CAD | BoC API | non |
| COT Positionnement | CFTC CSV public | non |
| Sentiment retail | OANDA v20 API | oui (OANDA) |
| Rate expectations BC | investinglive.com scraper | non |
| Analyse narrative | Bytez (Llama 3.1) | oui (Bytez) |

## Déploiement Vercel

```bash
git init && git add . && git commit -m "init forex dashboard"
# Créer repo privé sur github.com puis :
git remote add origin https://github.com/TONUSER/forex-dashboard.git
git push -u origin main
```

Sur [vercel.com](https://vercel.com) : New Project → importer le repo → Settings → Environment Variables → copier les variables de `.env.local`.

**Note** : le scraper Python ne tourne pas sur Vercel. Lancer localement puis committer `data/rate_expectations.json`.
