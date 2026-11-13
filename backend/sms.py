"""Envío de SMS con Twilio (API REST, sin librerías extra).

Variables en Railway:
  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN  → credenciales de la cuenta de Twilio
  TWILIO_FROM                            → número de Twilio que envía (+1..., +57...) o
  TWILIO_MESSAGING_SERVICE_SID           → servicio de mensajería (en vez de TWILIO_FROM)
  SMS_DRY_RUN=1                          → solo para pruebas: no envía nada, lo deja en el log
"""
import asyncio
import base64
import json
import logging
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional

log = logging.getLogger(__name__)


def dry_run() -> bool:
    return os.environ.get("SMS_DRY_RUN", "").strip() in ("1", "true", "yes")


def configured() -> bool:
    if dry_run():
        return True
    return bool(os.environ.get("TWILIO_ACCOUNT_SID") and os.environ.get("TWILIO_AUTH_TOKEN")
                and (os.environ.get("TWILIO_FROM") or os.environ.get("TWILIO_MESSAGING_SERVICE_SID")))


def normalize_phone(raw: Optional[str]) -> Optional[str]:
    """Celular en formato internacional. Un celular colombiano de 10 dígitos (3xx...) se vuelve +57..."""
    if not raw:
        return None
    s = re.sub(r"[^\d+]", "", str(raw))
    if s.startswith("00"):
        s = "+" + s[2:]
    if s.startswith("+"):
        return s if re.fullmatch(r"\+\d{8,15}", s) else None
    if re.fullmatch(r"3\d{9}", s):
        return "+57" + s
    if re.fullmatch(r"573\d{9}", s):
        return "+" + s
    return None


def plain_text(text: str) -> str:
    """Sin tildes ni símbolos especiales: así el SMS usa el alfabeto GSM (160 caracteres por mensaje)."""
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFKD", text or "") if not unicodedata.combining(c)).replace("ñ", "n").replace("Ñ", "N")


def mask_phone(phone: str) -> str:
    return phone[:3] + "*" * (len(phone) - 7) + phone[-4:] if len(phone) > 7 else phone


def _send_twilio(to: str, body: str) -> dict:
    sid, token = os.environ["TWILIO_ACCOUNT_SID"], os.environ["TWILIO_AUTH_TOKEN"]
    form = {"To": to, "Body": body}
    if os.environ.get("TWILIO_MESSAGING_SERVICE_SID"):
        form["MessagingServiceSid"] = os.environ["TWILIO_MESSAGING_SERVICE_SID"]
    else:
        form["From"] = os.environ["TWILIO_FROM"]
    req = urllib.request.Request(
        f"https://api.twilio.com/2010-04-01/Accounts/{urllib.parse.quote(sid)}/Messages.json",
        data=urllib.parse.urlencode(form).encode(), method="POST",
        headers={"Authorization": "Basic " + base64.b64encode(f"{sid}:{token}".encode()).decode()})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read() or b"{}")
            return {"ok": True, "id": data.get("sid"), "status": data.get("status")}
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read() or b"{}").get("message")
        except Exception:
            detail = None
        return {"ok": False, "error": detail or f"Twilio respondió {e.code}"}
    except Exception as e:  # red, timeout
        return {"ok": False, "error": f"No se pudo conectar con Twilio: {e}"}


async def send_sms(to: str, body: str) -> dict:
    """Envía un SMS. Devuelve {ok, id?, error?}. No lanza excepciones."""
    if dry_run():
        log.info(f"[sms] (simulado) a {mask_phone(to)}: {len(body)} caracteres")
        return {"ok": True, "id": "simulado", "status": "simulado"}
    if not configured():
        return {"ok": False, "error": "El envío de SMS no está configurado"}
    return await asyncio.to_thread(_send_twilio, to, body)
