import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError
from datetime import datetime
from dotenv import load_dotenv
from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types

# Resolve .env next to this file, not CWD — invoking the engine from another
# directory must not silently lose the API key.
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

MODEL_NAME = "gemini-3.1-flash-lite"  # verified live against the models.list API

MAX_API_RETRIES = 4
BASE_DELAY_SECONDS = 2
# Deterministic, bounded generation: temperature 0 for reproducibility,
# capped output so one verbose dump cannot burn the budget.
GENERATION_CONFIG = {"temperature": 0.0, "max_output_tokens": 2048}

# Per-call usage records: {timestamp, model, purpose, tag, prompt_tokens,
# completion_tokens, total_tokens}. `tag` (usually the dataset path) lets
# parallel batch runs attribute spend per dataset. All access goes through
# _USAGE_LOCK: batch mode runs datasets on worker threads, and reset_usage
# REBINDS the list while readers iterate it — append-atomicity is not enough.
USAGE_LOG: list[dict] = []
_USAGE_LOCK = threading.Lock()

_client = None
_CLIENT_LOCK = threading.Lock()


def _get_client():
    """Lazy client: importing this module (e.g. in CI without keys) must not crash.

    Exactly ONE client ever exists: racing genai.Client constructions (one
    per batch thread) garbage-collects the losers, whose __del__ closes
    transports out from under in-flight sibling calls ("client has been
    closed"). Double-checked locking keeps the fast path lock-free.

    The HTTP timeout is enforced INSIDE the SDK (httpx deadline), not just by
    the wrapper future: exiting a ThreadPoolExecutor context waits for its
    tasks, so a wrapper-only timeout reports on time while the process stays
    blocked. The wrapper below is only a backstop with a margin on top.
    """
    global _client
    if _client is None:
        with _CLIENT_LOCK:
            if _client is None:
                # HttpOptions.timeout is MILLISECONDS (google-genai types.HttpOptions)
                # — passing seconds here sets a ~0.1s deadline that fails every call
                # and burns both retry loops. Convert explicitly.
                _client = genai.Client(
                    api_key=os.getenv("GEMINI_API_KEY"),
                    http_options={"timeout": int(_llm_timeout_s() * 1000)},
                )
    return _client


def _record_usage(response, purpose: str, tag: str):
    meta = getattr(response, "usage_metadata", None)
    with _USAGE_LOCK:
        USAGE_LOG.append({
        "timestamp": datetime.now().isoformat(),
        "model": MODEL_NAME,
        "purpose": purpose,
        "tag": tag,
        "prompt_tokens": getattr(meta, "prompt_token_count", 0) or 0,
        "completion_tokens": getattr(meta, "candidates_token_count", 0) or 0,
        "total_tokens": getattr(meta, "total_token_count", 0) or 0,
    })


class EmptyResponseError(Exception):
    """The model returned no usable text (empty / safety-blocked). Retryable."""


def _llm_timeout_s() -> float:
    try:
        return float(os.getenv("GEMINI_TIMEOUT_S", "120"))
    except ValueError:
        return 120.0


def _is_timeout(err: BaseException) -> bool:
    """True for socket/future timeouts regardless of which layer raised them."""
    return "timeout" in type(err).__name__.lower() or "timed out" in str(err).lower()


def _call_once(prompt: str, purpose: str, tag: str):
    """Single API call with config knobs. Raises on transport OR empty text."""
    import concurrent.futures as _fut  # local import keeps module import light
    config = genai_types.GenerateContentConfig(**GENERATION_CONFIG)
    # Backstop only: the real deadline is the SDK http_options timeout above,
    # so by the time this future resolves the `with` exit cannot block on a
    # hung socket. Margin on top keeps the wrapper from racing it.
    deadline = _llm_timeout_s() + 30
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(
            _get_client().models.generate_content,
            model=MODEL_NAME, contents=prompt, config=config,
        )
        try:
            response = future.result(timeout=deadline)
        except _fut.TimeoutError as e:
            raise EmptyResponseError(
                f"LLM call timed out after {deadline:g}s with no response"
            ) from e
    text = response.text or ""
    if not text.strip():
        raise EmptyResponseError("LLM returned empty text (blocked or blank response)")
    _record_usage(response, purpose, tag)
    return text


def generate(prompt: str, purpose: str = "", tag: str = "") -> str:
    last_error = None
    value_errors_seen = 0
    for attempt in range(1, MAX_API_RETRIES + 1):
        try:
            return _call_once(prompt, purpose, tag)
        except genai_errors.APIError as e:
            last_error = e
            is_retryable = getattr(e, "code", None) in (429, 500, 503) or _is_timeout(e)
            if not is_retryable or attempt == MAX_API_RETRIES:
                raise
        except FuturesTimeoutError as e:
            # Wrapper backstop fired (the SDK deadline should have fired first).
            last_error = e
            if attempt == MAX_API_RETRIES:
                raise
        except (EmptyResponseError, ValueError) as e:
            # SDK ValueErrors (UnknownApiResponse et al.) and empty responses:
            # retry briefly — the next call usually parses — then give up.
            last_error = e
            value_errors_seen += 1
            if value_errors_seen >= 2 or attempt == MAX_API_RETRIES:
                raise
        delay = BASE_DELAY_SECONDS * (2 ** (attempt - 1))  # 2s, 4s, 8s...
        code = getattr(last_error, "code", type(last_error).__name__)
        print(f"Gemini error ({code}), retrying in {delay}s (attempt {attempt}/{MAX_API_RETRIES})...")
        time.sleep(delay)
    raise last_error


def reset_usage(tag: str | None = None):
    """Clear usage records (all, or just one dataset tag)."""
    global USAGE_LOG
    with _USAGE_LOCK:
        if tag is None:
            USAGE_LOG = []
        else:
            USAGE_LOG = [u for u in USAGE_LOG if u.get("tag") != tag]


def usage_totals(tag: str | None = None) -> dict:
    """Summed tokens across matching records."""
    with _USAGE_LOCK:
        recs = list(USAGE_LOG) if tag is None else [u for u in USAGE_LOG if u.get("tag") == tag]
    return {
        "calls": len(recs),
        "prompt_tokens": sum(u["prompt_tokens"] for u in recs),
        "completion_tokens": sum(u["completion_tokens"] for u in recs),
        "total_tokens": sum(u["total_tokens"] for u in recs),
    }


def estimate_cost(prompt_tokens: int, completion_tokens: int) -> float | None:
    """USD estimate from env rates; None when rates are not configured.

    Set GEMINI_PRICE_INPUT_PER_MTOK / GEMINI_PRICE_OUTPUT_PER_MTOK (USD per
    1M tokens) from the provider pricing page. No hardcoded prices — they
    change, and a wrong number is worse than no number.
    """
    try:
        rate_in = float(os.getenv("GEMINI_PRICE_INPUT_PER_MTOK", ""))
        rate_out = float(os.getenv("GEMINI_PRICE_OUTPUT_PER_MTOK", ""))
    except (TypeError, ValueError):
        return None
    return prompt_tokens / 1_000_000 * rate_in + completion_tokens / 1_000_000 * rate_out
