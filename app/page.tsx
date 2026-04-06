'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Piesa = {
  id: string
  cdp: string
  cod_piesa: string | null
  denumire: string
  masina: string | null
  compatibilitate: string | null
  categorie: string | null
  pret: number | null
  cantitate: number | null
  descriere: string | null
  draft: boolean | null
  poze: string[] | null
  raft: string | null
  vin?: string | null
  cod_culoare?: string | null
  pieseauto_main_category?: string | null
  pieseauto_subcategory?: string | null
  pieseauto_category_path?: string | null
  updated_at?: string | null
}

type SortOption = 'cdp_desc' | 'cdp_asc' | 'pret_desc' | 'pret_asc' | 'denumire_asc' | 'masina_asc'
type StockFilter = 'toate' | 'in_stoc' | 'stoc_zero'

type PieseautoCatalog = {
  main_categories: string[]
  subcategories: Record<string, Array<{ title: string; fulltitle: string; url: string }>>
}

const INTERNAL_CATEGORIES = [
  'Accesorii auto','Accesorii roti','Aprindere','Cabluri auto','Car audio','Caroserie','Climatizare','Dezmembrari auto',
  'Directie','Diverse','Electrica & Electronica Auto','Evacuare','Faruri stopuri lumini','Filtre auto','Frane',
  'Instalatii GPL','Interioare auto','Intretinere auto','Jante & Anvelope','Navigatie GPS','Pachete revizie',
  'Piese moto','Piese Motoare','Pompe si injectoare','Punte si rulmenti','Racire','Scule auto','Suspensie',
  'Transmisie','Tuning','Turbo','Ulei Auto','Xenon',
]

const PAGE_SIZE = 30
const ROW_PREVIEW_DELAY = 220

function normalizeText(value: string) {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\/_.\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeCode(value: string) {
  return (value || '').toLowerCase().replace(/[\s\-_.\/]+/g, '').trim()
}

function scoreSubcategory(name: string, title: string) {
  const hay = normalizeText(name)
  const target = normalizeText(title)
  if (!hay || !target) return 0
  if (hay.includes(target)) return target.length + 100
  let score = 0
  for (const word of target.split(' ').filter(Boolean)) {
    if (word.length >= 3 && hay.includes(word)) score += word.length
  }
  return score
}

function detectInternalCategory(name: string) {
  const hay = normalizeText(name)
  const rules: Array<[string[], string]> = [
    [['airbag', 'ecu', 'modul', 'alternator', 'electromotor', 'senzor'], 'Electrica & Electronica Auto'],
    [['far', 'stop'], 'Faruri stopuri lumini'],
    [['xenon', 'balast'], 'Xenon'],
    [['injector', 'pompa'], 'Pompe si injectoare'],
    [['etrier', 'disc frana'], 'Frane'],
    [['bara', 'usa', 'portiera', 'aripa', 'capota', 'haion', 'oglinda'], 'Caroserie'],
    [['volan', 'bord', 'tapiterie'], 'Interioare auto'],
    [['planetara', 'ambreiaj', 'cutie viteze'], 'Transmisie'],
    [['amortizor', 'arc'], 'Suspensie'],
    [['compresor clima', 'clima'], 'Climatizare'],
    [['turbina', 'turbo'], 'Turbo'],
  ]
  for (const [needles, category] of rules) {
    if (needles.some((n) => hay.includes(normalizeText(n)))) return category
  }
  return ''
}

function detectPieseautoFromName(name: string, catalog: PieseautoCatalog | null) {
  const hay = normalizeText(name)
  if (!hay || !catalog) return { main: '', sub: '', path: '' }

  const aliases: Array<[string[], string, string]> = [
    [['calculator abs', 'modul abs'], 'Electrica & Electronica Auto', 'Calculator ABS'],
    [['calculator airbag', 'modul airbag', 'airbag'], 'Electrica & Electronica Auto', 'Calculator airbag'],
    [['calculator ecu', 'ecu', 'ecm', 'calculator motor'], 'Electrica & Electronica Auto', 'Calculator ECU'],
    [['calculator frana mana', 'frana mana', 'epb'], 'Electrica & Electronica Auto', 'Calculator frana mana'],
    [['alternator'], 'Electrica & Electronica Auto', 'Alternator'],
    [['electromotor'], 'Electrica & Electronica Auto', 'Electromotor'],
    [['bobina'], 'Aprindere', 'Bobine inductie'],
    [['bujie incandescenta', 'bujii incandescente'], 'Aprindere', 'Bujii incandescente'],
    [['etrier'], 'Frane', 'Etrieri frana'],
    [['disc frana'], 'Frane', 'Discuri frana'],
    [['far'], 'Faruri stopuri lumini', 'Faruri'],
    [['stop'], 'Faruri stopuri lumini', 'Stopuri'],
    [['balast xenon', 'xenon'], 'Xenon', 'Balast xenon'],
    [['injector'], 'Pompe si injectoare', 'Injectoare'],
    [['pompa inalta'], 'Pompe si injectoare', 'Pompa inalta presiune'],
    [['compresor clima'], 'Climatizare', 'Compresoare clima'],
    [['usa', 'portiera'], 'Caroserie', 'Portiere'],
    [['bara fata'], 'Caroserie', 'Bare fata'],
    [['bara spate'], 'Caroserie', 'Bare spate'],
    [['aripa'], 'Caroserie', 'Aripi'],
    [['capota'], 'Caroserie', 'Capote'],
    [['haion'], 'Caroserie', 'Haioane'],
    [['oglinda'], 'Caroserie', 'Oglinzi'],
    [['volan'], 'Interioare auto', 'Volane'],
    [['ceasuri bord'], 'Interioare auto', 'Ceasuri bord'],
    [['tapiterie'], 'Interioare auto', 'Tapiterie'],
    [['cutie viteze'], 'Transmisie', 'Cutii viteze'],
    [['planetara'], 'Transmisie', 'Planetare'],
    [['ambreiaj'], 'Transmisie', 'Kit ambreiaj'],
    [['amortizor'], 'Suspensie', 'Amortizoare'],
    [['arc'], 'Suspensie', 'Arcuri'],
    [['caseta directie'], 'Directie', 'Casete directie'],
    [['radiator'], 'Racire', 'Radiatoare'],
    [['filtru ulei'], 'Filtre auto', 'Filtru ulei'],
    [['filtru aer'], 'Filtre auto', 'Filtru aer'],
    [['janta'], 'Jante & Anvelope', 'Jante'],
    [['anvelopa'], 'Jante & Anvelope', 'Anvelope'],
    [['turbina', 'turbo'], 'Turbo', 'Turbine'],
  ]

  for (const [needles, main, sub] of aliases) {
    if (needles.some((n) => hay.includes(normalizeText(n)))) {
      return { main, sub, path: `${main} > ${sub}` }
    }
  }

  let best = { main: '', sub: '', path: '', score: 0 }
  for (const main of catalog.main_categories) {
    const list = catalog.subcategories[main] || []
    for (const sub of list) {
      const score = scoreSubcategory(name, sub.title)
      if (score > best.score) best = { main, sub: sub.title, path: `${main} > ${sub.title}`, score }
    }
  }
  if (best.score > 0) return { main: best.main, sub: best.sub, path: best.path }

  const mainOnly = detectInternalCategory(name)
  return mainOnly ? { main: mainOnly, sub: '', path: mainOnly } : { main: '', sub: '', path: '' }
}

async function rotateImageFileFromUrl(imageUrl: string, degrees: 90 | -90) {
  const response = await fetch(imageUrl)
  if (!response.ok) throw new Error('Nu am putut citi poza pentru rotire.')
  const blob = await response.blob()
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponibil.')
  canvas.width = bitmap.height
  canvas.height = bitmap.width
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((degrees * Math.PI) / 180)
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2)
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((fileBlob) => fileBlob ? resolve(fileBlob) : reject(new Error('Nu am putut genera poza rotită.')), 'image/jpeg', 0.95)
  })
}

export default function Page() {
  const [piese, setPiese] = useState<Piesa[]>([])
  const [selected, setSelected] = useState<Piesa | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [deletingPhoto, setDeletingPhoto] = useState<string | null>(null)
  const [deletingPiesa, setDeletingPiesa] = useState(false)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('cdp_desc')
  const [stockFilter, setStockFilter] = useState<StockFilter>('toate')
  const [selectedPoza, setSelectedPoza] = useState<string | null>(null)
  const [autosaveStatus, setAutosaveStatus] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [hoverPreview, setHoverPreview] = useState(false)
  const [hoveredPiesa, setHoveredPiesa] = useState<Piesa | null>(null)
  const [hoverCardVisible, setHoverCardVisible] = useState(false)
  const [hoverCardPos, setHoverCardPos] = useState({ x: 0, y: 0 })
  const [viewport, setViewport] = useState({ width: 1600, height: 900 })
  const [rotating, setRotating] = useState(false)
  const [manualCategoryEdited, setManualCategoryEdited] = useState(false)
  const [catalog, setCatalog] = useState<PieseautoCatalog | null>(null)

  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedJson = useRef<string>('')

  async function loadPiese(keepCurrentSelection = true) {
    setLoading(true)
    const { data, error } = await supabase.from('piese').select('*').order('cdp', { ascending: false })
    if (error) {
      alert('Eroare la încărcare: ' + error.message)
      setLoading(false)
      return
    }
    const lista = (data || []) as Piesa[]
    setPiese(lista)
    if (keepCurrentSelection && selected) {
      const actualizata = lista.find((p) => p.id === selected.id)
      if (actualizata) {
        setSelected(actualizata)
        const primaPoza = actualizata.poze?.[0] || null
        setSelectedPoza((prev) => prev && actualizata.poze?.includes(prev) ? prev : primaPoza)
      } else {
        setSelected(null)
        setSelectedPoza(null)
      }
    }
    setLoading(false)
  }

  useEffect(() => {
    loadPiese(false)
    fetch('/pieseauto_categories_public.json')
      .then((r) => r.json())
      .then((data) => setCatalog(data))
      .catch(() => setCatalog({ main_categories: [], subcategories: {} }))
  }, [])

  useEffect(() => {
    const updateViewport = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    updateViewport()
    window.addEventListener('resize', updateViewport)
    return () => window.removeEventListener('resize', updateViewport)
  }, [])

  function buildPayload(piesa: Piesa) {
    return {
      cod_piesa: piesa.cod_piesa,
      denumire: piesa.denumire,
      masina: piesa.masina,
      compatibilitate: piesa.compatibilitate,
      categorie: piesa.categorie,
      pret: piesa.pret,
      cantitate: piesa.cantitate,
      descriere: piesa.descriere,
      draft: piesa.draft,
      raft: piesa.raft,
      vin: piesa.vin ?? null,
      cod_culoare: piesa.cod_culoare ?? null,
      pieseauto_main_category: piesa.pieseauto_main_category ?? null,
      pieseauto_subcategory: piesa.pieseauto_subcategory ?? null,
      pieseauto_category_path: piesa.pieseauto_category_path ?? null,
    }
  }

  async function getNextCdpFromSupabase() {
    const { data, error } = await supabase.rpc('get_next_cdp')
    if (error) throw error
    return String(data)
  }

  async function handlePiesaNoua() {
    setCreating(true)
    try {
      const cdpNou = await getNextCdpFromSupabase()
      const { data, error } = await supabase.from('piese').insert([{
        cdp: cdpNou, cod_piesa: null, denumire: 'Piesă nouă', masina: null, compatibilitate: null, categorie: null,
        pret: 0, cantitate: 1, descriere: null, draft: true, poze: [], raft: null, vin: null, cod_culoare: null,
        pieseauto_main_category: null, pieseauto_subcategory: null, pieseauto_category_path: null,
      }]).select().single()

      if (error) {
        alert('Eroare creare piesă: ' + error.message)
        return
      }
      await loadPiese(false)
      setSelected(data as Piesa)
      setSelectedPoza(null)
      setManualCategoryEdited(false)
      lastSavedJson.current = JSON.stringify(buildPayload(data as Piesa))
    } catch (err: any) {
      alert('Eroare creare piesă: ' + (err?.message || 'necunoscută'))
    } finally {
      setCreating(false)
    }
  }

  async function savePiesaSilent(piesa: Piesa, markAsFinal = false) {
    const payload = { ...buildPayload(piesa), draft: markAsFinal ? false : piesa.draft }
    const { error } = await supabase.from('piese').update(payload).eq('id', piesa.id)
    if (error) {
      setAutosaveStatus('Eroare autosave')
      return false
    }
    lastSavedJson.current = JSON.stringify(payload)
    setAutosaveStatus('Salvat')
    return true
  }

  async function updatePiesaManual() {
    if (!selected) return
    const updated = { ...selected, draft: false }
    const ok = await savePiesaSilent(updated, true)
    if (ok) {
      setSelected(updated)
      setPiese((prev) => prev.map((p) => p.id === updated.id ? updated : p))
    }
  }

  async function handleVinde() {
    if (!selected) return
    const updated = { ...selected, cantitate: 0, draft: false }
    const ok = await savePiesaSilent(updated, true)
    if (ok) {
      setSelected(updated)
      setPiese((prev) => prev.map((p) => p.id === updated.id ? updated : p))
      setAutosaveStatus('Marcată ca vândută')
    }
  }

  function updateSelectedField<K extends keyof Piesa>(field: K, value: Piesa[K]) {
    if (!selected) return
    const updated = { ...selected, [field]: value }
    setSelected(updated)
    setAutosaveStatus('Modificări nesalvate')
    setPiese((prev) => prev.map((p) => p.id === updated.id ? { ...p, [field]: value } : p))
  }

  async function saveSelectedOnBlur() {
    if (!selected) return
    const currentJson = JSON.stringify(buildPayload(selected))
    if (currentJson === lastSavedJson.current) return
    const ok = await savePiesaSilent(selected, false)
    if (ok) setPiese((prev) => prev.map((p) => p.id === selected.id ? selected : p))
  }

  function findLatestByCode(code: string, currentId?: string) {
    const norm = normalizeCode(code)
    if (!norm) return null
    const matches = piese.filter((p) => p.id !== currentId && normalizeCode(p.cod_piesa || '') === norm)
    if (!matches.length) return null
    matches.sort((a, b) => {
      const au = new Date(a.updated_at || 0).getTime()
      const bu = new Date(b.updated_at || 0).getTime()
      if (bu !== au) return bu - au
      return (b.cdp || '').localeCompare(a.cdp || '', undefined, { numeric: true })
    })
    return matches[0]
  }

  async function handleCodBlur() {
    if (!selected) return
    let nextSelected = selected
    const latest = findLatestByCode(selected.cod_piesa || '', selected.id)
    if (latest) {
      nextSelected = {
        ...selected,
        denumire: latest.denumire || selected.denumire,
        categorie: latest.categorie || selected.categorie,
        masina: latest.masina || selected.masina,
        pret: latest.pret ?? selected.pret,
        pieseauto_main_category: latest.pieseauto_main_category || selected.pieseauto_main_category,
        pieseauto_subcategory: latest.pieseauto_subcategory || selected.pieseauto_subcategory,
        pieseauto_category_path: latest.pieseauto_category_path || selected.pieseauto_category_path,
      }
      setSelected(nextSelected)
      setPiese((prev) => prev.map((p) => p.id === nextSelected.id ? nextSelected : p))
      setAutosaveStatus(`Precompletat după ${latest.cdp}`)
    }
    const currentJson = JSON.stringify(buildPayload(nextSelected))
    if (currentJson === lastSavedJson.current) return
    const ok = await savePiesaSilent(nextSelected, false)
    if (ok) setPiese((prev) => prev.map((p) => p.id === nextSelected.id ? nextSelected : p))
  }

  async function handleDenumireBlur() {
    if (!selected) return
    let nextSelected = selected
    const detected = detectPieseautoFromName(selected.denumire || '', catalog)
    if ((!manualCategoryEdited || !selected.pieseauto_main_category) && detected.main) {
      nextSelected = {
        ...selected,
        categorie: selected.categorie || detectInternalCategory(selected.denumire || ''),
        pieseauto_main_category: detected.main,
        pieseauto_subcategory: detected.sub || '',
        pieseauto_category_path: detected.path || detected.main,
      }
      setSelected(nextSelected)
      setPiese((prev) => prev.map((p) => p.id === nextSelected.id ? nextSelected : p))
    }
    const currentJson = JSON.stringify(buildPayload(nextSelected))
    if (currentJson === lastSavedJson.current) return
    const ok = await savePiesaSilent(nextSelected, false)
    if (ok) setPiese((prev) => prev.map((p) => p.id === nextSelected.id ? nextSelected : p))
  }

  useEffect(() => {
    if (!selected) {
      lastSavedJson.current = ''
      setAutosaveStatus('')
      setSelectedPoza(null)
      setManualCategoryEdited(false)
      return
    }
    lastSavedJson.current = JSON.stringify(buildPayload(selected))
    setSelectedPoza(selected.poze?.[0] || null)
    setManualCategoryEdited(false)
  }, [selected?.id])

  async function handleStergePiesa() {
    if (!selected) return
    const confirmDelete = window.confirm(`Sigur vrei să ștergi piesa ${selected.cdp} - ${selected.denumire}?`)
    if (!confirmDelete) return
    setDeletingPiesa(true)
    const pathsDeSters = (selected.poze || []).map((url) => getStoragePathFromPublicUrl(url)).filter(Boolean) as string[]
    if (pathsDeSters.length > 0) {
      const { error: removeStorageError } = await supabase.storage.from('piese-poze').remove(pathsDeSters)
      if (removeStorageError) {
        setDeletingPiesa(false)
        alert('Eroare ștergere poze din Storage: ' + removeStorageError.message)
        return
      }
    }
    const { error } = await supabase.from('piese').delete().eq('id', selected.id)
    if (error) {
      setDeletingPiesa(false)
      alert('Eroare ștergere piesă: ' + error.message)
      return
    }
    setSelected(null)
    setSelectedPoza(null)
    await loadPiese(false)
    setDeletingPiesa(false)
  }

  async function handlePozaUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!selected) return
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setUploading(true)
    const pozeNoi = [...(selected.poze || [])]
    for (const file of files) {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const storagePath = `${selected.cdp}/${selected.cdp}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: uploadError } = await supabase.storage.from('piese-poze').upload(storagePath, file)
      if (uploadError) {
        setUploading(false)
        alert('Eroare upload: ' + uploadError.message)
        return
      }
      const { data } = supabase.storage.from('piese-poze').getPublicUrl(storagePath)
      if (!pozeNoi.includes(data.publicUrl)) pozeNoi.push(data.publicUrl)
    }
    const uniquePoze = Array.from(new Set(pozeNoi.filter(Boolean)))
    const { error: updateError } = await supabase.from('piese').update({ poze: uniquePoze }).eq('id', selected.id)
    if (updateError) {
      setUploading(false)
      alert('Eroare salvare poze: ' + updateError.message)
      return
    }
    const updated = { ...selected, poze: uniquePoze }
    setSelected(updated)
    setSelectedPoza(uniquePoze[0] || null)
    setPiese((prev) => prev.map((p) => p.id === updated.id ? updated : p))
    setUploading(false)
    e.target.value = ''
  }

  async function handleRotateSelected(degrees: 90 | -90) {
    if (!selected || !selectedPoza) return
    setRotating(true)
    try {
      const rotatedBlob = await rotateImageFileFromUrl(selectedPoza, degrees)
      const oldPath = getStoragePathFromPublicUrl(selectedPoza)
      const newStoragePath = `${selected.cdp}/${selected.cdp}-rotated-${Date.now()}.jpg`
      const { error: uploadError } = await supabase.storage.from('piese-poze').upload(newStoragePath, rotatedBlob, { contentType: 'image/jpeg', upsert: false })
      if (uploadError) throw uploadError
      const { data } = supabase.storage.from('piese-poze').getPublicUrl(newStoragePath)
      const nextPoze = (selected.poze || []).map((poza) => poza === selectedPoza ? data.publicUrl : poza)
      const { error: updateError } = await supabase.from('piese').update({ poze: nextPoze }).eq('id', selected.id)
      if (updateError) throw updateError
      if (oldPath) await supabase.storage.from('piese-poze').remove([oldPath])
      const updated = { ...selected, poze: nextPoze }
      setSelected(updated)
      setSelectedPoza(data.publicUrl)
      setPiese((prev) => prev.map((p) => p.id === updated.id ? updated : p))
    } catch (err: any) {
      alert('Eroare rotire poză: ' + (err?.message || 'necunoscută'))
    } finally {
      setRotating(false)
    }
  }

  async function handleStergePoza(pozaUrl: string) {
    if (!selected) return
    setDeletingPhoto(pozaUrl)
    const path = getStoragePathFromPublicUrl(pozaUrl)
    if (path) {
      const { error: storageError } = await supabase.storage.from('piese-poze').remove([path])
      if (storageError) {
        setDeletingPhoto(null)
        alert('Eroare ștergere din Storage: ' + storageError.message)
        return
      }
    }
    const pozeNoi = (selected.poze || []).filter((poza) => poza !== pozaUrl)
    const { error } = await supabase.from('piese').update({ poze: pozeNoi }).eq('id', selected.id)
    if (error) {
      setDeletingPhoto(null)
      alert('Eroare ștergere poză: ' + error.message)
      return
    }
    const updated = { ...selected, poze: pozeNoi }
    setSelected(updated)
    setSelectedPoza(pozeNoi[0] || null)
    setPiese((prev) => prev.map((p) => p.id === updated.id ? updated : p))
    setDeletingPhoto(null)
  }

  const pieseFiltrateSiSortate = useMemo(() => {
    const terms = normalizeText(search).split(/\s+/).filter(Boolean)
    let rezultat = !terms.length ? [...piese] : piese.filter((p) => {
      const fields = [
        p.cdp || '', p.cod_piesa || '', p.denumire || '', p.masina || '', p.categorie || '', p.raft || '',
        p.vin || '', p.cod_culoare || '', p.compatibilitate || '', p.descriere || '',
        p.pieseauto_main_category || '', p.pieseauto_subcategory || '', p.pieseauto_category_path || '',
      ].map((v) => normalizeText(String(v)))
      return terms.every((term) => fields.some((field) => field.includes(term)))
    })
    if (stockFilter === 'in_stoc') rezultat = rezultat.filter((p) => (p.cantitate || 0) > 0)
    else if (stockFilter === 'stoc_zero') rezultat = rezultat.filter((p) => (p.cantitate || 0) <= 0)
    rezultat.sort((a, b) => {
      switch (sortBy) {
        case 'cdp_asc': return (a.cdp || '').localeCompare(b.cdp || '', undefined, { numeric: true })
        case 'cdp_desc': return (b.cdp || '').localeCompare(a.cdp || '', undefined, { numeric: true })
        case 'pret_asc': return (a.pret || 0) - (b.pret || 0)
        case 'pret_desc': return (b.pret || 0) - (a.pret || 0)
        case 'denumire_asc': return (a.denumire || '').localeCompare(b.denumire || '')
        case 'masina_asc': return (a.masina || '').localeCompare(b.masina || '')
        default: return (b.cdp || '').localeCompare(a.cdp || '', undefined, { numeric: true })
      }
    })
    return rezultat
  }, [piese, search, sortBy, stockFilter])

  const totalPages = Math.max(1, Math.ceil(pieseFiltrateSiSortate.length / PAGE_SIZE))
  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages) }, [currentPage, totalPages])

  const paginatedPiese = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return pieseFiltrateSiSortate.slice(start, start + PAGE_SIZE)
  }, [pieseFiltrateSiSortate, currentPage])

  const valoareStoc = useMemo(() => piese.reduce((sum, p) => sum + (p.pret || 0) * (p.cantitate || 0), 0), [piese])

  const allPieseautoSubcategories = useMemo(() => {
    return Object.values(catalog?.subcategories || {})
      .flat()
      .map((x) => x.title)
      .filter((value, index, arr) => arr.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b, 'ro'))
  }, [catalog])

  function handleRowMouseEnter(piesa: Piesa, e: React.MouseEvent<HTMLDivElement>) {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setHoveredPiesa(piesa)
    setHoverCardPos({ x: e.clientX + 18, y: e.clientY + 12 })
    hoverTimer.current = setTimeout(() => setHoverCardVisible(true), ROW_PREVIEW_DELAY)
  }

  function handleRowMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    setHoverCardPos({ x: e.clientX + 18, y: e.clientY + 12 })
  }

  function handleRowMouseLeave() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setHoverCardVisible(false)
    setHoveredPiesa(null)
  }

  function getRowBackground(p: Piesa) {
    if (selected?.id === p.id && (p.cantitate || 0) <= 0) return '#fecaca'
    if (selected?.id === p.id) return '#dbeafe'
    if ((p.cantitate || 0) <= 0) return '#fee2e2'
    if (p.draft) return '#fff8cc'
    return '#fff'
  }

  return (
    <main style={{ height: '100vh', overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto 1fr', fontFamily: 'Arial, sans-serif', background: '#eef2f6' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #d8dee5', background: '#fff', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '18px', fontWeight: 700 }}>PieseApp</div>
        <input type="text" placeholder="Caută: CDP / cod / denumire / categorie / mașină / VIN / cod culoare" value={search} onChange={(e) => { setSearch(e.target.value); setCurrentPage(1) }} style={topInputStyle} />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortOption)} style={topSelectStyle}>
          <option value="cdp_desc">CDP descrescător</option><option value="cdp_asc">CDP crescător</option>
          <option value="pret_desc">Preț mare → mic</option><option value="pret_asc">Preț mic → mare</option>
          <option value="denumire_asc">Denumire A-Z</option><option value="masina_asc">Mașină A-Z</option>
        </select>
        <select value={stockFilter} onChange={(e) => setStockFilter(e.target.value as StockFilter)} style={topSelectStyle}>
          <option value="toate">Toate piesele</option><option value="in_stoc">Doar în stoc</option><option value="stoc_zero">Doar stoc 0</option>
        </select>
        <button onClick={handlePiesaNoua} disabled={creating} style={primaryBtn}>{creating ? 'Se creează...' : '+ Piesă nouă'}</button>
        <div style={{ marginLeft: 'auto', fontSize: '12px', color: '#475467' }}>Piese: <b>{piese.length}</b> | Valoare stoc: <b>{valoareStoc.toFixed(2)} RON</b></div>
      </div>

      <div style={{ minHeight: 0, display: 'grid', gridTemplateColumns: '54% 46%', gap: '12px', padding: '12px' }}>
        <div style={{ minHeight: 0, display: 'grid', gridTemplateRows: 'auto auto 1fr auto', background: '#fff', border: '1px solid #d8dee5', borderRadius: '12px', overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid #d8dee5', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', fontWeight: 700 }}>
            <span>Lista piese</span><span>{pieseFiltrateSiSortate.length} rezultate</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '86px 120px 1fr 130px 120px 72px 110px 70px', gap: '6px', padding: '8px 8px', borderBottom: '1px solid #d8dee5', fontWeight: 700, fontSize: '11px', background: '#eef2f6', color: '#334155' }}>
            <div>CDP</div><div>Cod piesă</div><div>Denumire</div><div>Categorie</div><div>Mașină</div><div>Raft</div><div>VIN / culoare</div><div>Preț</div>
          </div>
          <div style={{ overflowY: 'auto', minHeight: 0 }}>
            {loading ? <div style={{ padding: '12px', fontSize: '12px' }}>Se încarcă...</div> : paginatedPiese.length === 0 ? <div style={{ padding: '12px', fontSize: '12px' }}>Nu există piese</div> : paginatedPiese.map((p) => (
              <div key={p.id} onClick={() => { setSelected(p); setSelectedPoza(p.poze?.[0] || null) }} onMouseEnter={(e) => handleRowMouseEnter(p, e)} onMouseMove={handleRowMouseMove} onMouseLeave={handleRowMouseLeave} style={{ display: 'grid', gridTemplateColumns: '86px 120px 1fr 130px 120px 72px 110px 70px', gap: '6px', padding: '7px 8px', borderBottom: '1px solid #edf1f5', cursor: 'pointer', background: getRowBackground(p), alignItems: 'center', fontSize: '11px' }}>
                <Cell strong>{p.cdp}</Cell>
                <Cell title={p.cod_piesa || ''}>{p.cod_piesa || '-'}</Cell>
                <Cell strong title={p.denumire}>{p.denumire}</Cell>
                <Cell title={p.categorie || ''}>{p.categorie || '-'}</Cell>
                <Cell title={p.masina || ''}>{p.masina || '-'}</Cell>
                <Cell title={p.raft || ''}>{p.raft || '-'}</Cell>
                <Cell title={`${p.vin || ''} ${p.cod_culoare || ''}`}>{[p.vin || '', p.cod_culoare || ''].filter(Boolean).join(' / ') || '-'}</Cell>
                <div style={{ fontWeight: 700 }}>{(p.pret || 0).toFixed(0)}</div>
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid #d8dee5', background: '#fff', padding: '8px 10px', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} style={pagerBtn}>‹</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).slice(Math.max(0, currentPage - 4), Math.max(0, currentPage - 4) + 8).map((page) => (
              <button key={page} onClick={() => setCurrentPage(page)} style={{ ...pagerBtn, background: currentPage === page ? '#2f80ed' : '#fff', color: currentPage === page ? '#fff' : '#344054', borderColor: currentPage === page ? '#2f80ed' : '#d0d7de' }}>{page}</button>
            ))}
            <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} style={pagerBtn}>›</button>
            <div style={{ marginLeft: '8px', fontSize: '11px', color: '#667085' }}>Pagina {currentPage} / {totalPages}</div>
          </div>
        </div>

        <div style={{ minHeight: 0, overflow: 'hidden' }}>
          {!selected ? (
            <div style={{ background: '#fff', border: '1px solid #d8dee5', borderRadius: '12px', padding: '18px', fontSize: '13px' }}>Selectează o piesă</div>
          ) : (
            <div style={{ position: 'sticky', top: 0, height: 'calc(100vh - 92px)', minHeight: 0, overflowY: 'auto', paddingRight: '4px', display: 'grid', gridTemplateRows: 'auto auto auto auto auto', gap: '8px' }}>
              <div style={cardStyle}>
                <div style={{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)', gap: '12px', alignItems: 'start' }}>
                  <div onMouseEnter={() => setHoverPreview(true)} onMouseLeave={() => setHoverPreview(false)} style={{ width: '300px', height: '224px', borderRadius: '10px', overflow: 'hidden', border: '1px solid #d8dee5', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: selectedPoza ? 'zoom-in' : 'default', position: 'relative' }}>
                    {selectedPoza ? <img src={selectedPoza} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#f8fafc' }} /> : <div style={{ fontSize: '11px', color: '#667085' }}>Fără poză</div>}
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <div style={{ fontSize: '24px', fontWeight: 700 }}>{selected.cdp}</div>
                      <div style={{ background: (selected.cantitate || 0) <= 0 ? '#fee2e2' : selected.draft ? '#fff8cc' : '#ecfdf3', color: (selected.cantitate || 0) <= 0 ? '#b42318' : selected.draft ? '#8a6d00' : '#027a48', border: '1px solid ' + ((selected.cantitate || 0) <= 0 ? '#fca5a5' : selected.draft ? '#f4df93' : '#abefc6'), borderRadius: '999px', padding: '6px 12px', fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {(selected.cantitate || 0) <= 0 ? 'Stoc 0' : selected.draft ? 'Draft' : 'Completă'}
                      </div>
                    </div>
                    <div style={{ fontSize: '15px', fontWeight: 700, marginTop: '6px' }}>{selected.cod_piesa || '-'}</div>
                    <div style={{ fontSize: '14px', marginTop: '6px', fontWeight: 700 }}>{selected.denumire || '-'}</div>
                    <div style={{ fontSize: '12px', color: '#667085', marginTop: '4px' }}>{selected.masina || '-'}</div>
                    <div style={{ fontSize: '11px', color: '#667085', marginTop: '6px' }}>{autosaveStatus}</div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
                      <button onClick={() => handleRotateSelected(-90)} disabled={!selectedPoza || rotating} style={smallSecondaryBtn}>{rotating ? 'Se rotește...' : '↺ Rotire stânga'}</button>
                      <button onClick={() => handleRotateSelected(90)} disabled={!selectedPoza || rotating} style={smallSecondaryBtn}>{rotating ? 'Se rotește...' : 'Rotire dreapta ↻'}</button>
                    </div>
                  </div>
                </div>
                {hoverPreview && selectedPoza && <div style={{ position: 'fixed', top: '80px', right: '20px', width: '600px', height: '600px', background: '#fff', border: '1px solid #d8dee5', borderRadius: '12px', boxShadow: '0 18px 40px rgba(0,0,0,0.18)', padding: '10px', zIndex: 9999 }}><img src={selectedPoza} alt="preview mare" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '8px', background: '#f8fafc' }} /></div>}
              </div>

              <div style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <button onClick={updatePiesaManual} style={smallPrimaryBtn}>Salvează</button>
                  <button onClick={handleStergePiesa} disabled={deletingPiesa} style={smallDangerBtn}>{deletingPiesa ? 'Se șterge...' : 'Șterge'}</button>
                  <div style={{ width: '10px' }} />
                  <button onClick={handleVinde} style={smallSellBtn}>Vinde</button>
                </div>
              </div>

              <div style={cardStyle}>
                <SectionTitle title="Identificare" />
                <div style={{ ...formGrid, gridTemplateColumns: 'minmax(210px, 280px) minmax(210px, 280px)', justifyContent: 'start', columnGap: '16px' }}>
                  <Camp label="CDP" value={selected.cdp} onChange={() => {}} disabled />
                  <Camp label="Cod piesă" value={selected.cod_piesa || ''} onChange={(value) => updateSelectedField('cod_piesa', value)} onBlur={handleCodBlur} />
                  <Camp label="Denumire" value={selected.denumire} onChange={(value) => updateSelectedField('denumire', value)} onBlur={handleDenumireBlur} />
                  <Camp label="Categorie" value={selected.categorie || ''} onChange={(value) => updateSelectedField('categorie', value)} onBlur={saveSelectedOnBlur} asSelect options={INTERNAL_CATEGORIES} />
                  <Camp label="Mașină" value={selected.masina || ''} onChange={(value) => updateSelectedField('masina', value)} onBlur={saveSelectedOnBlur} />
                  <Camp
                    label="Subcategorie pieseauto"
                    value={selected.pieseauto_subcategory || ''}
                    onChange={(value) => {
                      setManualCategoryEdited(true)

                      let mainFound = ''
                      for (const main of catalog?.main_categories || []) {
                        const list = catalog?.subcategories[main] || []
                        if (list.find((x) => x.title === value)) {
                          mainFound = main
                          break
                        }
                      }

                      const path = mainFound ? `${mainFound} > ${value}` : value
                      const updated = {
                        ...selected,
                        pieseauto_main_category: mainFound || null,
                        pieseauto_subcategory: value,
                        pieseauto_category_path: path,
                      }

                      setSelected(updated)
                      setPiese((prev) => prev.map((p) => p.id === updated.id ? updated : p))
                    }}
                    onBlur={saveSelectedOnBlur}
                    asSelect
                    options={allPieseautoSubcategories}
                  />
                  <Camp label="Raft" value={selected.raft || ''} onChange={(value) => updateSelectedField('raft', value)} onBlur={saveSelectedOnBlur} />
                  <Camp label="VIN" value={selected.vin || ''} onChange={(value) => updateSelectedField('vin', value)} onBlur={saveSelectedOnBlur} />
                  <Camp label="Cod culoare" value={selected.cod_culoare || ''} onChange={(value) => updateSelectedField('cod_culoare', value)} onBlur={saveSelectedOnBlur} />
                  <Camp label="Cantitate" type="number" value={String(selected.cantitate ?? 1)} onChange={(value) => updateSelectedField('cantitate', value === '' ? 1 : Number(value))} onBlur={saveSelectedOnBlur} />
                  <Camp label="Preț" type="number" value={String(selected.pret ?? 0)} onChange={(value) => updateSelectedField('pret', value === '' ? 0 : Number(value))} onBlur={saveSelectedOnBlur} />
                </div>
                <div style={{ marginTop: '10px', fontSize: '12px', color: '#667085', fontWeight: 700 }}>Path categorie: {selected.pieseauto_category_path || '-'}</div>
              </div>

              <div style={cardStyle}>
                <SectionTitle title="Poze piesă" />
                <div style={{ marginBottom: '10px' }}>
                  <label style={uploadLabelStyle}>
                    <input type="file" accept="image/*" multiple onChange={handlePozaUpload} style={{ display: 'none' }} />
                    + Adaugă poze
                  </label>
                  {uploading && <div style={{ marginTop: '8px', fontSize: '12px', color: '#475467' }}>Se încarcă pozele...</div>}
                </div>
                <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '4px' }}>
                  {(selected.poze || []).map((poza, index) => (
                    <div key={index} onClick={() => setSelectedPoza(poza)} style={{ minWidth: '98px', width: '98px', border: selectedPoza === poza ? '2px solid #3b82f6' : '1px solid #d0d7de', borderRadius: '8px', padding: '4px', background: '#fff', cursor: 'pointer', position: 'relative' }}>
                      <img src={poza} alt={`poza-${index}`} style={{ width: '88px', height: '72px', objectFit: 'cover', borderRadius: '6px', display: 'block' }} />
                      <button onClick={(e) => { e.stopPropagation(); handleStergePoza(poza) }} disabled={deletingPhoto === poza} style={{ position: 'absolute', top: '6px', right: '6px', width: '22px', height: '22px', borderRadius: '50%', border: 'none', background: '#d11a2a', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: '11px' }} title="Șterge poza">{deletingPhoto === poza ? '...' : 'X'}</button>
                    </div>
                  ))}
                </div>
              </div>

              <div style={cardStyle}>
                <SectionTitle title="Observații" />
                <textarea style={textareaStyle} placeholder="Observații" value={selected.descriere || ''} onChange={(e) => updateSelectedField('descriere', e.target.value)} onBlur={saveSelectedOnBlur} />
              </div>
            </div>
          )}
        </div>
      </div>

      {hoverCardVisible && hoveredPiesa && (
        <div style={{ position: 'fixed', left: Math.min(hoverCardPos.x, viewport.width - 310), top: Math.min(hoverCardPos.y, viewport.height - 170), width: '290px', background: '#fff', border: '1px solid #d8dee5', borderRadius: '12px', boxShadow: '0 14px 28px rgba(0,0,0,0.16)', padding: '10px', zIndex: 9998, pointerEvents: 'none' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: '10px' }}>
            <div style={{ width: '92px', height: '76px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #d8dee5', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {hoveredPiesa.poze?.[0] ? <img src={hoveredPiesa.poze[0]} alt="preview mic" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ fontSize: '11px', color: '#667085' }}>Fără poză</div>}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 700 }}>{hoveredPiesa.cdp}</div>
              <div style={{ fontSize: '12px', fontWeight: 700, marginTop: '2px' }}>{hoveredPiesa.cod_piesa || '-'}</div>
              <div style={{ fontSize: '12px', marginTop: '4px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hoveredPiesa.denumire || '-'}</div>
              <div style={{ fontSize: '11px', color: '#667085', marginTop: '6px', lineHeight: 1.4 }}>Mașină: {hoveredPiesa.masina || '-'}<br />Raft: {hoveredPiesa.raft || '-'} | Preț: {(hoveredPiesa.pret || 0).toFixed(0)} RON</div>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function getStoragePathFromPublicUrl(url: string) {
  try {
    const marker = '/storage/v1/object/public/piese-poze/'
    const index = url.indexOf(marker)
    if (index === -1) return null
    return decodeURIComponent(url.substring(index + marker.length))
  } catch {
    return null
  }
}

function SectionTitle({ title }: { title: string }) {
  return <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '10px', color: '#101828' }}>{title}</div>
}

function Cell({ children, strong = false, title }: { children: React.ReactNode; strong?: boolean; title?: string }) {
  return <div title={title} style={{ fontWeight: strong ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</div>
}

type CampProps = {
  label: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  type?: string
  disabled?: boolean
  asSelect?: boolean
  options?: string[]
}

function Camp({ label, value, onChange, onBlur, type = 'text', disabled = false, asSelect = false, options = [] }: CampProps) {
  return (
    <div>
      <div style={{ marginBottom: '6px', fontWeight: 700, fontSize: '12px', color: '#344054' }}>{label}</div>
      {asSelect ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} disabled={disabled} style={{ width: '100%', padding: '9px 10px', border: '1px solid #c9d3dd', borderRadius: '8px', background: disabled ? '#f5f7fa' : '#fff', fontSize: '12px' }}>
          <option value="">Selectează</option>
          {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      ) : (
        <input type={type} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} style={{ width: '100%', padding: '9px 10px', border: '1px solid #c9d3dd', borderRadius: '8px', background: disabled ? '#f5f7fa' : '#fff', fontSize: '12px' }} />
      )}
    </div>
  )
}

const topInputStyle: React.CSSProperties = { minWidth: '320px', flex: 1, maxWidth: '650px', padding: '10px 12px', border: '1px solid #c9d3dd', borderRadius: '10px', background: '#fff', fontSize: '13px' }
const topSelectStyle: React.CSSProperties = { padding: '10px 12px', border: '1px solid #c9d3dd', borderRadius: '10px', background: '#fff', fontSize: '13px' }
const primaryBtn: React.CSSProperties = { padding: '10px 14px', cursor: 'pointer', border: '1px solid #2e6ee6', background: '#2f80ed', color: '#fff', borderRadius: '10px', fontWeight: 700, fontSize: '13px' }
const smallPrimaryBtn: React.CSSProperties = { padding: '8px 12px', cursor: 'pointer', border: '1px solid #2e6ee6', background: '#2f80ed', color: '#fff', borderRadius: '8px', fontWeight: 700, fontSize: '12px' }
const smallSellBtn: React.CSSProperties = { padding: '8px 12px', cursor: 'pointer', border: '1px solid #f59e0b', background: '#fff7ed', color: '#b45309', borderRadius: '8px', fontWeight: 700, fontSize: '12px' }
const smallSecondaryBtn: React.CSSProperties = { padding: '8px 12px', cursor: 'pointer', border: '1px solid #c9d3dd', background: '#fff', color: '#344054', borderRadius: '8px', fontWeight: 700, fontSize: '12px' }
const smallDangerBtn: React.CSSProperties = { padding: '8px 12px', cursor: 'pointer', border: '1px solid #f1b5bb', background: '#fff5f5', color: '#b42318', borderRadius: '8px', fontWeight: 700, fontSize: '12px' }
const pagerBtn: React.CSSProperties = { minWidth: '30px', height: '30px', padding: '0 8px', cursor: 'pointer', border: '1px solid #d0d7de', background: '#fff', color: '#344054', borderRadius: '8px', fontWeight: 700, fontSize: '12px' }
const cardStyle: React.CSSProperties = { background: '#fff', border: '1px solid #d8dee5', borderRadius: '12px', padding: '12px' }
const formGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }
const textareaStyle: React.CSSProperties = { width: '100%', minHeight: '180px', padding: '10px', border: '1px solid #c9d3dd', borderRadius: '8px', resize: 'vertical', fontSize: '12px' }
const uploadLabelStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: '40px', padding: '0 14px', border: '1px solid #c9d3dd', borderRadius: '10px', background: '#fff', color: '#344054', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }
