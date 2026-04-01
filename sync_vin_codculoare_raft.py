import sqlite3
import requests

SQLITE_DB = r"C:\Users\x\pieseapp-web\stoc_piese.db"
SUPABASE_URL = "PASTE_SUPABASE_URL_HERE"
SUPABASE_SERVICE_ROLE_KEY = "PASTE_SERVICE_ROLE_KEY_HERE"

AUTH_HEADERS = {
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
}


def fetch_sqlite_map():
    conn = sqlite3.connect(SQLITE_DB)
    cur = conn.cursor()
    rows = cur.execute("""
        SELECT cod_cdp, locatie_raft, vin, cod_culoare
        FROM piese
        WHERE cod_cdp IS NOT NULL
    """).fetchall()
    conn.close()

    result = {}
    for cdp, raft, vin, cod_culoare in rows:
        cdp = str(cdp).strip() if cdp is not None else ""
        if not cdp:
            continue
        result[cdp] = {
            "raft": str(raft).strip() if raft is not None else "",
            "vin": str(vin).strip() if vin is not None else "",
            "cod_culoare": str(cod_culoare).strip() if cod_culoare is not None else "",
        }
    return result


def fetch_supabase_rows():
    all_rows = []
    start = 0
    step = 1000

    while True:
        resp = requests.get(
            f"{SUPABASE_URL}/rest/v1/piese",
            headers={**AUTH_HEADERS, "Range": f"{start}-{start + step - 1}"},
            params={"select": "id,cdp,raft,vin,cod_culoare"},
            timeout=60,
        )
        resp.raise_for_status()
        rows = resp.json()
        if not rows:
            break
        all_rows.extend(rows)
        if len(rows) < step:
            break
        start += step

    return all_rows


def norm(v):
    return "" if v is None else str(v).strip()


def patch_row(row_id: str, payload: dict):
    resp = requests.patch(
        f"{SUPABASE_URL}/rest/v1/piese",
        headers={
            **AUTH_HEADERS,
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        params={"id": f"eq.{row_id}"},
        json=payload,
        timeout=60,
    )
    resp.raise_for_status()


def main():
    sqlite_map = fetch_sqlite_map()
    supabase_rows = fetch_supabase_rows()

    updated = 0
    skipped = 0

    for row in supabase_rows:
        cdp = norm(row.get("cdp"))
        if not cdp or cdp not in sqlite_map:
            skipped += 1
            continue

        source = sqlite_map[cdp]
        payload = {}

        if norm(row.get("raft")) != source["raft"]:
            payload["raft"] = source["raft"] or None
        if norm(row.get("vin")) != source["vin"]:
            payload["vin"] = source["vin"] or None
        if norm(row.get("cod_culoare")) != source["cod_culoare"]:
            payload["cod_culoare"] = source["cod_culoare"] or None

        if not payload:
            skipped += 1
            continue

        patch_row(row["id"], payload)
        print(f"[UPDATE] {cdp}: {payload}")
        updated += 1

    print("")
    print(f"Gata. Updated: {updated}, Skipped: {skipped}")


if __name__ == "__main__":
    main()
