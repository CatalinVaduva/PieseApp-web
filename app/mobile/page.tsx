'use client'

import { useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

type SelectedPhoto = {
  id: string
  file: File
  preview: string
}

const MAX_FILES = 8
const ACCEPTED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'heic', 'heif']

function getFileExt(file: File) {
  return (file.name.split('.').pop() || '').toLowerCase().trim()
}

function isImageFile(file: File) {
  const ext = getFileExt(file)
  return file.type.startsWith('image/') || ACCEPTED_IMAGE_EXTENSIONS.includes(ext)
}

function safeImageExtension(file: File) {
  const ext = getFileExt(file)
  if (ACCEPTED_IMAGE_EXTENSIONS.includes(ext)) return ext
  if (file.type === 'image/png') return 'png'
  if (file.type === 'image/webp') return 'webp'
  if (file.type === 'image/gif') return 'gif'
  if (file.type === 'image/bmp') return 'bmp'
  if (file.type === 'image/heic') return 'heic'
  if (file.type === 'image/heif') return 'heif'
  return 'jpg'
}

function safeContentType(file: File) {
  if (file.type && file.type.startsWith('image/')) return file.type
  const ext = getFileExt(file)
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'bmp') return 'image/bmp'
  if (ext === 'heic') return 'image/heic'
  if (ext === 'heif') return 'image/heif'
  return 'image/jpeg'
}

export default function MobilePage() {
  const [photos, setPhotos] = useState<(SelectedPhoto | null)[]>(
    Array.from({ length: MAX_FILES }, () => null)
  )
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('Poți face poze una câte una sau alege mai multe din galerie.')
  const [createdCdp, setCreatedCdp] = useState<string | null>(null)
  const [raft, setRaft] = useState('')
  const [galleryInputKey, setGalleryInputKey] = useState(1)

  const galleryInputRef = useRef<HTMLInputElement | null>(null)

  const photosCount = useMemo(() => photos.filter(Boolean).length, [photos])
  const canSubmit = useMemo(() => photosCount > 0 && !saving, [photosCount, saving])

  function makePhotoId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }

  function makeItem(file: File): SelectedPhoto {
    return {
      id: makePhotoId(),
      file,
      preview: URL.createObjectURL(file),
    }
  }

  function resetGalleryInput() {
    if (galleryInputRef.current) galleryInputRef.current.value = ''
    // Pe mobil, mai ales Safari/iPhone, inputul file trebuie remontat după fiecare folosire.
    setGalleryInputKey((v) => v + 1)
  }

  function openGallery() {
    if (saving || photosCount >= MAX_FILES) return
    resetGalleryInput()
    window.setTimeout(() => galleryInputRef.current?.click(), 30)
  }

  function nextEmptyIndex(list: (SelectedPhoto | null)[]) {
    return list.findIndex((p) => p === null)
  }

  function addCameraFileAt(index: number, fileList: FileList | null) {
    const file = fileList?.[0]
    if (!file || !isImageFile(file)) {
      setStatus('Nu s-a selectat nicio poză validă.')
      return
    }

    setPhotos((prev) => {
      const next = [...prev]
      const old = next[index]
      if (old?.preview?.startsWith('blob:')) URL.revokeObjectURL(old.preview)
      next[index] = makeItem(file)
      const count = next.filter(Boolean).length
      setStatus(`Poze pregătite: ${count} / ${MAX_FILES}`)
      setCreatedCdp(null)
      return next
    })
  }

  function addGalleryFiles(fileList: FileList | null) {
    const selectedFiles = Array.from(fileList || [])
    if (!selectedFiles.length) {
      setStatus('Nu s-a selectat nicio poză.')
      resetGalleryInput()
      return
    }

    let added = 0
    let skipped = 0

    setPhotos((prev) => {
      const next = [...prev]

      for (const file of selectedFiles) {
        if (!isImageFile(file)) {
          skipped += 1
          continue
        }
        const emptyIdx = nextEmptyIndex(next)
        if (emptyIdx === -1) break
        next[emptyIdx] = makeItem(file)
        added += 1
      }

      const count = next.filter(Boolean).length
      if (added > 0) {
        setStatus(`Poze pregătite: ${count} / ${MAX_FILES}`)
        setCreatedCdp(null)
      } else if (skipped > 0) {
        setStatus('Fișierele alese nu par poze valide. Încearcă JPG/PNG sau fă poză direct din cameră.')
      } else if (count >= MAX_FILES) {
        setStatus(`Ai atins limita de ${MAX_FILES} poze.`)
      } else {
        setStatus('Nu s-a adăugat nicio poză.')
      }
      return next
    })

    window.setTimeout(resetGalleryInput, 100)
  }

  function removePhoto(index: number) {
    setPhotos((prev) => {
      const next = [...prev]
      const item = next[index]
      if (item?.preview?.startsWith('blob:')) {
        URL.revokeObjectURL(item.preview)
      }
      next[index] = null
      const count = next.filter(Boolean).length
      setStatus(
        count
          ? `Poze pregătite: ${count} / ${MAX_FILES}`
          : 'Poți face poze una câte una sau alege mai multe din galerie.'
      )
      return next
    })
    resetGalleryInput()
  }

  async function getNextCdp() {
    const { data, error } = await supabase.rpc('get_next_cdp')
    if (error) throw error
    return String(data)
  }

  async function createDraftWithRetry(raftValue: string, maxRetries = 3) {
    let lastError: any = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const cdpNou = await getNextCdp()

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
              raft: raftValue.trim() || null,
              vin: null,
              cod_culoare: null,
            },
          ])
          .select('id, cdp')
          .single()

        if (error) throw error
        return data
      } catch (err: any) {
        lastError = err
        const msg = String(err?.message || '').toLowerCase()
        if (!msg.includes('duplicate key value')) {
          throw err
        }
      }
    }

    throw lastError || new Error('Nu s-a putut crea draftul.')
  }

  async function uploadPhotosDirect(cdp: string, files: File[]) {
    const publicUrls: string[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const ext = safeImageExtension(file)
      const random = Math.random().toString(36).slice(2, 8)
      const fileName = `${cdp}-${Date.now()}-${i + 1}-${random}.${ext}`
      const storagePath = `${cdp}/${fileName}`

      setStatus(`Se urcă poza ${i + 1} / ${files.length}...`)

      const { error: uploadError } = await supabase.storage
        .from('piese-poze')
        .upload(storagePath, file, {
          cacheControl: '3600',
          contentType: safeContentType(file),
          upsert: false,
        })

      if (uploadError) throw uploadError

      const { data } = supabase.storage.from('piese-poze').getPublicUrl(storagePath)
      publicUrls.push(data.publicUrl)
    }

    return publicUrls
  }

  async function handleSubmit() {
    const validPhotos = photos.filter(Boolean) as SelectedPhoto[]
    if (!validPhotos.length) {
      setStatus('Adaugă mai întâi pozele.')
      return
    }

    setSaving(true)
    setCreatedCdp(null)

    try {
      setStatus('Se creează draftul...')
      const raftCurat = raft.trim()
      const inserted = await createDraftWithRetry(raftCurat)

      const urls = await uploadPhotosDirect(
        inserted.cdp,
        validPhotos.map((p) => p.file)
      )

      const { error: updateError } = await supabase
        .from('piese')
        .update({ poze: urls })
        .eq('id', inserted.id)

      if (updateError) throw updateError

      validPhotos.forEach((p) => {
        if (p.preview.startsWith('blob:')) URL.revokeObjectURL(p.preview)
      })

      setPhotos(Array.from({ length: MAX_FILES }, () => null))
      resetGalleryInput()
      setCreatedCdp(inserted.cdp)
      setStatus(`Draft creat cu succes: ${inserted.cdp} · ${urls.length} poze${raftCurat ? ` · raft ${raftCurat}` : ''}`)
    } catch (err: any) {
      const message = String(err?.message || 'necunoscută')
      setStatus('Eroare: ' + message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#eef2f6',
        fontFamily: 'Arial, sans-serif',
        padding: '12px',
        paddingBottom: '90px',
      }}
    >
      <div
        style={{
          maxWidth: '760px',
          margin: '0 auto',
          display: 'grid',
          gap: '12px',
        }}
      >
        <div
          style={{
            background: '#fff',
            border: '1px solid #d8dee5',
            borderRadius: '16px',
            padding: '16px',
          }}
        >
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#101828' }}>
            PieseApp Mobile
          </div>
          <div style={{ marginTop: '8px', fontSize: '14px', lineHeight: 1.5, color: '#667085' }}>
            Camera merge pe sloturi separate: faci poză 1, apoi poză 2, apoi poză 3, fără refresh.
          </div>
          <div
            style={{
              marginTop: '12px',
              display: 'grid',
              gridTemplateColumns: 'auto minmax(110px, 170px)',
              gap: '10px',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                borderRadius: '999px',
                background: '#f8fafc',
                border: '1px solid #d8dee5',
                fontSize: '13px',
                fontWeight: 700,
                color: '#344054',
                whiteSpace: 'nowrap',
              }}
            >
              Poze pregătite: {photosCount} / {MAX_FILES}
            </div>

            <input
              type="text"
              value={raft}
              onChange={(e) => setRaft(e.target.value.toUpperCase())}
              disabled={saving}
              placeholder="Raft: C32"
              autoCapitalize="characters"
              style={{
                width: '100%',
                minHeight: '38px',
                padding: '0 12px',
                border: '1px solid #c9d3dd',
                borderRadius: '12px',
                background: saving ? '#f5f7fa' : '#ffffff',
                color: '#101828',
                fontSize: '15px',
                fontWeight: 800,
                textTransform: 'uppercase',
                outline: 'none',
              }}
            />
          </div>
        </div>

        <div
          style={{
            background: '#fff',
            border: '1px solid #d8dee5',
            borderRadius: '16px',
            padding: '14px',
            display: 'grid',
            gap: '10px',
          }}
        >
          <button
            type="button"
            onClick={openGallery}
            disabled={saving || photosCount >= MAX_FILES}
            style={{
              display: 'block',
              width: '100%',
              minHeight: '54px',
              border: '1px solid #c9d3dd',
              background: '#fff',
              color: '#101828',
              borderRadius: '14px',
              fontSize: '17px',
              fontWeight: 800,
              textAlign: 'center',
              lineHeight: '54px',
              cursor: saving || photosCount >= MAX_FILES ? 'not-allowed' : 'pointer',
              opacity: saving || photosCount >= MAX_FILES ? 0.7 : 1,
            }}
          >
            Alege din galerie
          </button>
          <input
            key={galleryInputKey}
            ref={galleryInputRef}
            type="file"
            accept="image/*,.jpg,.jpeg,.png,.webp,.heic,.heif"
            multiple
            disabled={saving || photosCount >= MAX_FILES}
            style={{
              position: 'fixed',
              left: '-9999px',
              top: '-9999px',
              width: '1px',
              height: '1px',
              opacity: 0,
            }}
            onClick={(e) => {
              ;(e.currentTarget as HTMLInputElement).value = ''
            }}
            onChange={(e) => addGalleryFiles(e.target.files)}
          />

          <div
            style={{
              padding: '12px',
              borderRadius: '12px',
              background: createdCdp ? '#ecfdf3' : '#f8fafc',
              border: '1px solid ' + (createdCdp ? '#abefc6' : '#d8dee5'),
              color: createdCdp ? '#027a48' : '#344054',
              fontSize: '14px',
              fontWeight: 700,
              lineHeight: 1.45,
            }}
          >
            {status}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '10px',
            }}
          >
            {photos.map((item, index) => (
              <div
                key={index}
                style={{
                  minHeight: '208px',
                  border: '1px solid #d8dee5',
                  borderRadius: '12px',
                  overflow: 'hidden',
                  background: '#f8fafc',
                  display: 'grid',
                  gridTemplateRows: '110px auto auto',
                }}
              >
                <div
                  style={{
                    background: '#f8fafc',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {item ? (
                    <img
                      src={item.preview}
                      alt={`Poza ${index + 1}`}
                      style={{
                        width: '100%',
                        height: '110px',
                        objectFit: 'cover',
                        display: 'block',
                      }}
                    />
                  ) : (
                    <div style={{ color: '#667085', fontSize: '14px', fontWeight: 700 }}>
                      Poza {index + 1}
                    </div>
                  )}
                </div>

                <div
                  style={{
                    padding: '10px',
                    fontSize: '12px',
                    color: item ? '#101828' : '#667085',
                    fontWeight: 700,
                    lineHeight: 1.35,
                    wordBreak: 'break-word',
                  }}
                >
                  {item ? item.file.name || `poza-${index + 1}` : 'Gol'}
                </div>

                <div style={{ padding: '0 10px 10px 10px', display: 'grid', gap: '8px' }}>
                  {!item ? (
                    <label
                      style={{
                        display: 'block',
                        width: '100%',
                        minHeight: '38px',
                        border: '1px solid #2e6ee6',
                        background: '#2f80ed',
                        color: '#fff',
                        borderRadius: '10px',
                        fontSize: '13px',
                        fontWeight: 800,
                        textAlign: 'center',
                        lineHeight: '38px',
                        cursor: saving ? 'not-allowed' : 'pointer',
                        opacity: saving ? 0.7 : 1,
                      }}
                    >
                      Fă poză
                      <input
                        key={`camera-slot-${index}-${photosCount}`}
                        type="file"
                        accept="image/*,.jpg,.jpeg,.png,.webp,.heic,.heif"
                        capture="environment"
                        disabled={saving}
                        style={{ display: 'none' }}
                        onClick={(e) => {
                          ;(e.currentTarget as HTMLInputElement).value = ''
                        }}
                        onChange={(e) => addCameraFileAt(index, e.target.files)}
                      />
                    </label>
                  ) : (
                    <button
                      type="button"
                      onClick={() => removePhoto(index)}
                      disabled={saving}
                      style={{
                        width: '100%',
                        minHeight: '38px',
                        border: '1px solid #f1b5bb',
                        background: '#fff5f5',
                        color: '#b42318',
                        borderRadius: '10px',
                        fontSize: '13px',
                        fontWeight: 800,
                        cursor: saving ? 'not-allowed' : 'pointer',
                      }}
                    >
                      Șterge poza
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div
            style={{
              position: 'sticky',
              bottom: '10px',
              zIndex: 30,
              background: 'rgba(238,242,246,0.92)',
              paddingTop: '8px',
              backdropFilter: 'blur(6px)',
            }}
          >
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{
                width: '100%',
                minHeight: '58px',
                border: '1px solid #2e6ee6',
                background: canSubmit ? '#2f80ed' : '#9ec5f8',
                color: '#fff',
                borderRadius: '14px',
                fontSize: '18px',
                fontWeight: 800,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                boxShadow: '0 8px 20px rgba(47,128,237,0.22)',
              }}
            >
              {saving ? 'Se adaugă piesa...' : 'Adaugă piesă'}
            </button>
          </div>
        </div>
      </div>
    </main>
  )
}
