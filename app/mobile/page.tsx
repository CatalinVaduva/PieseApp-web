'use client'

import { useRef, useState } from 'react'

export default function MobilePage() {
  const [files, setFiles] = useState<File[]>([])
  const [status, setStatus] = useState('Alege 1-4 poze.')
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function handleFiles(list: FileList | null) {
    const next = Array.from(list || []).slice(0, 4)
    setFiles(next)

    if (!next.length) {
      setStatus('Nu ai selectat nicio poză.')
      return
    }

    setStatus(`Selectate: ${next.length} ${next.length === 1 ? 'poză' : 'poze'}.`)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!files.length) {
      setStatus('Alege mai întâi 1-4 poze.')
      return
    }

    setSaving(true)
    setStatus('Se trimite...')

    try {
      const formData = new FormData()
      files.forEach((file) => formData.append('photos', file))

      const res = await fetch('/api/mobile-upload', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(data?.error || 'Eroare la upload')
      }

      setFiles([])
      setStatus(`Draft creat cu succes: ${data.cdp}`)

      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    } catch (err: any) {
      setStatus('Eroare: ' + (err?.message || 'necunoscută'))
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
        padding: '16px',
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
            Varianta simplă și stabilă: alegi 1-4 poze și apeși <b>Adaugă piesă</b>.
            Draftul se creează pe server.
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          style={{
            background: '#fff',
            border: '1px solid #d8dee5',
            borderRadius: '16px',
            padding: '16px',
            display: 'grid',
            gap: '12px',
          }}
        >
          <label
            style={{
              display: 'block',
              width: '100%',
              minHeight: '58px',
              border: '1px solid #2e6ee6',
              background: '#2f80ed',
              color: '#fff',
              borderRadius: '14px',
              fontSize: '18px',
              fontWeight: 800,
              textAlign: 'center',
              lineHeight: '58px',
            }}
          >
            Alege poze
            <input
              ref={fileInputRef}
              type="file"
              name="photos"
              accept="image/*"
              multiple
              onChange={(e) => handleFiles(e.target.files)}
              disabled={saving}
              style={{ display: 'none' }}
            />
          </label>

          <div
            style={{
              padding: '12px',
              borderRadius: '12px',
              background: '#f8fafc',
              border: '1px solid #d8dee5',
              color: '#344054',
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
            {[0, 1, 2, 3].map((index) => {
              const file = files[index]
              return (
                <div
                  key={index}
                  style={{
                    minHeight: '110px',
                    border: '1px solid #d8dee5',
                    borderRadius: '12px',
                    background: '#f8fafc',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '10px',
                    textAlign: 'center',
                  }}
                >
                  <div
                    style={{
                      fontSize: '13px',
                      fontWeight: 700,
                      color: file ? '#101828' : '#667085',
                      wordBreak: 'break-word',
                    }}
                  >
                    {file ? file.name : `Poza ${index + 1}`}
                  </div>
                </div>
              )
            })}
          </div>

          <button
            type="submit"
            disabled={saving || files.length === 0}
            style={{
              width: '100%',
              minHeight: '58px',
              border: '1px solid #2e6ee6',
              background: saving || files.length === 0 ? '#9ec5f8' : '#2f80ed',
              color: '#fff',
              borderRadius: '14px',
              fontSize: '18px',
              fontWeight: 800,
              cursor: saving || files.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Se adaugă piesa...' : 'Adaugă piesă'}
          </button>
        </form>
      </div>
    </main>
  )
}
