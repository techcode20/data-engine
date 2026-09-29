import pandas as pd

from pre_clean import format_report, pre_clean


def test_strips_whitespace_and_reports_counts():
    df = pd.DataFrame({"a": ["  x ", "y"], "n": [1, 2]})
    out, report = pre_clean(df)
    assert out["a"].tolist() == ["x", "y"]
    assert report["cells_stripped"] == 1
    assert out["n"].tolist() == [1, 2]  # non-string column untouched


def test_empty_and_blank_strings_become_nan():
    df = pd.DataFrame({"a": ["", "   ", "z"], "b": [1, 2, 3]})
    out, report = pre_clean(df)
    assert out["a"].isnull().sum() == 2
    assert report["empties_to_nan"] == 2


def test_wholly_empty_rows_dropped_by_default():
    df = pd.DataFrame({"a": ["x", None], "b": ["y", None]})
    out, report = pre_clean(df)
    assert len(out) == 1
    assert report["rows_dropped"] == 1


def test_empty_row_drop_can_be_disabled():
    df = pd.DataFrame({"a": ["x", None]})
    out, report = pre_clean(df, drop_empty_rows=False)
    assert len(out) == 2
    assert report["rows_dropped"] == 0


def test_non_string_objects_survive():
    df = pd.DataFrame({"eps": [["a", "b"], ["c"]], "name": [" x ", "y"]})
    out, _ = pre_clean(df)
    assert out["eps"].tolist() == [["a", "b"], ["c"]]
    assert out["name"].tolist() == ["x", "y"]


def test_native_dtypes_untouched():
    df = pd.DataFrame({"i": [1, 2], "f": [1.5, 2.5], "b": [True, False]})
    out, report = pre_clean(df)
    assert str(out["i"].dtype) == "int64"
    assert str(out["b"].dtype) == "bool"
    assert report == {"cells_stripped": 0, "empties_to_nan": 0, "rows_dropped": 0}


def test_does_not_mutate_input():
    df = pd.DataFrame({"a": ["  x "]})
    pre_clean(df)
    assert df["a"].tolist() == ["  x "]


def test_format_report():
    assert format_report({"cells_stripped": 0, "empties_to_nan": 0, "rows_dropped": 0}) == "already tidy"
    assert format_report({"cells_stripped": 2, "empties_to_nan": 1, "rows_dropped": 0}) == "2 cells stripped, 1 empties→NaN"
