import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

// Groq — API OpenAI-compatible, niveau gratuit, modèles Llama
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY ?? "",
  baseURL: "https://api.groq.com/openai/v1",
});

const SYSTEM_PROMPT = `Tu es un analyste macro Forex senior. Tu analyses les données macroéconomiques de 8 devises majeures (USD, EUR, GBP, JPY, CHF, CAD, AUD, NZD) et tu fournis des synthèses concises et actionnables pour un trader particulier.

Tes analyses sont :
- Directes et factuelles — pas de conditionnel excessif
- Structurées en 3-4 points maximum
- Focalisées sur les divergences et signaux de trading
- En français
- Sans disclaimers légaux

Format de réponse : texte court, 80-120 mots maximum par devise.`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GROQ_API_KEY manquant — ajouter dans Vercel → Settings → Environment Variables" }, { status: 503 });
  }

  let body: {
    mode: "cb_analysis" | "expert_opinion" | "summary" | "divergence" | "report_ccy";
    currency?: string;
    data?: unknown;
    userInput?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { mode, currency, data, userInput } = body;

  let userMessage = "";

  switch (mode) {
    case "cb_analysis":
      userMessage = `Analyse le communiqué de la banque centrale pour ${currency}.
Données contextuelles : ${JSON.stringify(data, null, 2)}

Fournis une analyse en 4 points :
1. Changement de ton (hawkish/dovish/neutre)
2. Évolution des projections de taux
3. Phrases clés ajoutées ou supprimées vs précédent
4. Impact suggéré sur ${currency} (+1 haussier / 0 neutre / -1 baissier)`;
      break;

    case "expert_opinion":
      userMessage = `Point de Vérité — Confrontation IA :
Avis expert injecté : "${userInput}"
Données actuelles du dashboard pour ${currency} : ${JSON.stringify(data, null, 2)}

Analyse :
- Convergences entre l'avis expert et les données quantitatives
- Divergences et points de tension
- Score avant/après ajustement suggéré
- Validation ou rejet de l'avis par devise`;
      break;

    case "divergence":
      userMessage = `Analyse les divergences de positionnement détectées pour ${currency} :
${JSON.stringify(data, null, 2)}

Explique en 3 phrases : pourquoi cette configuration est significative et quelle action de trading elle suggère.`;
      break;

    case "report_ccy": {
      const d = data as {
        weeklyPct?: string; weekFrom?: string; weekTo?: string;
        cotNetTff?: number; cotDeltaTff?: number; cotLongPctTff?: number;
        cotNetLegacy?: number; cotDeltaLegacy?: number;
        yieldCurrent?: number; yieldDelta?: number;
        hint?: string;
      };
      const weekRange = d.weekFrom && d.weekTo ? `${d.weekFrom} au ${d.weekTo}` : "de la semaine";
      userMessage = `Rédige le paragraphe d'analyse hebdomadaire pour ${currency} (semaine du ${weekRange}).

Données disponibles :
- Performance hebdomadaire vs USD : ${d.weeklyPct ?? "N/D"}
- COT Hedge Funds (TFF) : net ${d.cotNetTff ?? "N/D"} contrats, variation semaine : ${d.cotDeltaTff != null ? (d.cotDeltaTff > 0 ? "+" : "") + d.cotDeltaTff : "N/D"}, % long : ${d.cotLongPctTff ?? "N/D"}%
- COT Non-Commercial (Legacy) : net ${d.cotNetLegacy ?? "N/D"} contrats, variation : ${d.cotDeltaLegacy != null ? (d.cotDeltaLegacy > 0 ? "+" : "") + d.cotDeltaLegacy : "N/D"}
- Rendement obligataire : ${d.yieldCurrent != null ? d.yieldCurrent + "%" : "N/D"} (Δ ${d.yieldDelta != null ? (d.yieldDelta > 0 ? "+" : "") + d.yieldDelta + "%" : "N/D"})
${d.hint ? `- Contexte additionnel : ${d.hint}` : ""}

Rédige un paragraphe fluide de 80 à 120 mots, style analyste macro professionnel. Structure : (1) performance et catalyseurs de la semaine, (2) lecture institutionnelle (COT), (3) niveau ou seuil clé à surveiller. Pas de bullet points — texte continu.`;
      break;
    }

    case "summary":
    default:
      userMessage = `Génère une synthèse macro hebdomadaire pour ${currency} basée sur ces données :
${JSON.stringify(data, null, 2)}

Résumé en 3 points : situation actuelle, signal directionnel, risque principal.`;
  }

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      max_tokens: 300,
      temperature: 0.3,
    });

    const text = completion.choices[0]?.message?.content ?? "";
    return NextResponse.json({ analysis: text, model: completion.model, mode });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Groq error: ${message}` }, { status: 502 });
  }
}
