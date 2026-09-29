import pandas as pd

from pre_clean import smart_parse, try_parse_currency, try_parse_datetime


def test_currency_parses_symbols_commas_and_plain_numbers():
    s = pd.Series(["$49.99", "1,234.50", "10", "-$5"])
    out, ok = try_parse_currency(s)
    assert ok
    assert out.tolist() == [49.99, 1234.50, 10.0, -5.0]
    assert str(out.dtype) == "float64"


def test_currency_integral_values_become_nullable_int():
    s = pd.Series(["1", "2", None])
    out, ok = try_parse_currency(s)
    assert ok
    assert str(out.dtype) == "Int64"
    assert out.tolist()[0] == 1


def test_currency_partial_failure_leaves_column_untouched():
    s = pd.Series(["$49.99", "cold", "10"])
    out, ok = try_parse_currency(s)
    assert not ok
    assert out.tolist() == ["$49.99", "cold", "10"]


def test_currency_rejects_empty_and_symbol_only():
    for bad in (["", "10"], ["$", "10"], ["-", "10"]):
        _, ok = try_parse_currency(pd.Series(bad))
        assert not ok


def test_currency_empty_series_is_noop():
    s = pd.Series([None, None], dtype="object")
    _, ok = try_parse_currency(s)
    assert not ok


def test_datetime_parses_mixed_formats():
    s = pd.Series(["2023-01-15", "01/22/2023", "15-Jan-2023"])
    out, ok = try_parse_datetime(s)
    assert ok
    assert str(out.dtype) == "datetime64[ns]"
    assert out.iloc[0] == pd.Timestamp("2023-01-15")


def test_datetime_strips_timezone():
    s = pd.Series(["2017-11-04T18:48:46.250Z", "2023-01-15T00:00:00Z"])
    out, ok = try_parse_datetime(s)
    assert ok
    assert str(out.dtype) == "datetime64[ns]"
    assert out.iloc[0] == pd.Timestamp("2017-11-04 18:48:46.250")


def test_datetime_partial_failure_leaves_column_untouched():
    s = pd.Series(["2023-01-15", "not-a-date"])
    out, ok = try_parse_datetime(s)
    assert not ok
    assert out.tolist() == ["2023-01-15", "not-a-date"]


def test_datetime_skips_already_datetime():
    s = pd.Series(pd.to_datetime(["2023-01-15"]))
    _, ok = try_parse_datetime(s)
    assert not ok


def test_smart_parse_reports_and_skips_garbage():
    df = pd.DataFrame({
        "price": ["$5", "$10"],
        "when": ["2023-01-15", "01/22/2023"],
        "name": ["x", "y"],
        "n": [1, 2],
        "eps": [["a"], ["b"]],
    })
    out, report = smart_parse(df)
    assert report == {"currency_parsed": ["price"], "dates_parsed": ["when"]}
    assert str(out["price"].dtype) == "Int64"
    assert str(out["when"].dtype) == "datetime64[ns]"
    assert out["name"].tolist() == ["x", "y"]
    assert out["n"].tolist() == [1, 2]
    assert out["eps"].tolist() == [["a"], ["b"]]
