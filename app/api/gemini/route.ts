import { NextRequest, NextResponse } from "next/server"

const MODELS_FALLBACK = [
  "gemini-2.0-flash-exp",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
  "gemini-1.0-pro",
]

function buildSystemPrompt(dbContext: any): string {
  const hasContext = dbContext && !dbContext.error && dbContext.totaleTurniAnalizzati > 0

  // Base identity
  let prompt = `Sei un assistente esperto per la gestione dei turni di lavoro.
Il tuo compito e' creare turni che seguano ESATTAMENTE lo stile, il vocabolario e le abitudini gia' presenti nel database.
`

  if (hasContext) {
    prompt += `
Hai analizzato ${dbContext.totaleTurniAnalizzati} turni degli ultimi 60 giorni. Ecco i pattern appresi:

## Operatori attivi nel sistema
${dbContext.operatoriUsati?.join(", ") || "N/A"}

## Attivita' piu' usate (vocabolario da rispettare - usa QUESTE esatte formulazioni)
${dbContext.topAttivitaGlobali?.map((a: string, i: number) => `${i+1}. "${a}"`).join("\n") || "N/A"}

## Pattern per operatore (orari abituali, attivita' tipiche, celle preferite)
`
    for (const op of (dbContext.operatoriUsati || [])) {
      const orari = dbContext.orariPerOp?.[op]?.map((o: any) => `${o.da}-${o.a} (${o.count}x)`).join(", ")
      const attiv = dbContext.topAttivitaPerOp?.[op]?.slice(0,3).join(" / ")
      const celle = dbContext.topCellePerOp?.[op]?.join(", ")
      if (orari || attiv || celle) {
        prompt += `- ${op}: orari [${orari || "–"}] | attivita' tipiche [${attiv || "–"}] | celle [${celle || "–"}]\n`
      }
    }

    if (dbContext.ultimi10?.length > 0) {
      prompt += `
## Esempi concreti di stile (ultimi turni inseriti — replica questo stile)
`
      for (const t of dbContext.ultimi10) {
        prompt += `- ${t.operatore}: ${t.da_ore}-${t.a_ore} | "${t.attivita}" | ${t.cella} | ${t.stato}${t.note ? ` | note: "${t.note}"` : ""}\n`
      }
    }

    if (dbContext.noteEsempi?.length > 0) {
      prompt += `
## Esempi di note (usa questo stile per le note)
${dbContext.noteEsempi.map((n: string) => `"${n}"`).join("\n")}
`
    }
  } else {
    // Fallback to hardcoded operators if no DB context yet
    prompt += `
Operatori disponibili: Ammaturo Antonio, Ammaturo Francesco, Aprile Claudio, Dell Orzo Franco, Dell Orzo Maurizio, Fabio Matteo, Friolo Antonio, Giangrande Carmelo, Rizzato Nicola, Ruggero Francesco, Zanzarelli Francesco
Turni standard: Mattina 05:00-13:00, Pomeriggio 13:00-21:00, Manutenzione 07:00-14:00, Pulizia 08:00-14:00
Celle disponibili: B1-B20
`
  }

  prompt += `
## Regole fondamentali
- Usa SEMPRE le stesse formulazioni di attivita' gia' presenti nel DB (non inventare nuove).
- Rispetta gli orari abituali di ogni operatore salvo indicazioni contrarie.
- Assegna le celle secondo le preferenze storiche dell'operatore.
- Se l'utente dice "come al solito" o "turno normale", usa i pattern storici dell'operatore.
- Se l'utente corregge una proposta, tieni presente quella correzione per tutto il resto della conversazione.
- Se un operatore ha spesso un certo stato (es. part-time, manutenzione), ricordatelo.

## Quando l'utente vuole inserire turni
Rispondi con:
1. Una breve conferma testuale di cosa stai per creare
2. Un blocco JSON con questo formato ESATTO (tra JSONSTART e JSONEND):

JSONSTART
{
  "action": "create_turni",
  "turni": [
    {
      "operatore": "Nome Cognome",
      "da_ore": "HH:MM",
      "a_ore": "HH:MM",
      "attivita": "testo esatto come da DB",
      "cella": "B1",
      "stato": "attivo",
      "note": ""
    }
  ]
}
JSONEND

## Quando l'utente fa domande o analisi
Rispondi in linguaggio naturale senza JSON. Puoi usare i dati storici per rispondere.

## Quando l'utente rifiuta o corregge una proposta
Chiedi cosa cambiare, poi riproponi il JSON corretto.

Rispondi sempre in italiano. Sii conciso e professionale.`

  return prompt
}

async function callGemini(model: string, systemPrompt: string, messages: any[], apiKey: string) {
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }))

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 1024,
        },
      }),
    }
  )

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Gemini ${model} error ${response.status}: ${err}`)
  }

  const data = await response.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error("No text in Gemini response")
  return text
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_KEY
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_KEY non configurata" }, { status: 500 })
    }

    const { messages, context, dbContext } = await req.json()

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: "messages is required" }, { status: 400 })
    }

    // Build dynamic system prompt from DB patterns
    const systemPrompt = buildSystemPrompt(dbContext)

    // Inject today's turni as initial context in the conversation
    const fullMessages = context
      ? [
          {
            role: "user",
            content: `Contesto turni del giorno selezionato:\n${context}`,
          },
          {
            role: "assistant",
            content: "Ho i dati dei turni correnti. Come posso aiutarti?",
          },
          ...messages,
        ]
      : messages

    let lastError: Error | null = null
    for (const model of MODELS_FALLBACK) {
      try {
        const text = await callGemini(model, systemPrompt, fullMessages, apiKey)
        return NextResponse.json({ text, model })
      } catch (err: any) {
        lastError = err
        console.error(`[gemini] Model ${model} failed:`, err.message)
      }
    }

    return NextResponse.json(
      { error: lastError?.message || "Tutti i modelli Gemini non disponibili" },
      { status: 503 }
    )
  } catch (err: any) {
    console.error("[gemini] route error:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
