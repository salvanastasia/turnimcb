"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { MessageCircle, X, Send, Mic, MicOff, Check, ChevronDown, Loader2, Bot, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"

interface Turno {
  id: string
  operatore: string
  data: string
  da_ore: string
  a_ore: string
  cella: string
  stato: string
  note: string
  attivita?: string
}

interface Message {
  role: "user" | "assistant"
  content: string
  pendingTurni?: ProposedTurno[]
  approved?: boolean
}

interface ProposedTurno {
  operatore: string
  da_ore: string
  a_ore: string
  attivita: string
  cella: string
  stato: string
  note: string
}

interface GeminiChatbotProps {
  turni: Turno[]
  selectedDate: Date
  onTurniInserted: () => void
}

function parseProposedTurni(text: string): ProposedTurno[] | null {
  const match =
    text.match(/JSONSTART\s*([\s\S]*?)\s*JSONEND/) ||
    text.match(/```json\s*([\s\S]*?)```/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[1])
    if (parsed.action === "create_turni" && Array.isArray(parsed.turni)) {
      return parsed.turni
    }
  } catch {
    // invalid json
  }
  return null
}

function cleanText(text: string): string {
  return text
    .replace(/JSONSTART[\s\S]*?JSONEND/g, "")
    .replace(/```json[\s\S]*?```/g, "")
    .trim()
}

function formatTurnoForContext(t: Turno): string {
  return `- ${t.operatore}: ${t.da_ore?.slice(0, 5) ?? ""}-${t.a_ore?.slice(0, 5) ?? ""} | "${t.attivita || "–"}" | ${t.cella || "–"} | ${t.stato}`
}

export function GeminiChatbot({ turni, selectedDate, onTurniInserted }: GeminiChatbotProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [usedModel, setUsedModel] = useState("")
  const [voiceSupported, setVoiceSupported] = useState(false)
  const [dbContext, setDbContext] = useState<any>(null)
  const [isLoadingContext, setIsLoadingContext] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const recognitionRef = useRef<any>(null)

  // Check voice support
  useEffect(() => {
    setVoiceSupported(
      typeof window !== "undefined" &&
        ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)
    )
  }, [])

  // Fetch DB context (patterns/style) from Supabase via server API
  const fetchDbContext = useCallback(async () => {
    setIsLoadingContext(true)
    try {
      const res = await fetch("/api/gemini/context")
      if (!res.ok) throw new Error("Errore caricamento contesto")
      const data = await res.json()
      setDbContext(data)
    } catch {
      // Non-blocking: chatbot still works without DB context
      setDbContext(null)
    } finally {
      setIsLoadingContext(false)
    }
  }, [])

  // On open: load DB context and show welcome message
  useEffect(() => {
    if (!isOpen) return

    if (messages.length === 0) {
      const dateStr = selectedDate.toLocaleDateString("it-IT", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
      setMessages([
        {
          role: "assistant",
          content: `Ciao! Lavoro sui turni del ${dateStr}.\n\nHo analizzato i turni storici per replicare esattamente il tuo stile. Dimmi chi deve lavorare e quando.`,
        },
      ])
    }

    if (!dbContext && !isLoadingContext) {
      fetchDbContext()
    }
  }, [isOpen, messages.length, selectedDate, dbContext, isLoadingContext, fetchDbContext])

  // Re-fetch context whenever turni change (someone edited/added something)
  useEffect(() => {
    if (isOpen && dbContext) {
      fetchDbContext()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turni])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const buildDayContext = useCallback(() => {
    if (turni.length === 0) return "Nessun turno inserito per questa data."
    const dateStr = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(2, "0")}`
    return `Data: ${dateStr}\nTurni gia' presenti:\n${turni.map(formatTurnoForContext).join("\n")}`
  }, [turni, selectedDate])

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return

    const userMsg: Message = { role: "user", content: text.trim() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput("")
    setIsLoading(true)

    try {
      // Last 14 messages for rolling context window
      const apiMessages = newMessages.slice(-14).map((m) => ({
        role: m.role,
        content: m.content,
      }))

      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          context: buildDayContext(),
          dbContext,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Errore API Gemini")

      if (data.model) setUsedModel(data.model)

      const proposed = parseProposedTurni(data.text)
      const cleanContent = cleanText(data.text)

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: cleanContent,
          pendingTurni: proposed ?? undefined,
        },
      ])
    } catch (err: any) {
      toast.error("Errore chatbot: " + err.message)
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Mi dispiace, si e' verificato un errore. Riprova." },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const approveAndInsert = async (msgIndex: number) => {
    const msg = messages[msgIndex]
    if (!msg.pendingTurni) return

    const supabase = createClient()
    if (!supabase) {
      toast.error("Errore: impossibile connettersi al database")
      return
    }

    const year = selectedDate.getFullYear()
    const month = String(selectedDate.getMonth() + 1).padStart(2, "0")
    const day = String(selectedDate.getDate()).padStart(2, "0")
    const dateStr = `${year}-${month}-${day}`

    const turniToInsert = msg.pendingTurni.map((t) => ({
      operatore: t.operatore,
      data: dateStr,
      da_ore: t.da_ore || "00:00",
      a_ore: t.a_ore || "00:00",
      cella: t.cella || "",
      stato: t.stato || "attivo",
      note: t.note || "",
      attivita: t.attivita || "",
    }))

    try {
      const { error } = await supabase.from("turni").insert(turniToInsert)
      if (error) throw error

      toast.success(
        `${turniToInsert.length} ${turniToInsert.length === 1 ? "turno inserito" : "turni inseriti"} con successo`
      )

      setMessages((prev) =>
        prev.map((m, i) => (i === msgIndex ? { ...m, approved: true } : m))
      )
      onTurniInserted()

      // Learning signal: tell Gemini what was approved so it learns the pattern
      const turniDesc = turniToInsert
        .map((t) => `${t.operatore}: ${t.da_ore}-${t.a_ore}, "${t.attivita}", ${t.cella}, ${t.stato}`)
        .join("; ")

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Inserito correttamente. Ho memorizzato il pattern: ${turniDesc}. Vuoi aggiungere altro?`,
        },
      ])

      // Refresh DB context after insert so future suggestions are even more accurate
      fetchDbContext()
    } catch (err: any) {
      toast.error("Errore nell'inserimento: " + err.message)
    }
  }

  const rejectProposal = (msgIndex: number) => {
    const msg = messages[msgIndex]
    setMessages((prev) =>
      prev.map((m, i) => (i === msgIndex ? { ...m, approved: false, pendingTurni: undefined } : m))
    )

    // Learning signal: tell Gemini the proposal was rejected so it adapts
    const rejectedDesc = msg.pendingTurni
      ?.map((t) => `${t.operatore}: ${t.da_ore}-${t.a_ore}, "${t.attivita}"`)
      .join("; ")

    const learningNote = rejectedDesc
      ? `La proposta e' stata rifiutata (${rejectedDesc}). Come la correggo?`
      : "La proposta e' stata rifiutata. Cosa cambio?"

    setMessages((prev) => [
      ...prev,
      { role: "user", content: learningNote },
    ])

    // Auto-send the learning signal
    setTimeout(() => sendMessage(learningNote), 100)
  }

  const startRecording = () => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      toast.error("Riconoscimento vocale non supportato dal browser")
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang = "it-IT"
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    recognition.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript
      setInput((prev) => (prev ? prev + " " + transcript : transcript))
      setIsRecording(false)
    }

    recognition.onerror = () => {
      toast.error("Errore nel riconoscimento vocale")
      setIsRecording(false)
    }

    recognition.onend = () => {
      setIsRecording(false)
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsRecording(true)
  }

  const stopRecording = () => {
    recognitionRef.current?.stop()
    setIsRecording(false)
  }

  const formatTime = (time: string) => time?.slice(0, 5) ?? ""

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-105 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Apri assistente AI"
      >
        <Bot className="w-6 h-6" />
      </button>
    )
  }

  return (
    <div className="fixed bottom-6 right-6 z-40 flex flex-col w-[calc(100vw-3rem)] max-w-sm sm:max-w-md h-[70vh] max-h-[600px] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b bg-primary text-primary-foreground shrink-0">
        <div className="w-8 h-8 rounded-full bg-primary-foreground/20 flex items-center justify-center shrink-0">
          <Bot className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm leading-none">Assistente Turni</p>
          <p className="text-xs opacity-70 mt-0.5 truncate">
            {isLoadingContext
              ? "Analisi stile in corso..."
              : dbContext?.totaleTurniAnalizzati
              ? `${dbContext.totaleTurniAnalizzati} turni analizzati · ${usedModel || "Gemini"}`
              : usedModel || "Gemini AI"}
          </p>
        </div>
        <button
          onClick={() => fetchDbContext()}
          disabled={isLoadingContext}
          className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-primary-foreground/20 transition-colors disabled:opacity-40"
          aria-label="Aggiorna contesto"
          title="Ricarica dati DB"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoadingContext ? "animate-spin" : ""}`} />
        </button>
        <button
          onClick={() => setIsOpen(false)}
          className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-primary-foreground/20 transition-colors"
          aria-label="Chiudi chat"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      {/* DB context badge */}
      {dbContext?.topAttivitaGlobali?.length > 0 && (
        <div className="px-3 py-1.5 bg-muted/40 border-b flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
          <span className="text-xs text-muted-foreground shrink-0">Stile:</span>
          {dbContext.topAttivitaGlobali.slice(0, 5).map((a: string) => (
            <span
              key={a}
              className="text-xs bg-background border border-border rounded-full px-2 py-0.5 whitespace-nowrap cursor-pointer hover:bg-muted transition-colors"
              onClick={() => setInput((prev) => prev ? `${prev}, ${a}` : a)}
              title="Clicca per inserire nel messaggio"
            >
              {a}
            </span>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-muted text-foreground rounded-bl-sm"
              }`}
            >
              {msg.content && <p className="whitespace-pre-wrap">{msg.content}</p>}

              {/* Proposed turni card */}
              {msg.pendingTurni && msg.approved === undefined && (
                <div className="mt-3 border border-border rounded-xl overflow-hidden bg-background">
                  <div className="px-3 py-2 bg-muted/50 border-b">
                    <p className="text-xs font-semibold text-foreground">
                      Turni proposti ({msg.pendingTurni.length})
                    </p>
                  </div>
                  <div className="divide-y">
                    {msg.pendingTurni.map((t, ti) => (
                      <div key={ti} className="px-3 py-2 space-y-0.5">
                        <p className="text-xs font-medium text-foreground">{t.operatore}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatTime(t.da_ore)} – {formatTime(t.a_ore)}
                          {t.cella ? ` · ${t.cella}` : ""}
                        </p>
                        {t.attivita && (
                          <p className="text-xs text-muted-foreground italic">{t.attivita}</p>
                        )}
                        {t.stato && t.stato !== "attivo" && (
                          <Badge variant="secondary" className="text-xs h-4 px-1.5">{t.stato}</Badge>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 p-2 border-t bg-muted/30">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 h-7 text-xs"
                      onClick={() => rejectProposal(i)}
                    >
                      <X className="w-3 h-3 mr-1" />
                      Correggi
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1 h-7 text-xs"
                      onClick={() => approveAndInsert(i)}
                    >
                      <Check className="w-3 h-3 mr-1" />
                      Inserisci
                    </Button>
                  </div>
                </div>
              )}

              {msg.approved === true && (
                <Badge className="mt-2 text-xs bg-lime-200 text-foreground border-0">
                  <Check className="w-3 h-3 mr-1" /> Inserito
                </Badge>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-2xl rounded-bl-sm px-3 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-3 border-t bg-card shrink-0">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Scrivi un messaggio... (Invio per inviare)"
            rows={1}
            className="flex-1 resize-none min-h-[36px] max-h-[100px] text-sm py-2 leading-relaxed"
            disabled={isLoading}
          />
          {voiceSupported && (
            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                isRecording
                  ? "bg-destructive text-destructive-foreground animate-pulse"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
              aria-label={isRecording ? "Stop registrazione" : "Registra vocale"}
            >
              {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isLoading}
            className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 hover:opacity-90 transition-opacity disabled:opacity-40"
            aria-label="Invia messaggio"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5 text-center">
          Invio per inviare · Shift+Invio per nuova riga
        </p>
      </div>
    </div>
  )
}
