import os
import time
from dotenv import load_dotenv
from google import genai
from google.genai import errors as genai_errors

load_dotenv()
_client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
MODEL_NAME = "gemini-3.1-flash-lite"

MAX_API_RETRIES = 4
BASE_DELAY_SECONDS = 2

def generate(prompt: str) -> str:
    last_error = None
    for attempt in range(1, MAX_API_RETRIES + 1):
        try:
            response = _client.models.generate_content(
                model=MODEL_NAME,
                contents=prompt,
            )
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