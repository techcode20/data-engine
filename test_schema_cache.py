import json
import os

import schema_cache as sc


def _isolate_cache(tmp_path):
    sc.CACHE_PATH = str(tmp_path / "schema_cache.json")


def test_url_source_roundtrips_without_touching_filesystem(tmp_path):
    _isolate_cache(tmp_path)
    url = "https://api.example.com/users"
    assert sc.get_cached_schema(url, "rules") is None
    sc.set_cached_schema(url, "rules", {"ok": True})
    assert sc.get_cached_schema(url, "rules") == {"ok": True}


def test_missing_local_file_does_not_crash(tmp_path):
    _isolate_cache(tmp_path)
    missing = str(tmp_path / "nope.csv")
    assert sc.get_cached_schema(missing, "r") is None
    sc.set_cached_schema(missing, "r", {"x": 1})
    assert sc.get_cached_schema(missing, "r") == {"x": 1}


def test_corrupt_cache_recovers(tmp_path):
    _isolate_cache(tmp_path)
    with open(sc.CACHE_PATH, "w") as f:
        f.write("not json{{{")
    assert sc.get_cached_schema("whatever.csv", "r") is None
    sc.set_cached_schema("whatever.csv", "r", {"recovered": True})
    assert sc.get_cached_schema("whatever.csv", "r") == {"recovered": True}


def test_content_fingerprint_distinguishes_changed_urls(tmp_path):
    _isolate_cache(tmp_path)
    url = "https://api.example.com/users"
    sc.set_cached_schema(url, "r", {"v": 1}, content_fingerprint="aaa")
    # Same URL, different content -> miss (no stale schema reuse).
    assert sc.get_cached_schema(url, "r", content_fingerprint="bbb") is None
    assert sc.get_cached_schema(url, "r", content_fingerprint="aaa") == {"v": 1}


def test_fingerprint_does_not_collide_with_plain_key(tmp_path):
    _isolate_cache(tmp_path)
    url = "https://api.example.com/users"
    sc.set_cached_schema(url, "r", {"plain": True})
    assert sc.get_cached_schema(url, "r", content_fingerprint="zzz") is None
    # A miss must not write phantom entries.
    with open(sc.CACHE_PATH) as f:
        assert len(json.load(f)) == 1


def test_real_file_still_hashes_content(tmp_path):
    _isolate_cache(tmp_path)
    p = tmp_path / "data.csv"
    p.write_text("a,b\n1,2\n")
    assert sc.get_cached_schema(str(p), "r") is None
    sc.set_cached_schema(str(p), "r", {"cols": 2})
    assert sc.get_cached_schema(str(p), "r") == {"cols": 2}
    # Same path, changed content -> miss, forcing re-inference.
    p.write_text("a,b,c\n1,2,3\n")
    assert sc.get_cached_schema(str(p), "r") is None
    assert os.path.exists(sc.CACHE_PATH)
