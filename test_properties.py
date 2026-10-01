"""Property-based tests (hypothesis): invariants that must hold for ALL inputs."""
import pandas as pd
from hypothesis import given, settings
from hypothesis import strategies as st

from pre_clean import pre_clean, sanitize_export_cells, smart_parse
from sandbox import gate_code
from validate import sanity_checks

text_cells = st.text(alphabet="abc $,.@\n\t-", max_size=12)


def _frame(draw, ncols):
    rows = draw(st.lists(
        st.lists(text_cells, min_size=ncols, max_size=ncols),
        min_size=1, max_size=5))
    cols = [f"c{i}" for i in range(ncols)]
    return pd.DataFrame(rows, columns=cols, dtype="object")


@settings(max_examples=60)
@given(st.integers(min_value=1, max_value=3), st.data())
def test_pre_clean_is_idempotent(ncols, data):
    # Values (incl. null positions) are stable across passes; degenerate
    # all-NA columns may wobble between object/StringDtype, which is
    # semantically null either way downstream.
    df = _frame(data.draw, ncols)
    once, _ = pre_clean(df)
    twice, _ = pre_clean(once)
    pd.testing.assert_frame_equal(
        once.reset_index(drop=True), twice.reset_index(drop=True), check_dtype=False)
    pd.testing.assert_frame_equal(
        once.reset_index(drop=True).isnull(), twice.reset_index(drop=True).isnull())


@settings(max_examples=60)
@given(st.integers(min_value=1, max_value=3), st.data())
def test_export_never_emits_live_formula(ncols, data):
    df = _frame(data.draw, ncols)
    out = sanitize_export_cells(df)
    for v in out.stack().tolist():
        if isinstance(v, str) and v.lstrip()[:1] in ("=", "+", "@", "|"):
            raise AssertionError(f"live formula survived: {v!r}")


@settings(max_examples=100)
@given(st.text(max_size=400))
def test_gate_never_crashes_on_arbitrary_text(blob):
    assert isinstance(gate_code(blob), list)


@settings(max_examples=40)
@given(
    st.integers(min_value=1, max_value=50),
    st.integers(min_value=0, max_value=50),
)
def test_sanity_drop_fraction_is_exact(n_raw_extra, n_drop):
    n_raw = 1 + n_raw_extra
    n_drop = min(n_drop, n_raw)
    raw = pd.DataFrame({"a": list(range(n_raw))})
    cleaned = raw.iloc[: n_raw - n_drop]
    frac = n_drop / n_raw
    issues = sanity_checks(raw, cleaned, max_drop_fraction=0.75)
    assert (frac > 0.75) == (len(issues) > 0)


@settings(max_examples=40)
@given(st.integers(min_value=1, max_value=3), st.data())
def test_smart_parse_never_crashes_nor_invents_rows(ncols, data):
    df = _frame(data.draw, ncols)
    out, report = smart_parse(df)
    assert len(out) == len(df)  # parsing never drops rows
    assert set(report) == {"currency_parsed", "dates_parsed"}
