'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Piesa = {
  created_at?: string | null
  updated_at?: string | null
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
  anunt_online?: boolean | null
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function phraseMatches(text: string, phrase: string) {
  const normalizedText = ` ${normalizeText(text)} `
  const normalizedPhrase = normalizeText(phrase)
  if (!normalizedPhrase) return false

  // Potrivire pe expresie întreagă, nu bucăți.
  // Exemplu: "capota" NU mai poate potrivi "cap de bara".
  const pattern = new RegExp(`(^|\\s)${escapeRegExp(normalizedPhrase)}(\\s|$)`, 'i')
  return pattern.test(normalizedText)
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
    [['calculator abs', 'calculator ecu', 'modul abs', 'modul airbag', 'alternator', 'electromotor', 'senzor', 'ecu'], 'Electrica & Electronica Auto'],
    [['far', 'stop'], 'Faruri stopuri lumini'],
    [['xenon', 'balast'], 'Xenon'],
    [['injector', 'pompa'], 'Pompe si injectoare'],
    [['etrier', 'disc frana'], 'Frane'],
    [['bara', 'usa', 'portiera', 'aripa', 'capota', 'haion', 'oglinda'], 'Caroserie'],
    [['volan', 'bord', 'tapiterie', 'airbag'], 'Interioare auto'],
    [['planetara', 'ambreiaj', 'cutie viteze', 'volanta'], 'Transmisie'],
    [['amortizor', 'arc'], 'Suspensie'],
    [['compresor clima', 'clima'], 'Climatizare'],
    [['turbina', 'turbo'], 'Turbo'],
  ]
  for (const [needles, category] of rules) {
    if (needles.some((n) => hay.includes(normalizeText(n)))) return category
  }
  return ''
}

function mapMainOrSubToInternalCategory(main: string, sub: string) {
  const joined = normalizeText(`${main} ${sub}`)
  if (!joined) return ''

  const rules: Array<[string[], string]> = [
    [['electrica electronica auto', 'calculator', 'ecu', 'abs', 'electromotor', 'alternator'], 'Electrica & Electronica Auto'],
    [['faruri stopuri lumini', 'faruri', 'stopuri'], 'Faruri stopuri lumini'],
    [['xenon', 'balast'], 'Xenon'],
    [['injectoare', 'pompa inalta', 'pompe injectoare'], 'Pompe si injectoare'],
    [['frane', 'etrieri', 'discuri'], 'Frane'],
    [['caroserie', 'portiere', 'bare', 'aripi', 'capote', 'haioane', 'oglinzi'], 'Caroserie'],
    [['interioare auto', 'volane', 'ceasuri bord', 'tapiterie', 'airbag'], 'Interioare auto'],
    [['transmisie', 'cutii viteze', 'planetare', 'ambreiaj', 'volanta'], 'Transmisie'],
    [['suspensie', 'amortizoare', 'arcuri'], 'Suspensie'],
    [['climatizare', 'compresoare clima'], 'Climatizare'],
    [['turbo', 'turbine'], 'Turbo'],
    [['directie', 'casete directie'], 'Directie'],
    [['racire', 'radiatoare'], 'Racire'],
    [['filtre auto', 'filtru'], 'Filtre auto'],
    [['jante anvelope', 'jante', 'anvelope'], 'Jante & Anvelope'],
    [['aprindere', 'bobine', 'bujii'], 'Aprindere'],
  ]

  for (const [needles, category] of rules) {
    if (needles.some((n) => joined.includes(normalizeText(n)))) return category
  }

  return detectInternalCategory(`${main} ${sub}`)
}

function findBestCatalogSubcategory(catalog: PieseautoCatalog | null, desiredMain: string, desiredSub: string) {
  const normalizedSub = normalizeText(desiredSub)
  const mains = desiredMain ? [desiredMain, ...(catalog?.main_categories || []).filter((m) => m !== desiredMain)] : (catalog?.main_categories || [])

  let best: { main: string; sub: string; score: number } = { main: '', sub: '', score: 0 }

  for (const main of mains) {
    const list = catalog?.subcategories[main] || []
    for (const item of list) {
      const normalizedTitle = normalizeText(item.title)
      let score = 0
      if (normalizedTitle === normalizedSub) score = 1000
      else if (normalizedTitle.includes(normalizedSub) || normalizedSub.includes(normalizedTitle)) score = 700
      else score = scoreSubcategory(desiredSub, item.title)

      if (desiredMain && main === desiredMain && score > 0) score += 50

      if (score > best.score) best = { main, sub: item.title, score }
    }
  }

  return best.score > 0 ? best : { main: desiredMain || '', sub: desiredSub || '', score: 0 }
}

function detectPieseautoFromName(name: string, catalog: PieseautoCatalog | null) {
  const hay = normalizeText(name)
  if (!hay) return { main: '', sub: '', path: '' }

  // Reguli stricte: alegem expresia cea mai specifică și nu lăsăm catalogul să suprascrie.
  // Așa evităm cazuri de genul "capota" -> "Cap de bara".
  const aliases: Array<[string[], string, string, number]> = [
    // Caroserie
    [['capota spate', 'capota portbagaj', 'haion', 'hayon', 'usa portbagaj', 'hayon portbagaj'], 'Caroserie', 'Haioane', 1400],
    [['bara spate', 'spoiler spate'], 'Caroserie', 'Bare spate', 1380],
    [['bara fata', 'bara față', 'spoiler fata', 'spoiler față'], 'Caroserie', 'Bare fata', 1380],
    [['capota motor', 'capota'], 'Caroserie', 'Capote', 1360],
    [['aripa fata', 'aripa față', 'aripa spate', 'aripa'], 'Caroserie', 'Aripi', 1300],
    [['usa fata', 'usa spate', 'portiera fata', 'portiera spate', 'portiera', 'usa'], 'Caroserie', 'Portiere', 1280],
    [['oglinda stanga', 'oglinda dreapta', 'oglinda electrica', 'oglinda'], 'Caroserie', 'Oglinzi', 1260],
    [['grila radiator', 'grila fata', 'grila bara', 'grila'], 'Caroserie', 'Grile', 1240],
    [['trager', 'panou frontal', 'frontala'], 'Caroserie', 'Trager', 1220],
    [['armatura bara', 'intaritura bara', 'absorber bara'], 'Caroserie', 'Armatura bara', 1200],
    [['broasca usa', 'broasca portiera', 'incuietoare usa'], 'Caroserie', 'Broaste usi', 1190],
    [['macara geam', 'macara electrica geam'], 'Caroserie', 'Macara geam', 1180],
    [['geam usa', 'geam portiera', 'luneta', 'parbriz'], 'Caroserie', 'Geamuri', 1170],
    [['chedere', 'cheder'], 'Caroserie', 'Chedere', 1050],

    // Electrica / electronica
    [['calculator frana mana', 'modul frana mana', 'calculator frână mână'], 'Electrica & Electronica Auto', 'Calculator frana mana', 1450],
    [['calculator airbag', 'modul airbag', 'centrala airbag'], 'Electrica & Electronica Auto', 'Calculator airbag', 1440],
    [['calculator abs', 'modul abs', 'pompa abs electronica'], 'Electrica & Electronica Auto', 'Calculator ABS', 1440],
    [['calculator motor', 'calculator ecu', 'ecu motor', 'ecu', 'calculator injectie'], 'Electrica & Electronica Auto', 'Calculator ECU', 1430],
    [['modul confort', 'calculator confort'], 'Electrica & Electronica Auto', 'Modul confort', 1380],
    [['modul bcm', 'bcm', 'calculator lumini'], 'Electrica & Electronica Auto', 'Modul BCM', 1370],
    [['alternator'], 'Electrica & Electronica Auto', 'Alternator', 1300],
    [['electromotor', 'starter'], 'Electrica & Electronica Auto', 'Electromotor', 1300],
    [['senzor parcare', 'senzori parcare', 'pdc'], 'Electrica & Electronica Auto', 'Senzori parcare', 1280],
    [['senzor presiune', 'senzor temperatura', 'senzor turatie', 'senzor vibrochen', 'senzor ax came', 'senzor'], 'Electrica & Electronica Auto', 'Senzori', 1100],
    [['claxon'], 'Electrica & Electronica Auto', 'Claxon', 1060],
    [['releu', 'sigurante', 'panou sigurante'], 'Electrica & Electronica Auto', 'Relee si sigurante', 1050],

    // Lumini
    [['tripla stanga', 'tripla dreapta', 'tripla', 'lampa spate', 'stop spate', 'stopuri', 'stop'], 'Faruri stopuri lumini', 'Stopuri', 1400],
    [['far xenon', 'far led', 'far stanga', 'far dreapta', 'faruri', 'far'], 'Faruri stopuri lumini', 'Faruri', 1380],
    [['proiector ceata', 'proiector ceață', 'proiector'], 'Faruri stopuri lumini', 'Proiectoare', 1320],
    [['semnalizare oglinda', 'semnalizare aripa', 'semnalizare'], 'Faruri stopuri lumini', 'Semnalizari', 1200],
    [['balast xenon', 'modul xenon', 'droser xenon'], 'Xenon', 'Balast xenon', 1280],

    // Navigatie / audio
    [['display mmi', 'ecran mmi', 'display navigatie', 'ecran navigatie', 'monitor navigatie', 'display', 'ecran'], 'Navigatie GPS', 'Display navigatie', 1400],
    [['navigatie', 'unitate navigatie', 'mmi', 'modul mmi'], 'Navigatie GPS', 'Navigatii GPS', 1260],
    [['radio cd', 'casetofon', 'unitate radio', 'cd player'], 'Car audio', 'Radio CD', 1200],
    [['boxa', 'difuzor', 'subwoofer', 'amplificator'], 'Car audio', 'Difuzoare', 1180],

    // Interior
    [['airbag volan'], 'Interioare auto', 'Airbag volan', 1400],
    [['volan piele', 'volan'], 'Interioare auto', 'Volane', 1280],
    [['airbag cortina', 'airbag scaun', 'airbag bord', 'airbag'], 'Interioare auto', 'Airbag', 1200],
    [['ceasuri bord', 'ceas bord', 'instrumente bord', 'cluster'], 'Interioare auto', 'Ceasuri bord', 1320],
    [['scaun fata', 'scaun față', 'scaun spate', 'scaune', 'bancheta'], 'Interioare auto', 'Scaune', 1240],
    [['tapiterie', 'fata usa', 'fata portiera'], 'Interioare auto', 'Tapiterie', 1160],
    [['cotiera', 'consola centrala', 'torpedou', 'maner usa interior'], 'Interioare auto', 'Console si cotiere', 1120],
    [['buton geam', 'comanda geam', 'butoane geamuri'], 'Interioare auto', 'Butoane geamuri', 1100],
    [['bloc lumini', 'comutator lumini'], 'Interioare auto', 'Bloc lumini', 1100],

    // Motor / transmisie
    [['cutie viteze automata', 'cutie automata', 'cutie viteze manuala', 'cutie manuala', 'cutie viteze'], 'Transmisie', 'Cutii viteze', 1400],
    [['planetara stanga', 'planetara dreapta', 'planetare', 'planetara'], 'Transmisie', 'Planetare', 1320],
    [['ambreiaj', 'kit ambreiaj'], 'Transmisie', 'Kit ambreiaj', 1260],
    [['volanta masa dubla', 'volanta'], 'Transmisie', 'Volanta', 1260],
    [['turbina', 'turbo'], 'Turbo', 'Turbine', 1280],
    [['injector', 'injectoare'], 'Pompe si injectoare', 'Injectoare', 1260],
    [['pompa inalta', 'pompa injectie', 'pompa inalta presiune'], 'Pompe si injectoare', 'Pompa inalta presiune', 1280],
    [['pompa combustibil', 'pompa benzina', 'pompa motorina'], 'Pompe si injectoare', 'Pompa combustibil', 1240],
    [['galerie admisie', 'clapeta acceleratie', 'egr', 'racitor gaze'], 'Piese Motoare', 'Admisie', 1200],
    [['chiulasa', 'baie ulei', 'capac motor', 'capac culbutori', 'motor'], 'Piese Motoare', 'Piese motor', 1080],

    // Frane / directie / suspensie
    [['etrier frana', 'etrier'], 'Frane', 'Etrieri frana', 1280],
    [['disc frana', 'discuri frana'], 'Frane', 'Discuri frana', 1260],
    [['pompa abs'], 'Frane', 'Pompa ABS', 1240],
    [['servofrana', 'tulumba frana', 'pompa frana'], 'Frane', 'Pompa frana', 1200],
    [['caseta directie', 'caseta servo'], 'Directie', 'Casete directie', 1280],
    [['pompa servo', 'coloana volan', 'coloana directie'], 'Directie', 'Coloana directie', 1120],
    [['amortizor', 'amortizoare'], 'Suspensie', 'Amortizoare', 1240],
    [['arc suspensie', 'arcuri', 'arc'], 'Suspensie', 'Arcuri', 1180],
    [['bascula', 'brat suspensie', 'fuzeta', 'rulment roata'], 'Punte si rulmenti', 'Fuzete', 1180],

    // Racire / clima / evacuare
    [['compresor clima', 'compresor ac'], 'Climatizare', 'Compresoare clima', 1280],
    [['radiator apa', 'radiator racire', 'radiator clima', 'radiator ac', 'radiator'], 'Racire', 'Radiatoare', 1240],
    [['electroventilator', 'ventilator radiator', 'termocupla'], 'Racire', 'Ventilatoare radiator', 1200],
    [['intercooler'], 'Racire', 'Intercooler', 1200],
    [['evaporator', 'aeroterma', 'ventilator habitaclu'], 'Climatizare', 'Aeroterma', 1160],
    [['catalizator', 'filtru particule', 'dpf', 'toba', 'evacuare'], 'Evacuare', 'Evacuare', 1100],

    // Roti / accesorii
    [['janta aliaj', 'janta tabla', 'jante aliaj', 'jante tabla', 'janta', 'jante'], 'Jante & Anvelope', 'Jante', 1240],
    [['anvelopa', 'anvelope', 'cauciuc', 'cauciucuri'], 'Jante & Anvelope', 'Anvelope', 1220],
    [['capac roata', 'capace roti', 'capac janta'], 'Accesorii roti', 'Capace roti', 1180],
    [['carlig remorcare', 'cârlig remorcare'], 'Accesorii auto', 'Carlig remorcare', 1100],
  ]

  let best = { main: '', sub: '', path: '', score: 0 }

  for (const [needles, main, sub, baseScore] of aliases) {
    for (const needle of needles) {
      if (!phraseMatches(hay, needle)) continue
      const normalizedNeedle = normalizeText(needle)
      const score = baseScore + normalizedNeedle.length * 20
      if (score > best.score) {
        best = { main, sub, path: `${main} > ${sub}`, score }
      }
    }
  }

  if (best.score > 0) {
    return { main: best.main, sub: best.sub, path: best.path }
  }

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
  const router = useRouter()
  const [authLoading, setAuthLoading] = useState(true)
  const [userEmail, setUserEmail] = useState<string | null>(null)

  const [piese, setPiese] = useState<Piesa[]>([])
  const [selected, setSelected] = useState<Piesa | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMessage, setLoadingMessage] = useState('')
  const [uploading, setUploading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [postingAnunt, setPostingAnunt] = useState(false)
  const [seleniumStatus, setSeleniumStatus] = useState('')
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
  const [menuOpen, setMenuOpen] = useState(false)

  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedJson = useRef<string>('')

  async function loadPiese(keepCurrentSelection = true) {
    setLoading(true)
    setLoadingMessage('Se încarcă stocul...')

    const pageSize = 1000
    let from = 0
    let lista: Piesa[] = []
    let totalCount: number | null = null

    while (true) {
      const { data, error, count } = await supabase
        .from('piese')
        .select('*', { count: 'exact' })
        .order('cdp', { ascending: false })
        .range(from, from + pageSize - 1)

      if (error) {
        alert('Eroare la încărcare: ' + error.message)
        setLoading(false)
        setLoadingMessage('')
        return
      }

      if (typeof count === 'number') totalCount = count
      const batch = (data || []) as Piesa[]
      lista = [...lista, ...batch]
      setLoadingMessage(totalCount ? `Se încarcă stocul... ${lista.length} / ${totalCount}` : `Se încarcă stocul... ${lista.length}`)

      if (batch.length < pageSize) break
      if (totalCount !== null && lista.length >= totalCount) break
      from += pageSize
    }

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
    setLoadingMessage('')
    setLoading(false)
  }

  useEffect(() => {
    verificaLogin()
  }, [])

  async function verificaLogin() {
    const { data } = await supabase.auth.getSession()

    if (!data.session) {
      router.push('/login')
      return
    }

    setUserEmail(data.session.user.email || null)
    setAuthLoading(false)
  }

  async function logout() {
    await supabase.auth.signOut()
    router.push('/login')
  }
  useEffect(() => {
    if (!authLoading && userEmail) {
      loadPiese(false)
    }
    fetch('/pieseauto_categories_public.json')
      .then((r) => r.json())
      .then((data) => setCatalog(data))
      .catch(() => setCatalog({ main_categories: [], subcategories: {} }))
  }, [authLoading, userEmail])

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
      anunt_online: piesa.anunt_online ?? false,
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
        pieseauto_main_category: null, pieseauto_subcategory: null, pieseauto_category_path: null, anunt_online: false,
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

  async function handlePuneAnuntPieseauto() {
    if (!selected) return

    if (!selected.denumire?.trim()) {
      alert('Completează denumirea piesei înainte de anunț.')
      return
    }
    if (!Number(selected.pret || 0)) {
      alert('Completează prețul înainte de anunț.')
      return
    }
    if (!selected.poze?.length) {
      alert('Adaugă cel puțin o poză înainte de anunț.')
      return
    }

    setPostingAnunt(true)
    setSeleniumStatus('Trimit piesa către Selenium...')

    try {
      await saveSelectedOnBlur()

      const payload = {
        id: selected.id,
        cdp: selected.cdp,
        cod_piesa: selected.cod_piesa,
        denumire: selected.denumire,
        masina: selected.masina,
        compatibilitate: selected.compatibilitate,
        categorie: selected.categorie,
        pret: selected.pret,
        cantitate: selected.cantitate || 1,
        descriere: selected.descriere,
        poze: selected.poze || [],
        raft: selected.raft,
        vin: selected.vin ?? null,
        cod_culoare: selected.cod_culoare ?? null,
        pieseauto_main_category: selected.pieseauto_main_category ?? null,
        pieseauto_subcategory: selected.pieseauto_subcategory ?? null,
        pieseauto_category_path: selected.pieseauto_category_path ?? null,
        anunt_online: selected.anunt_online ?? false,
      }

      const resp = await fetch('http://127.0.0.1:8765/pune-anunt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const result = await resp.json().catch(() => ({}))
      if (!resp.ok || !result.ok) {
        throw new Error(result.error || 'Selenium a refuzat comanda.')
      }

      const updated = { ...selected, anunt_online: true }
      const { error: markError } = await supabase
        .from('piese')
        .update({ anunt_online: true })
        .eq('id', selected.id)

      if (markError) {
        setSeleniumStatus('Trimis către Selenium, dar nu am putut marca reclama în Supabase.')
      } else {
        setSelected(updated)
        setPiese((prev) => prev.map((p) => p.id === updated.id ? updated : p))
        lastSavedJson.current = JSON.stringify(buildPayload(updated))
        setSeleniumStatus('Trimis către Selenium și marcat ca reclamă online.')
      }

      alert('Am trimis piesa către Selenium. Am marcat-o cu verde ca reclamă online.')
    } catch (err: any) {
      const message = err?.message || 'Nu pot contacta serverul Selenium local.'
      setSeleniumStatus(message)
      alert(message + '\n\nPornește programul Python pe calculator și încearcă din nou.')
    } finally {
      setPostingAnunt(false)
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

    // Când denumirea se schimbă, recalculăm automat doar dacă nu ai ales categoria manual.
    // Dacă ai schimbat categoria din dropdown, nu îți mai schimbă singur subcategoria.
    if (!manualCategoryEdited && detected.main) {
      const resolvedMain = detected.main
      const resolvedSub = detected.sub || ''
      const resolvedCategory = mapMainOrSubToInternalCategory(resolvedMain, resolvedSub) || resolvedMain

      nextSelected = {
        ...selected,
        categorie: resolvedCategory,
        pieseauto_main_category: resolvedMain,
        pieseauto_subcategory: resolvedSub,
        pieseauto_category_path: resolvedMain && resolvedSub ? `${resolvedMain} > ${resolvedSub}` : (detected.path || resolvedMain),
      }
      setSelected(nextSelected)
      setPiese((prev) => prev.map((p) => p.id === nextSelected.id ? nextSelected : p))
      setManualCategoryEdited(false)
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
        p.cdp || '',
        p.cod_piesa || '',
        p.denumire || '',
        p.masina || '',
        p.raft || '',
        p.vin || '',
        p.cod_culoare || '',
        p.compatibilitate || '',
        p.descriere || '',
        p.anunt_online ? 'reclama online anunt publicat pus pe net' : '',
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


  function escapeCsv(value: unknown) {
    const text = String(value ?? '').replace(/\r?\n/g, ' ').trim()
    return `"${text.replace(/"/g, '""')}"`
  }

  function cleanCsvText(value: unknown) {
    return String(value ?? '')
      .replace(/\r?\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function buildPieseautoCsvTitle(p: Piesa) {
    const titlu = [p.denumire, p.masina, p.cod_piesa]
      .map(cleanCsvText)
      .filter(Boolean)
      .join(' ')
      .trim()

    return titlu || cleanCsvText(p.cdp) || 'Piesa auto'
  }

  function buildPieseautoCsvDescription(p: Piesa, titlu: string) {
    const linii = [
      cleanCsvText(titlu),
      p.cod_piesa ? `Cod piesa: ${cleanCsvText(p.cod_piesa)}` : '',
      p.cdp ? `Cod intern / Referinta: ${cleanCsvText(p.cdp)}` : '',
      p.masina ? `Masina: ${cleanCsvText(p.masina)}` : '',
      p.compatibilitate ? `Compatibilitate: ${cleanCsvText(p.compatibilitate)}` : '',
      p.descriere ? `Observatii: ${cleanCsvText(p.descriere)}` : '',
      'Piesa provenita din dezmembrari auto.',
      'Este verificata si testata inainte de demontare.',
      'Se vinde exact piesa din imagini. Pozele sunt reale.',
      'Se ofera factura si garantie pentru orice piesa.',
      'Posibilitate retur in termen de 14 zile, in conditii simple.',
      'Livrare prin curier rapid oriunde in tara.',
      'Pentru detalii suplimentare nu ezitati sa ne contactati.',
    ].filter(Boolean)

    return linii.join('<br/><br/>')
  }

  function exportaCsvStoc() {
    // Format pentru import pieseauto.ro: 0;1;2;3;4;5;6;7;8
    // Categoria este intenționat hardcodată la toate produsele: Dezmembrari Auto
    const header = '0;1;2;3;4;5;6;7;8'

    const randuri = pieseFiltrateSiSortate.map((p) => {
      const titlu = buildPieseautoCsvTitle(p)
      const descriere = buildPieseautoCsvDescription(p, titlu)
      const urls = (p.poze || []).filter(Boolean).join('[,]')

      return [
        p.cdp || '',
        titlu,
        'Dezmembrari Auto',
        descriere,
        'Lei',
        Number(p.pret || 0).toFixed(2),
        p.cantitate || 1,
        urls,
        'second hand',
      ]
    })

    const csv = [
      header,
      ...randuri.map((row) => row.map(escapeCsv).join(';')),
    ].join('\n')

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pieseauto-pieseapp-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  function downloadTextFile(filename: string, content: string, mimeType: string) {
    const blob = new Blob(['\ufeff' + content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  function exportBackupJson() {
    const payload = {
      exported_at: new Date().toISOString(),
      total: piese.length,
      source: 'PieseApp Web',
      piese,
    }

    downloadTextFile(
      `backup-pieseapp-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2),
      'application/json;charset=utf-8;',
    )
    setMenuOpen(false)
  }

  function exportBackupCsv() {
    const header = [
      'id',
      'cdp',
      'cod_piesa',
      'denumire',
      'masina',
      'compatibilitate',
      'categorie',
      'pret',
      'cantitate',
      'raft',
      'vin',
      'cod_culoare',
      'descriere',
      'draft',
      'anunt_online',
      'pieseauto_main_category',
      'pieseauto_subcategory',
      'pieseauto_category_path',
      'poze',
      'created_at',
      'updated_at',
    ]

    const rows = piese.map((p) => [
      p.id,
      p.cdp,
      p.cod_piesa,
      p.denumire,
      p.masina,
      p.compatibilitate,
      p.categorie,
      p.pret,
      p.cantitate,
      p.raft,
      p.vin,
      p.cod_culoare,
      p.descriere,
      p.draft,
      p.anunt_online,
      p.pieseauto_main_category,
      p.pieseauto_subcategory,
      p.pieseauto_category_path,
      (p.poze || []).join('[,]'),
      p.created_at,
      p.updated_at,
    ])

    const csv = [
      header.map(escapeCsv).join(';'),
      ...rows.map((row) => row.map(escapeCsv).join(';')),
    ].join('\n')

    downloadTextFile(
      `backup-pieseapp-${new Date().toISOString().slice(0, 10)}.csv`,
      csv,
      'text/csv;charset=utf-8;',
    )
    setMenuOpen(false)
  }


  function sanitizeBackupName(value: unknown) {
    const cleaned = String(value || 'fara-cdp')
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 80)

    return cleaned || 'fara-cdp'
  }

  async function exportPozeInFolder() {
    const picker = (window as any).showDirectoryPicker
    if (!picker) {
      alert('Browserul nu suportă salvare directă în folder. Folosește Chrome sau Edge actualizat.')
      return
    }

    const pieseCuPoze = piese.filter((p) => Array.isArray(p.poze) && p.poze.length > 0)
    if (!pieseCuPoze.length) {
      alert('Nu există poze de exportat.')
      return
    }

    const confirmExport = window.confirm(
      `Export poze pentru ${pieseCuPoze.length} piese?\n\nAlege un folder gol sau un folder de backup. Programul va crea subfoldere după CDP.`
    )
    if (!confirmExport) return

    try {
      setMenuOpen(false)
      setAutosaveStatus('Alege folderul pentru backup poze...')
      const rootHandle = await picker({ mode: 'readwrite' })
      const backupName = `Backup_PieseApp_poze_${new Date().toISOString().slice(0, 10)}`
      const backupHandle = await rootHandle.getDirectoryHandle(backupName, { create: true })

      let salvate = 0
      let erori = 0

      for (const piesa of pieseCuPoze) {
        const cdpSafe = sanitizeBackupName(piesa.cdp)
        const piesaHandle = await backupHandle.getDirectoryHandle(cdpSafe, { create: true })
        const poze = (piesa.poze || []).filter(Boolean)

        for (let index = 0; index < poze.length; index++) {
          const urlPoza = poze[index]
          try {
            setAutosaveStatus(`Export poze: ${salvate + 1} / ${pieseCuPoze.reduce((s, p) => s + (p.poze?.length || 0), 0)}`)
            const response = await fetch(urlPoza)
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const blob = await response.blob()

            const urlWithoutQuery = String(urlPoza).split('?')[0]
            const extMatch = urlWithoutQuery.match(/\.(jpg|jpeg|png|webp|bmp)$/i)
            const ext = extMatch ? extMatch[0].toLowerCase() : '.jpg'
            const filename = `${cdpSafe}_${index + 1}${ext}`

            const fileHandle = await piesaHandle.getFileHandle(filename, { create: true })
            const writable = await fileHandle.createWritable()
            await writable.write(blob)
            await writable.close()
            salvate++
          } catch (error) {
            console.error('Eroare export poză', piesa.cdp, urlPoza, error)
            erori++
          }
        }
      }

      setAutosaveStatus(`Backup poze terminat: ${salvate} salvate${erori ? `, ${erori} erori` : ''}`)
      alert(`Backup poze terminat.\n\nPoze salvate: ${salvate}\nErori: ${erori}\nFolder: ${backupName}`)
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        setAutosaveStatus('Export poze anulat')
        return
      }
      console.error(error)
      setAutosaveStatus('Eroare export poze')
      alert(`Nu am putut exporta pozele.\n\n${error?.message || error}`)
    }
  }

  function escapeHtml(value: unknown) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  function exportaPdfStoc() {
    const valoareExport = pieseFiltrateSiSortate.reduce((sum, p) => sum + (p.pret || 0) * (p.cantitate || 0), 0)
    const rows = pieseFiltrateSiSortate.map((p) => `
      <tr>
        <td><b>${escapeHtml(p.cdp)}</b></td>
        <td>${escapeHtml(p.cod_piesa || '-')}</td>
        <td>${escapeHtml(p.denumire || '-')}</td>
        <td>${escapeHtml(p.categorie || '-')}</td>
        <td>${escapeHtml(p.masina || '-')}</td>
        <td>${escapeHtml(p.raft || '-')}</td>
        <td>${escapeHtml([p.vin || '', p.cod_culoare || ''].filter(Boolean).join(' / ') || '-')}</td>
        <td class="right">${(p.pret || 0).toFixed(0)}</td>
        <td class="right">${p.cantitate || 0}</td>
        <td class="right"><b>${((p.pret || 0) * (p.cantitate || 0)).toFixed(0)}</b></td>
      </tr>
    `).join('')

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>PieseApp - Stoc</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111827; padding-bottom: 12px; margin-bottom: 16px; }
    h1 { margin: 0; font-size: 22px; }
    .meta { font-size: 12px; color: #475467; line-height: 1.5; text-align: right; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th { background: #eef2f6; text-align: left; padding: 7px 6px; border: 1px solid #cfd8e3; }
    td { padding: 6px; border: 1px solid #d8dee5; vertical-align: top; }
    tr:nth-child(even) td { background: #fafafa; }
    .right { text-align: right; white-space: nowrap; }
    .total { margin-top: 14px; text-align: right; font-size: 14px; font-weight: 700; }
    @media print { body { margin: 12mm; } button { display: none; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>PieseApp - Stoc piese</h1>
      <div style="font-size:12px;color:#475467;margin-top:6px;">Export generat din lista curentă / filtrată</div>
    </div>
    <div class="meta">
      Data: ${new Date().toLocaleString('ro-RO')}<br />
      Piese: <b>${pieseFiltrateSiSortate.length}</b><br />
      Valoare stoc: <b>${valoareExport.toFixed(2)} RON</b>
    </div>
  </div>
  <table>
    <thead>
      <tr><th>CDP</th><th>Cod piesă</th><th>Denumire</th><th>Categorie</th><th>Mașină</th><th>Raft</th><th>VIN / culoare</th><th>Preț</th><th>Cant.</th><th>Valoare</th></tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="10">Nu există piese de exportat.</td></tr>'}</tbody>
  </table>
  <div class="total">Total: ${valoareExport.toFixed(2)} RON</div>
  <script>window.onload = () => { window.print(); }</script>
</body>
</html>`

    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      alert('Browserul a blocat fereastra de print/PDF. Permite pop-up pentru localhost.')
      return
    }
    printWindow.document.open()
    printWindow.document.write(html)
    printWindow.document.close()
  }

  const allPieseautoSubcategories = useMemo(() => {
    const selectedMain = selected?.pieseauto_main_category || selected?.categorie || ''

    const list = selectedMain && catalog?.subcategories?.[selectedMain]
      ? catalog.subcategories[selectedMain]
      : []

    const titles = list
      .map((x) => x.title)
      .filter(Boolean)

    // Dacă subcategoria detectată nu există exact în catalog, o păstrăm vizibilă.
    const current = selected?.pieseauto_subcategory || ''
    const withCurrent = current && !titles.includes(current) ? [current, ...titles] : titles

    return withCurrent
      .filter((value, index, arr) => arr.indexOf(value) === index)
      .sort((a, b) => a.localeCompare(b, 'ro'))
  }, [catalog, selected?.categorie, selected?.pieseauto_main_category, selected?.pieseauto_subcategory])

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
    if ((p.cantitate || 0) <= 0) return '#fee2e2'
    if (selected?.id === p.id && p.anunt_online) return '#bbf7d0'
    if (selected?.id === p.id) return '#dbeafe'
    if (p.anunt_online) return '#dcfce7'
    if (p.draft) return '#fff8cc'
    return '#fff'
  }

  return (
    <main style={{ height: '100vh', overflow: 'hidden', display: 'grid', gridTemplateRows: 'auto 1fr', fontFamily: 'Arial, sans-serif', background: '#eef2f6' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #d8dee5', background: '#ffffff', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            style={{
              border: '1px solid #cbd5e1',
              background: '#f8fafc',
              borderRadius: '10px',
              padding: '9px 12px',
              fontSize: '15px',
              fontWeight: 800,
              cursor: 'pointer',
              color: '#0f172a',
              minWidth: '92px',
              textAlign: 'left',
            }}
          >
            Meniu ▾
          </button>
          {menuOpen && (
            <div
              style={{
                position: 'absolute',
                top: '42px',
                left: 0,
                width: '220px',
                background: '#ffffff',
                border: '1px solid #d8dee5',
                borderRadius: '12px',
                boxShadow: '0 18px 40px rgba(15,23,42,0.18)',
                padding: '8px',
                zIndex: 9999,
              }}
            >
              <div style={{ padding: '7px 8px', fontSize: '12px', fontWeight: 800, color: '#475467' }}>Admin / Backup</div>
              <button type="button" onClick={exportBackupJson} style={menuItemBtn}>Salvează backup JSON</button>
              <button type="button" onClick={exportBackupCsv} style={menuItemBtn}>Salvează backup CSV</button>
              <button type="button" onClick={exportPozeInFolder} style={menuItemBtn}>Export poze în folder</button>
              <div style={{ height: '1px', background: '#eef2f6', margin: '6px 0' }} />
              <button type="button" onClick={() => { exportaCsvStoc(); setMenuOpen(false) }} style={menuItemBtn}>Export pieseauto CSV</button>
              <button type="button" onClick={() => { exportaPdfStoc(); setMenuOpen(false) }} style={menuItemBtn}>Export PDF stoc</button>
              <div style={{ height: '1px', background: '#eef2f6', margin: '6px 0' }} />
              <button type="button" onClick={() => { setMenuOpen(false); logout() }} style={{ ...menuItemBtn, color: '#b91c1c' }}>Logout</button>
            </div>
          )}
        </div>
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
        <button onClick={handlePuneAnuntPieseauto} disabled={!selected || postingAnunt} style={postBtn}>{postingAnunt ? 'Trimit...' : 'Pune anunț'}</button>
        <div style={{ marginLeft: 'auto', fontSize: '12px', color: '#1f2937' }}>Piese: <b>{piese.length}</b> | Valoare stoc: <b>{valoareStoc.toFixed(2)} RON</b></div>

        <div className="flex items-center gap-2">
          <div className="text-xs text-gray-500">{userEmail}</div>
        </div>
      </div>

      <div style={{ minHeight: 0, display: 'grid', gridTemplateColumns: '54% 46%', gap: '12px', padding: '12px' }}>
        <div style={{ minHeight: 0, display: 'grid', gridTemplateRows: 'auto auto 1fr auto', background: '#ffffff', border: '1px solid #d8dee5', borderRadius: '12px', overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid #d8dee5', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', fontWeight: 700 }}>
            <span>Lista piese</span><span>{pieseFiltrateSiSortate.length} rezultate</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '86px 120px 1fr 130px 120px 72px 110px 70px', gap: '6px', padding: '8px 8px', borderBottom: '1px solid #d8dee5', fontWeight: 700, fontSize: '11px', background: '#eef2f6', color: '#334155' }}>
            <div>CDP</div><div>Cod piesă</div><div>Denumire</div><div>Categorie</div><div>Mașină</div><div>Raft</div><div>VIN / culoare</div><div>Preț</div>
          </div>
          <div style={{ overflowY: 'auto', minHeight: 0 }}>
            {loading ? <div style={{ padding: '12px', fontSize: '12px' }}>{loadingMessage || 'Se încarcă...'}</div> : paginatedPiese.length === 0 ? <div style={{ padding: '12px', fontSize: '12px' }}>Nu există piese</div> : paginatedPiese.map((p) => (
              <div key={p.id} onClick={() => { setSelected(p)
    setSelectedPoza((p.poze && p.poze.length > 0) ? p.poze[0] : null); setSelectedPoza(p.poze?.[0] || null) }} onMouseEnter={(e) => handleRowMouseEnter(p, e)} onMouseMove={handleRowMouseMove} onMouseLeave={handleRowMouseLeave} style={{ display: 'grid', gridTemplateColumns: '86px 120px 1fr 130px 120px 72px 110px 70px', gap: '6px', padding: '7px 8px', borderBottom: '1px solid #edf1f5', cursor: 'pointer', background: getRowBackground(p), alignItems: 'center', fontSize: '11px' }}>
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
          <div style={{ borderTop: '1px solid #d8dee5', background: '#ffffff', padding: '8px 10px', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} style={pagerBtn}>‹</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).slice(Math.max(0, currentPage - 4), Math.max(0, currentPage - 4) + 8).map((page) => (
              <button key={page} onClick={() => setCurrentPage(page)} style={{ ...pagerBtn, background: currentPage === page ? '#2f80ed' : '#fff', color: currentPage === page ? '#fff' : '#344054', borderColor: currentPage === page ? '#2f80ed' : '#d0d7de' }}>{page}</button>
            ))}
            <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} style={pagerBtn}>›</button>
            <div style={{ marginLeft: '8px', fontSize: '11px', color: '#344054' }}>Pagina {currentPage} / {totalPages}</div>
          </div>
        </div>

        <div style={{ minHeight: 0, overflow: 'hidden' }}>
          {!selected ? (
            <div style={{ background: '#ffffff', border: '1px solid #d8dee5', borderRadius: '12px', padding: '18px', fontSize: '13px' }}>Selectează o piesă</div>
          ) : (
            <div style={{ position: 'sticky', top: 0, height: 'calc(100vh - 92px)', minHeight: 0, overflowY: 'auto', paddingRight: '4px', display: 'grid', gridTemplateRows: 'auto auto auto auto auto', gap: '8px' }}>
              <div style={cardStyle}>
                <div style={{ display: 'grid', gridTemplateColumns: '300px minmax(0, 1fr)', gap: '12px', alignItems: 'start' }}>
                  <div onMouseEnter={() => setHoverPreview(true)} onMouseLeave={() => setHoverPreview(false)} style={{ width: '300px', height: '224px', borderRadius: '10px', overflow: 'hidden', border: '1px solid #d8dee5', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: selectedPoza ? 'zoom-in' : 'default', position: 'relative' }}>
                    {selectedPoza ? <img src={selectedPoza} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#f8fafc' }} /> : <div style={{ fontSize: '11px', color: '#344054' }}>Fără poză</div>}
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
                    <div style={{ fontSize: '12px', color: '#344054', marginTop: '4px' }}>{selected.masina || '-'}</div>
                    <div style={{ fontSize: '11px', color: '#344054', marginTop: '6px' }}>{autosaveStatus}</div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
                      <button onClick={() => handleRotateSelected(-90)} disabled={!selectedPoza || rotating} style={smallSecondaryBtn}>{rotating ? 'Se rotește...' : '↺ Rotire stânga'}</button>
                      <button onClick={() => handleRotateSelected(90)} disabled={!selectedPoza || rotating} style={smallSecondaryBtn}>{rotating ? 'Se rotește...' : 'Rotire dreapta ↻'}</button>
                    </div>
                  </div>
                </div>
                {hoverPreview && selectedPoza && <div style={{ position: 'fixed', top: '80px', right: '20px', width: '600px', height: '600px', background: '#ffffff', border: '1px solid #d8dee5', borderRadius: '12px', boxShadow: '0 18px 40px rgba(0,0,0,0.18)', padding: '10px', zIndex: 9999 }}><img src={selectedPoza} alt="preview mare" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: '8px', background: '#f8fafc' }} /></div>}
              </div>

              <div style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <button onClick={updatePiesaManual} style={smallPrimaryBtn}>Salvează</button>
                  <button onClick={handleStergePiesa} disabled={deletingPiesa} style={smallDangerBtn}>{deletingPiesa ? 'Se șterge...' : 'Șterge'}</button>
                  <div style={{ width: '10px' }} />
                  <button onClick={handleVinde} style={smallSellBtn}>Vinde</button>
                  <button onClick={handlePuneAnuntPieseauto} disabled={postingAnunt} style={postBtn}>{postingAnunt ? 'Trimit...' : 'Pune anunț'}</button>
                  {seleniumStatus && <div style={{ fontSize: '11px', color: '#344054', fontWeight: 700 }}>{seleniumStatus}</div>}
                </div>
              </div>

              <div style={cardStyle}>
                <SectionTitle title="Identificare" />
                <div style={{ ...formGrid, gridTemplateColumns: 'minmax(210px, 280px) minmax(210px, 280px)', justifyContent: 'start', columnGap: '16px' }}>
                  <Camp label="CDP" value={selected.cdp} onChange={() => {}} disabled />
                  <Camp label="Cod piesă" value={selected.cod_piesa || ''} onChange={(value) => updateSelectedField('cod_piesa', value)} onBlur={handleCodBlur} />
                  <Camp label="Denumire" value={selected.denumire} onChange={(value) => updateSelectedField('denumire', value)} onBlur={handleDenumireBlur} />
                  <Camp
                    label="Categorie"
                    value={selected.categorie || ''}
                    onChange={(value) => {
                      setManualCategoryEdited(true)
                      const updated = {
                        ...selected,
                        categorie: value,
                        pieseauto_main_category: value || null,
                        pieseauto_subcategory: '',
                        pieseauto_category_path: value || '',
                      }
                      setSelected(updated)
                      setPiese((prev) => prev.map((p) => p.id === updated.id ? updated : p))
                    }}
                    onBlur={saveSelectedOnBlur}
                    asSelect
                    options={INTERNAL_CATEGORIES}
                  />
                  <Camp label="Mașină" value={selected.masina || ''} onChange={(value) => updateSelectedField('masina', value)} onBlur={saveSelectedOnBlur} />
                  <Camp
                    label="Subcategorie pieseauto"
                    value={selected.pieseauto_subcategory || ''}
                    onChange={(value) => {
                      setManualCategoryEdited(true)

                      const currentMain = selected.pieseauto_main_category || selected.categorie || ''
                      const matched = findBestCatalogSubcategory(catalog, currentMain, value)
                      const mainFound = matched.main || currentMain || ''
                      const resolvedSub = matched.sub || value
                      const path = mainFound && resolvedSub ? `${mainFound} > ${resolvedSub}` : (mainFound || resolvedSub)
                      const updated = {
                        ...selected,
                        categorie: mainFound || selected.categorie,
                        pieseauto_main_category: mainFound || null,
                        pieseauto_subcategory: resolvedSub,
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
                <div style={{ marginTop: '10px', fontSize: '12px', color: '#344054', fontWeight: 700 }}>Path categorie: {selected.pieseauto_category_path || '-'}</div>
              </div>

              <div style={cardStyle}>
                <SectionTitle title="Poze piesă" />
                <div style={{ marginBottom: '10px' }}>
                  <label style={uploadLabelStyle}>
                    <input type="file" accept="image/*" multiple onChange={handlePozaUpload} style={{ display: 'none' }} />
                    + Adaugă poze
                  </label>
                  {uploading && <div style={{ marginTop: '8px', fontSize: '12px', color: '#1f2937' }}>Se încarcă pozele...</div>}
                </div>
                <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '4px' }}>
                  {(selected.poze || []).map((poza, index) => (
                    <div key={index} onClick={() => setSelectedPoza(poza)} style={{ minWidth: '98px', width: '98px', border: selectedPoza === poza ? '2px solid #3b82f6' : '1px solid #d0d7de', borderRadius: '8px', padding: '4px', background: '#ffffff', cursor: 'pointer', position: 'relative' }}>
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
        <div style={{ position: 'fixed', left: Math.min(hoverCardPos.x, viewport.width - 310), top: Math.min(hoverCardPos.y, viewport.height - 170), width: '290px', background: '#ffffff', border: '1px solid #d8dee5', borderRadius: '12px', boxShadow: '0 14px 28px rgba(0,0,0,0.16)', padding: '10px', zIndex: 9998, pointerEvents: 'none' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: '10px' }}>
            <div style={{ width: '92px', height: '76px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #d8dee5', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {hoveredPiesa.poze?.[0] ? <img src={hoveredPiesa.poze[0]} alt="preview mic" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ fontSize: '11px', color: '#344054' }}>Fără poză</div>}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 700 }}>{hoveredPiesa.cdp}</div>
              <div style={{ fontSize: '12px', fontWeight: 700, marginTop: '2px' }}>{hoveredPiesa.cod_piesa || '-'}</div>
              <div style={{ fontSize: '12px', marginTop: '4px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hoveredPiesa.denumire || '-'}</div>
              <div style={{ fontSize: '11px', color: '#344054', marginTop: '6px', lineHeight: 1.4 }}>Mașină: {hoveredPiesa.masina || '-'}<br />Raft: {hoveredPiesa.raft || '-'} | Preț: {(hoveredPiesa.pret || 0).toFixed(0)} RON</div>
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

const topInputStyle: React.CSSProperties = { minWidth: '320px', flex: 1, maxWidth: '650px', padding: '10px 12px', border: '1px solid #c9d3dd', borderRadius: '10px', background: '#ffffff', fontSize: '13px' }
const topSelectStyle: React.CSSProperties = { padding: '10px 12px', border: '1px solid #c9d3dd', borderRadius: '10px', background: '#ffffff', fontSize: '13px' }
const menuItemBtn: React.CSSProperties = { width: '100%', textAlign: 'left', padding: '9px 10px', cursor: 'pointer', border: '0', background: '#ffffff', color: '#1f2937', borderRadius: '8px', fontWeight: 700, fontSize: '13px' }
const primaryBtn: React.CSSProperties = { padding: '10px 14px', cursor: 'pointer', border: '1px solid #2e6ee6', background: '#2f80ed', color: '#fff', borderRadius: '10px', fontWeight: 700, fontSize: '13px' }
const exportBtn: React.CSSProperties = { padding: '10px 13px', cursor: 'pointer', border: '1px solid #b8c4d2', background: '#f8fafc', color: '#344054', borderRadius: '10px', fontWeight: 700, fontSize: '13px' }
const smallPrimaryBtn: React.CSSProperties = { padding: '8px 12px', cursor: 'pointer', border: '1px solid #2e6ee6', background: '#2f80ed', color: '#fff', borderRadius: '8px', fontWeight: 700, fontSize: '12px' }
const smallSellBtn: React.CSSProperties = { padding: '8px 12px', cursor: 'pointer', border: '1px solid #f59e0b', background: '#fff7ed', color: '#b45309', borderRadius: '8px', fontWeight: 700, fontSize: '12px' }
const postBtn: React.CSSProperties = { padding: '8px 12px', cursor: 'pointer', border: '1px solid #16a34a', background: '#ecfdf3', color: '#027a48', borderRadius: '8px', fontWeight: 700, fontSize: '12px' }
const smallSecondaryBtn: React.CSSProperties = { padding: '8px 12px', cursor: 'pointer', border: '1px solid #c9d3dd', background: '#ffffff', color: '#344054', borderRadius: '8px', fontWeight: 700, fontSize: '12px' }
const smallDangerBtn: React.CSSProperties = { padding: '8px 12px', cursor: 'pointer', border: '1px solid #f1b5bb', background: '#fff5f5', color: '#b42318', borderRadius: '8px', fontWeight: 700, fontSize: '12px' }
const pagerBtn: React.CSSProperties = { minWidth: '30px', height: '30px', padding: '0 8px', cursor: 'pointer', border: '1px solid #d0d7de', background: '#ffffff', color: '#344054', borderRadius: '8px', fontWeight: 700, fontSize: '12px' }
const cardStyle: React.CSSProperties = { background: '#ffffff', border: '1px solid #d8dee5', borderRadius: '12px', padding: '12px' }
const formGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }
const textareaStyle: React.CSSProperties = { width: '100%', minHeight: '180px', padding: '10px', border: '1px solid #c9d3dd', borderRadius: '8px', resize: 'vertical', fontSize: '12px' }
const uploadLabelStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: '40px', padding: '0 14px', border: '1px solid #c9d3dd', borderRadius: '10px', background: '#ffffff', color: '#344054', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }
