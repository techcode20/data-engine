import os
import json
import requests
import pandas as pd

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


def ingest(source: str, pagination: str = "link") -> pd.DataFrame:
    if source.lower().startswith("http://") or source.lower().startswith("https://"):
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
        with open(source, "r") as f:
            raw = json.load(f)
        # Same as above: preserve native types from JSON.
        df = pd.json_normalize(raw)
    else:
        df = pd.read_csv(source, dtype=str)

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