"""PDF generation helpers for Polarizados Manager.

Generates:
- Recibo de Ingreso (Check-in) con firma y saldo pendiente
- Estado de Cuenta tras registrar un pago
- Factura Electronica MOCK (numeración DIAN simulada)
"""
import os
from datetime import datetime, timedelta, timezone
from io import BytesIO
from typing import List, Optional

from email_templates import CHECKIN_NOTICES
from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    Image,
    PageBreak,
)

COLOMBIA_TZ = timezone(timedelta(hours=-5))
BRAND_COLOR = colors.HexColor("#00e0d1")
DARK_COLOR = colors.HexColor("#0f172a")
MUTED_COLOR = colors.HexColor("#64748b")


def _fmt_money(v) -> str:
    try:
        return f"${float(v or 0):,.0f}"
    except Exception:
        return "$0"


def _fmt_dt(iso: Optional[str]) -> str:
    if not iso:
        return "-"
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d %H:%M")
    except Exception:
        return iso


def _header(story, title: str, subtitle: str = ""):
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "TitleBrand", parent=styles["Title"],
        textColor=DARK_COLOR, fontSize=20, spaceAfter=2, alignment=0,
    )
    subtitle_style = ParagraphStyle(
        "Sub", parent=styles["Normal"],
        textColor=MUTED_COLOR, fontSize=10, spaceAfter=8,
    )
    story.append(Paragraph(f"<b>PolarizadosYA! · {title}</b>", title_style))
    if subtitle:
        story.append(Paragraph(subtitle, subtitle_style))
    story.append(Spacer(1, 0.3 * cm))


def _kv_table(rows):
    tbl = Table(rows, colWidths=[4.5 * cm, 12 * cm])
    tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 0), (0, -1), MUTED_COLOR),
        ("TEXTCOLOR", (1, 0), (1, -1), DARK_COLOR),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return tbl


def _services_table(services):
    data = [["Servicio", "Piezas / Detalle", "Valor"]]
    for s in services or []:
        name = s.get("service") or "-"
        detail_bits = []
        if s.get("parts"):
            detail_bits.append(", ".join(s["parts"]))
        pct = s.get("part_percentages") or {}
        if pct:
            detail_bits.append(" ".join(f"{k}:{v}" for k, v in pct.items()))
        if s.get("ppf_scope"):
            scope_lbl = "Full Body" if s["ppf_scope"] == "full" else "Partes"
            detail_bits.append(f"PPF: {scope_lbl}")
        if s.get("ppf_finish"):
            detail_bits.append(f"Acabado: {str(s['ppf_finish']).capitalize()}")
        if s.get("ppf_color"):
            detail_bits.append(f"Color: {s['ppf_color']}")
        if s.get("ppf_zones"):
            detail_bits.append("Zonas: " + ", ".join(str(z).capitalize() for z in s["ppf_zones"]))
        if s.get("ppf_parts"):
            detail_bits.append("Partes: " + ", ".join(s["ppf_parts"]))
        # Solo mostrar descripción libre si no hay campos estructurados (órdenes antiguas)
        if s.get("ppf_parts_description") and not (s.get("ppf_finish") or s.get("ppf_parts")):
            detail_bits.append(s["ppf_parts_description"])
        for ex in s.get("extras") or []:
            detail_bits.append(f"+ {ex.get('nombre')} ({_fmt_money(ex.get('price'))})")
        detail = "\n".join(detail_bits) or "-"
        data.append([name, detail, _fmt_money(s.get("price"))])
    tbl = Table(data, colWidths=[6 * cm, 8 * cm, 3 * cm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BRAND_COLOR),
        ("TEXTCOLOR", (0, 0), (-1, 0), DARK_COLOR),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (2, 0), (2, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
    ]))
    return tbl


def _retention(order: dict) -> float:
    """Reteica + Retefuente que retiene el cliente: no la paga."""
    snap = order.get("retention_snapshot") or {}
    return float(snap.get("total_retention") or 0) if order.get("retention_applied") else 0.0


def _totals_table(total, paid, balance, payment_method=None, requires_invoice=False, retention=0.0):
    rows = [
        ["Total", _fmt_money(total)],
        ["Método de pago", (payment_method or "-").capitalize()],
    ]
    if requires_invoice:
        rows.append(["Factura electrónica", "Solicitada (+IVA 19%)"])
    if retention:
        rows.append(["Retenciones", f"-{_fmt_money(retention)}"])
    rows += [
        ["Abonos", _fmt_money(paid)],
        ["Saldo pendiente", _fmt_money(balance)],
    ]
    tbl = Table(rows, colWidths=[4.5 * cm, 4.5 * cm])
    tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (0, -1), MUTED_COLOR),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEABOVE", (0, -1), (-1, -1), 1, DARK_COLOR),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("TEXTCOLOR", (0, -1), (-1, -1), colors.HexColor("#dc2626") if float(balance or 0) > 0 else colors.HexColor("#16a34a")),
    ]))
    return tbl


def _b64_to_image(b64_url: str, width_cm: float = 6, height_cm: float = 3) -> Optional[Image]:
    try:
        if not b64_url:
            return None
        raw = b64_url.split(",", 1)[1] if b64_url.startswith("data:") else b64_url
        import base64 as _b64
        data = _b64.b64decode(raw)
        return Image(BytesIO(data), width=width_cm * cm, height=height_cm * cm)
    except Exception:
        return None


def build_ingreso_receipt(order: dict) -> bytes:
    """PDF de recibo de check-in con firma y saldo pendiente."""
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=LETTER,
        leftMargin=1.5 * cm, rightMargin=1.5 * cm,
        topMargin=1.5 * cm, bottomMargin=1.5 * cm,
    )
    story = []
    subtitle = f"Recibo de Ingreso · Orden {order.get('order_code', '')} · {_fmt_dt(order.get('ingreso_at'))}"
    _header(story, "Recibo de Ingreso", subtitle)

    total = float(order.get("final_value") or order.get("negotiated_value") or 0)
    paid = float(order.get("amount_paid") or 0)
    retention = _retention(order)
    balance = max(total - retention - paid, 0)

    story.append(_kv_table([
        ["Cliente", order.get("client_name") or "-"],
        ["Cédula", order.get("client_cedula") or "-"],
        ["Teléfono", order.get("client_phone") or "-"],
        ["Correo", order.get("client_email") or "-"],
        ["Placa", (order.get("plate") or "").upper()],
        ["Vehículo", f"{order.get('brand', '')} {order.get('model', '')}".strip() or "-"],
    ]))
    story.append(Spacer(1, 0.4 * cm))

    story.append(Paragraph("<b>Servicios contratados</b>", getSampleStyleSheet()["Heading4"]))
    story.append(_services_table(order.get("services") or []))
    story.append(Spacer(1, 0.4 * cm))

    story.append(_totals_table(
        total, paid, balance,
        payment_method=order.get("payment_method"),
        requires_invoice=bool(order.get("requires_invoice")),
        retention=retention,
    ))
    story.append(Spacer(1, 0.6 * cm))

    # Signature
    sig_img = _b64_to_image(order.get("signature_url") or "", width_cm=6, height_cm=2.5)
    if sig_img:
        story.append(Paragraph("<b>Firma del cliente</b>", getSampleStyleSheet()["Heading4"]))
        story.append(sig_img)
    else:
        story.append(Paragraph("<i>Firma no registrada.</i>", getSampleStyleSheet()["Italic"]))

    story.append(Spacer(1, 0.4 * cm))
    story.append(Paragraph(
        "<font size=8 color='#64748b'>Este documento es un recibo de ingreso. El cliente reconoce y acepta los términos y saldo indicado. "
        "PolarizadosYA! no se hace responsable por objetos personales dejados dentro del vehículo.</font>",
        getSampleStyleSheet()["Normal"],
    ))

    # Avisos importantes (en rojo), confirmados con el cliente en el check-in
    story.append(Spacer(1, 0.3 * cm))
    warn_style = ParagraphStyle(
        "Warn", parent=getSampleStyleSheet()["Normal"],
        textColor=colors.HexColor("#dc2626"), fontSize=9, leading=12,
    )
    warn_title_style = ParagraphStyle(
        "WarnTitle", parent=warn_style,
        textColor=colors.HexColor("#b91c1c"), fontSize=10, spaceAfter=3,
    )
    story.append(Paragraph("<b>AVISOS IMPORTANTES</b>", warn_title_style))
    story.append(Paragraph(
        "<br/>".join(f"<b>{i}. {n}</b>" for i, n in enumerate(CHECKIN_NOTICES, start=1)),
        warn_style,
    ))

    doc.build(story)
    return buf.getvalue()


def build_payment_statement(order: dict, payments: List[dict]) -> bytes:
    """PDF estado de cuenta después de un pago."""
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=LETTER,
        leftMargin=1.5 * cm, rightMargin=1.5 * cm,
        topMargin=1.5 * cm, bottomMargin=1.5 * cm,
    )
    story = []
    subtitle = f"Estado de Cuenta · Orden {order.get('order_code', '')} · {_fmt_dt(datetime.now(timezone.utc).isoformat())}"
    _header(story, "Estado de Cuenta", subtitle)

    total = float(order.get("final_value") or order.get("negotiated_value") or 0)
    paid = float(order.get("amount_paid") or 0)
    retention = _retention(order)
    balance = max(total - retention - paid, 0)

    story.append(_kv_table([
        ["Cliente", order.get("client_name") or "-"],
        ["Cédula", order.get("client_cedula") or "-"],
        ["Placa", (order.get("plate") or "").upper()],
        ["Vehículo", f"{order.get('brand', '')} {order.get('model', '')}".strip() or "-"],
    ]))
    story.append(Spacer(1, 0.4 * cm))

    if payments:
        story.append(Paragraph("<b>Movimientos de pago</b>", getSampleStyleSheet()["Heading4"]))
        data = [["Fecha", "Método", "Referencia", "Monto"]]
        for p in payments:
            data.append([
                _fmt_dt(p.get("created_at")),
                (p.get("method") or "-").capitalize(),
                p.get("reference") or "-",
                _fmt_money(p.get("amount")),
            ])
        tbl = Table(data, colWidths=[4 * cm, 3 * cm, 6 * cm, 4 * cm])
        tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), BRAND_COLOR),
            ("TEXTCOLOR", (0, 0), (-1, 0), DARK_COLOR),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 9),
            ("ALIGN", (3, 0), (3, -1), "RIGHT"),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
        ]))
        story.append(tbl)
        story.append(Spacer(1, 0.4 * cm))

    story.append(_totals_table(total, paid, balance, payment_method=order.get("payment_method"), retention=retention))
    story.append(Spacer(1, 0.6 * cm))

    if balance <= 0:
        msg = "Su cuenta se encuentra al día. Gracias por su preferencia."
        col = "#16a34a"
    else:
        msg = f"Saldo pendiente: {_fmt_money(balance)}. Le agradecemos completar el pago para autorizar la entrega."
        col = "#dc2626"

    story.append(Paragraph(f"<font color='{col}'><b>{msg}</b></font>", getSampleStyleSheet()["Normal"]))

    doc.build(story)
    return buf.getvalue()


# Datos de la empresa para la factura electrónica (formato Siigo de AUTOS 104 SAS)
INVOICE_COMPANY = {
    "name": "AUTOS 104 SAS",
    "nit": "900.497.413-6",
    "address": "CALLE 127 B # 45 13",
    "phone": "Tel: (57) 3115318401",
    "city": "Bogotá - Colombia",
    "email": "autos_104@hotmail.com",
    "logo": os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "logo_autos104.png"),
    "legal": (
        "A esta factura de venta aplican las normas relativas a la letra de cambio (artículo 5 Ley 1231 de 2008). "
        "Con esta el Comprador declara haber recibido real y materialmente las mercancías o prestación de servicios "
        "descritos en este título - Valor. <b>Número Autorización Electrónica 18764109192361 aprobado en 20260430 "
        "prefijo FE desde el número 3001 al 5000 Vigencia: 24 Meses</b>"
    ),
    "activity": "Responsable de IVA - Actividad Económica 4512  Comercio de vehículos automotores usados Tarifa 6.9 X 1.000",
}

PAYMENT_METHOD_LABELS = {
    "efectivo": "Efectivo", "tarjeta": "Tarjeta", "transferencia": "Transferencia",
    "nequi": "Nequi", "daviplata": "Daviplata", "otro": "Otro",
}

_UNITS = ["", "un", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez",
          "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve",
          "veinte", "veintiún", "veintidós", "veintitrés", "veinticuatro", "veinticinco", "veintiséis",
          "veintisiete", "veintiocho", "veintinueve"]
_TENS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"]
_HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos",
             "setecientos", "ochocientos", "novecientos"]


def _words_999(n: int) -> str:
    if n == 100:
        return "cien"
    h, r = divmod(n, 100)
    parts = [_HUNDREDS[h]] if h else []
    if r < 30:
        if r:
            parts.append(_UNITS[r])
    else:
        t, u = divmod(r, 10)
        parts.append(_TENS[t] + (f" y {_UNITS[u]}" if u else ""))
    return " ".join(parts)


def _amount_in_words(value: float) -> str:
    """Valor en letras al estilo de la factura: 'Un millón seiscientos mil pesos m/cte con un cent.'"""
    cents = int(round(value * 100)) % 100
    n = int(round(value * 100)) // 100
    if n == 0:
        words = "cero"
    else:
        millions, rest = divmod(n, 1_000_000)
        thousands, units = divmod(rest, 1000)
        parts = []
        if millions:
            parts.append("un millón" if millions == 1 else f"{_amount_in_words_int(millions)} millones")
        if thousands:
            parts.append("mil" if thousands == 1 else f"{_words_999(thousands)} mil")
        if units:
            parts.append(_words_999(units))
        words = " ".join(parts)
    de = " de" if n and n % 1_000_000 == 0 else ""
    text = f"{words}{de} pesos m/cte"
    if cents:
        text += f" con {_words_999(cents)} cent."
    return text[0].upper() + text[1:]


def _amount_in_words_int(n: int) -> str:
    thousands, units = divmod(n, 1000)
    parts = []
    if thousands:
        parts.append("mil" if thousands == 1 else f"{_words_999(thousands)} mil")
    if units:
        parts.append(_words_999(units))
    return " ".join(parts)


def _num(v) -> str:
    """Formato de la factura: 1,344,537.82"""
    return f"{float(v or 0):,.2f}"


def build_mock_invoice(order: dict, invoice_number: str) -> bytes:
    """Factura electrónica de venta con el formato de AUTOS 104 SAS (Siigo).
    La numeración es la del sistema (simulada) hasta la integración con Siigo: no lleva CUFE real."""
    import qrcode as _qrcode

    buf = BytesIO()
    page_w, page_h = LETTER
    doc = SimpleDocTemplate(buf, pagesize=LETTER, leftMargin=1 * cm, rightMargin=1 * cm,
                            topMargin=0.8 * cm, bottomMargin=0.8 * cm)
    width = page_w - 2 * cm
    styles = getSampleStyleSheet()
    normal = ParagraphStyle("FeN", parent=styles["Normal"], fontName="Helvetica", fontSize=8, leading=10)
    center = ParagraphStyle("FeC", parent=normal, alignment=1)
    small_center = ParagraphStyle("FeSC", parent=normal, fontSize=7, leading=8.5, alignment=1)
    heading = ParagraphStyle("FeH", parent=normal, fontName="Helvetica-Bold", fontSize=11, leading=13)
    grid = colors.HexColor("#c8c8c8")
    co = INVOICE_COMPANY

    total = float(order.get("final_value") or order.get("negotiated_value") or 0)
    with_iva = bool(order.get("requires_invoice"))
    if with_iva:
        tax_base = float(order["tax_base"]) if order.get("tax_base") is not None else round(total / 1.19, 2)
    else:
        tax_base = total
    iva = round(total - tax_base, 2)
    discount = float(order.get("discount_amount") or 0)
    gross = tax_base + discount  # Total bruto antes del descuento (sin IVA)
    disc_pct = round(discount / gross * 100, 2) if gross and discount else 0
    issued = order.get("invoice_sent_at") or datetime.now(timezone.utc).isoformat()
    try:
        issued_dt = datetime.fromisoformat(issued.replace("Z", "+00:00")).astimezone(COLOMBIA_TZ)
    except Exception:
        issued_dt = datetime.now(COLOMBIA_TZ)
    issued_str = issued_dt.strftime("%d/%m/%Y, %H:%M")

    story = []

    # ===== Encabezado: logo · empresa · QR · número de factura =====
    logo = Image(co["logo"], width=3.1 * cm, height=2.55 * cm) if os.path.exists(co["logo"]) else Paragraph("", normal)
    company = Paragraph(
        f"<b>{co['name']}</b><br/>NIT {co['nit']}<br/>{co['address']}<br/>{co['phone']}<br/>{co['city']}<br/>{co['email']}",
        ParagraphStyle("FeCo", parent=center, fontSize=9, leading=11),
    )
    qr_img = _qrcode.make(
        f"NumFac: {invoice_number}\nFecFac: {issued_dt.strftime('%Y-%m-%d')}\nNitFac: {co['nit']}\n"
        f"DocAdq: {order.get('client_cedula') or ''}\nValFac: {tax_base:.2f}\nValIva: {iva:.2f}\nValTolFac: {total:.2f}"
    )
    qr_buf = BytesIO()
    qr_img.save(qr_buf, format="PNG")
    qr_buf.seek(0)
    qr = Image(qr_buf, width=3.2 * cm, height=3.2 * cm)
    number_box = Table([[Paragraph("Factura electrónica de venta", ParagraphStyle("FeT", parent=center, fontSize=11, leading=13))],
                        [Paragraph(f"<b>No. {invoice_number}</b>", ParagraphStyle("FeNo", parent=center, fontSize=10, leading=12))]],
                       colWidths=[6.2 * cm])
    number_box.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.8, grid), ("TOPPADDING", (0, 0), (-1, 0), 10),
                                    ("BOTTOMPADDING", (0, -1), (-1, -1), 10)]))
    header = Table([[logo, company, qr, number_box]], colWidths=[3.6 * cm, 5.2 * cm, 3.8 * cm, width - 12.6 * cm])
    header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ALIGN", (0, 0), (2, 0), "CENTER"),
                                ("ALIGN", (3, 0), (3, 0), "RIGHT")]))
    story.append(header)
    story.append(Spacer(1, 0.3 * cm))

    # ===== Cliente · fechas =====
    bold = ParagraphStyle("FeB", parent=normal, fontName="Helvetica-Bold", fontSize=8.5)
    val = ParagraphStyle("FeV", parent=normal, fontSize=8.5)
    snap = order.get("retention_snapshot") or {}
    client = Table([
        [Paragraph("Señores", bold), Paragraph(order.get("client_razon_social") or order.get("client_name") or "-", val), "", ""],
        [Paragraph("NIT", bold), Paragraph(order.get("client_cedula") or "-", val),
         Paragraph("Teléfono", bold), Paragraph(order.get("client_phone") or "-", val)],
        [Paragraph("Dirección", bold), Paragraph(order.get("client_address") or "", val),
         Paragraph("Ciudad", bold), Paragraph(snap.get("city") or "-", val)],
    ], colWidths=[2.6 * cm, 4.6 * cm, 2.6 * cm, 3.0 * cm])
    client.setStyle(TableStyle([("SPAN", (1, 0), (3, 0)), ("BOX", (0, 0), (-1, -1), 0.8, grid),
                                ("LINEBELOW", (0, 0), (-1, 1), 0.5, grid), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    dates = Table([
        [Paragraph("<b>Fecha y hora Factura</b>", center), ""],
        [Paragraph("<b>Generación</b>", center), Paragraph(issued_str, center)],
        [Paragraph("<b>Expedición</b>", center), Paragraph(issued_str, center)],
        [Paragraph("<b>Vencimiento</b>", ParagraphStyle("FeV7", parent=center, fontSize=7)), Paragraph(issued_dt.strftime("%d/%m/%Y"), center)],
    ], colWidths=[2.6 * cm, 3.6 * cm])
    dates.setStyle(TableStyle([("SPAN", (0, 0), (1, 0)), ("BOX", (0, 0), (-1, -1), 0.8, grid),
                               ("INNERGRID", (0, 0), (-1, -1), 0.5, grid), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    top = Table([[client, "", dates]], colWidths=[12.8 * cm, width - 19 * cm, 6.2 * cm])
    top.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                             ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    story.append(top)
    story.append(Spacer(1, 0.45 * cm))

    # ===== Ítems: un renglón por servicio (placa + vehículo + servicio) =====
    services = [s for s in (order.get("services") or []) if isinstance(s, dict)]
    vehicle = " ".join(x for x in ((order.get("plate") or "").upper(), (order.get("brand") or "").upper(),
                                   (order.get("model") or "").upper()) if x)
    lines = []
    for s in services:
        price = float(s.get("price") or 0) + sum(float((e or {}).get("price") or 0) for e in (s.get("extras") or []))
        if price <= 0:
            continue
        lines.append([f"{vehicle} {(s.get('description') or s.get('service') or '').upper()}".strip(), price])
    if not lines:
        lines = [[f"{vehicle} SERVICIO".strip(), gross]]
    lines_sum = sum(p for _, p in lines) or 1
    data = [["Ítem", "Descripción", "Cantidad", "Impto. Cargo", "Vr. Bruto", "Vr. Total", "% Desc."]]
    acc_total = 0.0
    for i, (desc, price) in enumerate(lines, 1):
        bruto = round(gross * price / lines_sum, 2)  # reparte el bruto según el valor de cada servicio
        if i == len(lines):
            line_total = round(total - acc_total, 2)  # el último cuadra el total exacto
        else:
            line_total = round(bruto * (1 - disc_pct / 100) * (1.19 if with_iva else 1), 2)
            acc_total += line_total
        data.append([str(i), Paragraph(desc, normal), "1.00", "19 %" if with_iva else "0 %",
                     _num(bruto), _num(line_total), f"{disc_pct:g} %"])
    col_w = [1.1 * cm, 7.2 * cm, 1.9 * cm, 2.4 * cm, 2.6 * cm, 2.6 * cm]
    col_w.append(width - sum(col_w))
    items = Table(data, colWidths=col_w, repeatRows=1)
    items.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ("ALIGN", (0, 0), (-1, 0), "CENTER"), ("ALIGN", (0, 1), (0, -1), "CENTER"), ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
        ("BOX", (0, 0), (-1, -1), 0.8, grid), ("INNERGRID", (0, 0), (-1, -1), 0.5, grid),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    filler_h = max(9.5 * cm - 0.75 * cm * len(lines), 1.5 * cm)
    filler = Table([[""]], colWidths=[width], rowHeights=[filler_h])
    filler.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.8, grid)]))
    story.append(items)
    story.append(filler)
    story.append(Spacer(1, 0.3 * cm))

    # ===== Pie: valor en letras, forma/medio de pago · totales =====
    method = PAYMENT_METHOD_LABELS.get((order.get("payment_method") or "").lower(), (order.get("payment_method") or "Contado").capitalize())
    left = [
        Paragraph(f"<b>Total items:</b> {len(lines)}", heading), Spacer(1, 6),
        Paragraph("<b>Valor en Letras:</b>", heading), Paragraph(_amount_in_words(total), ParagraphStyle("FeIn", parent=normal, fontSize=9, leftIndent=8)), Spacer(1, 6),
        Paragraph("<b>Forma de pago:</b>", heading), Paragraph("Contado", ParagraphStyle("FeIn2", parent=normal, fontSize=10, leftIndent=8)), Spacer(1, 6),
        Paragraph("<b>Medio de pago:</b>", heading),
        Table([[Paragraph(method, ParagraphStyle("FeIn3", parent=normal, fontSize=9)), "$", _num(total)]],
              colWidths=[6.5 * cm, 0.8 * cm, 3 * cm],
              style=TableStyle([("FONTSIZE", (0, 0), (-1, -1), 9), ("ALIGN", (2, 0), (2, 0), "RIGHT"), ("LEFTPADDING", (0, 0), (0, 0), 8)])),
    ]
    tot_rows = [[Paragraph("<b>Total Bruto</b>", val), _num(gross)]]
    if discount:
        tot_rows.append([Paragraph("Descuento", val), f"-{_num(discount)}"])
        tot_rows.append([Paragraph("Subtotal", val), _num(tax_base)])
    if with_iva:
        tot_rows.append([Paragraph("IVA 19%", val), _num(iva)])
    tot_rows.append([Paragraph("<b>Total a Pagar</b>", val), _num(total)])
    totals = Table(tot_rows, colWidths=[3.6 * cm, 3.6 * cm])
    totals.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.8, grid), ("INNERGRID", (0, 0), (-1, -1), 0.5, grid),
                                ("ALIGN", (1, 0), (1, -1), "RIGHT"), ("FONTSIZE", (0, 0), (-1, -1), 9),
                                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 6),
                                ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    foot = Table([[left, totals]], colWidths=[width - 7.4 * cm, 7.4 * cm])
    foot.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (0, 0), 6),
                              ("LEFTPADDING", (1, 0), (1, 0), 0),
                              ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    story.append(foot)
    story.append(Spacer(1, 0.4 * cm))

    # ===== Observaciones: orden y retenciones practicadas =====
    story.append(Paragraph("<b>Observaciones:</b>", heading))
    obs = [f"Orden {order.get('order_code', '')} · Placa {(order.get('plate') or '').upper()}"]
    if snap and not snap.get("no_aplica") and float(snap.get("total_retention") or 0) > 0:
        rate_ica = f"{snap.get('reteica_rate')}/1000" if snap.get("reteica_unit") == "por_mil" else f"{snap.get('reteica_rate')}%"
        bits = []
        if float(snap.get("retefuente_amount") or 0):
            bits.append(f"Retefuente {snap.get('retefuente_rate')}%: {_num(snap['retefuente_amount'])}")
        if float(snap.get("reteica_amount") or 0):
            bits.append(f"ICA {rate_ica}: {_num(snap['reteica_amount'])}")
        obs.append("Retenciones practicadas: " + " · ".join(bits) +
                   f" · Valor a pagar cliente: {_num(total - float(snap.get('total_retention') or 0))}")
    story.append(Paragraph("<br/>".join(obs), ParagraphStyle("FeObs", parent=normal, fontSize=8.5, leftIndent=8)))

    # ===== Texto legal al pie de la página =====
    def _footer(canv, _doc):
        canv.saveState()
        legal = Paragraph(f"{co['legal']}<br/>{co['activity']}<br/><b>CUFE:</b> {order.get('invoice_cufe') or 'pendiente de validación ante la DIAN'}",
                          small_center)
        _, h = legal.wrap(width - 1 * cm, 4 * cm)
        legal.drawOn(canv, doc.leftMargin + 0.5 * cm, 0.9 * cm)
        canv.setStrokeColor(grid)
        canv.roundRect(0.5 * cm, 0.5 * cm, page_w - 1 * cm, page_h - 1 * cm, 6, stroke=1, fill=0)
        canv.restoreState()

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()


def build_exit_certificate(order: dict) -> bytes:
    """Certificado de salida: vehículo pagado y con control de calidad aprobado."""
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=LETTER,
        leftMargin=1.5 * cm, rightMargin=1.5 * cm,
        topMargin=1.2 * cm, bottomMargin=1.2 * cm,
    )
    styles = getSampleStyleSheet()
    cert = order.get("exit_certificate") or {}
    story = []
    _header(story, "Certificado de Salida",
            f"N.º {cert.get('number', '-')} · Emitido {_fmt_dt(cert.get('issued_at'))} · Orden {order.get('order_code', '')}")

    ok_style = ParagraphStyle("Ok", parent=styles["Normal"], textColor=colors.HexColor("#16a34a"), fontSize=12, leading=15)
    story.append(Paragraph("<b>VEHÍCULO AUTORIZADO PARA SALIR</b> · pagado y con control de calidad aprobado", ok_style))
    story.append(Spacer(1, 0.3 * cm))

    story.append(_kv_table([
        ["Placa", (order.get("plate") or "").upper()],
        ["Vehículo", f"{order.get('brand', '')} {order.get('model', '')} {order.get('color') or ''}".strip() or "-"],
        ["Cliente", order.get("client_name") or "-"],
        ["Cédula", order.get("client_cedula") or "-"],
        ["Teléfono", order.get("client_phone") or "-"],
        ["Técnicos", " · ".join(t for t in (order.get("assigned_technician_name"), order.get("assigned_technician_2_name")) if t) or "-"],
        ["Ingreso", _fmt_dt(order.get("ingreso_at"))],
        ["Instalación terminada", _fmt_dt(order.get("service_completed_at"))],
        ["Certificado emitido por", f"{cert.get('issued_by_name') or '-'} · enviado al Coordinador y al Jefe de Seguridad"],
    ]))
    story.append(Spacer(1, 0.25 * cm))

    story.append(Paragraph("<b>Servicios realizados</b>", styles["Heading4"]))
    svc_lines = [
        f"• {s.get('description') or s.get('service')}"
        for s in (order.get("services") or []) if isinstance(s, dict)
    ]
    story.append(Paragraph("<br/>".join(svc_lines) or "-", styles["Normal"]))
    story.append(Spacer(1, 0.25 * cm))

    answers = order.get("quality_answers") or []
    ok_n = sum(1 for a in answers if a.get("result") == "ok")
    na_n = sum(1 for a in answers if a.get("result") == "na")
    story.append(Paragraph("<b>Control de calidad</b>", styles["Heading4"]))
    if order.get("quality_status") == "aprobado":
        story.append(_kv_table([
            ["Resultado", "APROBADO"],
            ["Revisado por", order.get("quality_by_name") or "-"],
            ["Fecha", _fmt_dt(order.get("quality_checked_at"))],
            ["Puntos revisados", f"{ok_n} cumplen · {na_n} no aplican · 0 con novedad"],
            ["Observaciones", order.get("quality_notes") or "-"],
        ]))
    else:
        story.append(Paragraph("<i>Orden anterior al control de calidad.</i>", styles["Italic"]))
    photos = [p for p in (order.get("quality_photos") or []) if p][:4]
    imgs = [img for img in (_b64_to_image(p, width_cm=3.6, height_cm=2.7) for p in photos) if img]
    if imgs:
        story.append(Spacer(1, 0.2 * cm))
        tbl = Table([imgs], colWidths=[3.8 * cm] * len(imgs))
        tbl.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
        story.append(tbl)
    story.append(Spacer(1, 0.25 * cm))

    total = float(order.get("final_value") or order.get("negotiated_value") or 0)
    paid = float(order.get("amount_paid") or 0)
    story.append(Paragraph("<b>Pago</b>", styles["Heading4"]))
    retention = _retention(order)
    story.append(_totals_table(total, paid, max(total - retention - paid, 0),
                               payment_method=order.get("payment_method"), retention=retention))
    story.append(Spacer(1, 0.25 * cm))

    story.append(Spacer(1, 0.9 * cm))

    sig = Table([["_______________________", "_______________________", "_______________________"],
                 ["Coordinador", "Jefe de Seguridad", "Cliente"]],
                colWidths=[5.8 * cm] * 3)
    sig.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 1), (-1, 1), MUTED_COLOR),
    ]))
    story.append(sig)

    doc.build(story)
    return buf.getvalue()


def build_retention_certificate(ret: dict, order: dict) -> bytes:
    """Certificado de retención: Retefuente e ICA que el cliente practicó sobre la factura del servicio."""
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=LETTER,
        leftMargin=1.5 * cm, rightMargin=1.5 * cm,
        topMargin=1.2 * cm, bottomMargin=1.2 * cm,
    )
    styles = getSampleStyleSheet()
    story = []
    _header(story, "Certificado de Retención",
            f"N.º {ret.get('certificate_number', '-')} · Emitido {_fmt_dt(ret.get('certificate_issued_at'))} · "
            f"Orden {ret.get('order_code') or order.get('order_code', '')}")

    story.append(Paragraph("<b>Datos del cliente (agente retenedor)</b>", styles["Heading4"]))
    story.append(_kv_table([
        ["Nombre", order.get("client_name") or ret.get("client_name") or "-"],
        ["Razón social", order.get("client_razon_social") or "-"],
        ["NIT / Cédula", order.get("client_cedula") or ret.get("client_cedula") or "-"],
        ["Ciudad", ret.get("city") or "-"],
        ["Correo", order.get("client_email") or "-"],
    ]))
    story.append(Spacer(1, 0.2 * cm))

    story.append(Paragraph("<b>Vehículo y servicio</b>", styles["Heading4"]))
    story.append(_kv_table([
        ["Placa", (ret.get("plate") or order.get("plate") or "").upper()],
        ["Vehículo", f"{order.get('brand', '')} {order.get('model', '')} {order.get('color') or ''}".strip() or "-"],
        ["Servicios", ", ".join(s.get("description") or s.get("service") or "-"
                                for s in (order.get("services") or []) if isinstance(s, dict)) or "-"],
        ["Factura electrónica", order.get("invoice_number") or "Pendiente de envío"],
        ["Retención aplicada", f"{_fmt_dt(ret.get('applied_at'))} · por {ret.get('applied_by_name') or '-'}"],
    ]))
    story.append(Spacer(1, 0.3 * cm))

    total = float(ret.get("order_total_before") or 0)
    base = ret.get("retention_base")
    por_mil = ret.get("reteica_unit") == "por_mil"
    if base is None:  # retenciones anteriores a la liquidación sobre la base sin IVA
        base = total
    base = float(base)
    story.append(Paragraph("<b>Liquidación de la retención</b>", styles["Heading4"]))
    data = [["Concepto", "Base", "Tarifa", "Valor retenido"]]
    if ret.get("retefuente_applied"):
        data.append(["Retención en la fuente", _fmt_money(base), f"{ret.get('retefuente_rate')}%",
                     _fmt_money(ret.get("retefuente_amount"))])
    if ret.get("reteica_applied"):
        data.append(["Retención de ICA (Reteica)", _fmt_money(base),
                     f"{ret.get('reteica_rate')}/1000" if por_mil else f"{ret.get('reteica_rate')}%",
                     _fmt_money(ret.get("reteica_amount"))])
    data.append(["Total retenciones practicadas", "", "", _fmt_money(ret.get("total_retention"))])
    tbl = Table(data, colWidths=[7 * cm, 3.5 * cm, 3 * cm, 3.5 * cm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BRAND_COLOR),
        ("TEXTCOLOR", (0, 0), (-1, 0), DARK_COLOR),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 0.3 * cm))

    iva = total - base if total > base else 0
    rows = [["Base (sin IVA)", _fmt_money(base)]]
    if iva:
        rows.append(["IVA 19%", _fmt_money(iva)])
    rows += [
        ["Subtotal factura", _fmt_money(total)],
        ["Menos total retenciones", f"-{_fmt_money(ret.get('total_retention'))}"],
        ["Valor a pagar cliente", _fmt_money(ret.get("order_total_after"))],
    ]
    totals = Table(rows, colWidths=[5 * cm, 4 * cm])
    totals.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (0, -1), MUTED_COLOR),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEABOVE", (0, -1), (-1, -1), 1, DARK_COLOR),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
    ]))
    story.append(totals)
    if base == total and not por_mil:
        story.append(Spacer(1, 0.2 * cm))
        story.append(Paragraph("<i>Retención registrada antes de la liquidación sobre la base sin IVA.</i>", styles["Italic"]))

    story.append(Spacer(1, 1.4 * cm))
    sig = Table([["_______________________", "_______________________"],
                 ["Facturación PolarizadosYA!", "Cliente / Agente retenedor"]],
                colWidths=[8.5 * cm] * 2)
    sig.setStyle(TableStyle([
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("TEXTCOLOR", (0, 1), (-1, 1), MUTED_COLOR),
    ]))
    story.append(sig)

    doc.build(story)
    return buf.getvalue()
