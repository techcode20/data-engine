import json

import code_cache as cc


def _isolate(monkeypatch, tmp_path):
    monkeypatch.setattr(cc, "CODE_CACHE_PATH", str(tmp_path / "code_cache.json"))


def test_miss_returns_none(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    assert cc.get_cached_code('{"a": 1}', "rules") is None


def test_roundtrip(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    cc.set_cached_code('{"a": 1}', "rules", "def clean(df):\n    return df")
    assert cc.get_cached_code('{"a": 1}', "rules") == "def clean(df):\n    return df"


def test_rules_distinguish_entries(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    cc.set_cached_code('{"a": 1}', "rules one", "code-1")
    assert cc.get_cached_code('{"a": 1}', "rules two") is None
    assert cc.get_cached_code('{"a": 1}', "rules one") == "code-1"


def test_schema_text_distinguishes_entries(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    cc.set_cached_code('{"a": 1}', "r", "code-1")
    assert cc.get_cached_code('{"a": 2}', "r") is None


def test_corrupt_cache_recovers(monkeypatch, tmp_path):
    _isolate(monkeypatch, tmp_path)
    with open(cc.CODE_CACHE_PATH, "w") as f:
        f.write("garbage{{{")
    assert cc.get_cached_code('{"a": 1}', "r") is None
    cc.set_cached_code('{"a": 1}', "r", "code")
    assert cc.get_cached_code('{"a": 1}', "r") == "code"
    with open(cc.CODE_CACHE_PATH) as f:
        assert isinstance(json.load(f), dict)
