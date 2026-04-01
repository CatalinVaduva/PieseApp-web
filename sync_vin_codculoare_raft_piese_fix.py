import sqlite3
import requests

SQLITE_DB = r"C:\Users\x\pieseapp-web\stoc_piese.db"
SUPABASE_URL = "https://zhfupadxugstzovdyvcu.supabase.co"
SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoZnVwYWR4dWdzdHpvdmR5dmN1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkwMTcxNSwiZXhwIjoyMDkwNDc3NzE1fQ.2VzU1pk-DgjB-BiLREzw3UZCbtXgBgrMi8LTdFGntF4"

SQLITE_TABLE = "piese"
SQLITE_CDP_COL = "cod_cdp"
SQLITE_RAFT_COL = "locatie_raft"
SQLITE_VIN_COL = "vin"
SQLITE_CULOARE_COL = "cod_culoare"

AUTH_HEADERS = {
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
}


def fetch_sqlite_map():
    conn = sqlite3.connect(SQLITE_DB)
    cur = conn.cursor()

    try:
        rows = cur.execute(
            f"""
            SELECT {SQLITE_CDP_COL}, {SQLITE_RAFT_COL}, {SQLITE_VIN_COL}, {SQLITE_CULOARE_COL}
            FROM {SQLITE_TABLE}
            WHERE {SQLITE_CDP_COL} IS NOT NULL
            """
        ).fetchall()
    except sqlite3.OperationalError as exc:
        print("Eroare SQLite:", exc)
        print("")
        print("Tabele existente în baza ta:")
        tables = cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
        for t in tables:
            print("-", t[0])
        conn.close()
        raise

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


def norm(value):
    return "" if value is None else str(value).strip()


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
