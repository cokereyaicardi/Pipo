import os
import json
import time
import socket
import urllib.request
from datetime import datetime, timezone, timedelta
import feedparser
from google import genai
from google.genai import types
from google.genai.errors import APIError, ServerError

socket.setdefaulttimeout(12)

FEEDS = {
    "economia": [
        "https://www.df.cl/noticias/site/list/port/rss.xml",
        "https://feeds.bbci.co.uk/mundo/topics/c2dwqd1zr92t/rss.xml",
        "https://www.cnbc.com/id/100003114/device/rss/rss.html",
    ],
    "chile": [
        "https://www.biobiochile.cl/lista/categorias/deportes/rss.xml",
        "https://redgol.cl/feed",
        "https://www.alairelibre.cl/noticias/site/list/port/rss.xml",
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


def fetch_feed_with_timeout(url, timeout=10):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (PipoRadar/1.0)"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw_bytes = resp.read()
    return feedparser.parse(raw_bytes)


def fetch_headlines():
    collected = {}
    for cat, urls in FEEDS.items():
        entries = []
        for url in urls:
            try:
                print(f"Leyendo feed [{cat}]: {url}")
                feed = fetch_feed_with_timeout(url, timeout=10)
                for entry in feed.entries[:8]:
                    title = entry.get("title", "").strip()
                    summary = entry.get("summary", "").strip()[:240]
                    link = entry.get("link", "").strip()
                    if title and link:
                        entries.append(
                            f"- TITULAR: {title} | RESUMEN: {summary} | LINK: {link}"
                        )
            except Exception as e:
                print(f"Saltando {url} por error/timeout: {e}")
        collected[cat] = "\n".join(entries[:18])
    return collected


def build_briefing(raw_news):
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("Falta GEMINI_API_KEY en el entorno.")

    client = genai.Client(api_key=api_key)

    prompt = f"""
Eres Pipo, un cronista y analista sin filtro que reemplaza el scroll tóxico de redes sociales.
Tu tarea es procesar las siguientes noticias recientes y devolver un JSON estricto con **5 a 6 tarjetas** por cada una de las 5 categorías (alrededor de 25 a 30 tarjetas en total):
- economia (Economía y finanzas de Chile, EE. UU. y el mundo)
- chile (Fútbol chileno)
- argentina (Fútbol argentino)
- italia (Fútbol italiano)
- brasil (Fútbol brasileño)

Reglas estrictas para cada tarjeta:
1. "headline": Titular claro, directo y con gancho (máximo 12 palabras).
2. "url": Copia EXACTAMENTE el LINK correspondiente de la noticia original entregada abajo. No inventes URLs.
3. "formal": Dato duro, contexto económico/táctico/dirigencial serio, objetivo y bien explicado (2 a 3 oraciones).
4. "tribuna": El pulso real de la calle, los hinchas y la gente común frente a esa noticia. Incluye reacciones auténticas de hinchas, debates reales de tablón, quejas o festejos concretos que genera este hecho en la gente (como leer los comentarios más picantes y sinceros de la hinchada o el ciudadano de a pie, sin difamar ni insultar con odio).

Usa estas claves exactas en el JSON:
{{
  "items": [
    {{
      "category": "economia | chile | argentina | italia | brasil",
      "category_label": "Nombre legible de la categoría",
      "headline": "...",
      "url": "https://...",
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
            except ServerError:
                print(f"[{model_name}] Intento {attempt}/2 con error 503. Esperando 3s...")
                time.sleep(3)
            except APIError as e:
                print(f"[{model_name}] Error de API ({e.code}): {e.message}")
                break
            except Exception as e:
                print(f"[{model_name}] Error inesperado: {e}")
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
    print("Pipo iniciando búsqueda de noticias...")
    news = fetch_headlines()
    print("Noticias recolectadas. Consultando a los modelos...")
    briefing = build_briefing(news)
    if briefing is None:
        print("Los modelos no respondieron en esta corrida. Se mantiene el briefing actual.")
        raise SystemExit(0)

    os.makedirs("data", exist_ok=True)
    with open("data/briefing.json", "w", encoding="utf-8") as f:
        json.dump(briefing, f, ensure_ascii=False, indent=2)
    print("Briefing de Pipo actualizado correctamente.")
