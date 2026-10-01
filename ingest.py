import os
import ipaddress
import json
import socket
from urllib.parse import urlparse

import requests
import pandas as pd


def _ensure_public_url(url: str):
    """Refuse non-public hosts (loopback/link-local/private resale).

    Set DATA_ALLOW_PRIVATE_HOSTS=1 to bypass (tests, intranet demos).
    Unresolvable names pass through — the fetch itself will fail loudly.
    NOTE: resolve-then-fetch has a DNS-rebinding TOCTOU gap; this is a
    tripwire for accidents, not a boundary for hostile networks.
    """
    if os.getenv("DATA_ALLOW_PRIVATE_HOSTS") == "1":
        return
    host = urlparse(url).hostname or ""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        if not ip.is_global:
            raise ValueError(f"refusing non-public URL host {host} ({ip})")

def fetch_paginated_json(url: str, max_pages: int = 10, headers: dict = None) -> list:
    """Follow rel="next" links (the standard Link header pagination pattern) until there are no more pages or max_pages is hit."""
    all_data = []
    next_url = url
    page_count = 0

    while next_url and page_count < max_pages:
        response = requests.get(next_url, headers=headers, timeout=10)
        response.raise_for_status()
        page_data = response.json()

        if isinstance(page_data, dict) and "results" in page_data and isinstance(page_data["results"], list):
            all_data.extend(page_data["results"])
        elif isinstance(page_data, list):
            all_data.extend(page_data)
        else:
            all_data.append(page_data)

        page_count += 1
        next_url = response.links.get("next", {}).get("url")

    print(f"Fetched {page_count} page(s), {len(all_data)} total records")
    return all_data

def fetch_paginated_json_by_page_param(url: str, max_pages: int = 10, headers: dict = None) -> list:
    """For APIs with no Link header — increments a `page` query param until the response is empty."""
    all_data = []
    page = 1

    while page <= max_pages:
        separator = "&" if "?" in url else "?"
        page_url = f"{url}{separator}page={page}"
        response = requests.get(page_url, headers=headers, timeout=10)
        response.raise_for_status()
        payload = response.json()

        page_data = payload.get("results", payload) if isinstance(payload, dict) else payload

        if not page_data:
            break

        if isinstance(page_data, list):
            all_data.extend(page_data)
        else:
            all_data.append(page_data)
        page += 1

    print(f"Fetched {page - 1} page(s), {len(all_data)} total records")
    return all_data

def fetch_paginated_json_auto(url: str, max_pages: int = 10, headers: dict = None) -> list:
    """Try Link-header pagination first; if page 1 has no next link, fall back to page-param style."""
    response = requests.get(url, headers=headers, timeout=10)
    response.raise_for_status()
    first_page = response.json()
    first_data = first_page.get("results", first_page) if isinstance(first_page, dict) else first_page

    if response.links.get("next"):
        return fetch_paginated_json(url, max_pages=max_pages, headers=headers)

    # No Link header — try page-param style, but only if the first page suggests more exist
    # (heuristic: if the response body itself looks paginated, e.g. has "results"/"info")
    if isinstance(first_page, dict) and ("results" in first_page or "next" in first_page):
        return fetch_paginated_json_by_page_param(url, max_pages=max_pages, headers=headers)

    # Neither pattern detected — treat as a single-page response
    return first_data if isinstance(first_data, list) else [first_data]


import csv


def _check_size(source: str):
    """Refuse absurd inputs before they eat all RAM (override: DATA_MAX_BYTES)."""
    try:
        limit = int(float(os.getenv("DATA_MAX_BYTES", str(500 * 1024 * 1024))))
    except ValueError:
        limit = 500 * 1024 * 1024
    try:
        size = os.path.getsize(source)
    except OSError:
        return
    if size == 0:
        raise ValueError(f"{source} is empty — nothing to clean")
    if size > limit:
        raise ValueError(
            f"{source} is {size / 1024 / 1024:.0f} MB (limit {limit / 1024 / 1024:.0f} MB, "
            "override with DATA_MAX_BYTES) — refusing to load it whole into RAM"
        )


def _read_text_sample(source: str) -> tuple[str, str]:
    """First 32K decoded as UTF-8 (BOM-stripped), falling back to latin-1."""
    with open(source, "rb") as f:
        raw = f.read(32768)
    try:
        text = raw.decode("utf-8-sig")
        return text, "utf-8-sig"
    except UnicodeDecodeError:
        print(f"Note: {source} decoded as latin-1 (not UTF-8)")
        return raw.decode("latin-1"), "latin-1"


def _read_csv_smart(source: str) -> pd.DataFrame:
    _check_size(source)
    sample, encoding = _read_text_sample(source)
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=[",", ";", "\t", "|"])
        sep = dialect.delimiter
    except csv.Error:
        # Single-column files defeat the sniffer — accept only if the header
        # shows no sign of another delimiter, else refuse the silent 1-col parse.
        first_line = sample.splitlines()[0] if sample.splitlines() else ""
        if any(d in first_line for d in (";", "\t", "|")):
            raise ValueError(
                f"{source}: could not detect delimiter (looks delimited but "
                "sniffing failed) — refusing a silent single-column parse"
            ) from None
        sep = ","
    df = pd.read_csv(source, dtype=str, sep=sep, encoding=encoding)
    # pandas silently renames dup/blank headers (id.1, Unnamed: 0) — refuse instead.
    header = next(csv.reader(sample.splitlines(), delimiter=sep), [])
    if any(not h.strip() for h in header):
        raise ValueError(f"{source}: blank column name(s) in header")
    if len(set(header)) != len(header):
        raise ValueError(f"{source}: duplicate column name(s) in header")
    return df


def _read_json_smart(source: str) -> pd.DataFrame:
    _check_size(source)
    with open(source, "r", encoding="utf-8-sig") as f:
        text = f.read()
    if not text.strip():
        raise ValueError(f"{source} is empty — nothing to clean")
    try:
        raw = json.loads(text)
    except json.JSONDecodeError:
        try:
            raw = [json.loads(line) for line in text.splitlines() if line.strip()]
        except json.JSONDecodeError as e:
            raise ValueError(f"{source}: not JSON or JSON Lines: {e}") from e
        if not raw:
            raise ValueError(f"{source}: no JSON records found")
    try:
        df = pd.json_normalize(raw)
    except (NotImplementedError, TypeError, ValueError) as e:
        raise ValueError(
            f"{source}: expected a JSON object/array of objects, "
            f"got {type(raw).__name__} ({e})"
        ) from e
    if not isinstance(df, pd.DataFrame):
        raise ValueError(f"{source}: could not tabulate JSON ({type(raw).__name__})")
    return df


def ingest(source: str, pagination: str = "link") -> pd.DataFrame:
    if source.lower().startswith("http://") or source.lower().startswith("https://"):
        _ensure_public_url(source)
        api_key = os.getenv("DATA_API_KEY")
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else None
        if pagination == "page_param":
            raw = fetch_paginated_json_by_page_param(source, headers=headers)
        elif pagination == "link":
            raw = fetch_paginated_json(source, headers=headers)
        elif pagination == "auto":
            raw = fetch_paginated_json_auto(source, headers=headers)
        else:
            raise ValueError(f"Unknown pagination style: {pagination!r} (expected 'link', 'page_param', or 'auto')")
        # Keep native JSON types (int stays int, bool stays bool).
        # Do NOT astype(str) here — stringifying forces clean() to guess
        # types back and causes bool/int validation loops (see fix_log).
        df = pd.json_normalize(raw)
    elif source.lower().endswith(".json"):
        df = _read_json_smart(source)
    else:
        df = _read_csv_smart(source)

    print("--- RAW INGEST REPORT ---")
    print(f"Rows: {len(df)}")
    print(f"Columns: {list(df.columns)}")
    print("\nSample rows:")
    print(df.head())
    print("\nNull counts per column:")
    print(df.isnull().sum())
    return df


if __name__ == "__main__":
    ingest("https://jsonplaceholder.typicode.com/users")