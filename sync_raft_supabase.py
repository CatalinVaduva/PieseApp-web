import sqlite3
import requests

SQLITE_DB = r'C:\Users\x\pieseapp-web\stoc_piese.db'
SUPABASE_URL = 'https://zhfupadxugstzovdyvcu.supabase.co'
SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoZnVwYWR4dWdzdHpvdmR5dmN1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkwMTcxNSwiZXhwIjoyMDkwNDc3NzE1fQ.2VzU1pk-DgjB-BiLREzw3UZCbtXgBgrMi8LTdFGntF4'

headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
}


def detect_table_and_columns(conn):
    cur = conn.cursor()
    candidates = []

    for (table_name,) in cur.execute("SELECT name FROM sqlite_master WHERE type='table'"):
        try:
            cols = [row[1] for row in cur.execute(f'PRAGMA table_info({table_name})').fetchall()]
            lower = {c.lower(): c for c in cols}
            if 'cdp' in lower:
                candidates.append((table_name, cols))
        except Exception:
            pass

    if not candidates:
        raise RuntimeError('Nu am găsit tabel cu coloană CDP în SQLite.')

    preferred = ['raft', 'locatie_raft', 'locație_raft', 'raft_locatie', 'locatie raft', 'locație raft']

    for table_name, cols in candidates:
        lower_map = {c.lower(): c for c in cols}
        for name in preferred:
            if name in lower_map:
                return table_name, lower_map['cdp'], lower_map[name]

    table_name, cols = candidates[0]
    possible = [c for c in cols if 'raft' in c.lower()]
    if not possible:
        raise RuntimeError(f'Am găsit tabelul {table_name}, dar nu am găsit coloană de raft. Coloane: {cols}')
    lower_map = {c.lower(): c for c in cols}
    return table_name, lower_map['cdp'], possible[0]


def fetch_sqlite_raft_map():
    conn = sqlite3.connect(SQLITE_DB)
    table_name, cdp_col, raft_col = detect_table_and_columns(conn)
    print(f'Tabel detectat: {table_name} | coloane: {cdp_col}, {raft_col}')

    cur = conn.cursor()
    rows = cur.execute(
        f'SELECT {cdp_col}, {raft_col} FROM {table_name} WHERE {cdp_col} IS NOT NULL'
    ).fetchall()
    conn.close()

    result = {}
    for cdp, raft in rows:
        cdp = str(cdp).strip()
        raft_value = '' if raft is None else str(raft).strip()
        if cdp:
            result[cdp] = raft_value
    return result


def fetch_supabase_piese():
    all_rows = []
    start = 0
    step = 1000

    while True:
        resp = requests.get(
            f'{SUPABASE_URL}/rest/v1/piese',
            headers={
                'apikey': SUPABASE_SERVICE_ROLE_KEY,
                'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
                'Range': f'{start}-{start + step - 1}',
            },
            params={'select': 'id,cdp,raft'},
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


def update_raft(row_id: str, raft_value: str):
    resp = requests.patch(
        f'{SUPABASE_URL}/rest/v1/piese',
        headers=headers,
        params={'id': f'eq.{row_id}'},
        json={'raft': raft_value or None},
        timeout=60,
    )
    resp.raise_for_status()


def main():
    sqlite_map = fetch_sqlite_raft_map()
    supabase_rows = fetch_supabase_piese()

    updated = 0
    skipped = 0

    for row in supabase_rows:
        cdp = str(row.get('cdp') or '').strip()
        current_raft = '' if row.get('raft') is None else str(row.get('raft')).strip()

        if not cdp or cdp not in sqlite_map:
            skipped += 1
            continue

        new_raft = sqlite_map[cdp]
        if current_raft == new_raft:
            skipped += 1
            continue

        update_raft(row['id'], new_raft)
        updated += 1
        print(f"[UPDATE] {cdp}: '{current_raft}' -> '{new_raft}'")

    print('')
    print(f'Gata. Updated: {updated}, Skipped: {skipped}')


if __name__ == '__main__':
    main()
