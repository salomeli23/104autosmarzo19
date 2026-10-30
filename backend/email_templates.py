"""Branded email templates (dark theme) for PolarizadosYA!

Genera HTML para:
- Confirmación de cita (con QR inline via CID)
- Recibo de ingreso (check-in)
- Factura electrónica MOCK

Assets en /app/backend/assets/:
- logo.png (logo blanco sobre fondo negro)
- car_hero.png (SUV negro con luces rojas)
"""
from io import BytesIO
from pathlib import Path
from typing import List, Optional

import os

import qrcode

ASSETS_DIR = Path(__file__).parent / "assets"

# Avisos que se confirman con el cliente en el check-in (modal, correo y PDF de la orden).
# Mantener igual a CHECKIN_NOTICES en frontend/src/lib/utils.js
CHECKIN_NOTICES = [
    "Dentro de la Garantía no aplica cambio de porcentaje.",
    "El cliente acepta el porcentaje de opacidad, bajo su responsabilidad y la garantía no cubre cambio de opacidad.",
    "El cliente autoriza la movilidad del auto y dejar su llave para el proceso de instalación y servicios.",
    "No se entrega su auto si el cliente no ha realizado el pago del servicio.",
]


def _load_asset_bytes(name: str) -> Optional[bytes]:
    p = ASSETS_DIR / name
    if not p.exists():
        return None
    return p.read_bytes()


def brand_attachments() -> List[dict]:
    """Attachments con CID para logo + hero del auto. Siempre los mismos, reutilizables."""
    out = []
    logo = _load_asset_bytes("logo.png")
    if logo:
        out.append({"filename": "logo.png", "content": list(logo), "content_id": "brand-logo"})
    car = _load_asset_bytes("car_hero.png")
    if car:
        out.append({"filename": "car_hero.png", "content": list(car), "content_id": "brand-car"})
    return out


# ============================================================
# QR helper
# ============================================================
def qr_png_bytes(code: str) -> bytes:
    """QR negro sobre blanco con margen (zona de silencio): así lo leen todas las cámaras."""
    qr = qrcode.QRCode(version=1, box_size=12, border=4,
                       error_correction=qrcode.constants.ERROR_CORRECT_M)
    qr.add_data(code)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#000000", back_color="#ffffff")
    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def qr_attachment(code: str, cid: str = "qr-code"):
    """QR embebido en el cuerpo del correo (cid:)."""
    return {
        "filename": "qr.png",
        "content": list(qr_png_bytes(code)),
        "content_id": cid,
    }


def appointment_qr_attachments(code: str, cid: str = "qr-code") -> List[dict]:
    """QR de la cita: embebido en el cuerpo y también como archivo adjunto visible."""
    png = list(qr_png_bytes(code))
    return [
        {"filename": "qr.png", "content": png, "content_id": cid},
        {"filename": f"QR_cita_{code}.png", "content": png},
    ]


def public_qr_url(code: str) -> Optional[str]:
    """URL pública del QR (respaldo si el cliente de correo no muestra la imagen embebida)."""
    base = (os.environ.get("PUBLIC_API_URL") or "").rstrip("/")
    if not base and os.environ.get("RAILWAY_PUBLIC_DOMAIN"):
        base = f"https://{os.environ['RAILWAY_PUBLIC_DOMAIN']}"
    if not base or not code:
        return None
    return f"{base}/api/public/qr/{code}.png"


def _fmt_money(v) -> str:
    try:
        return f"${float(v or 0):,.0f}"
    except Exception:
        return "$0"


def _fmt_date(iso: str) -> str:
    if not iso:
        return "-"
    try:
        from datetime import datetime
        import re
        if "T" in iso:
            dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
            months = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"]
            return f"{dt.day} de {months[dt.month-1]} de {dt.year}"
        y, m, d = iso.split("-")
        months = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"]
        return f"{int(d)} de {months[int(m)-1]} de {y}"
    except Exception:
        return iso


# ============================================================
# Base layout (dark PolarizadosYA! theme)
# ============================================================
_BASE_CSS = """
  body { background:#0a0a0a; color:#e5e5e5; font-family:'Helvetica Neue',Arial,sans-serif; margin:0; padding:0; }
  .wrap { max-width:600px; margin:0 auto; background:#0a0a0a; padding:0; }
  .hero { padding:0 24px 0; }
  .hero-banner { width:100%; height:180px; background:#0a0a0a center/cover no-repeat; border-radius:0 0 18px 18px; }
  .brand-row { display:flex; justify-content:space-between; align-items:center; padding:18px 0 12px; }
  .brand-logo { height:44px; }
  .logo { color:#ffffff; font-size:22px; font-weight:900; letter-spacing:0.5px; }
  .logo small { display:block; font-size:9px; font-weight:400; letter-spacing:2px; color:#888; margin-top:2px; }
  .tag { text-align:right; color:#ffffff; font-size:11px; letter-spacing:1.5px; }
  .tag span { display:block; color:#00e0d1; font-weight:bold; margin-top:3px; }
  .thanks { color:#888; font-size:10px; letter-spacing:2px; margin-bottom:6px; }
  .title { color:#ffffff; font-size:34px; font-weight:900; line-height:1.1; margin:0 0 10px; }
  .subtitle { color:#ccc; font-size:13px; line-height:1.5; margin:0 0 20px; }
  .icons-row { display:flex; gap:14px; padding:14px 0 20px; border-top:1px solid #1a1a1a; border-bottom:1px solid #1a1a1a; }
  .icon-cell { flex:1; text-align:center; }
  .icon-cell .ic { font-size:22px; color:#00e0d1; display:block; margin-bottom:4px; }
  .icon-cell .tx { font-size:9px; color:#aaa; letter-spacing:1.2px; line-height:1.4; }
  .card { background:#111111; border:1px solid #1f1f1f; border-radius:14px; padding:18px; margin:14px 0; }
  .card-row { display:flex; gap:12px; }
  .card-half { flex:1; padding:12px; background:#0d0d0d; border-radius:10px; }
  .lbl { color:#777; font-size:9px; letter-spacing:1.5px; margin-bottom:4px; text-transform:uppercase; }
  .val { color:#ffffff; font-size:15px; font-weight:600; }
  .val-lg { font-size:22px; font-weight:900; letter-spacing:1px; }
  .val-sm { color:#bbb; font-size:11px; margin-top:3px; }
  .val-accent { color:#00e0d1; }
  .total-row { display:flex; justify-content:space-between; align-items:center; }
  .total-row .total-val { color:#ffffff; font-size:26px; font-weight:900; letter-spacing:1px; }
  .note { color:#aaa; font-size:10px; line-height:1.4; }
  .qr-card { display:flex; gap:14px; align-items:center; }
  .qr-img { width:200px; height:200px; background:#ffffff; border-radius:10px; padding:8px; }
  .qr-txt { flex:1; color:#ccc; font-size:12px; line-height:1.5; }
  .notes-list { margin:0; padding:0; }
  .note-item { display:flex; gap:10px; margin-bottom:10px; }
  .note-num { background:#1a1a1a; color:#00e0d1; font-weight:700; font-size:12px; width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
  .note-txt { flex:1; color:#ddd; font-size:12px; line-height:1.5; }
  .note-txt b { color:#fff; }
  .footer { padding:22px 24px; border-top:1px solid #1a1a1a; margin-top:18px; }
  .footer-row { display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px; }
  .footer-cell { flex:1; min-width:150px; }
  .footer-lbl { color:#777; font-size:9px; letter-spacing:1.5px; margin-bottom:3px; }
  .footer-val { color:#fff; font-size:12px; font-weight:600; }
  .footer-btm { text-align:center; color:#666; font-size:10px; padding:12px 0 18px; }
  .footer-logo { height:28px; display:block; margin:0 auto 8px; }
"""

_ICONS_ROW = """
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #1a1a1a;border-bottom:1px solid #1a1a1a;margin:18px 0;">
  <tr>
    <td align="center" style="padding:12px 4px;">
      <div style="font-size:22px;color:#00e0d1;">🛡</div>
      <div style="font-size:9px;color:#aaa;letter-spacing:1.2px;margin-top:4px;">MAYOR<br>SEGURIDAD</div>
    </td>
    <td align="center" style="padding:12px 4px;">
      <div style="font-size:22px;color:#00e0d1;">☀</div>
      <div style="font-size:9px;color:#aaa;letter-spacing:1.2px;margin-top:4px;">CONFORT<br>TÉRMICO</div>
    </td>
    <td align="center" style="padding:12px 4px;">
      <div style="font-size:22px;color:#00e0d1;">👁</div>
      <div style="font-size:9px;color:#aaa;letter-spacing:1.2px;margin-top:4px;">PRIVACIDAD<br>Y ESTILO</div>
    </td>
    <td align="center" style="padding:12px 4px;">
      <div style="font-size:22px;color:#00e0d1;">⚙</div>
      <div style="font-size:9px;color:#aaa;letter-spacing:1.2px;margin-top:4px;">SERVICIO<br>PROFESIONAL</div>
    </td>
  </tr>
</table>
"""


def _wrap(title_badge: str, title: str, subtitle: str, body: str, notes: Optional[List[str]] = None) -> str:
    notes_html = ""
    if notes:
        items = "".join(
            f"<div class='note-item'><div class='note-num'>{i+1}</div><div class='note-txt'>{n}</div></div>"
            for i, n in enumerate(notes)
        )
        notes_html = f"""
        <div class='card' style='margin-top:16px;'>
          <div style='display:flex;gap:8px;align-items:center;margin-bottom:10px;'>
            <div style='font-size:16px;color:#00e0d1;'>📋</div>
            <div style='color:#fff;font-size:13px;font-weight:700;'>Notas importantes</div>
          </div>
          {items}
        </div>"""

    logo_html = (
        "<img src='cid:brand-logo' alt='PolarizadosYA!' class='brand-logo' />"
        if _load_asset_bytes("logo.png")
        else "<div class='logo'>POLARIZADOS YA!<small>TU SEGURIDAD Y CONFORT ES NUESTRO TRABAJO</small></div>"
    )
    car_html = (
        "<div class='hero-banner' style=\"background-image:url('cid:brand-car');\"></div>"
        if _load_asset_bytes("car_hero.png")
        else ""
    )
    logo_footer_html = (
        "<img src='cid:brand-logo' alt='PolarizadosYA!' class='footer-logo' />"
        if _load_asset_bytes("logo.png")
        else "<div style='color:#fff;font-weight:700;'>POLARIZADOS YA!</div>"
    )

    return f"""<!DOCTYPE html>
<html lang='es'>
<head>
  <meta charset='UTF-8'>
  <meta name='viewport' content='width=device-width,initial-scale=1'>
  <style>{_BASE_CSS}</style>
</head>
<body>
  <div class='wrap'>
    {car_html}
    <div class='hero'>
      <div class='brand-row'>
        {logo_html}
        <div class='tag'>{title_badge.split('|')[0]}<span>{title_badge.split('|')[1] if '|' in title_badge else ''}</span></div>
      </div>
      <div class='thanks'>— GRACIAS POR ELEGIRNOS</div>
      <h1 class='title'>{title}</h1>
      <p class='subtitle'>{subtitle}</p>
    </div>

    {_ICONS_ROW}

    <div style='padding:0 24px;'>
      {body}
      {notes_html}
    </div>

    <div class='footer'>
      <div class='footer-row'>
        <div class='footer-cell'>
          <div class='footer-lbl'>SEDE 138</div>
          <div class='footer-val'>310 601 8633</div>
        </div>
        <div class='footer-cell'>
          <div class='footer-lbl'>POSTVENTA / GARANTÍAS</div>
          <div class='footer-val'>317 801 6319</div>
        </div>
        <div class='footer-cell'>
          <div class='footer-lbl'>NUESTRA PÁGINA WEB</div>
          <div class='footer-val'>WWW.POLARIZADOSYA.COM</div>
        </div>
      </div>
    </div>

    <div class='footer-btm'>
      {logo_footer_html}
      polarizadosya.com
    </div>
  </div>
</body>
</html>"""


def _small_card(label: str, value: str, subvalue: Optional[str] = None) -> str:
    sub = f"<div class='val-sm'>{subvalue}</div>" if subvalue else ""
    return f"""
    <div class='card-half'>
      <div class='lbl'>{label}</div>
      <div class='val'>{value}</div>
      {sub}
    </div>"""


def _services_html(order: dict) -> str:
    items = []
    for svc in (order.get("services") or []):
        name = svc.get("description") or svc.get("service") or "Servicio"
        price = float(svc.get("price") or 0)
        parts = svc.get("parts") or []
        parts_txt = f" · {', '.join(parts[:4])}" if parts else ""
        items.append(
            f"<div style='display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1a1a1a;'>"
            f"<div style='color:#ddd;font-size:12px;'>{name}{parts_txt}</div>"
            f"<div style='color:#fff;font-size:13px;font-weight:700;'>{_fmt_money(price)}</div>"
            f"</div>"
        )
    return "".join(items)


# ============================================================
# 1) CONFIRMACIÓN DE CITA
# ============================================================
def build_appointment_confirmation_html(order: dict, qr_cid: str = "qr-code") -> str:
    code = order.get("order_code", "")
    date_str = _fmt_date(order.get("date", ""))
    time_str = order.get("scheduled_time", "")
    total = float(order.get("negotiated_value") or order.get("final_value") or 0)
    services_first = (order.get("services") or [{}])[0]
    service_label = services_first.get("description") or services_first.get("service", "")
    qr_url = public_qr_url(code)
    qr_link_html = (
        f"<br><a href='{qr_url}' style='color:#00e0d1;'>¿No ves el QR? Ábrelo aquí</a>" if qr_url else ""
    )

    body = f"""
    <div class='card'>
      <div class='card-row'>
        <div class='card-half' style='border-left:3px solid #00e0d1;'>
          <div class='lbl'>Código de tu cita</div>
          <div class='val val-lg'>{code}</div>
        </div>
        <div class='card-half'>
          <div class='lbl'>Hora de tu cita</div>
          <div class='val val-lg'>{time_str}</div>
          <div class='val-sm'>{date_str}</div>
        </div>
      </div>
    </div>

    <div class='card-row'>
      {_small_card('Cliente', order.get('client_name', '-'))}
      {_small_card('Vehículo', f"{order.get('plate', '')} — {order.get('brand', '')} {order.get('model', '')}".strip())}
    </div>

    <div class='card-row'>
      {_small_card('Fecha', date_str)}
      {_small_card('Servicio', service_label or 'Polarizado', order.get('route_rule_name'))}
    </div>

    <div class='card'>
      <div class='total-row'>
        <div>
          <div class='lbl'>Total</div>
          <div class='total-val'>{_fmt_money(total)} COP</div>
        </div>
        <div class='note' style='max-width:180px;text-align:right;'>
          🪙 Los precios no incluyen IVA.
        </div>
      </div>
    </div>

    <div class='card' style='text-align:center;'>
      <div class='lbl' style='margin-bottom:10px;'>QR de tu cita</div>
      <table role='presentation' cellpadding='0' cellspacing='0' border='0' align='center' style='margin:0 auto;'>
        <tr><td style='background:#ffffff;border-radius:12px;padding:10px;'>
          <img src='cid:{qr_cid}' alt='QR de la cita {code}' width='220' height='220'
               style='display:block;width:220px;height:220px;border:0;' />
        </td></tr>
      </table>
      <div class='val val-lg' style='margin-top:10px;'>{code}</div>
      <div class='qr-txt' style='margin-top:8px;'>
        <b style='color:#fff;'>Presenta este QR o el código al llegar.</b><br>
        El check-in estará disponible a partir de las <b style='color:#00e0d1;'>{time_str}</b>.<br>
        También lo encuentras como archivo adjunto <b style='color:#fff;'>QR_cita_{code}.png</b>.
        {qr_link_html}
      </div>
    </div>
    """

    notes = [
        "<b>Tu cita solo estará habilitada hasta la hora indicada.</b><br>Si llegas después de la hora, será necesario reprogramar según disponibilidad.",
        "<b>Los precios no incluyen IVA.</b><br>El valor final puede variar según los servicios que agregues en tu cita.",
        "<b>En tu cita podrás añadir más servicios o cambiar el tipo de servicio.</b><br>Nuestro equipo te asesorará para elegir la mejor opción según tus necesidades.",
    ]

    return _wrap(
        title_badge=f"CITA CONFIRMADA|#{code}",
        title="¡Tu cita está confirmada!",
        subtitle=f"Nos vemos pronto en Polarizados Ya. A continuación, encontrarás todos los detalles de tu cita.",
        body=body,
        notes=notes,
    )


# ============================================================
# 2) RECIBO DE INGRESO (Check-in)
# ============================================================
def build_ingreso_html(order: dict, pdf_attached: bool = True, photo_count: int = 0,
                       signed_order_attached: bool = False) -> str:
    code = order.get("order_code", "")
    date_str = _fmt_date(order.get("date", ""))
    time_str = order.get("scheduled_time", "")
    total = float(order.get("final_value") or order.get("negotiated_value") or 0)
    paid = float(order.get("amount_paid") or 0)
    balance = max(total - paid, 0)

    body = f"""
    <div class='card'>
      <div class='card-row'>
        <div class='card-half' style='border-left:3px solid #00e0d1;'>
          <div class='lbl'>Código de tu orden</div>
          <div class='val val-lg'>{code}</div>
        </div>
        <div class='card-half'>
          <div class='lbl'>Hora de ingreso</div>
          <div class='val val-lg'>{time_str}</div>
          <div class='val-sm'>{date_str}</div>
        </div>
      </div>
    </div>

    <div class='card-row'>
      {_small_card('Cliente', order.get('client_name', '-'))}
      {_small_card('Vehículo', f"{order.get('plate', '')} — {order.get('brand', '')} {order.get('model', '')}".strip())}
    </div>

    <div class='card'>
      <div class='lbl' style='margin-bottom:8px;'>Servicios contratados</div>
      {_services_html(order)}
      <div class='total-row' style='margin-top:12px;padding-top:10px;border-top:1px solid #1f1f1f;'>
        <div>
          <div class='lbl'>Total</div>
          <div class='total-val'>{_fmt_money(total)} COP</div>
        </div>
        <div style='text-align:right;'>
          <div class='lbl'>Abonado</div>
          <div class='val val-accent' style='font-size:16px;'>{_fmt_money(paid)}</div>
          <div class='lbl' style='margin-top:6px;'>Saldo pendiente</div>
          <div class='val' style='color:#f97316;font-size:16px;'>{_fmt_money(balance)}</div>
        </div>
      </div>
    </div>

    <div class='card' style='border-left:3px solid #dc2626;background:rgba(220,38,38,0.08);'>
      <div style='display:flex;gap:6px;align-items:center;margin-bottom:8px;'>
        <span style='font-size:16px;color:#ef4444;'>⚠</span>
        <b style='color:#ef4444;font-size:12px;letter-spacing:0.5px;'>AVISOS IMPORTANTES</b>
      </div>
      <ol style='margin:0;padding-left:18px;color:#f87171;font-size:12px;line-height:1.6;'>
        {''.join(f"<li style='margin-bottom:6px;'><b>{n}</b></li>" for n in CHECKIN_NOTICES)}
      </ol>
      <div style='color:#999;font-size:10px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(220,38,38,0.25);'>
        Firmado digitalmente por el cliente al ingreso. Válido como constancia de aceptación.
      </div>
    </div>
    """

    attachments_note = ""
    if pdf_attached or photo_count or signed_order_attached:
        parts = []
        if signed_order_attached:
            parts.append("📝 <b>Orden de pedido firmada</b> (PDF)")
        if pdf_attached:
            parts.append("📄 <b>Recibo firmado</b> (PDF)")
        if photo_count:
            parts.append(f"📷 <b>{photo_count} foto(s)</b> de la revisión 360°")
        attachments_note = f"<div class='card' style='margin-top:10px;'><div class='lbl'>Adjuntos en este correo</div><div style='color:#ddd;font-size:12px;line-height:1.6;'>{' · '.join(parts)}</div></div>"
    body += attachments_note

    notes = [
        "<b>Recibe tu recibo firmado.</b><br>Adjuntamos el PDF con tu firma y el saldo pendiente.",
        "<b>Verifica las fotos de la Revisión 360°.</b><br>Si notas algo que no coincida, avísanos antes de la entrega.",
        "<b>Completa tu pago antes de la entrega.</b><br>El vehículo queda listo para entrega cuando el saldo sea $0.",
    ]

    return _wrap(
        title_badge=f"RECIBO DE INGRESO|#{code}",
        title="¡Recibo de ingreso de tu vehículo!",
        subtitle=f"Tu {order.get('brand','')} {order.get('model','')} ({order.get('plate','').upper()}) ya está con nosotros. Aquí tienes los detalles del servicio y saldo.",
        body=body,
        notes=notes,
    )


# ============================================================
# 3) FACTURA ELECTRÓNICA MOCK
# ============================================================
def build_invoice_html(order: dict, invoice_number: str, is_mock: bool = True) -> str:
    code = order.get("order_code", "")
    total = float(order.get("final_value") or order.get("negotiated_value") or 0)
    retention = order.get("retention_snapshot") or {}
    reteica = float(retention.get("reteica_amount") or 0)
    retefuente = float(retention.get("retefuente_amount") or 0)
    neto = total - reteica - retefuente

    ret_rows = ""
    if reteica > 0:
        ret_rows += f"<div style='display:flex;justify-content:space-between;padding:6px 0;color:#f87171;font-size:12px;'><span>− Reteica {retention.get('reteica_rate')}{'/1000' if retention.get('reteica_unit') == 'por_mil' else '%'}</span><span class='val-sm' style='color:#f87171;'>-{_fmt_money(reteica)}</span></div>"
    if retefuente > 0:
        ret_rows += f"<div style='display:flex;justify-content:space-between;padding:6px 0;color:#f87171;font-size:12px;'><span>− Retefuente {retention.get('retefuente_rate')}%</span><span class='val-sm' style='color:#f87171;'>-{_fmt_money(retefuente)}</span></div>"

    body = f"""
    <div class='card'>
      <div class='card-row'>
        <div class='card-half' style='border-left:3px solid #00e0d1;'>
          <div class='lbl'>Número de factura</div>
          <div class='val val-lg'>{invoice_number}</div>
        </div>
        <div class='card-half'>
          <div class='lbl'>Orden</div>
          <div class='val val-lg'>{code}</div>
        </div>
      </div>
    </div>

    <div class='card-row'>
      {_small_card('Cliente', order.get('client_name', '-'), f"NIT: {order.get('client_cedula') or '-'}")}
      {_small_card('Razón Social', order.get('client_razon_social') or order.get('client_name', '-'))}
    </div>

    <div class='card'>
      <div class='lbl' style='margin-bottom:8px;'>Detalle</div>
      {_services_html(order)}
      <div style='margin-top:12px;padding-top:10px;border-top:1px solid #1f1f1f;'>
        <div style='display:flex;justify-content:space-between;padding:6px 0;'><span class='val-sm'>Subtotal</span><span class='val'>{_fmt_money(total)}</span></div>
        {ret_rows}
        <div style='display:flex;justify-content:space-between;padding:10px 0 0;border-top:1px solid #1f1f1f;margin-top:8px;'>
          <span style='color:#fff;font-weight:700;'>Total a pagar</span>
          <span class='total-val' style='font-size:22px;color:#00e0d1;'>{_fmt_money(neto)} COP</span>
        </div>
      </div>
    </div>
    """

    mock_note = "<div class='card' style='border-left:3px solid #fbbf24;margin-top:10px;'><div style='color:#fbbf24;font-size:11px;line-height:1.6;'>⚠ <b>DOCUMENTO DE PRUEBA (MOCK)</b><br>Esta factura NO tiene validez fiscal. La factura oficial DIAN se generará cuando conectemos con Siigo.</div></div>" if is_mock else ""
    body += mock_note

    notes = [
        "<b>Factura electrónica (MOCK).</b><br>La versión oficial se enviará una vez conectemos con el proveedor DIAN.",
        "<b>Retenciones aplicadas según norma colombiana.</b><br>Si tienes dudas sobre las tasas, contáctanos.",
        "<b>Presenta esta factura para garantías.</b><br>Guárdala junto al recibo de ingreso para cualquier reclamo.",
    ]

    return _wrap(
        title_badge=f"FACTURA ELECTRÓNICA|{invoice_number}",
        title="¡Tu factura electrónica está lista!",
        subtitle=f"Te enviamos la factura de la orden {code}. {('⚠ Documento de prueba (MOCK).' if is_mock else '')}",
        body=body,
        notes=notes,
    )
