import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error('Lipsesc NEXT_PUBLIC_SUPABASE_URL sau SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient(url, serviceRoleKey)
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const files = formData
      .getAll('photos')
      .filter((value): value is File => value instanceof File && value.size > 0)
      .slice(0, 4)

    if (!files.length) {
      return NextResponse.json({ error: 'Nu au fost primite poze.' }, { status: 400 })
    }

    const supabase = getSupabaseAdmin()

    const { data: cdpData, error: cdpError } = await supabase.rpc('get_next_cdp')
    if (cdpError) {
      throw new Error('Eroare get_next_cdp: ' + cdpError.message)
    }

    const cdpNou = String(cdpData)

    const { data: inserted, error: insertError } = await supabase
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
      .select('id, cdp')
      .single()

    if (insertError) {
      throw new Error('Eroare creare piesă: ' + insertError.message)
    }

    const publicUrls: string[] = []

    for (const file of files) {
      const bytes = await file.arrayBuffer()
      const buffer = Buffer.from(bytes)

      const ext =
        (file.name?.split('.').pop() || file.type.split('/').pop() || 'jpg').toLowerCase()

      const fileName = `${inserted.cdp}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`

      const storagePath = `${inserted.cdp}/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('piese-poze')
        .upload(storagePath, buffer, {
          contentType: file.type || 'image/jpeg',
          upsert: false,
        })

      if (uploadError) {
        throw new Error('Eroare upload poză: ' + uploadError.message)
      }

      const { data: publicData } = supabase.storage
        .from('piese-poze')
        .getPublicUrl(storagePath)

      publicUrls.push(publicData.publicUrl)
    }

    const { error: updateError } = await supabase
      .from('piese')
      .update({ poze: publicUrls })
      .eq('id', inserted.id)

    if (updateError) {
      throw new Error('Eroare update piese: ' + updateError.message)
    }

    return NextResponse.json({
      ok: true,
      cdp: inserted.cdp,
      poze: publicUrls.length,
    })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Eroare necunoscută' },
      { status: 500 }
    )
  }
}
