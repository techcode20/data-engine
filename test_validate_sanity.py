import pandas as pd

from validate import sanity_checks


def _df(rows, cols=("a", "b")):
    return pd.DataFrame(rows, columns=list(cols))


def test_healthy_cleaning_passes():
    raw = _df([[1, "x"], [2, "y"], [3, "z"], [4, "w"]])
    cleaned = _df([[1, "x"], [2, "y"], [3, "z"]])
    assert sanity_checks(raw, cleaned) == []


def test_emptied_dataset_fails():
    raw = _df([[1, "x"], [2, "y"]])
    cleaned = _df([], cols=("a", "b")).astype({"a": "object", "b": "object"})
    issues = sanity_checks(raw, cleaned)
    assert any("emptied" in i for i in issues)


def test_mass_row_drop_fails_at_default_threshold():
    raw = _df([[i, "x"] for i in range(10)])
    cleaned = _df([[1, "x"]])  # 90% dropped > 75% default
    issues = sanity_checks(raw, cleaned)
    assert any("dropped 90%" in i for i in issues)


def test_drop_fraction_at_boundary_passes():
    raw = _df([[1, "x"], [2, "y"], [3, "z"], [4, "w"]])
    cleaned = _df([[1, "x"]])  # exactly 75% — limit is exclusive
    assert sanity_checks(raw, cleaned) == []


def test_custom_threshold_respected():
    raw = _df([[i, "x"] for i in range(10)])
    cleaned = _df([[1, "x"], [2, "y"]])  # 80% dropped
    assert sanity_checks(raw, cleaned, max_drop_fraction=0.9) == []
    assert sanity_checks(raw, cleaned, max_drop_fraction=0.5) != []


def test_newly_all_null_column_fails():
    raw = _df([[1, "x"], [2, "y"]])
    cleaned = pd.DataFrame({"a": [1, 2], "b": [None, None]})
    issues = sanity_checks(raw, cleaned)
    assert any("'b' is entirely null" in i for i in issues)


def test_previously_all_null_column_is_fine():
    raw = pd.DataFrame({"a": [1, 2], "b": [None, None]})
    cleaned = pd.DataFrame({"a": [1, 2], "b": [None, None]})
    assert sanity_checks(raw, cleaned) == []


def test_empty_raw_input_is_not_penalized():
    raw = _df([], cols=("a", "b"))
    cleaned = _df([], cols=("a", "b"))
    assert sanity_checks(raw, cleaned) == []
