import mimetypes
import re
from pathlib import Path
from typing import Dict, List

import requests

SUPABASE_URL = 'https://zhfupadxugstzovdyvcu.supabase.co'
SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoZnVwYWR4dWdzdHpvdmR5dmN1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkwMTcxNSwiZXhwIjoyMDkwNDc3NzE1fQ.2VzU1pk-DgjB-BiLREzw3UZCbtXgBgrMi8LTdFGntF4'
BUCKET = 'piese-poze'
IMAGES_DIR = r'D:\PieseApp\imagini_piese'

# True = completează doar piesele fără poze în coloana `poze`
# False = reface lista de poze pentru toate piesele găsite
ONLY_MISSING_IMAGES = True

# câte piese citește din Supabase
LIMIT = 10000

ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.jfif'}

session = requests.Session()
session.headers.update({
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
})

rest_base = f'{SUPABASE_URL}/rest/v1'
storage_base = f'{SUPABASE_URL}/storage/v1'


def get_piese() -> List[Dict]:
    response = session.get(
        f'{rest_base}/piese',
        params={
            'select': 'id,cdp,poze',
            'order': 'cdp.asc',
            'limit': str(LIMIT),
        },
        timeout=60,
    )
    response.raise_for_status()
    return response.json()


def list_candidate_files(images_dir: Path, cdp: str) -> List[Path]:
    exact_matches: List[Path] = []
    contains_matches: List[Path] = []

    cdp_lower = cdp.lower().strip()

    for path in images_dir.iterdir():
        if not path.is_file():
            continue
        if path.suffix.lower() not in ALLOWED_EXTENSIONS:
            continue

        stem_lower = path.stem.lower()
        name_lower = path.name.lower()

        if stem_lower == cdp_lower:
            exact_matches.append(path)
            continue

        if re.fullmatch(rf'{re.escape(cdp_lower)}([ _-]?\d+)?', stem_lower):
            exact_matches.append(path)
            continue

        if cdp_lower in name_lower:
            contains_matches.append(path)

    def sort_key(path: Path):
        numbers = re.findall(r'(\d+)', path.stem)
        last_number = int(numbers[-1]) if numbers else 0
        return (last_number, path.name.lower())

    exact_matches.sort(key=sort_key)
    contains_matches.sort(key=sort_key)

    result: List[Path] = []
    seen = set()
    for path in exact_matches + contains_matches:
        key = str(path).lower()
        if key not in seen:
            seen.add(key)
            result.append(path)

    return result


def get_public_url(storage_path: str) -> str:
    return f'{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{storage_path}'


def upload_file(file_path: Path, storage_path: str) -> str:
    content_type = mimetypes.guess_type(file_path.name)[0] or 'application/octet-stream'
    headers = {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
        'x-upsert': 'true',
        'Content-Type': content_type,
    }

    with file_path.open('rb') as file_handle:
        response = requests.post(
            f'{storage_base}/object/{BUCKET}/{storage_path}',
            headers=headers,
            data=file_handle,
            timeout=300,
        )

    response.raise_for_status()
    return get_public_url(storage_path)


def update_poze(row_id: str, poze: List[str]) -> None:
    response = session.patch(
        f'{rest_base}/piese',
        params={'id': f'eq.{row_id}'},
        headers={
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
        },
        json={'poze': poze},
        timeout=60,
    )
    response.raise_for_status()


def main():
    images_dir = Path(IMAGES_DIR)
    if not images_dir.exists():
        raise SystemExit(f'Folderul nu există: {images_dir}')

    piese = get_piese()
    total = len(piese)

    print(f'Piese găsite în Supabase: {total}')

    actualizate = 0
    sarite = 0
    fara_poze = 0

    for index, piesa in enumerate(piese, start=1):
        row_id = str(piesa['id'])
        cdp = (piesa.get('cdp') or '').strip()
        existing_urls = piesa.get('poze') or []

        if not cdp:
            print(f'[{index}/{total}] SKIP fără CDP')
            sarite += 1
            continue

        if ONLY_MISSING_IMAGES and existing_urls:
            print(f'[{index}/{total}] SKIP {cdp} - are deja {len(existing_urls)} poze')
            sarite += 1
            continue

        files = list_candidate_files(images_dir, cdp)
        if not files:
            print(f'[{index}/{total}] FĂRĂ POZE {cdp}')
            fara_poze += 1
            continue

        urls: List[str] = []
        print(f'[{index}/{total}] {cdp} -> {len(files)} fișiere')

        for position, file_path in enumerate(files, start=1):
            safe_name = file_path.name.replace(' ', '_')
            storage_path = f'{cdp}/{position:02d}_{safe_name}'
            public_url = upload_file(file_path, storage_path)
            urls.append(public_url)

        update_poze(row_id, urls)
        actualizate += 1
        print(f'    OK {cdp}: {len(urls)} poze salvate')

    print('\n=== GATA ===')
    print(f'Actualizate: {actualizate}')
    print(f'Sărite:      {sarite}')
    print(f'Fără poze:   {fara_poze}')


if __name__ == '__main__':
    main()
