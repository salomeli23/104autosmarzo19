"""Integración con Callbell (bot y CRM): cliente de la API, verificación de webhooks y lectura de los datos
de la cita desde los campos personalizados del contacto.

Los leads son los contactos del equipo (team inbox) configurado (por defecto "AGENDADO BOGOTA NORT"); opcionalmente
también con una etiqueta.
Sus datos (nombre, placa, celular, correo, servicio, valor, forma de pago) se leen de los mensajes que el cliente
envió en el chat y, si existen, de los campos personalizados del contacto (customFields).
"""
import asyncio
import hashlib
import hmac
import json
import os
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

API_BASE = "https://api.callbell.eu/v1"
DEFAULT_TAG = ""  # opcional: además del equipo, exigir esta etiqueta
DEFAULT_TEAM = "AGENDADO BOGOTA NORT"
# Campo de la cita → nombre del campo personalizado en Callbell (se puede cambiar en Configuración)
DEFAULT_FIELDS = {
    "fecha": "Fecha cita",
    "hora": "Hora cita",
    "placa": "Placa",
    "marca": "Marca",
    "modelo": "Modelo",
    "servicio": "Servicio",
    "cedula": "Cédula",
    "email": "Correo",
}
# Si el nombre configurado no aparece, se busca un campo que contenga alguna de estas palabras
FIELD_HINTS = {
    "fecha": ["fecha"], "hora": ["hora"], "placa": ["placa"], "marca": ["marca"], "modelo": ["modelo", "linea", "referencia"],
    "servicio": ["servicio", "producto"], "cedula": ["cedula", "documento", "nit"], "email": ["correo", "email", "e-mail"],
}
MAX_PAGES = 40  # 20 contactos por página: hasta 800 contactos con la etiqueta por revisión


def api_token() -> str:
    return (os.environ.get("CALLBELL_API_TOKEN") or "").strip()


def webhook_secret() -> str:
    return (os.environ.get("CALLBELL_WEBHOOK_SECRET") or "").strip()


def _norm(s: Any) -> str:
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", s).strip().lower()


def _request(path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    token = api_token()
    if not token:
        raise RuntimeError("Falta CALLBELL_API_TOKEN")
    url = f"{API_BASE}{path}"
    if params:
        url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                                               "User-Agent": "PolarizadosYA-Callbell/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            return json.loads(res.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Callbell respondió {e.code}") from e


async def get_contact(contact_uuid: str) -> Optional[Dict[str, Any]]:
    data = await asyncio.to_thread(_request, f"/contacts/{urllib.parse.quote(contact_uuid)}")
    contact = data.get("contact")
    if isinstance(contact, list):  # la documentación muestra a veces el contacto dentro de una lista
        contact = contact[0] if contact else None
    return contact


async def list_tagged_contacts(tag: str, team_uuid: Optional[str] = None, inbound_after: Optional[str] = None) -> List[Dict[str, Any]]:
    """Contactos del equipo (y con la etiqueta, si hay), recorriendo el cursor `meta.next`.
    inbound_after (ISO 8601): solo los que escribieron desde esa fecha, los más recientes primero."""
    contacts, after = [], None
    base = {"tags": tag or None, "team_uuid": team_uuid or None, "last_inbound_message_after": inbound_after or None,
            "order": "last_inbound_message_at" if inbound_after else None}
    for _ in range(MAX_PAGES):
        params = {**base, "after": after} if after else base
        data = await asyncio.to_thread(_request, "/contacts", params)
        contacts.extend(data.get("contacts") or [])
        after = (data.get("meta") or {}).get("next")
        if not after:
            break
    return contacts


async def list_teams() -> List[Dict[str, Any]]:
    """Equipos (team inbox) de la cuenta: [{uuid, name}]."""
    data = await asyncio.to_thread(_request, "/teams")
    teams = data.get("teams") if isinstance(data, dict) else data
    return [{"uuid": t.get("uuid"), "name": t.get("name") or t.get("uuid")} for t in (teams or []) if isinstance(t, dict) and t.get("uuid")]


def contact_team_uuid(contact: Dict[str, Any]) -> Optional[str]:
    team = contact.get("team")
    return team.get("uuid") if isinstance(team, dict) else (team if isinstance(team, str) else None)


def is_from_contact(message: Dict[str, Any]) -> bool:
    """Mensaje que escribió el cliente (no el asesor, el bot ni el sistema)."""
    sender = message.get("sender") or {}
    if isinstance(sender, dict) and sender.get("type"):
        return sender.get("type") == "contact"
    return message.get("status") == "received"


def agent_of(message: Dict[str, Any]) -> Optional[Dict[str, str]]:
    """Asesor de Callbell que escribió el mensaje: {name, email}; None si lo escribió el cliente, el bot o el sistema."""
    sender = message.get("sender") or {}
    user = sender.get("user") if isinstance(sender, dict) else None
    if not isinstance(sender, dict) or sender.get("type") != "agent" or not isinstance(user, dict):
        return None
    name, email = str(user.get("name") or "").strip(), str(user.get("email") or "").strip().lower()
    return {"name": name or email, "email": email} if (name or email) else None


async def chat_messages(contact_uuid: str, max_pages: int = 2, since: Optional[datetime] = None,
                        agents: Optional[List[Dict[str, str]]] = None) -> List[Tuple[str, bool]]:
    """Mensajes del chat con texto, del más reciente al más antiguo: [(texto, lo_escribió_el_cliente)].
    since: solo los mensajes enviados desde esa fecha (los mensajes vienen del más nuevo al más viejo).
    agents: si se pasa una lista, se llena con los asesores que escribieron en el chat (del más reciente al más antiguo)."""
    out, after = [], None
    for _ in range(max_pages):
        data = await asyncio.to_thread(_request, f"/contacts/{urllib.parse.quote(contact_uuid)}/messages",
                                       {"after": after} if after else None)
        older = False
        for m in data.get("messages") or []:
            if agents is not None:
                a = agent_of(m)
                if a:
                    agents.append(a)
            created = parse_iso(m.get("createdAt"))
            if since and created and created < since:
                older = True
                continue
            if (m.get("text") or "").strip():
                out.append((m["text"].strip(), is_from_contact(m)))
        after = (data.get("meta") or {}).get("next")
        if not after or older:
            break
    return out


async def customer_texts(contact_uuid: str, max_pages: int = 2) -> List[str]:
    """Textos que el cliente envió en el chat, del más reciente al más antiguo."""
    return [t for t, mine in await chat_messages(contact_uuid, max_pages) if mine]


# ----------------------------- Datos del cliente escritos en el chat -----------------------------
_PAYMENTS = [("transferencia", "transferencia"), ("transfer", "transferencia"), ("bre-b", "breb"), ("breb", "breb"),
             ("nequi", "nequi"), ("daviplata", "daviplata"), ("bancolombia", "bancolombia"), ("efectivo", "efectivo"),
             ("tarjeta de credito", "tarjeta_credito"), ("credito", "tarjeta_credito"), ("tarjeta debito", "tarjeta_debito"),
             ("tarjeta de debito", "tarjeta_debito"), ("debito", "tarjeta_debito"), ("tarjeta", "tarjeta"), ("datafono", "tarjeta")]
_LABEL = re.compile(r"^\s*(nombre|cliente|placa|celular|telefono|tel|whatsapp|correo|email|e-mail|servicio|producto|valor|precio|total|"
                    r"pago|forma de pago|medio de pago|metodo de pago|cedula|cc|c\.c|documento|nit|marca|modelo|linea)(?:\s*[:=\-]\s*|\s+)", re.I)
_PLATE = re.compile(r"\b([a-z]{3})\s?-?(\d{3}|\d{2}[a-z])\b", re.I)
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_NOT_NAME = {"hola", "buenas", "buenos", "gracias", "ok", "listo", "si", "no", "dias", "tardes", "noches", "quiero", "necesito",
             "precio", "cuanto", "valor", "cita", "agendar", "polarizado", "ppf", "ultrasecure", "transferencia", "efectivo",
             # Palabras de frases del chat ("Ya voy en camino", "A esa hora se quede", "Perdón quería decir…")
             "a", "al", "el", "las", "los", "lo", "en", "por", "para", "con", "sin", "que", "se", "me", "te", "le", "les", "mi", "su",
             "ya", "voy", "va", "vamos", "vengo", "llego", "llegando", "salgo", "estoy", "esta", "estan", "alla", "aca", "aqui", "ahi",
             "camino", "hora", "horas", "esa", "ese", "eso", "este", "esto", "perdon", "queria", "quería", "decir", "dije", "puedo",
             "puede", "quede", "queda", "quedo", "pero", "y", "o", "u", "como", "cuando", "donde", "porque", "bien", "manana", "hoy",
             "tarde", "temprano", "carro", "vehiculo", "moto", "favor", "claro", "vale", "perfecto", "dale", "un", "una", "uno",
             "tengo", "tiene", "hay", "es", "son", "fue", "ser", "hacer", "vez", "mas", "menos", "muy", "tambien", "todo", "nada",
             "unero", "uneros", "senor", "senora", "amigo", "buen", "dia", "minutos", "rato", "momento", "ahorita", "pronto",
             # Marcas, películas y servicios ("Huper Optik", "Black Ceramic", "Nano Optik")
             "huper", "hupper", "optik", "optic", "nano", "ultra", "nanooptik", "ultraoptik", "huperoptik", "ceramic", "ceramica",
             "ceramico", "autobahn", "black", "llumar", "xpel", "suntek", "3m", "pelicula", "polarizar", "polarizados", "ppf",
             "wrap", "wrapping", "detailing", "nanoceramica", "aswf", "ultrasecure", "seguridad", "antirrayas", "full", "premium",
             "basico", "medio", "alto", "calidad", "kit", "sunroof", "panoramico", "parabrisas"}


def _money(text: str) -> Optional[int]:
    """1299.900 / 1.299.900 / $1'299.900 / 1299900 → 1299900 (solo valores de 50.000 en adelante)."""
    t = text.replace("'", ".").replace(" ", "")
    m = re.search(r"\$?\s*(\d{1,3}(?:[.,]\d{3})+|\d{4,}[.,]\d{3}|\d{5,9})(?![\d@])", t)
    if not m:
        return None
    digits = re.sub(r"\D", "", m.group(1))
    value = int(digits) if digits else 0
    return value if 50_000 <= value <= 200_000_000 else None


def _catalog_names(catalog: Dict[str, Any]) -> List[Tuple[str, str, str, str]]:
    """[(texto a buscar, id del servicio, nombre, categoría)] con el nombre completo y, si es único, su primera palabra."""
    entries, first_words = [], {}
    for key, cat in (catalog or {}).items():
        for svc in cat.get("services") or []:
            name = _norm(svc.get("name"))
            if len(name) < 3:
                continue
            entries.append((name, svc.get("id"), svc.get("name"), cat.get("name") or key))
            w = name.split(" ")[0]
            if len(w) >= 5:
                first_words.setdefault(w, []).append((svc.get("id"), svc.get("name"), cat.get("name") or key))
    entries += [(w, *v[0]) for w, v in first_words.items() if len(v) == 1]
    return sorted(entries, key=lambda e: -len(e[0]))


# Formulario de agendamiento que se diligencia en el chat ("👤 Nombre completo: …", "🔢 Placa: …", "💰 Valor pactado: …")
FORM_LABELS = [
    ("nombre", r"nombre(?: completo)?"), ("vehiculo", r"veh[ií]culo"), ("placa", r"placa"), ("telefono", r"celular|tel[eé]fono|whatsapp"),
    ("email", r"correo(?: electr[oó]nico)?|e-?mail"), ("servicio", r"servicio(?: o calidad elegida)?|calidad elegida|producto"),
    ("valor", r"valor(?: pactado)?|precio|total"), ("pago", r"m[eé]todo de pago|forma de pago|medio de pago"),
    ("cedula", r"c[eé]dula|documento|c\.?c\.?"), ("fecha", r"fecha(?: de la cita)?"), ("hora", r"hora(?: de la cita)?"),
]
_FORM_LINE = re.compile(r"^[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ*]*\*?\s*(" + "|".join(f"(?P<{k}>{rx})" for k, rx in FORM_LABELS) + r")\s*\*?\s*:\s*(?P<val>.*)$", re.I)
_FORM_END = re.compile(r"^\W*formas de pago", re.I)


def parse_form(text: str) -> Dict[str, str]:
    """Campos del formulario diligenciado (solo los que traen valor). Ignora lo que viene después de "Formas de pago"."""
    found: Dict[str, str] = {}
    for ln in (text or "").splitlines():
        line = ln.strip()
        if _FORM_END.match(line):
            break
        m = _FORM_LINE.match(line)
        if not m:
            continue
        key = next(k for k, _ in FORM_LABELS if m.group(k))
        val = (m.group("val") or "").strip().strip("*_ ").strip()
        if val and key not in found:
            found[key] = val
    return found


def _form_labels(text: str) -> int:
    return sum(1 for ln in (text or "").splitlines() if _FORM_LINE.match(ln.strip()))


def parse_chat(messages: List[Tuple[str, bool]], catalog: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Datos del lead: primero el formulario diligenciado más reciente (lo haya enviado el cliente o el asesor);
    lo que falte se completa con lo que el cliente escribió suelto en el chat."""
    out: Dict[str, Any] = {}
    # El formulario cuenta si tiene al menos 3 etiquetas y 2 datos diligenciados
    form_text = next((t for t, _ in messages if _form_labels(t) >= 3 and len(parse_form(t)) >= 2), None)
    if not form_text:
        # El asesor envió la plantilla vacía y el cliente respondió con sus datos (una línea por dato, sin etiquetas)
        idx = next((i for i, (t, _) in enumerate(messages) if _form_labels(t) >= 3), None)
        if idx is not None:
            client = [t for t, mine in messages[:idx] if mine]
            # El nombre sin etiqueta solo se toma del mensaje con los datos (no de frases como "Ya voy en camino")
            block = max(client, key=lambda t: len(parse_customer_data([t], catalog, loose_name=False)), default=None)
            reply = parse_customer_data([block], catalog) if block else {}
            for k, v in parse_customer_data(client, catalog, loose_name=False).items():
                reply.setdefault(k, v)
            if sum(1 for k in ("nombre", "placa", "telefono", "email", "servicio", "valor") if reply.get(k)) >= 2:
                return {"formulario": True, "respuesta_a_plantilla": True, **reply}
    if form_text:
        form = parse_form(form_text)
        out["formulario"] = True
        if form.get("vehiculo"):
            parts = form.pop("vehiculo").split(None, 1)
            out["marca"] = parts[0].capitalize()
            if len(parts) > 1:
                out["modelo"] = parts[1]
        # Cada valor del formulario se interpreta con las mismas reglas del texto suelto, usando su etiqueta
        labeled = {"nombre": "Nombre", "placa": "Placa", "telefono": "Celular", "email": "Correo", "servicio": "Servicio",
                   "valor": "Valor", "pago": "Pago", "cedula": "Cedula"}
        for key, label in labeled.items():
            if form.get(key):
                out.update({k: v for k, v in parse_customer_data([f"{label}: {form[key]}"], catalog).items() if k not in out})
                if key == "servicio" and "servicio" not in out:
                    out["servicio"] = form[key]
        for key in ("fecha", "hora"):
            if form.get(key):
                out[key] = form[key]
    loose = parse_customer_data([t for t, mine in messages if mine and t != form_text], catalog, loose_name=False)
    for k, v in loose.items():
        out.setdefault(k, v)
    return out


def parse_customer_data(texts: List[str], catalog: Optional[Dict[str, Any]] = None, loose_name: bool = True) -> Dict[str, Any]:
    """Datos que el cliente escribió en el chat (un mensaje por dato o todos juntos, con o sin etiqueta "Placa: …").
    Se toma el dato más reciente de cada tipo. texts va del mensaje más reciente al más antiguo.
    loose_name=False: el nombre solo se toma si viene con etiqueta ("Nombre: …"), no de una frase suelta del chat."""
    out: Dict[str, Any] = {}
    names = _catalog_names(catalog or {})
    lines = [ln.strip() for t in texts for ln in re.split(r"[\n\r]+", t or "") if ln.strip()]
    for raw in lines:
        label = _LABEL.match(raw)
        key = _norm(label.group(1)) if label else ""
        val = raw[label.end():].strip() if label else raw
        nval = _norm(val)
        if "email" not in out:
            m = _EMAIL.search(val)
            if m:
                out["email"] = m.group(0).lower()
                continue
        digits = re.sub(r"\D", "", val)
        if "telefono" not in out and (key in ("celular", "telefono", "tel", "whatsapp") or re.fullmatch(r"(\+?57)?\s*3\d{2}[\s-]?\d{3}[\s-]?\d{4}", val)):
            if re.fullmatch(r"(57)?3\d{9}", digits):
                out["telefono"] = digits[-10:]
                continue
        if "cedula" not in out and key in ("cedula", "cc", "c.c", "documento", "nit") and 5 <= len(digits) <= 11:
            out["cedula"] = digits
            continue
        if "placa" not in out and (key == "placa" or "placa" in nval or re.fullmatch(r"[a-z]{3}\s?-?(\d{3}|\d{2}[a-z])", nval)):
            m = _PLATE.search(val)
            if m:
                out["placa"] = (m.group(1) + m.group(2)).upper()
                continue
        if "pago" not in out and (key in ("pago", "forma de pago", "medio de pago", "metodo de pago") or len(nval.split()) <= 4):
            hit = next((code for word, code in _PAYMENTS if re.search(rf"\b{re.escape(word)}\b", nval)), None)
            if hit:
                out["pago"] = hit
                continue
        if "valor" not in out and (key in ("valor", "precio", "total") or not re.search(r"[a-z]{4,}", nval.replace("cop", ""))):
            v = _money(val)
            if v:
                out["valor"] = v
                continue
        if "servicio" not in out and names:
            joined = nval.replace(" ", "")
            hit = next((e for e in names if re.search(rf"\b{re.escape(e[0])}\b", nval)
                        or (" " not in e[0] and len(e[0]) >= 6 and e[0] in joined.split())), None)
            if not hit:  # "Huper Optik" escrito separado = servicio "Huperoptik"
                hit = next((e for e in names if " " not in e[0] and len(e[0]) >= 6 and e[0] == joined), None)
            if hit or key in ("servicio", "producto"):
                out["servicio"] = val
                if hit:
                    out["servicio_id"], out["servicio_nombre"], out["servicio_categoria"] = hit[1], hit[2], hit[3]
                continue
        if key in ("marca", "modelo", "linea") and val:
            out.setdefault("marca" if key == "marca" else "modelo", val)
            continue
        if "nombre" not in out and (key in ("nombre", "cliente") or (loose_name and
                re.fullmatch(r"[a-zñ ]{5,60}", nval) and 2 <= len(nval.split()) <= 5 and not (set(nval.split()) & _NOT_NAME))):
            out["nombre"] = " ".join(w.capitalize() for w in val.split())
    return out


def looks_like_phrase(name: Optional[str]) -> bool:
    """True si el "nombre" es en realidad una frase del chat ("Ya Voy En Camino", "A Esa Hora Se Quede")."""
    words = _norm(name or "").split()
    return len(words) >= 2 and bool(set(words) & _NOT_NAME)


def verify_signature(raw_body: bytes, header: str, secret: str, tolerance: int = 300) -> bool:
    """Firma de Callbell: X-Callbell-Signature: t=<unix>,v1=<hex HMAC-SHA256 de "<t>.<cuerpo>">."""
    try:
        parts = dict(p.split("=", 1) for p in (header or "").split(",") if "=" in p)
        ts, sig = int(parts["t"]), parts["v1"]
    except (KeyError, ValueError):
        return False
    if abs(time.time() - ts) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{ts}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)


def has_tag(contact: Dict[str, Any], tag: str) -> bool:
    """Sin etiqueta configurada no se exige ninguna."""
    if not _norm(tag):
        return True
    return _norm(tag) in {_norm(t) for t in (contact.get("tags") or [])}


def find_team(teams: List[Dict[str, Any]], name: str) -> Optional[Dict[str, Any]]:
    return next((t for t in teams if _norm(t.get("name")) == _norm(name)), None)


def read_fields(contact: Dict[str, Any], mapping: Dict[str, str]) -> Dict[str, str]:
    """Valores de la cita desde los campos personalizados: primero el nombre configurado, luego por palabras clave."""
    custom = {_norm(k): (v if not isinstance(v, list) else ", ".join(map(str, v)))
              for k, v in (contact.get("customFields") or {}).items()}
    out = {}
    for key, default in DEFAULT_FIELDS.items():
        name = _norm(mapping.get(key) or default)
        value = custom.get(name)
        if value in (None, ""):
            value = next((v for k, v in custom.items() if v not in (None, "") and any(h in k for h in FIELD_HINTS[key])
                          and not (key == "fecha" and "hora" in k)), None)
        out[key] = str(value).strip() if value not in (None, "") else ""
    return out


_MONTHS = {"ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6, "jul": 7, "ago": 8, "sep": 9, "set": 9,
           "oct": 10, "nov": 11, "dic": 12}


def parse_date(text: str, today: date) -> Optional[date]:
    """2026-11-07, 07/11/2026, 7-11-26, "7 de noviembre", "07/11" (año actual o el siguiente)."""
    t = _norm(text)
    if not t:
        return None
    m = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", t)
    if m:
        y, mo, d = map(int, m.groups())
    else:
        m = re.match(r"(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?", t)
        if m:
            d, mo = int(m.group(1)), int(m.group(2))
            y = int(m.group(3)) if m.group(3) else None
        else:
            m = re.match(r"(\d{1,2})\s*(?:de\s+)?([a-z]{3})[a-z]*\.?(?:\s*(?:de|del)?\s*(\d{4}))?", t)
            if not m or m.group(2) not in _MONTHS:
                return None
            d, mo, y = int(m.group(1)), _MONTHS[m.group(2)], int(m.group(3)) if m.group(3) else None
        if y is not None and y < 100:
            y += 2000
    try:
        if y is None:
            result = date(today.year, mo, d)
            return result if result >= today else date(today.year + 1, mo, d)
        return date(y, mo, d)
    except ValueError:
        return None


def parse_time(text: str) -> Optional[str]:
    """10:30, 10.30, 2 pm, 2:15 p. m., 14h → "HH:MM"."""
    t = _norm(text).replace(".", ":").replace(" ", "")
    m = re.match(r"(\d{1,2})(?::(\d{2}))?(?::\d{2})?(am|pm|a:m:?|p:m:?|h)?", t)
    if not m:
        return None
    h, mi = int(m.group(1)), int(m.group(2) or 0)
    suffix = (m.group(3) or "").replace(":", "")
    if suffix.startswith("p") and h < 12:
        h += 12
    if suffix.startswith("a") and h == 12:
        h = 0
    if h > 23 or mi > 59:
        return None
    return f"{h:02d}:{mi:02d}"


def slot_for(time_hhmm: str, slots: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Franja del día que contiene la hora."""
    for s in slots:
        if s["start"] <= time_hhmm < s["end"]:
            return s
    return None


def match_services(text: str, catalog: Dict[str, Any]) -> List[Tuple[Dict[str, Any], str]]:
    """Servicios del catálogo que aparecen en el texto del lead: [(servicio, categoría)]."""
    t = _norm(text)
    if not t:
        return []
    found = []
    for key, cat in catalog.items():
        hits = [svc for svc in cat.get("services") or [] if len(_norm(svc.get("name"))) >= 3 and _norm(svc.get("name")) in t]
        if hits:
            found.extend((svc, cat.get("name") or "") for svc in hits)
        # Se nombró la categoría (polarizado, ppf, ultrasecure…) sin un servicio puntual: se toma la categoría
        elif re.search(rf"\b({re.escape(_norm(cat.get('name')))}|{re.escape(_norm(key))})\b", t):
            found.append(({"id": key, "name": cat.get("name")}, cat.get("name") or ""))
    return found


def parse_iso(value: Optional[str]) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")) if value else None
    except ValueError:
        return None
