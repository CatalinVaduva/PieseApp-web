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
}

type SortOption =
  | 'cdp_desc'
  | 'cdp_asc'
  | 'pret_desc'
  | 'pret_asc'
  | 'denumire_asc'
  | 'masina_asc'

const CATEGORII = [
  'Accesorii auto',
  'Accesorii roti',
  'Aprindere',
  'Cabluri auto',
  'Car audio',
  'Caroserie',
  'Climatizare',
  'Directie',
  'Diverse',
  'Electrica & Electronica Auto',
  'Evacuare',
  'Faruri stopuri lumini',
  'Filtre auto',
  'Frane',
  'Instalatii GPL',
  'Interioare auto',
  'Intretinere auto',
  'Jante & Anvelope',
  'Navigatie GPS',
  'Pachete revizie',
  'Piese moto',
  'Piese Motoare',
  'Pompe si injectoare',
  'Punte si rulmenti',
  'Racire',
  'Scule auto',
  'Suspensie',
  'Transmisie',
  'Tuning',
  'Turbo',
  'Xenon',
  'Dezmembrari auto',
]

const PAGE_SIZE = 30
const ROW_PREVIEW_DELAY = 220

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
  const [selectedPoza, setSelectedPoza] = useState<string | null>(null)
  const [autosaveStatus, setAutosaveStatus] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [hoverPreview, setHoverPreview] = useState(false)
  const [hoveredPiesa, setHoveredPiesa] = useState<Piesa | null>(null)
  const [hoverCardVisible, setHoverCardVisible] = useState(false)
  const [hoverCardPos, setHoverCardPos] = useState({ x: 0, y: 0 })
  const [viewport, setViewport] = useState({ width: 1600, height: 900 })

  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedJson = useRef<string>('')

  async function loadPiese(keepCurrentSelection = true) {
    setLoading(true)

    const { data, error } = await supabase
      .from('piese')
      .select('*')
      .order('cdp', { ascending: false })

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
        setSelectedPoza((prev) =>
          prev && actualizata.poze?.includes(prev) ? prev : primaPoza
        )
      } else {
        setSelected(null)
        setSelectedPoza(null)
      }
    }

    setLoading(false)
  }

  useEffect(() => {
    loadPiese(false)
  }, [])

  useEffect(() => {
    const updateViewport = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight })

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

      const { data, error } = await supabase
        .from('piese')
        .insert([
          {
            cdp: cdpNou,
            cod_piesa: null,
            denumire: 'Piesă nouă',
            masina: null,
            compatibilitate: null,
            categorie: null,
            pret: 0,
            cantitate: 1,
            descriere: null,
            draft: true,
            poze: [],
            raft: null,
            vin: null,
            cod_culoare: null,
          },
        ])
        .select()
        .single()

      if (error) {
        alert('Eroare creare piesă: ' + error.message)
        return
      }

      await loadPiese(false)
      setSelected(data as Piesa)
      setSelectedPoza(null)
      lastSavedJson.current = JSON.stringify(buildPayload(data as Piesa))
    } catch (err: any) {
      alert('Eroare creare piesă: ' + (err?.message || 'necunoscută'))
    } finally {
      setCreating(false)
    }
  }

  async function savePiesaSilent(piesa: Piesa, markAsFinal = false) {
    const payload = {
      ...buildPayload(piesa),
      draft: markAsFinal ? false : piesa.draft,
    }

    const { error } = await supabase.from('piese').update(payload).eq('id', piesa.id)

    if (error) {
      setAutosaveStatus('Eroare autosave')
      return false
    }

    lastSavedJson.current = JSON.stringify(payload)
    setAutosaveStatus(markAsFinal ? 'Salvat' : 'Salvat')
    return true
  }

  async function updatePiesaManual() {
    if (!selected) return
    const updated = { ...selected, draft: false }
    const ok = await savePiesaSilent(updated, true)
    if (ok) {
      setSelected(updated)
      setPiese((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
    }
  }

  function updateSelectedField<K extends keyof Piesa>(field: K, value: Piesa[K]) {
    if (!selected) return

    const updated = { ...selected, [field]: value }
    setSelected(updated)
    setAutosaveStatus('Modificări nesalvate')

    setPiese((prev) =>
      prev.map((p) => (p.id === updated.id ? { ...p, [field]: value } : p))
    )
  }

  async function saveSelectedOnBlur() {
    if (!selected) return

    const payload = buildPayload(selected)
    const currentJson = JSON.stringify(payload)

    if (currentJson === lastSavedJson.current) return

    const ok = await savePiesaSilent(selected, false)
    if (ok) {
      setPiese((prev) => prev.map((p) => (p.id === selected.id ? selected : p)))
    }
  }

  useEffect(() => {
    if (!selected) {
      lastSavedJson.current = ''
      setAutosaveStatus('')
      setSelectedPoza(null)
      return
    }

    lastSavedJson.current = JSON.stringify(buildPayload(selected))
    setSelectedPoza(selected.poze?.[0] || null)
  }, [selected?.id])

  async function handleStergePiesa() {
    if (!selected) return

    const confirmDelete = window.confirm(
      `Sigur vrei să ștergi piesa ${selected.cdp} - ${selected.denumire}?`
    )
    if (!confirmDelete) return

    setDeletingPiesa(true)

    const pathsDeSters = (selected.poze || [])
      .map((url) => getStoragePathFromPublicUrl(url))
      .filter(Boolean) as string[]

    if (pathsDeSters.length > 0) {
      const { error: removeStorageError } = await supabase.storage
        .from('piese-poze')
        .remove(pathsDeSters)

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

    const pozeActuale = selected.poze || []
    const pozeNoi = [...pozeActuale]

    for (const file of files) {
      const extensie = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const storagePath = `${selected.cdp}/${selected.cdp}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${extensie}`

      const { error: uploadError } = await supabase.storage
        .from('piese-poze')
        .upload(storagePath, file)

      if (uploadError) {
        setUploading(false)
        alert('Eroare upload: ' + uploadError.message)
        return
      }

      const { data } = supabase.storage.from('piese-poze').getPublicUrl(storagePath)
      if (!pozeNoi.includes(data.publicUrl)) {
        pozeNoi.push(data.publicUrl)
      }
    }

    const uniquePoze = Array.from(new Set(pozeNoi.filter(Boolean)))

    const { error: updateError } = await supabase
      .from('piese')
      .update({ poze: uniquePoze })
      .eq('id', selected.id)

    if (updateError) {
      setUploading(false)
      alert('Eroare salvare poze: ' + updateError.message)
      return
    }

    const piesaNoua = { ...selected, poze: uniquePoze }
    setSelected(piesaNoua)
    setSelectedPoza(uniquePoze[0] || null)
    setPiese((prev) => prev.map((p) => (p.id === piesaNoua.id ? piesaNoua : p)))

    setUploading(false)
    e.target.value = ''
  }

  async function handleStergePoza(pozaUrl: string) {
    if (!selected) return

    setDeletingPhoto(pozaUrl)

    const path = getStoragePathFromPublicUrl(pozaUrl)
    if (path) {
      const { error: storageError } = await supabase.storage
        .from('piese-poze')
        .remove([path])

      if (storageError) {
        setDeletingPhoto(null)
        alert('Eroare ștergere din Storage: ' + storageError.message)
        return
      }
    }

    const pozeNoi = (selected.poze || []).filter((poza) => poza !== pozaUrl)

    const { error } = await supabase
      .from('piese')
      .update({ poze: pozeNoi })
      .eq('id', selected.id)

    if (error) {
      setDeletingPhoto(null)
      alert('Eroare ștergere poză: ' + error.message)
      return
    }

    const updated = { ...selected, poze: pozeNoi }
    setSelected(updated)
    setSelectedPoza(pozeNoi[0] || null)
    setPiese((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
    setDeletingPhoto(null)
  }

  const pieseFiltrateSiSortate = useMemo(() => {
  const termen = search.trim().toLowerCase()
  const terms = termen.split(/\s+/).filter(Boolean)

  let rezultat = !terms.length
    ? [...piese]
    : piese.filter((p) => {
        const fields = [
          p.cdp || '',
          p.cod_piesa || '',
          p.denumire || '',
          p.masina || '',
          p.categorie || '',
          p.raft || '',
          p.vin || '',
          p.cod_culoare || '',
          p.compatibilitate || '',
          p.descriere || '',
        ].map(v => String(v).toLowerCase())

        return terms.every((term) =>
          fields.some((field) => field.includes(term))
        )
      })

  rezultat.sort((a, b) => {
    switch (sortBy) {
      case 'cdp_asc':
        return (a.cdp || '').localeCompare(b.cdp || '', undefined, { numeric: true })
      case 'cdp_desc':
        return (b.cdp || '').localeCompare(a.cdp || '', undefined, { numeric: true })
      case 'pret_asc':
        return (a.pret || 0) - (b.pret || 0)
      case 'pret_desc':
        return (b.pret || 0) - (a.pret || 0)
      case 'denumire_asc':
        return (a.denumire || '').localeCompare(b.denumire || '')
      case 'masina_asc':
        return (a.masina || '').localeCompare(b.masina || '')
      default:
        return (b.cdp || '').localeCompare(a.cdp || '', undefined, { numeric: true })
    }
  })

  return rezultat
}, [piese, search, sortBy])

  const totalPages = Math.max(1, Math.ceil(pieseFiltrateSiSortate.length / PAGE_SIZE))

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  const paginatedPiese = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE
    return pieseFiltrateSiSortate.slice(start, start + PAGE_SIZE)
  }, [pieseFiltrateSiSortate, currentPage])

  const valoareStoc = useMemo(() => {
    return piese.reduce((sum, p) => sum + (p.pret || 0) * (p.cantitate || 0), 0)
  }, [piese])

  function handleRowMouseEnter(piesa: Piesa, e: React.MouseEvent<HTMLDivElement>) {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)

    setHoveredPiesa(piesa)
    setHoverCardPos({ x: e.clientX + 18, y: e.clientY + 12 })

    hoverTimer.current = setTimeout(() => {
      setHoverCardVisible(true)
    }, ROW_PREVIEW_DELAY)
  }

  function handleRowMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    setHoverCardPos({ x: e.clientX + 18, y: e.clientY + 12 })
  }

  function handleRowMouseLeave() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setHoverCardVisible(false)
    setHoveredPiesa(null)
  }

  return (
    <main
      style={{
        height: '100vh',
        overflow: 'hidden',
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
        fontFamily: 'Arial, sans-serif',
        background: '#eef2f6',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #d8dee5',
          background: '#fff',
          display: 'flex',
          gap: '10px',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ fontSize: '18px', fontWeight: 700 }}>PieseApp</div>

        <input
          type="text"
          placeholder="Caută: CDP / cod / denumire / categorie / mașină / VIN / cod culoare"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setCurrentPage(1)
          }}
          style={topInputStyle}
        />

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
          style={topSelectStyle}
        >
          <option value="cdp_desc">CDP descrescător</option>
          <option value="cdp_asc">CDP crescător</option>
          <option value="pret_desc">Preț mare → mic</option>
          <option value="pret_asc">Preț mic → mare</option>
          <option value="denumire_asc">Denumire A-Z</option>
          <option value="masina_asc">Mașină A-Z</option>
        </select>

        <button onClick={handlePiesaNoua} disabled={creating} style={primaryBtn}>
          {creating ? 'Se creează...' : '+ Piesă nouă'}
        </button>

        <div style={{ marginLeft: 'auto', fontSize: '12px', color: '#475467' }}>
          Piese: <b>{piese.length}</b> | Valoare stoc: <b>{valoareStoc.toFixed(2)} RON</b>
        </div>
      </div>

      <div
        style={{
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '54% 46%',
          gap: '12px',
          padding: '12px',
        }}
      >
        <div
          style={{
            minHeight: 0,
            display: 'grid',
            gridTemplateRows: 'auto auto 1fr auto',
            background: '#fff',
            border: '1px solid #d8dee5',
            borderRadius: '12px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '10px 12px',
              borderBottom: '1px solid #d8dee5',
              background: '#f8fafc',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '12px',
              fontWeight: 700,
            }}
          >
            <span>Lista piese</span>
            <span>{pieseFiltrateSiSortate.length} rezultate</span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '86px 120px 1fr 130px 120px 72px 110px 70px',
              gap: '6px',
              padding: '8px 8px',
              borderBottom: '1px solid #d8dee5',
              fontWeight: 700,
              fontSize: '11px',
              background: '#eef2f6',
              color: '#334155',
            }}
          >
            <div>CDP</div>
            <div>Cod piesă</div>
            <div>Denumire</div>
            <div>Categorie</div>
            <div>Mașină</div>
            <div>Raft</div>
            <div>VIN / culoare</div>
            <div>Preț</div>
          </div>

          <div style={{ overflowY: 'auto', minHeight: 0 }}>
            {loading ? (
              <div style={{ padding: '12px', fontSize: '12px' }}>Se încarcă...</div>
            ) : paginatedPiese.length === 0 ? (
              <div style={{ padding: '12px', fontSize: '12px' }}>Nu există piese</div>
            ) : (
              paginatedPiese.map((p) => (
                <div
                  key={p.id}
                  onClick={() => {
                    setSelected(p)
                    setSelectedPoza(p.poze?.[0] || null)
                  }}
                  onMouseEnter={(e) => handleRowMouseEnter(p, e)}
                  onMouseMove={handleRowMouseMove}
                  onMouseLeave={handleRowMouseLeave}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '86px 120px 1fr 130px 120px 72px 110px 70px',
                    gap: '6px',
                    padding: '7px 8px',
                    borderBottom: '1px solid #edf1f5',
                    cursor: 'pointer',
                    background:
                      selected?.id === p.id ? '#dbeafe' : p.draft ? '#fff8cc' : '#fff',
                    alignItems: 'center',
                    fontSize: '11px',
                  }}
                >
                  <Cell strong>{p.cdp}</Cell>
                  <Cell title={p.cod_piesa || ''}>{p.cod_piesa || '-'}</Cell>
                  <Cell strong title={p.denumire}>{p.denumire}</Cell>
                  <Cell title={p.categorie || ''}>{p.categorie || '-'}</Cell>
                  <Cell title={p.masina || ''}>{p.masina || '-'}</Cell>
                  <Cell title={p.raft || ''}>{p.raft || '-'}</Cell>
                  <Cell title={`${p.vin || ''} ${p.cod_culoare || ''}`}>
                    {[p.vin || '', p.cod_culoare || ''].filter(Boolean).join(' / ') || '-'}
                  </Cell>
                  <div style={{ fontWeight: 700 }}>{(p.pret || 0).toFixed(0)}</div>
                </div>
              ))
            )}
          </div>

          <div
            style={{
              borderTop: '1px solid #d8dee5',
              background: '#fff',
              padding: '8px 10px',
              display: 'flex',
              gap: '6px',
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              style={pagerBtn}
            >
              ‹
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .slice(Math.max(0, currentPage - 4), Math.max(0, currentPage - 4) + 8)
              .map((page) => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  style={{
                    ...pagerBtn,
                    background: currentPage === page ? '#2f80ed' : '#fff',
                    color: currentPage === page ? '#fff' : '#344054',
                    borderColor: currentPage === page ? '#2f80ed' : '#d0d7de',
                  }}
                >
                  {page}
                </button>
              ))}

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              style={pagerBtn}
            >
              ›
            </button>

            <div style={{ marginLeft: '8px', fontSize: '11px', color: '#667085' }}>
              Pagina {currentPage} / {totalPages}
            </div>
          </div>
        </div>

        <div style={{ minHeight: 0, overflow: 'hidden' }}>
          {!selected ? (
            <div
              style={{
                background: '#fff',
                border: '1px solid #d8dee5',
                borderRadius: '12px',
                padding: '18px',
                fontSize: '13px',
              }}
            >
              Selectează o piesă
            </div>
          ) : (
            <div
              style={{
                position: 'sticky',
                top: 0,
                height: 'calc(100vh - 92px)',
                minHeight: 0,
                overflowY: 'auto',
                paddingRight: '4px',
                display: 'grid',
                gridTemplateRows: 'auto auto auto auto auto',
                gap: '8px',
              }}
            >
              <div style={cardStyle}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '300px minmax(0, 1fr)',
                    gap: '12px',
                    alignItems: 'start',
                  }}
                >
                  <div
                    onMouseEnter={() => setHoverPreview(true)}
                    onMouseLeave={() => setHoverPreview(false)}
                    style={{
                      width: '300px',
                      height: '224px',
                      borderRadius: '10px',
                      overflow: 'hidden',
                      border: '1px solid #d8dee5',
                      background: '#f8fafc',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: selectedPoza ? 'zoom-in' : 'default',
                      position: 'relative',
                    }}
                  >
                    {selectedPoza ? (
                      <img
                        src={selectedPoza}
                        alt="preview"
                        style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#f8fafc' }}
                      />
                    ) : (
                      <div style={{ fontSize: '11px', color: '#667085' }}>Fără poză</div>
                    )}
                  </div>

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <div style={{ fontSize: '24px', fontWeight: 700 }}>{selected.cdp}</div>
                      <div
                        style={{
                          background: selected.draft ? '#fff8cc' : '#ecfdf3',
                          color: selected.draft ? '#8a6d00' : '#027a48',
                          border: '1px solid ' + (selected.draft ? '#f4df93' : '#abefc6'),
                          borderRadius: '999px',
                          padding: '6px 12px',
                          fontSize: '12px',
                          fontWeight: 700,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {selected.draft ? 'Draft' : 'Completă'}
                      </div>
                    </div>
                    <div style={{ fontSize: '15px', fontWeight: 700, marginTop: '6px' }}>
                      {selected.cod_piesa || '-'}
                    </div>
                    <div style={{ fontSize: '14px', marginTop: '6px', fontWeight: 700 }}>
                      {selected.denumire || '-'}
                    </div>
                    <div style={{ fontSize: '12px', color: '#667085', marginTop: '4px' }}>
                      {selected.masina || '-'}
                    </div>
                    <div style={{ fontSize: '11px', color: '#667085', marginTop: '6px' }}>
                      {autosaveStatus}
                    </div>
                  </div>
                </div>

                {hoverPreview && selectedPoza && (
                  <div
                    style={{
                      position: 'fixed',
                      top: '80px',
                      right: '20px',
                      width: '600px',
                      height: '600px',
                      background: '#fff',
                      border: '1px solid #d8dee5',
                      borderRadius: '12px',
                      boxShadow: '0 18px 40px rgba(0,0,0,0.18)',
                      padding: '10px',
                      zIndex: 9999,
                    }}
                  >
                    <img
                      src={selectedPoza}
                      alt="preview mare"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                        borderRadius: '8px',
                        background: '#f8fafc',
                      }}
                    />
                  </div>
                )}
              </div>

              <div style={cardStyle}>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button onClick={updatePiesaManual} style={smallPrimaryBtn}>
                    Salvează
                  </button>
                  <button
                    onClick={handleStergePiesa}
                    disabled={deletingPiesa}
                    style={smallDangerBtn}
                  >
                    {deletingPiesa ? 'Se șterge...' : 'Șterge'}
                  </button>
                </div>
              </div>

              <div style={cardStyle}>
                <SectionTitle title="Identificare" />
                <div
                  style={{
                    ...formGrid,
                    gridTemplateColumns: 'minmax(210px, 280px) minmax(210px, 280px)',
                    justifyContent: 'start',
                    columnGap: '16px',
                  }}
                >
                  <Camp label="CDP" value={selected.cdp} onChange={() => {}} disabled />
                  <Camp label="Cod piesă" value={selected.cod_piesa || ''} onChange={(value) => updateSelectedField('cod_piesa', value)} onBlur={saveSelectedOnBlur} />
                  <Camp label="Denumire" value={selected.denumire} onChange={(value) => updateSelectedField('denumire', value)} onBlur={saveSelectedOnBlur} />
                  <Camp label="Categorie" value={selected.categorie || ''} onChange={(value) => updateSelectedField('categorie', value)} onBlur={saveSelectedOnBlur} asSelect />
                  <Camp label="Mașină" value={selected.masina || ''} onChange={(value) => updateSelectedField('masina', value)} onBlur={saveSelectedOnBlur} />
                  <Camp label="Compatibilitate" value={selected.compatibilitate || ''} onChange={(value) => updateSelectedField('compatibilitate', value)} onBlur={saveSelectedOnBlur} />
                  <Camp label="VIN" value={selected.vin || ''} onChange={(value) => updateSelectedField('vin', value)} onBlur={saveSelectedOnBlur} />
                  <Camp label="Cod culoare" value={selected.cod_culoare || ''} onChange={(value) => updateSelectedField('cod_culoare', value)} onBlur={saveSelectedOnBlur} />
                  <Camp label="Raft" value={selected.raft || ''} onChange={(value) => updateSelectedField('raft', value)} onBlur={saveSelectedOnBlur} />
                  <Camp label="Cantitate" type="number" value={String(selected.cantitate ?? 1)} onChange={(value) => updateSelectedField('cantitate', value === '' ? 1 : Number(value))} onBlur={saveSelectedOnBlur} />
                  <Camp label="Preț" type="number" value={String(selected.pret ?? 0)} onChange={(value) => updateSelectedField('pret', value === '' ? 0 : Number(value))} onBlur={saveSelectedOnBlur} />
                </div>
              </div>

              <div style={cardStyle}>
                <SectionTitle title="Poze piesă" />
                <div style={{ marginBottom: '10px' }}>
                  <input type="file" accept="image/*" multiple onChange={handlePozaUpload} />
                  {uploading && (
                    <div style={{ marginTop: '8px', fontSize: '12px', color: '#475467' }}>
                      Se încarcă pozele...
                    </div>
                  )}
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: '10px',
                    overflowX: 'auto',
                    paddingBottom: '4px',
                  }}
                >
                  {(selected.poze || []).map((poza, index) => (
                    <div
                      key={index}
                      onClick={() => setSelectedPoza(poza)}
                      style={{
                        minWidth: '98px',
                        width: '98px',
                        border: selectedPoza === poza ? '2px solid #3b82f6' : '1px solid #d0d7de',
                        borderRadius: '8px',
                        padding: '4px',
                        background: '#fff',
                        cursor: 'pointer',
                        position: 'relative',
                      }}
                    >
                      <img
                        src={poza}
                        alt={`poza-${index}`}
                        style={{
                          width: '88px',
                          height: '72px',
                          objectFit: 'cover',
                          borderRadius: '6px',
                          display: 'block',
                        }}
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleStergePoza(poza)
                        }}
                        disabled={deletingPhoto === poza}
                        style={{
                          position: 'absolute',
                          top: '6px',
                          right: '6px',
                          width: '22px',
                          height: '22px',
                          borderRadius: '50%',
                          border: 'none',
                          background: '#d11a2a',
                          color: '#fff',
                          cursor: 'pointer',
                          fontWeight: 700,
                          fontSize: '11px',
                        }}
                        title="Șterge poza"
                      >
                        {deletingPhoto === poza ? '...' : 'X'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div style={cardStyle}>
                <SectionTitle title="Observații" />
                <textarea
                  style={textareaStyle}
                  placeholder="Observații"
                  value={selected.descriere || ''}
                  onChange={(e) => updateSelectedField('descriere', e.target.value)}
                  onBlur={saveSelectedOnBlur}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {hoverCardVisible && hoveredPiesa && (
        <div
          style={{
            position: 'fixed',
            left: Math.min(hoverCardPos.x, viewport.width - 310),
            top: Math.min(hoverCardPos.y, viewport.height - 170),
            width: '290px',
            background: '#fff',
            border: '1px solid #d8dee5',
            borderRadius: '12px',
            boxShadow: '0 14px 28px rgba(0,0,0,0.16)',
            padding: '10px',
            zIndex: 9998,
            pointerEvents: 'none',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: '10px' }}>
            <div
              style={{
                width: '92px',
                height: '76px',
                borderRadius: '8px',
                overflow: 'hidden',
                border: '1px solid #d8dee5',
                background: '#f8fafc',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {hoveredPiesa.poze?.[0] ? (
                <img
                  src={hoveredPiesa.poze[0]}
                  alt="preview mic"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <div style={{ fontSize: '11px', color: '#667085' }}>Fără poză</div>
              )}
            </div>

            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 700 }}>{hoveredPiesa.cdp}</div>
              <div style={{ fontSize: '12px', fontWeight: 700, marginTop: '2px' }}>
                {hoveredPiesa.cod_piesa || '-'}
              </div>
              <div
                style={{
                  fontSize: '12px',
                  marginTop: '4px',
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {hoveredPiesa.denumire || '-'}
              </div>
              <div style={{ fontSize: '11px', color: '#667085', marginTop: '6px', lineHeight: 1.4 }}>
                Mașină: {hoveredPiesa.masina || '-'}
                <br />
                Raft: {hoveredPiesa.raft || '-'} | Preț: {(hoveredPiesa.pret || 0).toFixed(0)} RON
              </div>
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
  return (
    <div
      style={{
        fontSize: '13px',
        fontWeight: 700,
        marginBottom: '10px',
        color: '#101828',
      }}
    >
      {title}
    </div>
  )
}

function Cell({
  children,
  strong = false,
  title,
}: {
  children: React.ReactNode
  strong?: boolean
  title?: string
}) {
  return (
    <div
      title={title}
      style={{
        fontWeight: strong ? 700 : 500,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {children}
    </div>
  )
}

type CampProps = {
  label: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  type?: string
  disabled?: boolean
  asSelect?: boolean
}

function Camp({
  label,
  value,
  onChange,
  onBlur,
  type = 'text',
  disabled = false,
  asSelect = false,
}: CampProps) {
  return (
    <div>
      <div style={{ marginBottom: '6px', fontWeight: 700, fontSize: '12px', color: '#344054' }}>{label}</div>
      {asSelect ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          style={{ width: '100%', padding: '9px 10px', border: '1px solid #c9d3dd', borderRadius: '8px', background: disabled ? '#f5f7fa' : '#fff', fontSize: '12px' }}
        >
          <option value="">Selectează categoria</option>
          {CATEGORII.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          style={{ width: '100%', padding: '9px 10px', border: '1px solid #c9d3dd', borderRadius: '8px', background: disabled ? '#f5f7fa' : '#fff', fontSize: '12px' }}
        />
      )}
    </div>
  )
}

const topInputStyle: React.CSSProperties = {
  minWidth: '320px',
  flex: 1,
  maxWidth: '650px',
  padding: '10px 12px',
  border: '1px solid #c9d3dd',
  borderRadius: '10px',
  background: '#fff',
  fontSize: '13px',
}

const topSelectStyle: React.CSSProperties = {
  padding: '10px 12px',
  border: '1px solid #c9d3dd',
  borderRadius: '10px',
  background: '#fff',
  fontSize: '13px',
}

const primaryBtn: React.CSSProperties = {
  padding: '10px 14px',
  cursor: 'pointer',
  border: '1px solid #2e6ee6',
  background: '#2f80ed',
  color: '#fff',
  borderRadius: '10px',
  fontWeight: 700,
  fontSize: '13px',
}

const smallPrimaryBtn: React.CSSProperties = {
  padding: '8px 12px',
  cursor: 'pointer',
  border: '1px solid #2e6ee6',
  background: '#2f80ed',
  color: '#fff',
  borderRadius: '8px',
  fontWeight: 700,
  fontSize: '12px',
}

const smallDangerBtn: React.CSSProperties = {
  padding: '8px 12px',
  cursor: 'pointer',
  border: '1px solid #f1b5bb',
  background: '#fff5f5',
  color: '#b42318',
  borderRadius: '8px',
  fontWeight: 700,
  fontSize: '12px',
}

const pagerBtn: React.CSSProperties = {
  minWidth: '30px',
  height: '30px',
  padding: '0 8px',
  cursor: 'pointer',
  border: '1px solid #d0d7de',
  background: '#fff',
  color: '#344054',
  borderRadius: '8px',
  fontWeight: 700,
  fontSize: '12px',
}

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #d8dee5',
  borderRadius: '12px',
  padding: '12px',
}

const formGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '10px',
}

const textareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '180px',
  padding: '10px',
  border: '1px solid #c9d3dd',
  borderRadius: '8px',
  resize: 'vertical',
  fontSize: '12px',
}
