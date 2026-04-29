import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// Fetch the last N days of turni to build a rich style/pattern context for Gemini
export async function GET() {
  try {
    const supabase = await createClient()

    // Get turni from last 60 days for strong pattern learning
    const since = new Date()
    since.setDate(since.getDate() - 60)
    const sinceStr = since.toISOString().slice(0, 10)

    const { data, error } = await supabase
      .from("turni")
      .select("operatore, data, da_ore, a_ore, attivita, cella, stato, note")
      .gte("data", sinceStr)
      .order("data", { ascending: false })
      .limit(300)

    if (error) throw error

    if (!data || data.length === 0) {
      return NextResponse.json({ context: null, patterns: null })
    }

    // --- Build patterns from real data ---

    // 1. Operatori actually used (from DB, not hardcoded)
    const operatoriUsati = [...new Set(data.map((t: any) => t.operatore).filter(Boolean))].sort()

    // 2. Orari per operatore (most frequent)
    const orariPerOp: Record<string, { da: string; a: string; count: number }[]> = {}
    for (const t of data) {
      if (!t.operatore || !t.da_ore || !t.a_ore) continue
      const key = `${t.da_ore.slice(0,5)}-${t.a_ore.slice(0,5)}`
      if (!orariPerOp[t.operatore]) orariPerOp[t.operatore] = []
      const existing = orariPerOp[t.operatore].find(x => `${x.da}-${x.a}` === key)
      if (existing) existing.count++
      else orariPerOp[t.operatore].push({ da: t.da_ore.slice(0,5), a: t.a_ore.slice(0,5), count: 1 })
    }
    // Sort by frequency and keep top 3 per operator
    for (const op of Object.keys(orariPerOp)) {
      orariPerOp[op] = orariPerOp[op].sort((a, b) => b.count - a.count).slice(0, 3)
    }

    // 3. Attivita more frequenti per operatore
    const attivitaPerOp: Record<string, Record<string, number>> = {}
    for (const t of data) {
      if (!t.operatore || !t.attivita) continue
      if (!attivitaPerOp[t.operatore]) attivitaPerOp[t.operatore] = {}
      attivitaPerOp[t.operatore][t.attivita] = (attivitaPerOp[t.operatore][t.attivita] || 0) + 1
    }
    const topAttivitaPerOp: Record<string, string[]> = {}
    for (const op of Object.keys(attivitaPerOp)) {
      topAttivitaPerOp[op] = Object.entries(attivitaPerOp[op])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([k]) => k)
    }

    // 4. Celle per operatore
    const cellePerOp: Record<string, Record<string, number>> = {}
    for (const t of data) {
      if (!t.operatore || !t.cella) continue
      if (!cellePerOp[t.operatore]) cellePerOp[t.operatore] = {}
      cellePerOp[t.operatore][t.cella] = (cellePerOp[t.operatore][t.cella] || 0) + 1
    }
    const topCellePerOp: Record<string, string[]> = {}
    for (const op of Object.keys(cellePerOp)) {
      topCellePerOp[op] = Object.entries(cellePerOp[op])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k]) => k)
    }

    // 5. Attivita globali più usate (vocabolario dello stile)
    const attivitaGlobali: Record<string, number> = {}
    for (const t of data) {
      if (!t.attivita) continue
      attivitaGlobali[t.attivita] = (attivitaGlobali[t.attivita] || 0) + 1
    }
    const topAttivitaGlobali = Object.entries(attivitaGlobali)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([k]) => k)

    // 6. Stati usati
    const statiUsati = [...new Set(data.map((t: any) => t.stato).filter(Boolean))]

    // 7. Note ricorrenti (stile di scrittura)
    const noteEsempi = data
      .filter((t: any) => t.note && t.note.trim().length > 2)
      .slice(0, 10)
      .map((t: any) => t.note)

    // 8. Ultimi 10 turni come esempi concreti di stile
    const ultimi10 = data.slice(0, 10).map((t: any) => ({
      operatore: t.operatore,
      da_ore: t.da_ore?.slice(0,5),
      a_ore: t.a_ore?.slice(0,5),
      attivita: t.attivita || "",
      cella: t.cella || "",
      stato: t.stato || "attivo",
      note: t.note || "",
    }))

    return NextResponse.json({
      operatoriUsati,
      orariPerOp,
      topAttivitaPerOp,
      topCellePerOp,
      topAttivitaGlobali,
      statiUsati,
      noteEsempi,
      ultimi10,
      totaleTurniAnalizzati: data.length,
    })
  } catch (err: any) {
    console.error("[gemini/context] error:", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
