# Batch / scheduled use. Interactive dev happens in venv/ instead.
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY *.py ./
COPY configs/ ./configs/
COPY eval_fixtures/ ./eval_fixtures/

# Secrets come from the environment at RUNTIME, never baked into the image.
#   docker build -t data-engine .
#   docker run --rm -e GEMINI_API_KEY=... -v %cd%/out:/app/out data-engine \
#     python engine.py --config-dir configs --output out/cleaned.csv
ENTRYPOINT ["python", "engine.py"]
