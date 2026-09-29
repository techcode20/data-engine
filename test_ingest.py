import json
from ingest import ingest

def test_ingest_reads_csv(tmp_path):
    csv_path = tmp_path / "data.csv"
    csv_path.write_text("id,name\n1,Alice\n2,Bob\n")
    df = ingest(str(csv_path))
    assert list(df.columns) == ["id", "name"]
    assert len(df) == 2
    assert df["name"].tolist() == ["Alice", "Bob"]

def test_ingest_reads_flat_json(tmp_path):
    json_path = tmp_path / "data.json"
    json_path.write_text(json.dumps([{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]))
    df = ingest(str(json_path))
    assert len(df) == 2
    assert list(df.columns) == ["id", "name"]

def test_ingest_flattens_nested_json(tmp_path):
    json_path = tmp_path / "nested.json"
    json_path.write_text(json.dumps([
        {"id": 1, "contact": {"email": "a@example.com"}},
    ]))
    df = ingest(str(json_path))
    assert "contact.email" in df.columns  # confirms pd.json_normalize actually flattened it

def test_ingest_always_returns_a_dataframe_not_none(tmp_path):
    # This directly guards against the exact bug this project hit in Milestone 26 —
    # a code path that silently returns None instead of a DataFrame.
    csv_path = tmp_path / "data.csv"
    csv_path.write_text("id\n1\n")
    df = ingest(str(csv_path))
    assert df is not None


from unittest.mock import patch, MagicMock
from ingest import fetch_paginated_json, fetch_paginated_json_by_page_param

@patch("ingest.requests.get")
def test_fetch_paginated_json_single_page(mock_get):
    mock_response = MagicMock()
    mock_response.json.return_value = [{"id": 1}, {"id": 2}]
    mock_response.links = {}  # no "next" link — should stop after one page
    mock_response.raise_for_status = MagicMock()
    mock_get.return_value = mock_response

    result = fetch_paginated_json("https://fake-api.test/items")
    assert result == [{"id": 1}, {"id": 2}]
    assert mock_get.call_count == 1

@patch("ingest.requests.get")
def test_fetch_paginated_json_follows_next_link(mock_get):
    page1 = MagicMock()
    page1.json.return_value = [{"id": 1}]
    page1.links = {"next": {"url": "https://fake-api.test/items?page=2"}}
    page1.raise_for_status = MagicMock()

    page2 = MagicMock()
    page2.json.return_value = [{"id": 2}]
    page2.links = {}  # no next link — this is the last page
    page2.raise_for_status = MagicMock()

    mock_get.side_effect = [page1, page2]  # first call returns page1, second call returns page2

    result = fetch_paginated_json("https://fake-api.test/items")
    assert result == [{"id": 1}, {"id": 2}]
    assert mock_get.call_count == 2

@patch("ingest.requests.get")
def test_fetch_paginated_json_by_page_param_stops_on_empty_page(mock_get):
    page1 = MagicMock()
    page1.json.return_value = {"results": [{"id": 1}]}
    page1.raise_for_status = MagicMock()

    page2 = MagicMock()
    page2.json.return_value = {"results": []}  # empty — should stop here
    page2.raise_for_status = MagicMock()

    mock_get.side_effect = [page1, page2]

    result = fetch_paginated_json_by_page_param("https://fake-api.test/items")
    assert result == [{"id": 1}]
    assert mock_get.call_count == 2