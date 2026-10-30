"""PDF generation helpers for Polarizados Manager.

Generates:
- Recibo de Ingreso (Check-in) con firma y saldo pendiente
- Estado de Cuenta tras registrar un pago
- Factura Electronica MOCK (numeración DIAN simulada)
"""
from datetime import datetime, timezone
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


def build_mock_invoice(order: dict, invoice_number: str) -> bytes:
    """PDF factura electrónica MOCK (numeración simulada DIAN)."""
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=LETTER,
        leftMargin=1.5 * cm, rightMargin=1.5 * cm,
        topMargin=1.5 * cm, bottomMargin=1.5 * cm,
    )
    story = []
    subtitle = (
        f"Factura Electrónica DIAN (MOCK) · {invoice_number} · "
        f"{_fmt_dt(datetime.now(timezone.utc).isoformat())}"
    )
    _header(story, "Factura Electrónica (MOCK)", subtitle)

    story.append(_kv_table([
        ["Cliente", order.get("client_name") or "-"],
        ["Cédula / NIT", order.get("client_cedula") or "-"],
        ["Teléfono", order.get("client_phone") or "-"],
        ["Correo", order.get("client_email") or "-"],
        ["Placa", (order.get("plate") or "").upper()],
        ["Vehículo", f"{order.get('brand', '')} {order.get('model', '')}".strip() or "-"],
        ["CUFE (simulado)", invoice_number.replace("MOCK-", "").ljust(40, "0")[:40]],
    ]))
    story.append(Spacer(1, 0.4 * cm))

    story.append(Paragraph("<b>Detalle de la factura</b>", getSampleStyleSheet()["Heading4"]))
    story.append(_services_table(order.get("services") or []))
    story.append(Spacer(1, 0.4 * cm))

    total = float(order.get("final_value") or order.get("negotiated_value") or 0)
    # Estimated breakdown assuming +19% IVA already in total when requires_invoice=True
    if order.get("requires_invoice"):
        # Base gravable guardada en el check-in (ya con el descuento); órdenes anteriores: total / 1,19
        base = float(order["tax_base"]) if order.get("tax_base") is not None else round(total / 1.19, 0)
        iva = total - base
    else:
        base = total
        iva = 0

    rows = [
        ["Base gravable", _fmt_money(base)],
        ["IVA 19%", _fmt_money(iva)],
        ["TOTAL", _fmt_money(total)],
    ]
    tbl = Table(rows, colWidths=[6 * cm, 4 * cm])
    tbl.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TEXTCOLOR", (0, 0), (0, -1), MUTED_COLOR),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEABOVE", (0, -1), (-1, -1), 1, DARK_COLOR),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 0.6 * cm))

    story.append(Paragraph(
        "<font size=8 color='#64748b'><b>DOCUMENTO DE PRUEBA (MOCK)</b>. "
        "Esta factura NO tiene validez fiscal. Cuando se conecte el proveedor real (Siigo) "
        "se generará la factura con numeración y CUFE oficial.</font>",
        getSampleStyleSheet()["Normal"],
    ))

    doc.build(story)
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
