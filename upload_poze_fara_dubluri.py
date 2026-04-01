import mimetypes
from pathlib import Path
import requests

SUPABASE_URL = 'https://zhfupadxugstzovdyvcu.supabase.co'
SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoZnVwYWR4dWdzdHpvdmR5dmN1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDkwMTcxNSwiZXhwIjoyMDkwNDc3NzE1fQ.2VzU1pk-DgjB-BiLREzw3UZCbtXgBgrMi8LTdFGntF4'
BUCKET = 'piese-poze'
IMAGES_DIR = r'D:\PieseApp\imagini_piese'
ONLY_MISSING_IMAGES = True
ALLOWED_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.webp'}

headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': f'Bearer {SUPABASE_SERVICE_ROLE_KEY}',
}

rest_headers = {
    **headers,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
}


def list_piese():
    all_rows = []
    start = 0
    step = 1000

    while True:
        resp = requests.get(
            f'{SUPABASE_URL}/rest/v1/piese',
            headers={**headers, 'Range': f'{start}-{start + step - 1}'},
            params={'select': 'id,cdp,poze'},
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


def existing_storage_paths(poze):
    result = set()
    for url in poze or []:
        if '/storage/v1/object/public/' not in url:
            continue
        path = url.split('/storage/v1/object/public/', 1)[1]
        prefix = f'{BUCKET}/'
        if path.startswith(prefix):
            result.add(path[len(prefix):].lower())
    return result


def public_url(storage_path: str) -> str:
    return f'{SUPABASE_URL}/storage/v1/object/public/{BUCKET}/{storage_path}'


def find_local_images(cdp: str):
    base = cdp.lower()
    folder = Path(IMAGES_DIR)
    matches = []

    if not folder.exists():
        raise FileNotFoundError(f'Folderul nu există: {IMAGES_DIR}')

    for p in folder.iterdir():
        if not p.is_file():
            continue
        if p.suffix.lower() not in ALLOWED_EXTENSIONS:
            continue
        if base in p.stem.lower():
            matches.append(p)

    def sort_key(path: Path):
        name = path.stem.lower()
        return (0 if name == base else 1, name)

    matches.sort(key=sort_key)
    return matches


def upload_file(local_path: Path, storage_path: str):
    mime = mimetypes.guess_type(str(local_path))[0] or 'application/octet-stream'
    with open(local_path, 'rb') as f:
        resp = requests.post(
            f'{SUPABASE_URL}/storage/v1/object/{BUCKET}/{storage_path}',
            headers={
                **headers,
                'Content-Type': mime,
                'x-upsert': 'false',
            },
            data=f.read(),
            timeout=300,
        )
    if resp.status_code not in (200, 201):
        raise RuntimeError(f'Upload eșuat pentru {local_path.name}: {resp.status_code} {resp.text[:500]}')


def update_row(row_id: str, urls):
    resp = requests.patch(
        f'{SUPABASE_URL}/rest/v1/piese',
        headers=rest_headers,
        params={'id': f'eq.{row_id}'},
        json={'poze': urls},
        timeout=60,
    )
    resp.raise_for_status()


def main():
    rows = list_piese()
    print(f'Piese găsite: {len(rows)}')

    updated = 0
    skipped = 0

    for row in rows:
        row_id = row['id']
        cdp = (row.get('cdp') or '').strip()
        poze_existente = row.get('poze') or []

        if not cdp:
            skipped += 1
            print(f'[SKIP] fără CDP: {row_id}')
            continue

        if ONLY_MISSING_IMAGES and poze_existente:
            skipped += 1
            print(f'[SKIP] {cdp} are deja poze')
            continue

        local_images = find_local_images(cdp)
        if not local_images:
            skipped += 1
            print(f'[SKIP] {cdp} fără poze locale')
            continue

        existing_paths = existing_storage_paths(poze_existente)
        final_urls = list(poze_existente)

        for idx, img in enumerate(local_images, start=1):
            ext = img.suffix.lower()
            storage_path = f'{cdp}/{cdp}-{idx}{ext}'
            url = public_url(storage_path)

            if storage_path.lower() in existing_paths or url in final_urls:
                if url not in final_urls:
                    final_urls.append(url)
                print(f'[EXISTĂ] {storage_path}')
                continue

            try:
                upload_file(img, storage_path)
                final_urls.append(url)
                print(f'[UPLOAD] {storage_path}')
            except Exception as exc:
                print(f'[EROARE] {cdp} / {img.name}: {exc}')

        final_urls = list(dict.fromkeys(final_urls))

        if final_urls != poze_existente:
            update_row(row_id, final_urls)
            updated += 1
            print(f'[UPDATE] {cdp} -> {len(final_urls)} poze')
        else:
            skipped += 1
            print(f'[SKIP] {cdp} fără schimbări')

    print('')
    print(f'Gata. Updated: {updated}, Skipped: {skipped}')


if __name__ == '__main__':
    main()
