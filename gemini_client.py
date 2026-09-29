import os
import time
from datetime import datetime
from dotenv import load_dotenv
from google import genai
from google.genai import errors as genai_errors

# Resolve .env next to this file, not CWD — invoking the engine from another
# directory must not silently lose the API key.
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

MODEL_NAME = "gemini-3.1-flash-lite"  # verified live against the models.list API

MAX_API_RETRIES = 4
BASE_DELAY_SECONDS = 2

# Per-call usage records: {timestamp, model, purpose, tag, prompt_tokens,
# completion_tokens, total_tokens}. `tag` (usually the dataset path) lets
# parallel batch runs attribute spend per dataset. list.append is atomic
# under the GIL, so worker threads can share this safely.
USAGE_LOG: list[dict] = []

_client = None


def _get_client():
    """Lazy client: importing this module (e.g. in CI without keys) must not crash."""
    global _client
    if _client is None:
        _client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    return _client


def _record_usage(response, purpose: str, tag: str):
    meta = getattr(response, "usage_metadata", None)
    USAGE_LOG.append({
        "timestamp": datetime.now().isoformat(),
        "model": MODEL_NAME,
        "purpose": purpose,
        "tag": tag,
        "prompt_tokens": getattr(meta, "prompt_token_count", 0) or 0,
        "completion_tokens": getattr(meta, "candidates_token_count", 0) or 0,
        "total_tokens": getattr(meta, "total_token_count", 0) or 0,
    })


def generate(prompt: str, purpose: str = "", tag: str = "") -> str:
    last_error = None
    for attempt in range(1, MAX_API_RETRIES + 1):
        try:
            response = _get_client().models.generate_content(
                model=MODEL_NAME,
                contents=prompt,
            )
            _record_usage(response, purpose, tag)
            return response.text
        except genai_errors.APIError as e:
            last_error = e
            is_retryable = getattr(e, "code", None) in (429, 500, 503)
            if not is_retryable or attempt == MAX_API_RETRIES:
                raise
            delay = BASE_DELAY_SECONDS * (2 ** (attempt - 1))  # 2s, 4s, 8s...
            print(f"Gemini API error ({e.code}), retrying in {delay}s (attempt {attempt}/{MAX_API_RETRIES})...")
            time.sleep(delay)
    raise last_error


def reset_usage(tag: str | None = None):
    """Clear usage records (all, or just one dataset tag)."""
    global USAGE_LOG
    if tag is None:
        USAGE_LOG = []
    else:
        USAGE_LOG = [u for u in USAGE_LOG if u.get("tag") != tag]


def usage_totals(tag: str | None = None) -> dict:
    """Summed tokens across matching records."""
    recs = USAGE_LOG if tag is None else [u for u in USAGE_LOG if u.get("tag") == tag]
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
