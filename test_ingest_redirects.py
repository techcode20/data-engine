"""Redirect + auth-host boundary (fetch layer must re-validate every hop)."""
from unittest.mock import patch

import pytest

from ingest import fetch_paginated_json


def _resp(status=200, payload=None, links=None, location=""):
    from unittest.mock import MagicMock
    r = MagicMock()
    r.status_code = status
    r.headers = {"location": location} if location else {}
    r.links = links or {}
    r.raise_for_status = MagicMock()
    r.json = MagicMock(return_value=payload)
    return r


def test_redirect_to_private_host_is_refused():
    redir = _resp(status=302, location="http://127.0.0.1:9000/steal")
    with patch("ingest.requests.get", return_value=redir) as mock_get:
        with pytest.raises(ValueError, match="non-public"):
            fetch_paginated_json("https://api.test/items", auth_host="api.test")
    assert mock_get.call_count == 1  # refused before any second request


def test_auth_stripped_on_cross_host_redirect():
    seen = []

    def fake_get(url, headers=None, **kw):
        seen.append((url, dict(headers or {})))
        if url == "https://api.test/a":
            return _resp(status=302, location="https://other.test/b")
        return _resp(payload=[{"id": 1}])

    with patch("ingest.requests.get", side_effect=fake_get):
        out = fetch_paginated_json(
            "https://api.test/a",
            headers={"Authorization": "Bearer SECRET"},
            auth_host="api.test",
        )
    assert out == [{"id": 1}]
    assert seen[0][1].get("Authorization") == "Bearer SECRET"
    assert "Authorization" not in seen[1][1]


def test_auth_kept_on_same_host_redirect():
    seen = []

    def fake_get(url, headers=None, **kw):
        seen.append((url, dict(headers or {})))
        if url == "https://api.test/a":
            return _resp(status=302, location="https://api.test/b")
        return _resp(payload=[{"id": 2}])

    with patch("ingest.requests.get", side_effect=fake_get):
        out = fetch_paginated_json(
            "https://api.test/a",
            headers={"Authorization": "Bearer SECRET"},
            auth_host="api.test",
        )
    assert out == [{"id": 2}]
    assert all(h.get("Authorization") == "Bearer SECRET" for _, h in seen)


def test_pagination_next_url_to_private_host_is_refused():
    page1 = _resp(payload=[{"id": 1}],
                 links={"next": {"url": "http://127.0.0.1:9000/items?page=2"}})
    with patch("ingest.requests.get", return_value=page1):
        with pytest.raises(ValueError, match="non-public"):
            fetch_paginated_json("https://api.test/items", auth_host="api.test")


def test_redirect_loop_hits_the_cap():
    loop = _resp(status=302, location="https://api.test/round")
    with patch("ingest.requests.get", return_value=loop):
        with pytest.raises(ValueError, match="too many redirects"):
            fetch_paginated_json("https://api.test/round", auth_host="api.test")
