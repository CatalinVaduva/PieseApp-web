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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");

  if (key !== process.env.PIESEAUTO_FEED_KEY) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const { data, error } = await supabase
    .from("piese")
    .select("*")
    .gt("pret", 0)
    .gt("stoc", 0)
    .order("cdp", { ascending: true });

  if (error) {
    return new NextResponse(error.message, { status: 500 });
  }

  const header = [
    "id produs",
    "titlu produs",
    "categorie produs",
    "descriere produs",
    "moneda",
    "pret",
    "cantitate",
    "url",
  ];

  const rows = (data ?? []).map((p: any) => [
    csvEscape(p.cdp),
    csvEscape(p.denumire),
    csvEscape(p.categorie || p.categorie_pieseauto || ""),
    csvEscape(p.descriere || p.observatii || ""),
    csvEscape("RON"),
    csvEscape(p.pret),
    csvEscape(p.stoc),
    csvEscape(Array.isArray(p.imagini) ? p.imagini.join(" [,] ") : p.url || ""),
  ]);

  const csv = [
    header.map(csvEscape).join(";"),
    ...rows.map((r) => r.join(";")),
  ].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `inline; filename="pieseauto.csv"`,
      "Cache-Control": "no-store",
    },
  });
}