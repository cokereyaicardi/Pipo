import os
import re
import json
import time
import socket
import urllib.request
from datetime import datetime, timezone, timedelta
import feedparser
from google import genai
from google.genai import types
from google.genai.errors import APIError, ServerError

socket.setdefaulttimeout(10)

FEEDS = {
    "economia": [
        "https://www.df.cl/noticias/site/list/port/rss.xml",
        "https://feeds.bbci.co.uk/mundo/topics/c2dwqd1zr92t/rss.xml",
        "https://www.cnbc.com/id/100003114/device/rss/rss.html",
    ],
    "chile": [
        "https://chile.as.com/rss/chile/futbol.xml",
        "https://redgol.cl/feed",
        "https://www.adnradio.cl/feed/",
        "https://www.latercera.com/arc/outboundfeeds/rss/category/el-deportivo/?outputType=xml",
        "https://www.biobiochile.cl/lista/categorias/deportes/rss.xml",
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
        "https://www.gazetaesportiva.com/feed/",
        "https://www.lance.com.br/rss",
        "https://rss.uol.com.br/feed/esporte.xml",
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


def extract_image(entry):
    # 1. media_content
    media = entry.get("media_content", [])
    if media and isinstance(media, list):
        url = media[0].get("url", "")
        if url.startswith("http"):
            return url

    # 2. media_thumbnail
    thumbs = entry.get("media_thumbnail", [])
    if thumbs and isinstance(thumbs, list):
        url = thumbs[0].get("url", "")
        if url.startswith("http"):
            return url

    # 3. enclosures
    for enc in entry.get("enclosures", []):
        enc_type = enc.get("type", "")
        href = enc.get("href", "") or enc.get("url", "")
        if href.startswith("http") and ("image" in enc_type or href.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))):
            return href

    # 4. Etiqueta <img src="..."> en summary o content
    html_blob = entry.get("summary", "")
    if entry.get("content"):
        html_blob += " " + entry["content"][0].get("value", "")
    match = re.search(r'<img[^>]+src=["\'](https?://[^"\']+)["\']', html_blob, re.IGNORECASE)
    if match:
        return match.group(1)

    return ""


def fetch_feed_with_timeout(url, timeout=8):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw_bytes = resp.read()
    return feedparser.parse(raw_bytes)


def fetch_headlines():
    collected = {}
    image_map = {}

    for cat, urls in FEEDS.items():
        entries = []
        for url in urls:
            try:
                print(f"Leyendo feed [{cat}]: {url}")
                feed = fetch_feed_with_timeout(url, timeout=8)
                for entry in feed.entries[:5]:
                    title = entry.get("title", "").strip()
                    summary = re.sub(r"<[^>]+>", "", entry.get("summary", "")).strip()[:120]
                    link = entry.get("link", "").strip()
                    img = extract_image(entry)
                    if title and link:
                        if img:
                            image_map[link] = img
                        entries.append(f"- {title} | {summary} | {link}")
            except Exception as e:
                print(f"Saltando {url}: {e}")
        print(f"Total entradas recolectadas para [{cat}]: {len(entries)}")
        collected[cat] = "\n".join(entries[:12])

    return collected, image_map


def build_briefing(raw_news, image_map):
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("Falta GEMINI_API_KEY en el entorno.")

    client = genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(timeout=40000),
    )

    prompt = f"""
Eres Pipo, un cronista y analista sin filtro que reemplaza el scroll tóxico de redes sociales.
Procesa las noticias entregadas y devuelve un JSON estricto con **EXACTAMENTE 4 tarjetas por cada una de las 5 categorías (20 tarjetas en total)**:
- economia (4 tarjetas)
- chile (4 tarjetas de fútbol chileno: Primera División, La Roja, chilenos en el exterior)
- argentina (4 tarjetas)
- italia (4 tarjetas)
- brasil (4 tarjetas)

Reglas obligatorias por tarjeta:
1. "category": Debe ser exactamente uno de estos valores: "economia", "chile", "argentina", "italia", "brasil". No omitas ninguna categoría.
2. "headline": Titular claro y con gancho (máx 12 palabras).
3. "url": Copia EXACTAMENTE el link de la noticia original entregada. No inventes URLs.
4. "formal": Dato duro y contexto serio/objetivo (2 oraciones breves).
5. "tribuna": Pulso real de la calle, hinchas y gente común frente a la noticia; reacciones auténticas, debates reales de tablón o sentir ciudadano directo (2 oraciones breves, sin difamar ni insultar con odio).

JSON esperado:
{{
  "items": [
    {{
      "category": "economia | chile | argentina | italia | brasil",
      "category_label": "Nombre legible",
      "headline": "...",
      "url": "https://...",
      "formal": "...",
      "tribuna": "..."
    }}
  ]
}}

Noticias:
{json.dumps(raw_news, ensure_ascii=False)}
"""

    response = None

    for model_name in MODELS_TO_TRY:
        print(f"Probando modelo: {model_name}")
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
            print(f"[{model_name}] Saturación (503), pasando al siguiente modelo...")
            time.sleep(2)
        except APIError as e:
            print(f"[{model_name}] Error de API ({e.code}): {e.message}")
        except Exception as e:
            print(f"[{model_name}] Timeout o error: {e}")

    if response is None:
        return None

    parsed = json.loads(response.text)
    chile_tz = timezone(timedelta(hours=-3))
    now_str = datetime.now(chile_tz).strftime("%d/%m/%Y · %H:%M hrs (Chile)")

    for item in parsed.get("items", []):
        cat = item.get("category", "")
        if cat in CATEGORY_LABELS:
            item["category_label"] = CATEGORY_LABELS[cat]
        item_url = item.get("url", "").strip()
        item["image"] = image_map.get(item_url, "")

    return {
        "updated_at": now_str,
        "items": parsed.get("items", []),
    }


if __name__ == "__main__":
    print("Pipo iniciando búsqueda de noticias...")
    news, img_map = fetch_headlines()
    print("Noticias recolectadas. Consultando a los modelos...")
    briefing = build_briefing(news, img_map)
    if briefing is None:
        print("Ningún modelo respondió a tiempo. Se mantiene el briefing actual.")
        raise SystemExit(0)

    os.makedirs("data", exist_ok=True)
    with open("data/briefing.json", "w", encoding="utf-8") as f:
        json.dump(briefing, f, ensure_ascii=False, indent=2)
    print("Briefing de Pipo actualizado correctamente.")
