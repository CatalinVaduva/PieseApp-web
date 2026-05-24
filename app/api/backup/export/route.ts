import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function csvEscape(value: any) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function cleanText(value: any) {
  return String(value ?? "").replace(/\r/g, " ").replace(/\n/g, " ").trim();
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");
  const format = searchParams.get("format") || "json";

  if (key !== process.env.PIESEAUTO_FEED_KEY) {
    return new NextResponse("Forbidden", { status: 403 });
  }

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

    if (error) return new NextResponse(error.message, { status: 500 });
    if (!data || data.length === 0) break;

    piese = [...piese, ...data];

    if (data.length < pageSize) break;
    from += pageSize;
  }

  const date = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

  if (format === "csv") {
    const columns = [
      "cdp",
      "denumire",
      "cod_piesa",
      "masina",
      "categorie",
      "subcategorie",
      "pret",
      "cantitate",
      "raft",
      "vin",
      "cod_culoare",
      "observatii",
      "poze",
    ];

    const rows = piese.map((p) =>
      columns.map((col) => {
        const value = Array.isArray(p[col]) ? p[col].join(" [,] ") : p[col];
        return csvEscape(cleanText(value));
      }).join(";")
    );

    const csv = [columns.map(csvEscape).join(";"), ...rows].join("\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="pieseapp_backup_${date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json(
    {
      created_at: new Date().toISOString(),
      total_piese: piese.length,
      data: piese,
    },
    {
      headers: {
        "Content-Disposition": `attachment; filename="pieseapp_backup_${date}.json"`,
        "Cache-Control": "no-store",
      },
    }
  );
}