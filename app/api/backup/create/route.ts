import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const key = searchParams.get("key");

    if (key !== process.env.PIESEAUTO_FEED_KEY) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    // luam toate piesele
    // luam toate piesele fara limita de 1000
let piese: any[] = [];
let from = 0;
const pageSize = 1000;

while (true) {
  const to = from + pageSize - 1;

  const { data, error } = await supabase
    .from("piese")
    .select("*")
    .order("cdp", { ascending: true })
    .range(from, to);

  if (error) {
    return new NextResponse(error.message, { status: 500 });
  }

  if (!data || data.length === 0) {
    break;
  }

  piese = [...piese, ...data];

  if (data.length < pageSize) {
    break;
  }

  from += pageSize;
}

    const totalPiese = piese?.length || 0;

    // numaram pozele
    let totalPoze = 0;

    for (const p of piese || []) {
      if (Array.isArray(p.poze)) {
        totalPoze += p.poze.length;
      }

      if (Array.isArray(p.imagini)) {
        totalPoze += p.imagini.length;
      }
    }

    const backupName = `backup_${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}`;

    // salvam backupul
    const { error: backupError } = await supabase
      .from("backup_piese")
      .insert({
        backup_name: backupName,
        total_piese: totalPiese,
        total_poze: totalPoze,
        data: piese,
      });

    if (backupError) {
      return new NextResponse(backupError.message, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      backup_name: backupName,
      total_piese: totalPiese,
      total_poze: totalPoze,
    });

  } catch (err: any) {
    return new NextResponse(err.message || "Unknown error", {
      status: 500,
    });
  }
}