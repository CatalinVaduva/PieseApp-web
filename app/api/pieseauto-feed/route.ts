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
  return String(value ?? "")
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildAnuntTitle(p: any) {
  return [
    cleanText(p.denumire),
    cleanText(p.masina),
    cleanText(p.cod_piesa),
  ]
    .filter(Boolean)
    .join(" ");
}

function buildAnuntDescription(p: any) {
  const chunks = [
    cleanText(p.denumire) ? `Denumire: ${cleanText(p.denumire)}` : "",
    cleanText(p.masina) ? `Masina: ${cleanText(p.masina)}` : "",
    cleanText(p.cod_piesa) ? `Cod piesa: ${cleanText(p.cod_piesa)}` : "",
    cleanText(p.compatibilitate) ? `Compatibilitate: ${cleanText(p.compatibilitate)}` : "",
    cleanText(p.observatii) ? `Observatii: ${cleanText(p.observatii)}` : "",
  ].filter(Boolean);

  chunks.push("Se oferă factură și garanție.");
  chunks.push("Retur în 14 zile.");

  return chunks.join(" | ");
}

function getPhotoUrls(p: any) {
  if (Array.isArray(p.poze)) return p.poze.filter(Boolean).join(" [,] ");
  if (Array.isArray(p.imagini)) return p.imagini.filter(Boolean).join(" [,] ");
  if (typeof p.poze === "string") return p.poze;
  if (typeof p.url === "string") return p.url;
  return "";
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
    .gt("cantitate", 0)
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
    csvEscape(buildAnuntTitle(p)),
    csvEscape(p.pieseauto_subcategory || p.pieseauto_main_category || p.categorie || ""),
    csvEscape(buildAnuntDescription(p)),
    csvEscape("RON"),
    csvEscape(p.pret),
    csvEscape(p.cantitate),
    csvEscape(getPhotoUrls(p)),
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
