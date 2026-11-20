import os
import json
import time
from datetime import datetime, timezone, timedelta
import feedparser
from google import genai
from google.genai import types
from google.genai.errors import APIError, ServerError

FEEDS = {
    "economia": [
        "https://www.df.cl/noticias/site/list/port/rss.xml",
        "https://feeds.bbci.co.uk/mundo/topics/c2dwqd1zr92t/rss.xml",
        "https://www.cnbc.com/id/100003114/device/rss/rss.html",
    ],
    "chile": [
        "https://www.biobiochile.cl/lista/categorias/deportes/rss.xml",
        "https://redgol.cl/feed",
    ],
    "argentina": [
        "https://www.ole.com.ar/rss/ultimas-noticias/",
        "https://www.tycsports.com/rss.xml",
    ],
    "italia": [
        "https://www.gazzetta.it/dynamic-feed/rss/section/Calcio/Serie-A.xml",
        "https://football-italia.net/feed/",
    ],
    "brasil": [
        "https://ge.globo.com/rss/ge/futebol/",
    ],
}

CATEGORY_LABELS = {
    "economia": "Economía & Mercados",
    "chile": "Fútbol Chileno",
    "argentina": "Fútbol Argentino",
    "italia": "Fútbol Italiano",
    "brasil": "Fútbol Brasileño",
}

MODELS_TO_TRY = [
    "gemini-4-hydrogen",
    "gemini-3.8-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
]


def fetch_headlines():
    collected = {}
    for cat, urls in FEEDS.items():
        entries = []
        for url in urls:
            try:
                feed = feedparser.parse(url)
                for entry in feed.entries[:6]:
                    title = entry.get("title", "").strip()
                    summary = entry.get("summary", "").strip()[:220]
                    if title:
                        entries.append(f"- {title}: {summary}")
            except Exception as e:
                print(f"Error leyendo {url}: {e}")
        collected[cat] = "\n".join(entries[:12])
    return collected


def build_briefing(raw_news):
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

    prompt = f"""
Eres Pipo, un cronista y analista sin filtro que reemplaza el scroll tóxico de redes sociales.
Tu tarea es procesar las siguientes noticias recientes y devolver un JSON estricto con 2 a 3 tarjetas por cada una de las 5 categorías:
- economia (Economía y finanzas de Chile, EE. UU. y el mundo)
- chile (Fútbol chileno)
- argentina (Fútbol argentino)
- italia (Fútbol italiano)
- brasil (Fútbol brasileño)

Reglas de estilo para cada tarjeta:
1. "headline": Titular claro, directo y con gancho (máximo 12 palabras).
2. "formal": Dato duro, contexto económico/táctico/dirigencial serio, objetivo y bien explicado (2 a 3 oraciones).
3. "tribuna": La reacción cruda, pasional, callejera y de "barrabrava" o mesa de café frente a esa noticia. Usa modismos naturales de fútbol/calle (sin difamar ni insultar con odio a personas reales). Que se sienta auténtico, picante y sin lenguaje corporativo (2 a 3 oraciones).

Usa estas claves exactas en el JSON:
{{
  "items": [
    {{
      "category": "economia | chile | argentina | italia | brasil",
      "category_label": "Nombre legible de la categoría",
      "headline": "...",
      "formal": "...",
      "tribuna": "..."
    }}
  ]
}}

Noticias recogidas hoy:
{json.dumps(raw_news, ensure_ascii=False)}
"""

    response = None

    for model_name in MODELS_TO_TRY:
        print(f"Probando modelo: {model_name}")
        for attempt in range(1, 3):
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        temperature=0.8,
                    ),
                )
                print(f"Respuesta obtenida con {model_name}")
                break
            except ServerError as e:
                print(f"[{model_name}] Intento {attempt}/2 con error 503. Esperando...")
                time.sleep(5 * attempt)
            except APIError as e:
                print(f"[{model_name}] Error de API ({e.code}): {e.message}")
                break
        if response is not None:
            break

    if response is None:
        return None

    parsed = json.loads(response.text)
    chile_tz = timezone(timedelta(hours=-3))
    now_str = datetime.now(chile_tz).strftime("%d/%m/%Y · %H:%M hrs (Chile)")

    for item in parsed.get("items", []):
        cat = item.get("category", "")
        if cat in CATEGORY_LABELS:
            item["category_label"] = CATEGORY_LABELS[cat]

    return {
        "updated_at": now_str,
        "items": parsed.get("items", []),
    }


if __name__ == "__main__":
    news = fetch_headlines()
    briefing = build_briefing(news)
    if briefing is None:
        print("Los modelos devolvieron error temporal en esta corrida. Se mantiene el briefing actual.")
        raise SystemExit(0)

    os.makedirs("data", exist_ok=True)
    with open("data/briefing.json", "w", encoding="utf-8") as f:
        json.dump(briefing, f, ensure_ascii=False, indent=2)
    print("Briefing de Pipo actualizado correctamente.")
