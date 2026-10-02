import os
from types import SimpleNamespace
from unittest.mock import patch

import gemini_client as gc


def _resp(prompt_t=10, comp_t=5, total_t=15):
    return SimpleNamespace(usage_metadata=SimpleNamespace(
        prompt_token_count=prompt_t,
        candidates_token_count=comp_t,
        total_token_count=total_t,
    ))


def test_record_and_totals_with_tag_filter():
    gc.reset_usage()
    gc._record_usage(_resp(10, 5, 15), "infer_schema", "a.csv")
    gc._record_usage(_resp(20, 10, 30), "generate_code", "b.csv")
    assert gc.usage_totals() == {"calls": 2, "prompt_tokens": 30,
                                 "completion_tokens": 15, "total_tokens": 45}
    assert gc.usage_totals(tag="a.csv") == {"calls": 1, "prompt_tokens": 10,
                                            "completion_tokens": 5, "total_tokens": 15}
    gc.reset_usage(tag="a.csv")
    assert gc.usage_totals()["calls"] == 1
    gc.reset_usage()
    assert gc.usage_totals() == {"calls": 0, "prompt_tokens": 0,
                                 "completion_tokens": 0, "total_tokens": 0}


def test_record_without_metadata_defaults_to_zero():
    gc.reset_usage()
    gc._record_usage(SimpleNamespace(), "x", "t")
    assert gc.usage_totals()["total_tokens"] == 0
    gc.reset_usage()


def test_generate_records_usage_without_network():
    gc.reset_usage()
    fake = SimpleNamespace(text="hi", usage_metadata=SimpleNamespace(
        prompt_token_count=3, candidates_token_count=1, total_token_count=4))
    mock_models = SimpleNamespace(generate_content=lambda model, contents, config=None: fake)
    with patch.object(gc, "_client", SimpleNamespace(models=mock_models)):
        assert gc.generate("hello", purpose="p", tag="t") == "hi"
    totals = gc.usage_totals(tag="t")
    assert (totals["calls"], totals["total_tokens"]) == (1, 4)
    gc.reset_usage()


def test_estimate_cost_none_without_rates():
    with patch.dict(os.environ, {}, clear=True):
        assert gc.estimate_cost(1000, 500) is None


def test_estimate_cost_math_with_rates():
    with patch.dict(os.environ, {"GEMINI_PRICE_INPUT_PER_MTOK": "2.0",
                                 "GEMINI_PRICE_OUTPUT_PER_MTOK": "8.0"}):
        assert gc.estimate_cost(1_000_000, 500_000) == 6.0


def test_client_gets_sdk_http_timeout():
    gc._client = None
    with patch.dict(os.environ, {"GEMINI_TIMEOUT_S": "42"}):
        with patch.object(gc.genai, "Client") as mock_client:
            mock_client.return_value.models.generate_content.return_value = SimpleNamespace(
                text="hi",
                usage_metadata=SimpleNamespace(prompt_token_count=1,
                                               candidates_token_count=1,
                                               total_token_count=2),
            )
            assert gc.generate("hello") == "hi"
            _, kwargs = mock_client.call_args
            assert kwargs["http_options"] == {"timeout": 42.0}
    gc._client = None


def test_socket_timeout_is_retried_then_raises():
    import concurrent.futures as fut

    calls = []

    def flaky(prompt, purpose="", tag=""):
        calls.append(prompt)
        if len(calls) < 3:
            raise fut.TimeoutError("socket timed out")
        return "recovered"

    with patch.object(gc, "_call_once", side_effect=flaky):
        with patch.object(gc.time, "sleep", return_value=None):
            assert gc.generate("hello") == "recovered"
    assert len(calls) == 3


def test_is_timeout_matches_layer_variants():
    class FakeSocketTimeout(Exception):
        pass

    assert gc._is_timeout(FakeSocketTimeout("socket timed out")) is True
    assert gc._is_timeout(TimeoutError("operation timed out")) is True
    assert gc._is_timeout(ValueError("bad request")) is False


def test_socket_timeout_gives_up_at_retry_cap():
    import concurrent.futures as fut

    with patch.object(gc, "_call_once", side_effect=fut.TimeoutError("socket timed out")):
        with patch.object(gc.time, "sleep", return_value=None):
            try:
                gc.generate("hello")
            except fut.TimeoutError:
                return
    raise AssertionError("expected the timeout to propagate after retries")
