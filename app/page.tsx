"use client"

import type React from "react"
import { useState, useEffect, useRef } from "react"
import { Plus, Trash2, Save, X, ChevronUp, ChevronDown, Share2, FileText, Camera, Lock, CalendarIcon, Check, Copy, CopyCheck } from 'lucide-react'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { toast } from "sonner"
import { it } from "date-fns/locale"
import { createClient } from "@/lib/supabase/client"
import { GeminiChatbot } from "@/components/gemini-chatbot"

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
  _originalOperatore?: string
}

const TurniManagement = () => {
  const PASSWORD = "igor13"

  const operatori = [
    "Ammaturo Antonio",
    "Ammaturo Francesco",
    "Aprile Claudio",
    "Dell Orzo Franco",
    "Dell Orzo Maurizio",
    "Fabio Matteo",
    "Friolo Antonio",
    "Giangrande Carmelo",
    "Rizzato Nicola",
    "Ruggero Francesco",
    "Zanzarelli Francesco",
  ]

  const turniOrari = [
    { label: "Turno Mattina (05:00 - 13:00)", daOre: "05:00", aOre: "13:00" },
    { label: "Turno Pomeriggio (13:00 - 21:00)", daOre: "13:00", aOre: "21:00" },
    { label: "Manutenzione (07:00 - 14:00)", daOre: "07:00", aOre: "14:00" },
    { label: "Pulizia (08:00 - 14:00)", daOre: "08:00", aOre: "14:00" },
    { label: "Personalizzato", daOre: "", aOre: "" },
  ]

  const celle = Array.from({ length: 20 }, (_, i) => `B${i + 1}`)

  const getCookie = (name: string): string | null => {
    if (typeof document === "undefined") return null
    const value = `; ${document.cookie}`
    const parts = value.split(`; ${name}=`)
    if (parts.length === 2) return parts.pop()?.split(";").shift() || null
    return null
  }

  const setCookie = (name: string, value: string, hours: number) => {
    if (typeof document === "undefined") return
    const date = new Date()
    date.setTime(date.getTime() + hours * 60 * 60 * 1000)
    const expires = `expires=${date.toUTCString()}`
    document.cookie = `${name}=${value};${expires};path=/`
  }

  const getTodayString = () => {
    const today = new Date()
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
  }

  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    const authCookie = getCookie("turni_auth")
    const todayStr = getTodayString()
    return authCookie === todayStr
  })

  const [password, setPassword] = useState("")
  const [passwordError, setPasswordError] = useState(false)
  const [turni, setTurni] = useState<Turno[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [sortConfig, setSortConfig] = useState<{ key: string | null; direction: "asc" | "desc" }>({
    key: null,
    direction: "asc",
  })
  const [selectedTurno, setSelectedTurno] = useState("")
  const [isCustomTime, setIsCustomTime] = useState(false)
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    return tomorrow
  })
  const tableRef = useRef<HTMLDivElement>(null)
  const daOreInputRef = useRef<HTMLInputElement>(null)
  const aOreInputRef = useRef<HTMLInputElement>(null)
  const [formData, setFormData] = useState({
    daOre: "",
    aOre: "",
    operatore: "",
    attivita: "",
    cella: "",
    note: "",
    status: "attivo",
  })
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [turnoToDelete, setTurnoToDelete] = useState<string | null>(null)
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [operatoreComboOpen, setOperatoreComboOpen] = useState(false)
  const [existingOperatori, setExistingOperatori] = useState<string[]>([])
  const [copyFromPrevModalOpen, setCopyFromPrevModalOpen] = useState(false)
  const [prevDayTurni, setPrevDayTurni] = useState<Turno[]>([])
  const [isCopyingFromPrev, setIsCopyingFromPrev] = useState(false)
  const [editingPrevTurnoId, setEditingPrevTurnoId] = useState<string | null>(null)
  const [selectedPrevTurniIds, setSelectedPrevTurniIds] = useState<Set<string>>(new Set())
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [alreadyUsedOperatori, setAlreadyUsedOperatori] = useState<Set<string>>(new Set())

  const formatTime = (time: string) => {
    if (!time) return ""
    // Remove seconds if present (e.g., "05:00:00" -> "05:00")
    return time.substring(0, 5)
  }

  useEffect(() => {
    if (!isAuthenticated) return

    const supabase = createClient()
    if (!supabase) return

    console.log("[v0] Setting up realtime subscription")

    // Subscribe to changes on the turni table
    const channel = supabase
      .channel("turni_changes")
      .on(
        "postgres_changes",
        {
          event: "*", // Listen to all events (INSERT, UPDATE, DELETE)
          schema: "public",
          table: "turni",
        },
        (payload) => {
          console.log("[v0] Realtime event received:", payload.eventType, payload)

          // Reload data when any change occurs
          loadDataFromSupabase()
          loadExistingOperatori()

          // Show toast notification
          if (payload.eventType === "INSERT") {
            toast.info("Nuovo turno aggiunto da un altro dispositivo")
          } else if (payload.eventType === "UPDATE") {
            toast.info("Turno modificato da un altro dispositivo")
          } else if (payload.eventType === "DELETE") {
            toast.info("Turno eliminato da un altro dispositivo")
          }
        },
      )
      .subscribe()

    // Cleanup subscription on unmount
    return () => {
      console.log("[v0] Cleaning up realtime subscription")
      supabase.removeChannel(channel)
    }
  }, [isAuthenticated, selectedDate])

  useEffect(() => {
    if (isAuthenticated) {
      loadDataFromSupabase()
      loadExistingOperatori()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, isAuthenticated])

  const loadDataFromSupabase = async () => {
    console.log("[v0] Loading data from Supabase")
    setIsLoading(true)
    try {
      const supabase = createClient()
      if (!supabase) {
        console.error("[v0] Failed to create Supabase client")
        toast.error("Errore: impossibile connettersi al database")
        return
      }

      const year = selectedDate.getFullYear()
      const month = String(selectedDate.getMonth() + 1).padStart(2, "0")
      const day = String(selectedDate.getDate()).padStart(2, "0")
      const dateStr = `${year}-${month}-${day}`
      console.log("[v0] Loading turni for date:", dateStr)

      const { data, error } = await supabase
        .from("turni")
        .select("*")
        .eq("data", dateStr)
        .order("da_ore", { ascending: true })

      if (error) {
        console.error("[v0] Error loading turni:", error)
        toast.error("Errore nel caricamento dei turni: " + error.message)
        return
      }

      console.log("[v0] Loaded turni:", data?.length || 0)
      console.log("[v0] Turni data:", data)

      if (data && data.length > 0) {
        setTurni(data)
      } else {
        setTurni([])
      }
    } catch (error) {
      console.error("[v0] Exception loading data:", error)
      toast.error("Errore nel caricamento dei dati")
    } finally {
      setIsLoading(false)
    }
  }

  const loadExistingOperatori = async () => {
    try {
      const supabase = createClient()
      if (!supabase) return

      const year = selectedDate.getFullYear()
      const month = String(selectedDate.getMonth() + 1).padStart(2, "0")
      const day = String(selectedDate.getDate()).padStart(2, "0")
      const dateStr = `${year}-${month}-${day}`

      const { data, error } = await supabase.from("turni").select("operatore").eq("data", dateStr).order("operatore")

      if (error) {
        console.error("[v0] Error loading operators:", error)
        return
      }

      if (data) {
        const uniqueOperatori = [...new Set(data.map((t: any) => t.operatore))]
        setExistingOperatori(uniqueOperatori)
      }
    } catch (error) {
      console.error("[v0] Exception loading operators:", error)
    }
  }

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault()
    if (password === PASSWORD) {
      setIsAuthenticated(true)
      setPasswordError(false)
      // Set cookie that expires at end of day (calculate hours until midnight)
      const now = new Date()
      const midnight = new Date(now)
      midnight.setHours(24, 0, 0, 0)
      const hoursUntilMidnight = (midnight.getTime() - now.getTime()) / (1000 * 60 * 60)
      setCookie("turni_auth", getTodayString(), hoursUntilMidnight)
      toast.success("Accesso effettuato con successo")
    } else {
      setPasswordError(true)
    }
  }

  const getFormattedDate = () => {
    const days = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"]
    const day = String(selectedDate.getDate()).padStart(2, "0")
    const month = String(selectedDate.getMonth() + 1).padStart(2, "0")
    const year = selectedDate.getFullYear()
    return `${days[selectedDate.getDay()]}, ${day}/${month}/${year}`
  }

  const getNextDay = () => {
    const days = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"]
    const months = [
      "Gennaio",
      "Febbraio",
      "Marzo",
      "Aprile",
      "Maggio",
      "Giugno",
      "Luglio",
      "Agosto",
      "Settembre",
      "Ottobre",
      "Novembre",
      "Dicembre",
    ]
    return `${days[selectedDate.getDay()]}, ${selectedDate.getDate()} ${months[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`
  }

  const handleSort = (key: string) => {
    let direction: "asc" | "desc" = "asc"
    if (sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc"
    }
    setSortConfig({ key, direction })
  }

  const getSortedTurni = () => {
    if (!sortConfig.key) return turni

    return [...turni].sort((a: any, b: any) => {
      const aVal = a[sortConfig.key!] || ""
      const bVal = b[sortConfig.key!] || ""

      if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1
      if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1
      return 0
    })
  }

  const resetForm = () => {
    setFormData({
      daOre: "",
      aOre: "",
      operatore: "",
      attivita: "",
      cella: "",
      note: "",
      status: "attivo",
    })
    setSelectedTurno("")
    setIsCustomTime(false)
    setEditingId(null)
  }

  const handleTurnoChange = (value: string) => {
    setSelectedTurno(value)
    const turno = turniOrari.find((t) => t.label === value)
    if (turno) {
      if (turno.label === "Personalizzato") {
        setIsCustomTime(true)
        setFormData({ ...formData, daOre: "", aOre: "" })
      } else {
        setIsCustomTime(false)
        setFormData({ ...formData, daOre: turno.daOre, aOre: turno.aOre })
      }
    }
  }

  const handleSubmit = async (closeModal = true) => {
    if (formData.status !== "malattia" && formData.status !== "ferie" && formData.status !== "permesso") {
      if (!formData.daOre || !formData.aOre || !formData.operatore || !formData.attivita) {
        toast.error("Compilare i campi obbligatori")
        return
      }
    } else {
      if (!formData.operatore) {
        toast.error("Selezionare un operatore")
        return
      }
    }

    try {
      const supabase = createClient()
      if (!supabase) {
        throw new Error("Failed to create Supabase client")
      }

      const year = selectedDate.getFullYear()
      const month = String(selectedDate.getMonth() + 1).padStart(2, "0")
      const day = String(selectedDate.getDate()).padStart(2, "0")
      const dateStr = `${year}-${month}-${day}`
      
      console.log("[v0] Saving turno for date:", dateStr)

      const turnoData = {
        operatore: formData.operatore,
        data: dateStr,
        da_ore: formData.daOre || "00:00",
        a_ore: formData.aOre || "00:00",
        cella: formData.cella || "",
        stato: formData.status,
        note: formData.note || "",
        attivita: formData.attivita || "",
      }

      if (editingId) {
        const { error } = await supabase.from("turni").update(turnoData).eq("id", editingId)

        if (error) throw error

        toast.success("Turno aggiornato con successo")
        // Reload data after update
        await loadDataFromSupabase()
      } else {
        const { error } = await supabase.from("turni").insert([turnoData])

        if (error) throw error

        if (!closeModal) {
          toast.success("Turno salvato! Puoi aggiungerne un altro.")
        } else {
          toast.success("Turno creato con successo")
        }
        // Reload data after insert
        await loadDataFromSupabase()
      }

      if (closeModal) {
        setIsModalOpen(false)
      }
      resetForm()
      loadExistingOperatori()
    } catch (error: any) {
      console.error("[v0] Error saving turno:", error)
      toast.error("Errore nel salvare il turno: " + (error?.message || "Errore sconosciuto"))
    }
  }

  const handleEdit = (turno: Turno) => {
    setFormData({
      daOre: turno.da_ore,
      aOre: turno.a_ore,
      operatore: turno.operatore,
      attivita: turno.attivita || "",
      cella: turno.cella,
      note: turno.note || "",
      status: turno.stato || "attivo",
    })
    const matchingTurno = turniOrari.find((t) => t.daOre === turno.da_ore && t.aOre === turno.a_ore)
    if (matchingTurno) {
      setSelectedTurno(matchingTurno.label)
      setIsCustomTime(matchingTurno.label === "Personalizzato")
    } else {
      setSelectedTurno("Personalizzato")
      setIsCustomTime(true)
    }
    setEditingId(turno.id)
    setIsModalOpen(true)
  }

  const handleDuplicate = (turno: Turno) => {
    setFormData({
      daOre: turno.da_ore,
      aOre: turno.a_ore,
      operatore: "", // Empty operator for duplicate
      attivita: turno.attivita || "",
      cella: turno.cella,
      note: turno.note || "",
      status: turno.stato || "attivo",
    })
    const matchingTurno = turniOrari.find((t) => t.daOre === turno.da_ore && t.aOre === turno.a_ore)
    if (matchingTurno) {
      setSelectedTurno(matchingTurno.label)
      setIsCustomTime(matchingTurno.label === "Personalizzato")
    } else {
      setSelectedTurno("Personalizzato")
      setIsCustomTime(true)
    }
    setEditingId(null) // Not editing, creating new
    setIsModalOpen(true)
  }

  const handleRowClick = (turno: Turno) => {
    handleEdit(turno)
  }

  const handleDelete = async (id: string) => {
    setTurnoToDelete(id)
    setDeleteModalOpen(true)
  }

  const openCopyFromPrevModal = async () => {
    try {
      const supabase = createClient()
      if (!supabase) {
        toast.error("Errore: impossibile connettersi al database")
        return
      }

      const prevDay = new Date(selectedDate)
      prevDay.setDate(prevDay.getDate() - 1)
      const year = prevDay.getFullYear()
      const month = String(prevDay.getMonth() + 1).padStart(2, "0")
      const day = String(prevDay.getDate()).padStart(2, "0")
      const prevDateStr = `${year}-${month}-${day}`

      console.log("[v0] Loading turni for previous day:", prevDateStr)

      const { data, error } = await supabase
        .from("turni")
        .select("*")
        .eq("data", prevDateStr)
        .order("da_ore", { ascending: true })

      if (error) {
        toast.error("Errore nel caricamento dei turni del giorno precedente: " + error.message)
        return
      }

      if (!data || data.length === 0) {
        toast.error("Nessun turno trovato per il giorno precedente")
        return
      }

      // Track which operators are already in today's turni (for UI display)
      const todayOperatori = new Set(turni.map((t) => t.operatore))
      setAlreadyUsedOperatori(todayOperatori)

      // Show ALL prev-day turni; for rows whose operator is already used, keep their name locked
      const loaded = data.map((t: Turno) => ({
        ...t,
        _originalOperatore: t.operatore,
        operatore: t.operatore, // keep original; locked ones won't be editable
      }))
      setPrevDayTurni(loaded)
      // Pre-select only turni whose original operator is NOT already in today
      const selectableIds = new Set<string>(
        loaded
          .filter((t: Turno) => !todayOperatori.has(t._originalOperatore!))
          .map((t: Turno) => t.id)
      )
      setSelectedPrevTurniIds(selectableIds)
      setIsSelectMode(false)
      setCopyFromPrevModalOpen(true)
    } catch (error) {
      console.error("[v0] Error loading previous day turni:", error)
      toast.error("Errore nel caricamento dei turni del giorno precedente")
    }
  }

  const confirmCopyFromPrev = async () => {
    setIsCopyingFromPrev(true)
    try {
      const supabase = createClient()
      if (!supabase) {
        throw new Error("Failed to create Supabase client")
      }

      const year = selectedDate.getFullYear()
      const month = String(selectedDate.getMonth() + 1).padStart(2, "0")
      const day = String(selectedDate.getDate()).padStart(2, "0")
      const currentDateStr = `${year}-${month}-${day}`

      const turniToInsert = prevDayTurni
        .filter((t) => selectedPrevTurniIds.has(t.id))
        .map((t) => ({
        operatore: t.operatore || "",
        data: currentDateStr,
        da_ore: t.da_ore,
        a_ore: t.a_ore,
        cella: t.cella || "",
        stato: t.stato,
        note: t.note || "",
        attivita: t.attivita || "",
      }))

      const { error } = await supabase.from("turni").insert(turniToInsert)

      if (error) throw error

      toast.success(`${turniToInsert.length} turni copiati dal giorno precedente`)
      setCopyFromPrevModalOpen(false)
      setPrevDayTurni([])
      setSelectedPrevTurniIds(new Set())
      await loadDataFromSupabase()
      loadExistingOperatori()
    } catch (error: any) {
      console.error("[v0] Error copying turni:", error)
      toast.error("Errore nella copia dei turni: " + (error?.message || "Errore sconosciuto"))
    } finally {
      setIsCopyingFromPrev(false)
    }
  }

  const confirmDelete = async () => {
    console.log("[v0] confirmDelete called for turno:", turnoToDelete)
    if (!turnoToDelete) return

    try {
      const supabase = createClient()
      if (!supabase) {
        throw new Error("Failed to create Supabase client")
      }

      const { error } = await supabase.from("turni").delete().eq("id", turnoToDelete)

      if (error) throw error

      setDeleteModalOpen(false)
      setTurnoToDelete(null)
      console.log("[v0] Turno deleted successfully")
      toast.success("Turno eliminato con successo")
      // Reload data from database to ensure consistency
      await loadDataFromSupabase()
      loadExistingOperatori()
    } catch (error: any) {
      console.error("[v0] Error deleting turno:", error)
      toast.error("Errore nell'eliminare il turno: " + (error?.message || "Errore sconosciuto"))
    }
  }

  const generatePrintContent = () => {
    const allTurni = getSortedTurni()

    return `
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; padding: 30px; background: white; }
          h1 { font-size: 28px; color: #0a0a0a; margin-bottom: 8px; font-weight: 600; }
          .date { font-size: 14px; color: #737373; margin-bottom: 24px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #e5e5e5; padding: 12px; text-align: left; }
          th { background-color: #fafafa; font-weight: 600; color: #0a0a0a; }
          td { color: #0a0a0a; }
          .note { font-size: 11px; color: #737373; margin-top: 4px; }
          .badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
          }
          .badge-presente {
            background-color: #d9f99d;
            color: #0a0a0a;
          }
          .badge-malattia {
            background-color: #991b1b;
            color: #fafafa;
          }
          .badge-ferie {
            background-color: #fed7aa;
            color: #0a0a0a;
          }
          .badge-permesso {
            background-color: #bfdbfe;
            color: #0a0a0a;
          }
          @media print {
            body { padding: 20px; }
          }
        </style>
      </head>
      <body>
        <h1>Gestione Turni Operatori</h1>
        <div class="date">${getNextDay()}</div>
        <table>
          <thead>
            <tr>
              <th>Orario</th>
              <th>Operatore</th>
              <th>Attività</th>
              <th>Cella</th>
              <th>Stato</th>
            </tr>
          </thead>
          <tbody>
            ${allTurni
              .map((t: any) => {
                let badgeClass = "badge-presente"
                let badgeLabel = "Presente"
                if (t.stato === "malattia") {
                  badgeClass = "badge-malattia"
                  badgeLabel = "Malattia"
                } else if (t.stato === "ferie") {
                  badgeClass = "badge-ferie"
                  badgeLabel = "Ferie"
                } else if (t.stato === "permesso") {
                  badgeClass = "badge-permesso"
                  badgeLabel = "Permesso"
                }

                return `
              <tr>
                <td>${t.stato === "attivo" && t.da_ore && t.a_ore ? `${formatTime(t.da_ore)} - ${formatTime(t.a_ore)}` : "-"}</td>
                <td>${t.operatore}</td>
                <td>
                  ${t.attivita || "-"}
                  ${t.note ? `<div class="note">${t.note}</div>` : ""}
                </td>
                <td>${t.cella || "-"}</td>
                <td><span class="badge ${badgeClass}">${badgeLabel}</span></td>
              </tr>
            `
              })
              .join("")}
          </tbody>
        </table>
      </body>
      </html>
    `
  }

  const exportAsPDF = () => {
    console.log("[v0] exportAsPDF called")
    try {
      const content = generatePrintContent()
      const printWindow = window.open("", "_blank", "width=800,height=600")
      if (printWindow) {
        printWindow.document.write(content)
        printWindow.document.close()
        setTimeout(() => {
          printWindow.focus()
          printWindow.print()
        }, 500)
      } else {
        alert("Impossibile aprire la finestra di stampa. Verifica le impostazioni del browser.")
      }
    } catch (error) {
      console.error("[v0] Error exporting PDF:", error)
      alert("Errore nell'esportazione PDF")
    }
  }

  const exportAsImage = () => {
    console.log("[v0] exportAsImage called")
    try {
      const content = generatePrintContent()
      const imageWindow = window.open("", "_blank", "width=800,height=600")
      if (imageWindow) {
        imageWindow.document.write(content)
        imageWindow.document.close()
        alert(
          'Per salvare come immagine: Clicca con il tasto destro sulla pagina → "Salva immagine con nome" o usa uno screenshot.',
        )
      } else {
        alert("Impossibile aprire la finestra. Verifica le impostazioni del browser.")
      }
    } catch (error) {
      console.error("[v0] Error exporting image:", error)
      alert("Errore nell'esportazione immagine")
    }
  }

  const exportMonthlyReport = async () => {
    console.log("[v0] exportMonthlyReport called")
    try {
      const supabase = createClient()
      if (!supabase) {
        toast.error("Errore: impossibile connettersi al database")
        return
      }

      // Get first and last day of current month
      const year = selectedDate.getFullYear()
      const month = selectedDate.getMonth()
      const firstDay = new Date(year, month, 1)
      const lastDay = new Date(year, month + 1, 0)

      const firstDayStr = `${firstDay.getFullYear()}-${String(firstDay.getMonth() + 1).padStart(2, "0")}-${String(firstDay.getDate()).padStart(2, "0")}`
      const lastDayStr = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`

      console.log("[v0] Loading monthly data from", firstDayStr, "to", lastDayStr)

      // Fetch all shifts for the month
      const { data, error } = await supabase
        .from("turni")
        .select("*")
        .gte("data", firstDayStr)
        .lte("data", lastDayStr)
        .order("data", { ascending: true })
        .order("da_ore", { ascending: true })

      if (error) {
        console.error("[v0] Error loading monthly data:", error)
        toast.error("Errore nel caricamento dei dati mensili")
        return
      }

      if (!data || data.length === 0) {
        toast.error("Nessun turno trovato per questo mese")
        return
      }

      console.log("[v0] Loaded", data.length, "turni for the month")

      // Group data by date
      const groupedByDate: { [key: string]: any[] } = {}
      data.forEach((turno: any) => {
        if (!groupedByDate[turno.data]) {
          groupedByDate[turno.data] = []
        }
        groupedByDate[turno.data].push(turno)
      })

      // Generate monthly report content
      const monthNames = [
        "Gennaio",
        "Febbraio",
        "Marzo",
        "Aprile",
        "Maggio",
        "Giugno",
        "Luglio",
        "Agosto",
        "Settembre",
        "Ottobre",
        "Novembre",
        "Dicembre",
      ]

      let reportContent = `
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: Arial, sans-serif; padding: 30px; background: white; }
            h1 { font-size: 28px; color: #0a0a0a; margin-bottom: 8px; font-weight: 600; }
            .month { font-size: 18px; color: #737373; margin-bottom: 32px; }
            .day-section { margin-bottom: 40px; page-break-inside: avoid; }
            .day-title { font-size: 16px; font-weight: 600; color: #0a0a0a; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid #0a0a0a; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
            th, td { border: 1px solid #e5e5e5; padding: 10px; text-align: left; font-size: 13px; }
            th { background-color: #fafafa; font-weight: 600; color: #0a0a0a; }
            td { color: #0a0a0a; }
            .note { font-size: 11px; color: #737373; margin-top: 4px; }
            .badge {
              display: inline-block;
              padding: 4px 12px;
              border-radius: 6px;
              font-size: 12px;
              font-weight: 500;
            }
            .badge-presente { background-color: #d9f99d; color: #0a0a0a; }
            .badge-malattia { background-color: #991b1b; color: #fafafa; }
            .badge-ferie { background-color: #fed7aa; color: #0a0a0a; }
          .badge-permesso { background-color: #bfdbfe; color: #0a0a0a; }
            @media print {
              body { padding: 20px; }
              .day-section { page-break-inside: avoid; }
            }
          </style>
        </head>
        <body>
          <h1>Report Mensile Turni Operatori</h1>
          <div class="month">${monthNames[month]} ${year}</div>
      `

      // Add each day's data
      Object.keys(groupedByDate)
        .sort()
        .forEach((dateStr) => {
          const date = new Date(dateStr + "T12:00:00")
          const dayNames = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"]
          const dayTitle = `${dayNames[date.getDay()]}, ${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}`

          reportContent += `
            <div class="day-section">
              <div class="day-title">${dayTitle}</div>
              <table>
                <thead>
                  <tr>
                    <th>Orario</th>
                    <th>Operatore</th>
                    <th>Attività</th>
                    <th>Cella</th>
                    <th>Stato</th>
                  </tr>
                </thead>
                <tbody>
          `

          groupedByDate[dateStr].forEach((turno: any) => {
            let badgeClass = "badge-presente"
            let badgeLabel = "Presente"
            if (turno.stato === "malattia") {
              badgeClass = "badge-malattia"
              badgeLabel = "Malattia"
} else if (turno.stato === "ferie") {
  badgeClass = "badge-ferie"
  badgeLabel = "Ferie"
  } else if (turno.stato === "permesso") {
  badgeClass = "badge-permesso"
  badgeLabel = "Permesso"
  }

            reportContent += `
              <tr>
                <td>${turno.stato === "attivo" && turno.da_ore && turno.a_ore ? `${formatTime(turno.da_ore)} - ${formatTime(turno.a_ore)}` : "-"}</td>
                <td>${turno.operatore}</td>
                <td>
                  ${turno.attivita || "-"}
                  ${turno.note ? `<div class="note">${turno.note}</div>` : ""}
                </td>
                <td>${turno.cella || "-"}</td>
                <td><span class="badge ${badgeClass}">${badgeLabel}</span></td>
              </tr>
            `
          })

          reportContent += `
                </tbody>
              </table>
            </div>
          `
        })

      reportContent += `
        </body>
        </html>
      `

      // Open print window
      const printWindow = window.open("", "_blank", "width=800,height=600")
      if (printWindow) {
        printWindow.document.write(reportContent)
        printWindow.document.close()
        setTimeout(() => {
          printWindow.focus()
          printWindow.print()
        }, 500)
        toast.success("Report mensile generato")
      } else {
        toast.error("Impossibile aprire la finestra di stampa")
      }
    } catch (error) {
      console.error("[v0] Error exporting monthly report:", error)
      toast.error("Errore nella generazione del report mensile")
    }
  }


  const handleShare = async () => {
    console.log("[v0] handleShare called")
    try {
      const text = generateShareText()

      if (navigator.share) {
        try {
          await navigator.share({
            title: "Report Turni Operatori",
            text: text,
          })
        } catch (error) {
          console.log("[v0] Share cancelled or failed:", error)
        }
      } else {
        await navigator.clipboard.writeText(text)
        toast.success("Testo copiato negli appunti!")
      }
    } catch (error) {
      console.error("[v0] Error sharing:", error)
      alert("Errore nella condivisione")
    }
  }

  const generateShareText = () => {
    let text = `GESTIONE TURNI OPERATORI\n${getNextDay()}\n\n`
    getSortedTurni()
      .filter((t: any) => t.stato === "attivo")
      .forEach((t: any) => {
        text += `${formatTime(t.da_ore)} - ${formatTime(t.a_ore)} | ${t.operatore}\n`
        text += `Attività: ${t.attivita}\n`
        if (t.cella) text += `Cella: ${t.cella}\n`
        if (t.note) text += `Note: ${t.note}\n`
        text += "\n"
      })
    const assenti = getOperatoriAssenti()
    if (assenti.length > 0) {
      text += "\nASSENZE:\n"
      assenti.forEach((t: any) => {
        text += `${t.stato.toUpperCase()}: ${t.operatore}\n`
      })
    }
    return text
  }

  const SortIcon = ({ column }: { column: string }) => {
    if (sortConfig.key !== column) return <ChevronUp className="w-4 h-4 opacity-30" />
    return sortConfig.direction === "asc" ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />
  }

  const getOperatoriAssenti = () => {
    return turni.filter((t: any) => t.stato === "malattia" || t.stato === "ferie" || t.stato === "permesso")
  }

  const getStatusBadge = (status: string) => {
    if (status === "malattia") {
      return (
        <Badge variant="destructive" className="font-medium bg-red-800">
          Malattia
        </Badge>
      )
    }
if (status === "ferie") {
  return (
  <Badge variant="secondary" className="font-medium bg-orange-100">
  Ferie
  </Badge>
  )
  }
  if (status === "permesso") {
  return (
  <Badge variant="secondary" className="font-medium bg-blue-100">
  Permesso
  </Badge>
  )
  }
  return (
      <Badge variant="default" className="font-medium text-foreground bg-lime-200">
        Presente
      </Badge>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="w-full max-w-md border-2">
          <CardHeader className="space-y-4 text-center pb-8">
            <div className="mx-auto w-16 h-16 bg-primary rounded-full flex items-center justify-center">
              <Lock className="w-8 h-8 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Gestione Turni</h1>
              <p className="text-sm text-muted-foreground mt-2">Accesso riservato</p>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setPasswordError(false)
                  }}
                  className={passwordError ? "border-destructive" : ""}
                  placeholder="Inserisci la password"
                  autoFocus
                />
                {passwordError && <p className="text-sm text-destructive">Password errata. Riprova.</p>}
              </div>

              <Button type="submit" className="w-full" size="lg">
                Accedi
              </Button>
            </form>

            <div className="pt-6 border-t">
              <p className="text-xs text-muted-foreground text-center">La sessione rimane attiva fino a mezzanotte</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        <Card className="shadow-none border-0" ref={tableRef}>
          <CardHeader className="border-b">
            <div className="flex flex-col gap-3">
              {/* Riga 1: Titolo + (su mobile: Condividi accanto alla data) */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-3xl font-bold tracking-tight">Gestione Turni</h1>
                  <div className="mt-3 flex items-center gap-2">
                    <Popover open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="gap-2 bg-transparent">
                          <CalendarIcon className="w-4 h-4" />
                          <span className="font-medium">{getFormattedDate()}</span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={selectedDate}
                          onSelect={(date) => {
                            if (date) {
                              setSelectedDate(date)
                              setIsDatePickerOpen(false)
                            }
                          }}
                          locale={it}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    {/* Condividi visibile accanto alla data solo su mobile */}
                    <div className="md:hidden">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="gap-2 bg-transparent">
                            <Share2 className="w-4 h-4" />
                            Condividi
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-48">
                          <DropdownMenuItem onClick={exportAsPDF} className="gap-3 cursor-pointer">
                            <FileText className="w-4 h-4" />
                            Esporta PDF
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={exportAsImage} className="gap-3 cursor-pointer">
                            <Camera className="w-4 h-4" />
                            Esporta Immagine
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={exportMonthlyReport} className="gap-3 cursor-pointer">
                            <FileText className="w-4 h-4" />
                            Report Mensile
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={handleShare} className="gap-3 cursor-pointer">
                            <Share2 className="w-4 h-4" />
                            Condividi
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </div>
                {/* Azioni desktop (visibili solo da md in su) */}
                <div className="hidden md:flex gap-2 items-center">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="gap-2 bg-transparent">
                        <Share2 className="w-4 h-4" />
                        Condividi
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem onClick={exportAsPDF} className="gap-3 cursor-pointer">
                        <FileText className="w-4 h-4" />
                        Esporta PDF
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={exportAsImage} className="gap-3 cursor-pointer">
                        <Camera className="w-4 h-4" />
                        Esporta Immagine
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={exportMonthlyReport} className="gap-3 cursor-pointer">
                        <FileText className="w-4 h-4" />
                        Report Mensile
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleShare} className="gap-3 cursor-pointer">
                        <Share2 className="w-4 h-4" />
                        Condividi
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  {`${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(2, "0")}` > getTodayString() && (
                    <Button
                      variant="outline"
                      onClick={openCopyFromPrevModal}
                      className="gap-2 bg-transparent"
                    >
                      <CopyCheck className="w-4 h-4" />
                      Copia da ieri
                    </Button>
                  )}
                  <Button
                    onClick={() => {
                      resetForm()
                      setIsModalOpen(true)
                    }}
                    className="gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Nuovo Turno
                  </Button>
                </div>
              </div>
              {/* Riga 2 mobile: Copia da ieri + Nuovo Turno */}
              <div className="flex gap-2 md:hidden">
                {`${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, "0")}-${String(selectedDate.getDate()).padStart(2, "0")}` > getTodayString() && (
                  <Button
                    variant="outline"
                    onClick={openCopyFromPrevModal}
                    className="gap-2 bg-transparent flex-1"
                  >
                    <CopyCheck className="w-4 h-4" />
                    Copia da ieri
                  </Button>
                )}
                <Button
                  onClick={() => {
                    resetForm()
                    setIsModalOpen(true)
                  }}
                  className="gap-2 flex-1"
                >
                  <Plus className="w-4 h-4" />
                  Nuovo Turno
                </Button>
              </div>
            </div>
          </CardHeader>

          <div className="overflow-x-auto">
            {isLoading ? (
              <div className="flex items-center justify-center p-12">
                <p className="text-muted-foreground">Caricamento turni...</p>
              </div>
            ) : turni.length === 0 ? (
              <div className="flex items-center justify-center p-12">
                <p className="text-muted-foreground">
                  Nessun turno per questa data. Clicca "Nuovo Turno" per aggiungerne uno.
                </p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-muted/50 border-b">
                  <tr>
                    <th
                      onClick={() => handleSort("da_ore")}
                      className="text-left p-4 text-sm font-semibold cursor-pointer hover:bg-muted transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        Orario
                        <SortIcon column="da_ore" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort("operatore")}
                      className="text-left p-4 text-sm font-semibold cursor-pointer hover:bg-muted transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        Operatore
                        <SortIcon column="operatore" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort("attivita")}
                      className="text-left p-4 text-sm font-semibold cursor-pointer hover:bg-muted transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        Attività
                        <SortIcon column="attivita" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort("cella")}
                      className="text-left p-4 text-sm font-semibold cursor-pointer hover:bg-muted transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        Cella
                        <SortIcon column="cella" />
                      </div>
                    </th>
                    <th
                      onClick={() => handleSort("stato")}
                      className="text-left p-4 text-sm font-semibold cursor-pointer hover:bg-muted transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        Stato
                        <SortIcon column="stato" />
                      </div>
                    </th>
                    <th className="text-left p-4 text-sm font-semibold">Azioni</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {getSortedTurni().map((turno: any) => (
                    <tr
                      key={turno.id}
                      onClick={() => handleRowClick(turno)}
                      className="hover:bg-muted/50 transition-colors cursor-pointer"
                    >
                      <td className="p-4 text-sm font-medium">
                        {turno.stato === "attivo" && turno.da_ore && turno.a_ore
                          ? `${formatTime(turno.da_ore)} - ${formatTime(turno.a_ore)}`
                          : "-"}
                      </td>
                      <td className="p-4 text-sm font-medium">{turno.operatore}</td>
                      <td className="p-4 text-sm">
                        {turno.attivita && <div>{turno.attivita}</div>}
                        {turno.note && <div className="text-xs text-muted-foreground mt-1">{turno.note}</div>}
                        {!turno.attivita && "-"}
                      </td>
                      <td className="p-4 text-sm">{turno.cella || "-"}</td>
                      <td className="p-4">{getStatusBadge(turno.stato)}</td>
                      <td className="p-4">
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDuplicate(turno)
                            }}
                            title="Duplica"
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDelete(turno.id)
                            }}
                            title="Elimina"
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto border-0">
            <CardHeader className="border-b">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold tracking-tight">{editingId ? "Modifica Turno" : "Nuovo Turno"}</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setIsModalOpen(false)
                    resetForm()
                  }}
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>
            </CardHeader>

            <CardContent className="pt-6 space-y-6">
              <div className="flex flex-wrap gap-4">
                <div className="flex-1 min-w-[200px] space-y-2">
                  <Label htmlFor="operatore">Operatore *</Label>
                  <Popover open={operatoreComboOpen} onOpenChange={setOperatoreComboOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={operatoreComboOpen}
                        className="w-full justify-between font-normal bg-transparent"
                      >
                        {formData.operatore || "Seleziona o inserisci operatore"}
                        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[300px] p-0" align="start">
                      <Command>
                        <CommandInput
                          placeholder="Cerca o inserisci operatore..."
                          value={formData.operatore}
                          onValueChange={(value) => setFormData({ ...formData, operatore: value })}
                        />
                        <CommandList>
                          <CommandEmpty>
                            <div className="p-2 text-sm">Premi Invio per aggiungere "{formData.operatore}"</div>
                          </CommandEmpty>
                          <CommandGroup>
                            {operatori.map((op) => (
                              <CommandItem
                                key={op}
                                value={op}
                                onSelect={(value) => {
                                  setFormData({ ...formData, operatore: value })
                                  setOperatoreComboOpen(false)
                                }}
                              >
                                <Check
                                  className={`mr-2 h-4 w-4 ${
                                    existingOperatori.includes(op) ? "opacity-100" : "opacity-0"
                                  }`}
                                />
                                {op}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="flex-1 min-w-[200px] space-y-2">
                  <Label htmlFor="status">Stato *</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value) => setFormData({ ...formData, status: value })}
                  >
                    <SelectTrigger id="status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="attivo">
                        <div className="flex items-center gap-2">
                          <Check className="w-4 h-4" />
                          Attivo
                        </div>
                      </SelectItem>
                      <SelectItem value="malattia">Malattia</SelectItem>
                      <SelectItem value="ferie">Ferie</SelectItem>
                    <SelectItem value="permesso">Permesso</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {formData.status === "attivo" && (
                <>
<div className="space-y-2">
  <div className="flex items-center justify-between">
  <Label htmlFor="turno">Turno *</Label>
  {formData.daOre && formData.aOre && (
  <span style={{ color: "#555" }} className="text-sm font-medium">
  Tot. ore: {(() => {
    const [daH, daM] = formData.daOre.split(":").map(Number)
    const [aH, aM] = formData.aOre.split(":").map(Number)
    const daMinutes = daH * 60 + daM
    const aMinutes = aH * 60 + aM
    const diffMinutes = aMinutes - daMinutes
    const hours = Math.floor(diffMinutes / 60)
    const minutes = diffMinutes % 60
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}`
  })()}
  </span>
  )}
  </div>
  <Select value={selectedTurno} onValueChange={handleTurnoChange}>
  <SelectTrigger id="turno">
  <SelectValue placeholder="Seleziona turno" />
  </SelectTrigger>
  <SelectContent>
  {turniOrari.map((t) => (
  <SelectItem key={t.label} value={t.label}>
  {t.label}
  </SelectItem>
  ))}
  </SelectContent>
  </Select>
  </div>

                  {(selectedTurno === "Personalizzato" || isCustomTime) && (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="daOre">Da Ore *</Label>
                        <div
                          className="relative cursor-pointer"
                          onClick={() => {
                            try {
                              daOreInputRef.current?.showPicker?.()
                            } catch (error) {
                              daOreInputRef.current?.focus()
                            }
                          }}
                        >
                          <Input
                            ref={daOreInputRef}
                            id="daOre"
                            type="time"
                            value={formData.daOre}
                            onChange={(e) => setFormData({ ...formData, daOre: e.target.value })}
                            className="cursor-pointer"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="aOre">A Ore *</Label>
                        <div
                          className="relative cursor-pointer"
                          onClick={() => {
                            try {
                              aOreInputRef.current?.showPicker?.()
                            } catch (error) {
                              aOreInputRef.current?.focus()
                            }
                          }}
                        >
                          <Input
                            ref={aOreInputRef}
                            id="aOre"
                            type="time"
                            value={formData.aOre}
                            onChange={(e) => setFormData({ ...formData, aOre: e.target.value })}
                            className="cursor-pointer"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="attivita">Attività da Svolgere *</Label>
                    <Textarea
                      id="attivita"
                      value={formData.attivita}
                      onChange={(e) => setFormData({ ...formData, attivita: e.target.value })}
                      rows={3}
                      placeholder="Descrizione dell'attività..."
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="cella">Cella</Label>
                    <Select
                      value={formData.cella || "none"}
                      onValueChange={(value) => setFormData({ ...formData, cella: value === "none" ? "" : value })}
                    >
                      <SelectTrigger id="cella">
                        <SelectValue placeholder="Nessuna" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nessuna</SelectItem>
                        {celle.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="note">Note</Label>
                    <Textarea
                      id="note"
                      value={formData.note}
                      onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                      rows={2}
                      placeholder="Note aggiuntive..."
                    />
                  </div>
                </>
              )}

              <div className="flex flex-col gap-3 pt-4">
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsModalOpen(false)
                      resetForm()
                    }}
                    className="flex-1"
                  >
                    Annulla
                  </Button>
                  {!editingId && (
                    <Button
                      onClick={() => {
                        handleSubmit(false)
                      }}
                      variant="outline"
                      className="gap-2 flex-1"
                    >
                      <Save className="w-4 h-4" />
                      Salva e Continua
                    </Button>
                  )}
                </div>
                <Button
                  onClick={() => {
                    handleSubmit(true)
                  }}
                  className="gap-2 w-full"
                >
                  <Save className="w-4 h-4" />
                  {editingId ? "Aggiorna" : "Salva e Chiudi"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {copyFromPrevModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 px-0 py-0">
          <Card className="w-full h-full pb-9 border-0 rounded-none md:max-w-lg md:h-auto md:rounded-xl md:border-2">
            <CardHeader className="border-b">
              <div className="flex items-start gap-4">
                
                <div className="flex-1">
                  <div className="flex justify-between items-start">
                    <h2 className="text-xl font-bold tracking-tight">Copia Giorno Precedente</h2>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setCopyFromPrevModalOpen(false)
                        setPrevDayTurni([])
                        setEditingPrevTurnoId(null)
                        setSelectedPrevTurniIds(new Set())
                        setIsSelectMode(false)
                        setAlreadyUsedOperatori(new Set())
                      }}
                    >
                      <X className="w-5 h-5" />
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Seleziona i turni da copiare nella data ({getFormattedDate()}).
                  </p>
                </div>
              </div>
            </CardHeader>

            <CardContent className="pt-4">
              {/* Toolbar */}
              <div className="flex items-center justify-between mb-3 px-1">
                <span className="text-sm text-muted-foreground">
                  {isSelectMode
                    ? `${selectedPrevTurniIds.size} di ${prevDayTurni.filter(t => !alreadyUsedOperatori.has(t._originalOperatore ?? "")).length} selezionabili`
                    : `${prevDayTurni.length} turni trovati`}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    if (isSelectMode) {
                      // Annulla: torna a tutti i selezionabili selezionati
                      setSelectedPrevTurniIds(new Set(
                        prevDayTurni
                          .filter(t => !alreadyUsedOperatori.has(t._originalOperatore ?? ""))
                          .map(t => t.id)
                      ))
                      setIsSelectMode(false)
                    } else {
                      // Entra in modalità selezione: deseleziona tutto
                      setSelectedPrevTurniIds(new Set())
                      setIsSelectMode(true)
                    }
                  }}
                >
                  {isSelectMode ? "Annulla selezione" : "Seleziona turni"}
                </Button>
              </div>
              <div className="max-h-[50vh] overflow-y-auto space-y-3 mb-4 pr-1">
                {prevDayTurni.map((t) => {
                  const isAlreadyUsed = alreadyUsedOperatori.has(t._originalOperatore ?? "")
                  const isSelected = selectedPrevTurniIds.has(t.id)
                  const cardClass = isAlreadyUsed
                    ? "border-border bg-muted/40 opacity-70 cursor-not-allowed"
                    : isSelectMode
                    ? isSelected
                      ? "border-border bg-lime-200/30 cursor-pointer"
                      : "border-border bg-card cursor-pointer"
                    : "border-border bg-card cursor-default"

                  // Operatori già assegnati negli altri turni (in-modal duplicates):
                  const assignedOperatori = prevDayTurni
                    .filter(p => p.id !== t.id && p.operatore && (!isSelectMode || selectedPrevTurniIds.has(p.id)))
                    .map(p => p.operatore)

                  return (
                    <div
                      key={t.id}
                      className={`rounded-xl border text-sm overflow-hidden transition-all ${cardClass}`}
                      onClick={() => {
                        if (isAlreadyUsed || !isSelectMode) return
                        setSelectedPrevTurniIds(prev => {
                          const next = new Set(prev)
                          if (next.has(t.id)) next.delete(t.id)
                          else next.add(t.id)
                          return next
                        })
                      }}
                    >
                      {/* Dropdown operatore */}
                      <div
                        className="px-3 pt-3 pb-2 border-b bg-muted/30"
                        onClick={(e) => {
                          if (isAlreadyUsed) { e.stopPropagation(); return }
                          if (isSelectMode && !isSelected) {
                            e.stopPropagation()
                            setSelectedPrevTurniIds(prev => {
                              const next = new Set(prev)
                              next.add(t.id)
                              return next
                            })
                          } else {
                            e.stopPropagation()
                          }
                        }}
                      >
                        {isAlreadyUsed ? (
                          <div className="flex items-center gap-2 h-8 px-1">
                            <span className="font-medium text-sm flex-1">{t._originalOperatore}</span>
                            <Badge variant="secondary" className="text-xs shrink-0 bg-orange-100 text-orange-800 border-orange-200">
                              Già in turno
                            </Badge>
                          </div>
                        ) : (
                        <Select
                          value={t.operatore || "none"}
                          onValueChange={(val) => setPrevDayTurni(prev => prev.map(p => p.id === t.id ? { ...p, operatore: val === "none" ? "" : val } : p))}
                        >
                          <SelectTrigger
                            className="h-8 text-sm bg-background"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (isSelectMode && !isSelected) e.preventDefault()
                            }}
                          >
                            <SelectValue placeholder="— Seleziona operatore —" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">— Nessun operatore —</SelectItem>
                            {operatori.map((op) => (
                              <SelectItem key={op} value={op} disabled={alreadyUsedOperatori.has(op)}>
                                <div className="flex items-center gap-2">
                                  <Check className={`w-3 h-3 shrink-0 ${assignedOperatori.includes(op) ? "opacity-100 text-primary" : "opacity-0"}`} />
                                  {op}
                                  {alreadyUsedOperatori.has(op) && (
                                    <span className="text-xs text-muted-foreground ml-auto">(già usato)</span>
                                  )}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        )}
                      </div>
                      {/* Dettagli attività */}
                      <div className="p-3 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            {t.stato === "attivo" && t.da_ore && t.a_ore && (
                              <span className="text-xs font-medium bg-muted px-2 py-0.5 rounded-md text-muted-foreground">
                                {formatTime(t.da_ore)} – {formatTime(t.a_ore)}
                              </span>
                            )}
                            {t.cella && (
                              <span className="text-xs font-medium bg-muted px-2 py-0.5 rounded-md text-muted-foreground">
                                {t.cella}
                              </span>
                            )}
                          </div>
                          {getStatusBadge(t.stato)}
                        </div>
                        {t.attivita && (
                          <p className="text-xs text-muted-foreground leading-relaxed pt-1">{t.attivita}</p>
                        )}
                        {t.note && (
                          <p className="text-xs text-muted-foreground/70 italic">{t.note}</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="flex gap-3 pt-2 border-t">
                <Button
                  variant="outline"
                  onClick={() => {
                    setCopyFromPrevModalOpen(false)
                    setPrevDayTurni([])
                    setEditingPrevTurnoId(null)
                    setSelectedPrevTurniIds(new Set())
                    setIsSelectMode(false)
                    setAlreadyUsedOperatori(new Set())
                  }}
                  className="flex-1"
                  disabled={isCopyingFromPrev}
                >
                  Annulla
                </Button>
                <Button
                  onClick={confirmCopyFromPrev}
                  className="flex-1 gap-2"
                  disabled={isCopyingFromPrev || selectedPrevTurniIds.size === 0}
                >
                  <CopyCheck className="w-4 h-4" />
                  {isCopyingFromPrev
                    ? `Copiando ${selectedPrevTurniIds.size}...`
                    : `Copia ${selectedPrevTurniIds.size} / ${prevDayTurni.filter(t => !alreadyUsedOperatori.has(t._originalOperatore ?? "")).length}`}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {isAuthenticated && (
        <GeminiChatbot
          turni={turni}
          selectedDate={selectedDate}
          onTurniInserted={() => {
            loadDataFromSupabase()
            loadExistingOperatori()
          }}
        />
      )}

      {deleteModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-md border-2">
            <CardHeader className="border-b">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center flex-shrink-0">
                  <Trash2 className="w-6 h-6 text-destructive" />
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-start">
                    <h2 className="text-xl font-bold tracking-tight">Conferma Eliminazione</h2>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setDeleteModalOpen(false)
                        setTurnoToDelete(null)
                      }}
                    >
                      <X className="w-5 h-5" />
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    Sei sicuro di voler eliminare questo turno? Questa azione non può essere annullata.
                  </p>
                </div>
              </div>
            </CardHeader>

            <CardContent className="pt-6">
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setDeleteModalOpen(false)
                    setTurnoToDelete(null)
                  }}
                  className="flex-1"
                >
                  Annulla
                </Button>
                <Button variant="destructive" onClick={confirmDelete} className="flex-1 gap-2">
                  <Trash2 className="w-4 h-4" />
                  Elimina
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

export default TurniManagement
