import { NextRequest, NextResponse } from "next/server"

const MODELS_FALLBACK = [
  "gemini-2.0-flash-exp",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
  "gemini-1.0-pro",
]

const SYSTEM_PROMPT = `Sei un assistente per la gestione dei turni di lavoro degli operatori.
Hai accesso ai dati dei turni correnti e puoi aiutare a creare, modificare o analizzare i turni.

Gli operatori disponibili sono:
- Ammaturo Antonio
- Ammaturo Francesco
- Aprile Claudio
- Dell Orzo Franco
- Dell Orzo Maurizio
- Fabio Matteo
- Friolo Antonio
- Giangrande Carmelo
- Rizzato Nicola
- Ruggero Francesco
- Zanzarelli Francesco

I turni standard disponibili sono:
- Turno Mattina: 05:00 - 13:00
- Turno Pomeriggio: 13:00 - 21:00
- Manutenzione: 07:00 - 14:00
- Pulizia: 08:00 - 14:00
- Personalizzato: orario libero

Le celle disponibili sono B1-B20.

Gli stati possibili per un turno sono: attivo, malattia, ferie, permesso.

Quando l'utente vuole inserire uno o più turni, rispondi con:
1. Una breve conferma testuale di cosa stai per creare
2. Un blocco JSON con il seguente formato ESATTO (includi il blocco tra ```json e ```):

\`\`\`json
{
  "action": "create_turni",
  "turni": [
    {
      "operatore": "Nome Cognome",
      "da_ore": "HH:MM",
      "a_ore": "HH:MM",
      "attivita": "descrizione attività",
      "cella": "B1",
      "stato": "attivo",
      "note": ""
    }
  ]
}
\`\`\`

Se l'utente fa domande sui turni esistenti o vuole analisi, rispondi in linguaggio naturale senza blocco JSON.
Se l'utente vuole modificare o eliminare turni esistenti, spiega che per ora puoi solo creare nuovi turni.
Sii conciso e professionale. Rispondi sempre in italiano.`

async function callGemini(model: string, messages: any[], apiKey: string) {
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
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        generationConfig: {
          temperature: 0.7,
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

    const { messages, context } = await req.json()

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: "messages is required" }, { status: 400 })
    }

    // Inject context (today's turni) as first user message if provided
    const fullMessages = context
      ? [
          { role: "user", content: `Contesto turni correnti:\n${context}` },
          { role: "assistant", content: "Capito, ho i dati dei turni correnti. Come posso aiutarti?" },
          ...messages,
        ]
      : messages

    let lastError: Error | null = null
    for (const model of MODELS_FALLBACK) {
      try {
        const text = await callGemini(model, fullMessages, apiKey)
        return NextResponse.json({ text, model })
      } catch (err: any) {
        lastError = err
        console.error(`[gemini] Model ${model} failed:`, err.message)
        // Try next model
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
