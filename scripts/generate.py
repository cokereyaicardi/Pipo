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

CHILE_TZ = timezone(timedelta(hours=-3))
MAX_AGE_DAYS = 2

FEEDS = {
    "economia": [
        "https://www.df.cl/noticias/site/list/port/rss.xml",
        "https://feeds.bbci.co.uk/mundo/topics/c2dwqd1zr92t/rss.xml",
        "https://www.cnbc.com/id/100003114/device/rss/rss.html",
        "https://www.latercera.com/arc/outboundfeeds/rss/category/pulso/?outputType=xml",
        "https://www.emol.com/rss/rss.asp?canal=3",
        "https://feeds.marketwatch.com/marketwatch/topstories/",
        "https://finance.yahoo.com/news/rssindex",
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
    "mis_equipos": [
        "https://football-italia.net/feed/",
        "https://www.gazzetta.it/dynamic-feed/rss/section/Calcio/Serie-A.xml",
        "https://chile.as.com/rss/chile/futbol.xml",
        "https://redgol.cl/feed",
        "https://www.adnradio.cl/feed/",
        "https://www.biobiochile.cl/lista/categorias/deportes/rss.xml",
    ],
    "fichajes": [
        "https://onefootball.com/es/noticias/rss",
        "https://football-italia.net/feed/",
        "https://chile.as.com/rss/chile/futbol.xml",
        "https://www.ole.com.ar/rss/ultimas-noticias/",
        "https://www.lance.com.br/rss",
    ],
}

CATEGORY_LABELS = {
    "economia": "Economía & Mercados",
    "chile": "Fútbol Chileno",
    "argentina": "Fútbol Argentino",
    "italia": "Fútbol Italiano",
    "brasil": "Fútbol Brasileño",
    "mis_equipos": "AC Milan & Palestino",
    "fichajes": "Fichajes & Rumores",
}

TEAM_KEYWORDS = (
    "milan",
    "rossoneri",
    "san siro",
    "palestino",
    "tino",
    "la cisterna",
)

TRANSFER_KEYWORDS = (
    "fichaje",
    "fichajes",
    "mercado",
    "rumor",
    "rumores",
    "traspaso",
    "refuerzo",
    "refuerzos",
    "interés",
    "pretende",
    "cláusula",
    "cesión",
    "préstamo",
    "transfer",
    "signing",
    "deal",
    "mercato",
    "calciomercato",
    "contrato",
    "renovación",
    "agente",
)

MODELS_TO_TRY = [
    "gemini-4-hydrogen",
    "gemini-3.8-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
]


def parse_entry_date(entry):
    struct_time = entry.get("published_parsed") or entry.get("updated_parsed")
    if not struct_time:
        return None
    try:
        dt_utc = datetime(*struct_time[:6], tzinfo=timezone.utc)
        return dt_utc.astimezone(CHILE_TZ)
    except Exception:
        return None


def is_recent_enough(dt_local, now_local):
    if dt_local is None:
        return False
    age = now_local - dt_local
    return timedelta(days=-1) <= age <= timedelta(days=MAX_AGE_DAYS)


def extract_image(entry):
    media = entry.get("media_content", [])
    if media and isinstance(media, list):
        url = media[0].get("url", "")
        if url.startswith("http"):
            return url

    thumbs = entry.get("media_thumbnail", [])
    if thumbs and isinstance(thumbs, list):
        url = thumbs[0].get("url", "")
        if url.startswith("http"):
            return url

    for enc in entry.get("enclosures", []):
        enc_type = enc.get("type", "")
        href = enc.get("href", "") or enc.get("url", "")
        if href.startswith("http") and (
            "image" in enc_type or href.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
        ):
            return href

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


def matches_any_keyword(text, keywords):
    low = text.lower()
    return any(kw in low for kw in keywords)


def fetch_headlines():
    now_local = datetime.now(CHILE_TZ)
    collected = {}
    image_map = {}
    date_map = {}

    for cat, urls in FEEDS.items():
        entries = []
        per_feed_limit = 7 if cat == "economia" else 10
        max_cat_entries = 16 if cat == "economia" else 10

        for url in urls:
            try:
                print(f"Leyendo feed [{cat}]: {url}")
                feed = fetch_feed_with_timeout(url, timeout=8)
                for entry in feed.entries[:per_feed_limit]:
                    dt_local = parse_entry_date(entry)
                    if not is_recent_enough(dt_local, now_local):
                        continue

                    title = re.sub(r"\s+", " ", entry.get("title", "")).strip()
                    summary = re.sub(r"<[^>]+>", "", entry.get("summary", ""))
                    summary = re.sub(r"\s+", " ", summary).strip()[:130]
                    link = entry.get("link", "").strip()
                    if not title or not link:
                        continue

                    combined_text = f"{title} {summary} {link}"
                    if cat == "mis_equipos" and not matches_any_keyword(combined_text, TEAM_KEYWORDS):
                        continue
                    if cat == "fichajes" and not matches_any_keyword(combined_text, TRANSFER_KEYWORDS):
                        if (
                            "onefootball" not in url.lower()
                            and "fichaje" not in url.lower()
                            and "transfer" not in url.lower()
                        ):
                            continue

                    date_str = dt_local.strftime("%d/%m/%Y")
                    img = extract_image(entry)
                    if img:
                        image_map[link] = img
                    date_map[link] = date_str
                    entries.append(f"- [{date_str}] {title} | {summary} | {link}")
            except Exception as e:
                print(f"Saltando {url}: {e}")

        print(f"Total entradas recientes (<=2 días) para [{cat}]: {len(entries)}")
        collected[cat] = "\n".join(entries[:max_cat_entries])

    return collected, image_map, date_map


def build_briefing(raw_news, image_map, date_map):
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("Falta GEMINI_API_KEY en el entorno.")

    client = genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(timeout=45000),
    )

    prompt = f"""
Eres Pipo, un cronista y analista sin filtro que reemplaza el scroll tóxico de redes sociales.
Procesa las noticias entregadas y devuelve un JSON estricto con estas cantidades exactas:
- economia: **5 tarjetas** (economía, finanzas, mercados, tasas, dólar, empresas e inversiones de Chile, EE. UU. y el mundo)
- chile: **3 tarjetas** de fútbol chileno
- argentina: **3 tarjetas** de fútbol argentino
- italia: **3 tarjetas** de fútbol italiano
- brasil: **3 tarjetas** de fútbol brasileño
- mis_equipos: **3 tarjetas** enfocadas en AC Milan y/o Palestino
- fichajes: **4 tarjetas** enfocadas en fichajes, traspasos o rumores de mercado

Reglas obligatorias por tarjeta:
1. "category": Debe ser exactamente uno de: "economia", "chile", "argentina", "italia", "brasil", "mis_equipos", "fichajes".
2. "headline": Titular claro y con gancho (máx 12 palabras).
3. "url": Copia EXACTAMENTE el link de la noticia original entregada. No inventes URLs.
4. "date": Copia la fecha [DD/MM/YYYY] de esa noticia específica (si no aparece, usa la fecha de hoy en Chile).
5. Para categorías distintas a "fichajes":
   - "formal": Dato duro y contexto serio/objetivo (2 oraciones breves). Comienza siempre con "Publicado el DD/MM/YYYY: ...".
   - "tribuna": Pulso real de la calle, hinchas y gente común frente a la noticia (2 oraciones breves, sin difamar ni insultar con odio).
6. Para la categoría "fichajes", además de "headline", "url" y "date", incluye estos campos cortos y limpios:
   - "player_name": Nombre del futbolista involucrado.
   - "from_club": Club actual o anterior del jugador (nunca uses "Origen por confirmar" si aparece un club o selección en la noticia; usa "Agente libre" solo si está libre).
   - "to_club": Club que lo ficha o lo pretende/rumorea (nunca uses "Destino por confirmar" si se menciona un club destino).
   - "transfer_status": "OFICIAL" si ya se cerró/anunció o "RUMOR" si es interés/negociación/rumor.

JSON esperado:
{{
  "items": [
    {{
      "category": "economia | chile | argentina | italia | brasil | mis_equipos",
      "category_label": "Nombre legible",
      "headline": "...",
      "url": "https://...",
      "date": "DD/MM/YYYY",
      "formal": "Publicado el DD/MM/YYYY: ...",
      "tribuna": "..."
    }},
    {{
      "category": "fichajes",
      "category_label": "Fichajes & Rumores",
      "headline": "...",
      "url": "https://...",
      "date": "DD/MM/YYYY",
      "player_name": "Nombre Jugador",
      "from_club": "Club Origen",
      "to_club": "Club Destino",
      "transfer_status": "RUMOR | OFICIAL"
    }}
  ]
}}

Noticias recientes (máximo 2 días de antigüedad):
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
                    temperature=0.7,
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
    now_local = datetime.now(CHILE_TZ)
    now_str = now_local.strftime("%d/%m/%Y · %H:%M hrs (Chile)")
    default_date = now_local.strftime("%d/%m/%Y")

    for item in parsed.get("items", []):
        cat = item.get("category", "")
        if cat in CATEGORY_LABELS:
            item["category_label"] = CATEGORY_LABELS[cat]

        item_url = item.get("url", "").strip()
        item["image"] = image_map.get(item_url, "")
        real_date = date_map.get(item_url) or item.get("date") or default_date
        item["date"] = real_date

        if cat != "fichajes":
            formal_txt = item.get("formal", "").strip()
            if formal_txt and real_date not in formal_txt:
                item["formal"] = f"Publicado el {real_date}: {formal_txt}"

    return {
        "updated_at": now_str,
        "items": parsed.get("items", []),
    }


if __name__ == "__main__":
    print("Pipo iniciando búsqueda de noticias recientes...")
    news, img_map, dt_map = fetch_headlines()
    print("Noticias recientes recolectadas. Consultando a los modelos...")
    briefing = build_briefing(news, img_map, dt_map)
    if briefing is None:
        print("Ningún modelo respondió a tiempo. Se mantiene el briefing actual.")
        raise SystemExit(0)

    os.makedirs("data", exist_ok=True)
    with open("data/briefing.json", "w", encoding="utf-8") as f:
        json.dump(briefing, f, ensure_ascii=False, indent=2)
    print("Briefing de Pipo actualizado correctamente.")
