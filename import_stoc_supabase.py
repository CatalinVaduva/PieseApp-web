import os
import re
import json
import glob
import sqlite3
import mimetypes
from pathlib import Path
from typing import List, Dict, Any, Optional

import requests

# =========================
# CONFIG - COMPLETEAZA ASTA
# =========================
SUPABASE_URL = os.getenv('SUPABASE_URL', 'https://zhfupadxugstzovdyvcu.supabase.co').rstrip('/')
SUPABASE_SERVICE_ROLE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoZnVwYWR4dWdzdHpvdmR5dmN1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkwMTcxNSwiZXhwIjoyMDkwNDc3NzE1fQ.2VzU1pk-DgjB-BiLREzw3UZCbtXgBgrMi8LTdFGntF4')

SQLITE_DB_PATH = os.getenv('SQLITE_DB_PATH', r'D:\PieseApp\stoc_piese.db')
LOCAL_IMAGES_DIR = os.getenv('LOCAL_IMAGES_DIR', r'D:\PieseApp\imagini_piese')

TABLE_NAME = 'piese'
BUCKET_NAME = 'piese-poze'

IMPORT_IMAGES = os.getenv('IMPORT_IMAGES', '0') == '1'   # 0 = doar stoc, 1 = si poze
ONLY_MISSING_IMAGES = os.getenv('ONLY_MISSING_IMAGES', '0') == '1'  # 1 = doar completeaza poze lipsa
LIMIT = int(os.getenv('LIMIT', '0'))  # 0 = toate
TIMEOUT = 60

# =========================
# UTILS
# =========================

def headers_json() -> Dict[str, str]:
    return {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
        'Content-Type': 'application/json',
    }


def headers_binary(content_type: str) -> Dict[str, str]:
    return {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
        'Content-Type': content_type,
        'x-upsert': 'true',
    }


def clean_text(value: Any) -> str:
    if value is None:
        return ''
    return str(value).strip()


def clean_number(value: Any, default: float = 0) -> float:
    if value in (None, ''):
        return default
    try:
        return float(value)
    except Exception:
        return default


def clean_int(value: Any, default: int = 0) -> int:
    if value in (None, ''):
        return default
    try:
        return int(float(value))
    except Exception:
        return default


def slugify_filename(name: str) -> str:
    name = re.sub(r'[^A-Za-z0-9._ -]+', '_', name)
    name = name.replace(' ', '_')
    return name


def public_storage_url(object_path: str) -> str:
    return f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET_NAME}/{object_path}"


def resolve_image_candidates(cdp: str, imagini_json: str, imagine: Optional[str]) -> List[str]:
    found: List[str] = []

    def add_if_exists(p: str):
        if p and os.path.exists(p) and p not in found:
            found.append(p)

    # 1) din imagini_json
    try:
        arr = json.loads(imagini_json or '[]')
        if isinstance(arr, list):
            for item in arr:
                if isinstance(item, str):
                    add_if_exists(item)
    except Exception:
        pass

    # 2) din coloana imagine
    if imagine:
        add_if_exists(imagine)

    # 3) fallback dupa CDP in folderul mare local
    base_patterns = [
        os.path.join(LOCAL_IMAGES_DIR, f'{cdp}.*'),
        os.path.join(LOCAL_IMAGES_DIR, f'{cdp} -*.*'),
        os.path.join(LOCAL_IMAGES_DIR, f'{cdp}_*.*'),
        os.path.join(LOCAL_IMAGES_DIR, f'{cdp.lower()}*.*'),
        os.path.join(LOCAL_IMAGES_DIR, f'{cdp.upper()}*.*'),
    ]
    for pattern in base_patterns:
        for match in sorted(glob.glob(pattern)):
            add_if_exists(match)

    # pastram doar imagini
    valid_ext = {'.jpg', '.jpeg', '.png', '.webp', '.bmp'}
    found = [p for p in found if Path(p).suffix.lower() in valid_ext]
    return found


def build_descriere(row: sqlite3.Row) -> str:
    observatii = clean_text(row['observatii'])
    parts = [
        clean_text(row['denumire']),
        f"Cod piesă: {clean_text(row['cod_piesa']) or '-'}",
        f"Mașină: {clean_text(row['masina']) or '-'}",
        f"Compatibilitate: {clean_text(row['compatibilitate']) or '-'}",
        '',
        f"CDP: {clean_text(row['cod_cdp'])}",
    ]
    if observatii:
        parts += ['', observatii]
    return '\n'.join(parts).strip()


def build_payload(row: sqlite3.Row, poze_urls: Optional[List[str]] = None) -> Dict[str, Any]:
    return {
        'cdp': clean_text(row['cod_cdp']),
        'cod_piesa': clean_text(row['cod_piesa']) or None,
        'denumire': clean_text(row['denumire']) or 'Piesă',
        'masina': clean_text(row['masina']) or None,
        'compatibilitate': clean_text(row['compatibilitate']) or None,
        'categorie': clean_text(row['categorie']) or None,
        'pret': clean_number(row['pret_vanzare'], 0),
        'cantitate': clean_int(row['cantitate'], 1),
        'descriere': build_descriere(row),
        'draft': bool(clean_int(row['is_draft'], 0)),
        'poze': poze_urls if poze_urls is not None else [],
    }


def fetch_existing_map() -> Dict[str, int]:
    url = f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}?select=id,cdp&limit=10000"
    resp = requests.get(url, headers=headers_json(), timeout=TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    result = {}
    for row in data:
        cdp = row.get('cdp')
        rid = row.get('id')
        if cdp and rid:
            result[str(cdp)] = int(rid)
    return result


def upload_image(local_path: str, cdp: str) -> str:
    filename = slugify_filename(os.path.basename(local_path))
    object_path = f"import/{cdp}/{filename}"
    mime = mimetypes.guess_type(local_path)[0] or 'application/octet-stream'
    url = f"{SUPABASE_URL}/storage/v1/object/{BUCKET_NAME}/{object_path}"
    with open(local_path, 'rb') as f:
        resp = requests.post(url, headers=headers_binary(mime), data=f, timeout=TIMEOUT)
    # 200/201 ok, 409 can happen on old APIs if already exists
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"Upload failed {resp.status_code}: {resp.text[:300]}")
    return public_storage_url(object_path)


def create_row(payload: Dict[str, Any]) -> int:
    url = f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}"
    headers = headers_json()
    headers['Prefer'] = 'return=representation'
    resp = requests.post(url, headers=headers, data=json.dumps(payload), timeout=TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    if not data:
        raise RuntimeError('Insert fără răspuns')
    return int(data[0]['id'])


def update_row(row_id: int, payload: Dict[str, Any]) -> None:
    url = f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}?id=eq.{row_id}"
    headers = headers_json()
    headers['Prefer'] = 'return=minimal'
    resp = requests.patch(url, headers=headers, data=json.dumps(payload), timeout=TIMEOUT)
    resp.raise_for_status()


def main():
    print('=== IMPORT STOC -> SUPABASE ===')
    print('DB:', SQLITE_DB_PATH)
    print('IMAGES:', LOCAL_IMAGES_DIR)
    print('IMPORT_IMAGES:', IMPORT_IMAGES)
    print('ONLY_MISSING_IMAGES:', ONLY_MISSING_IMAGES)
    print()

    if 'YOUR_PROJECT.supabase.co' in SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY == 'YOUR_SERVICE_ROLE_KEY':
        raise SystemExit('Completează SUPABASE_URL și SUPABASE_SERVICE_ROLE_KEY înainte să rulezi scriptul.')

    conn = sqlite3.connect(SQLITE_DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    rows = cur.execute('SELECT * FROM piese ORDER BY id ASC').fetchall()
    if LIMIT > 0:
        rows = rows[:LIMIT]

    existing = fetch_existing_map()
    print(f'Piese deja în Supabase: {len(existing)}')
    print(f'Piese găsite în SQLite: {len(rows)}')
    print()

    created = 0
    updated = 0
    uploaded_images = 0
    skipped_images = 0
    errors = 0

    for idx, row in enumerate(rows, start=1):
        cdp = clean_text(row['cod_cdp'])
        if not cdp:
            print(f'[{idx}] SKIP fără CDP')
            continue

        try:
            existing_id = existing.get(cdp)

            current_public_urls: List[str] = []
            if IMPORT_IMAGES:
                local_images = resolve_image_candidates(cdp, row['imagini_json'], row['imagine'])
                for local_path in local_images:
                    try:
                        url = upload_image(local_path, cdp)
                        current_public_urls.append(url)
                        uploaded_images += 1
                    except Exception as ex:
                        print(f'   ! poză eșuată {local_path}: {ex}')
                        skipped_images += 1

            payload = build_payload(row, poze_urls=current_public_urls if IMPORT_IMAGES else None)

            if existing_id:
                if ONLY_MISSING_IMAGES:
                    # Citește piesa actuală ca să păstrezi pozele deja existente și să completezi doar lipsurile
                    get_url = f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}?select=poze&id=eq.{existing_id}&limit=1"
                    resp = requests.get(get_url, headers=headers_json(), timeout=TIMEOUT)
                    resp.raise_for_status()
                    current = resp.json()[0] if resp.json() else {}
                    existing_poze = current.get('poze') or []
                    merged = list(dict.fromkeys([*existing_poze, *(payload.get('poze') or [])]))
                    payload['poze'] = merged
                elif IMPORT_IMAGES is False:
                    payload.pop('poze', None)

                update_row(existing_id, payload)
                updated += 1
                print(f'[{idx}] UPDATE {cdp}')
            else:
                new_id = create_row(payload)
                existing[cdp] = new_id
                created += 1
                print(f'[{idx}] CREATE {cdp}')

        except Exception as ex:
            errors += 1
            print(f'[{idx}] ERROR {cdp}: {ex}')

    print('\n=== REZUMAT ===')
    print('Create:', created)
    print('Update:', updated)
    print('Poze urcate:', uploaded_images)
    print('Poze sărite/erori:', skipped_images)
    print('Erori:', errors)


if __name__ == '__main__':
    main()
