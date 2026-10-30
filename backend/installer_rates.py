"""Tarifas de liquidación 2026.

- "PAGO A INSTALADORES": lo que se le paga al técnico según lo que instaló (compute_installer_charge).
- "PAGO A ASESORES": la comisión del asesor que hizo el check-in, según lo vendido (compute_advisor_commission).
"""
from typing import Dict, List, Optional

VEHICLE_TYPES = {"automovil": "Automóvil", "camioneta": "Camioneta"}

# Polarizado: tarifa por tipo de vehículo y por piezas
#   completo = automóvil / camioneta completa; panoramicos = los 2; panoramico = 1;
#   laterales = los 4; lateral = 1
POLARIZADO_RATES: Dict[str, dict] = {
    "ultra_optik": {
        "label": "Ultra Optik",
        "services": ["ultraoptik_aswf"],
        "automovil": {"completo": 113000, "panoramicos": 44000, "panoramico": 25000, "laterales": 69000, "lateral": 20000},
        "camioneta": {"completo": 119000, "panoramicos": 45000, "panoramico": 25000, "laterales": 75000, "lateral": 20000},
    },
    "ceramic_i3": {
        "label": "Ceramic I3",
        "services": ["ceramic_i3_autobahn"],
        "automovil": {"completo": 118000, "panoramicos": 49000, "panoramico": 30000, "laterales": 69000, "lateral": 20000},
        "camioneta": {"completo": 125000, "panoramicos": 50000, "panoramico": 30000, "laterales": 75000, "lateral": 20000},
    },
    "ceramic_i3_plus": {
        "label": "Ceramic I3+",
        "services": ["ceramic_i3_plus_autobahn"],
        "automovil": {"completo": 128000, "panoramicos": 53000, "panoramico": 30000, "laterales": 74000, "lateral": 20000},
        "camioneta": {"completo": 135000, "panoramicos": 55000, "panoramico": 30000, "laterales": 80000, "lateral": 20000},
    },
    "huperoptik": {
        "label": "Huperoptik",
        "services": ["huperoptik"],
        "automovil": {"completo": 133000, "panoramicos": 54000, "panoramico": 30000, "laterales": 79000, "lateral": 20000},
        "camioneta": {"completo": 140000, "panoramicos": 55000, "panoramico": 30000, "laterales": 85000, "lateral": 20000},
    },
}
PIECE_LABELS = {"completo": "completo", "panoramicos": "2 panorámicos", "panoramico": "1 panorámico",
                "laterales": "4 laterales", "lateral": "lateral"}

# Ultrasecure: automóvil completo, por micras
ULTRASECURE_RATES = {"micras_500": 200000, "micras_700": 250000, "micras_1000": 300000, "micras_1700": 480000}

# PPF (comisión del asesor): según el valor de venta. (desde, tarifa) — se toma el último tramo cuyo "desde" no supera la venta
PPF_RATES = [
    (0, 5000), (300000, 10000), (500000, 15000), (700000, 20000), (1000000, 25000),
    (1300000, 30000), (1900000, 40000), (2500000, 45000), (3000000, 50000), (3500000, 60000),
    (4500000, 75000), (6500000, 90000), (9000000, 140000), (12000000, 190000), (14000000, 210000),
]

# Adicionales que marca el técnico al cobrar
TESLA_ROOF_RATES = {"medio": ("Medio sunroof (Tesla)", 15000), "completo": ("Techo sunroof (Tesla)", 30000)}
REMOVAL_RATES = {"completo": ("Retirada película carro completo", 10000),
                 "laterales": ("Retirada película laterales", 5000),
                 "panoramico": ("Retirada película panorámico", 5000)}

# Piezas del check-in → panorámicos / laterales
PANORAMIC_PARTS = {"panoramico", "luneta", "vidrio_trasero"}
LATERAL_PARTS = {"vidrio_piloto", "vidrio_copiloto", "vidrio_trasero_piloto", "vidrio_trasero_copiloto"}


# Sin piezas registradas en el check-in se toma el vehículo completo
FULL_PIECES = ["panoramico", "luneta", "vidrio_piloto", "vidrio_copiloto", "vidrio_trasero_piloto", "vidrio_trasero_copiloto"]
PIECE_NAMES = {"panoramico": "Panorámico", "luneta": "Luneta / Trasero", "vidrio_trasero": "Vidrio trasero",
               "vidrio_piloto": "Vidrio piloto", "vidrio_copiloto": "Vidrio copiloto",
               "vidrio_trasero_piloto": "Vidrio trasero piloto", "vidrio_trasero_copiloto": "Vidrio trasero copiloto"}


def _polarizado_pieces(service: dict) -> List[str]:
    """Vidrios de un servicio de polarizado que entran en la tarifa (panorámicos y laterales)."""
    parts = [p for p in (service.get("parts") or []) if p in PANORAMIC_PARTS or p in LATERAL_PARTS]
    return parts or list(FULL_PIECES)


def _polarizado_line(rates: dict, vehicle_type: str, pieces: List[str], all_pieces: List[str]) -> List[dict]:
    """Tarifa de polarizado según los vidrios que instaló el técnico (todos = vehículo completo)."""
    table = rates[vehicle_type]
    pan = len(PANORAMIC_PARTS & set(pieces))
    lat = len(LATERAL_PARTS & set(pieces))
    if set(pieces) >= set(all_pieces) and pan >= 2 and lat >= 4:
        return [{"concept": f"{rates['label']} · {VEHICLE_TYPES[vehicle_type]} completo", "amount": table["completo"]}]
    lines = []
    if pan >= 2:
        lines.append({"concept": f"{rates['label']} · 2 panorámicos", "amount": table["panoramicos"]})
    elif pan == 1:
        lines.append({"concept": f"{rates['label']} · 1 panorámico", "amount": table["panoramico"]})
    if lat >= 4:
        lines.append({"concept": f"{rates['label']} · 4 laterales", "amount": table["laterales"]})
    elif lat:
        lines.append({"concept": f"{rates['label']} · {lat} lateral{'es' if lat > 1 else ''}", "amount": table["lateral"] * lat})
    return lines


def _ppf_rate(sale_value: float) -> int:
    rate = PPF_RATES[0][1]
    for since, value in PPF_RATES:
        if sale_value >= since:
            rate = value
    return rate


def compute_installer_charge(
    items: List[tuple],
    brand: Optional[str] = None,
    vehicle_type: str = "automovil",
    tesla_roof: Optional[str] = None,
    removals: Optional[List[str]] = None,
    pieces: Optional[Dict[str, List[str]]] = None,
    services: Optional[List[int]] = None,
) -> dict:
    """Calcula el cobro del técnico con lo que él instaló.

    items: [(índice en order.services, servicio)] de los servicios instalados.
    pieces: {índice: [vidrios]} de cada polarizado que hizo este técnico (None = todos).
    services: índices de los demás servicios que hizo (None = todos).
    Devuelve las líneas, el total, lo que no tiene tarifa, las "claims" (lo que cobra, para que el
    otro técnico no lo cobre también) y las unidades disponibles para elegir en la app.
    """
    vehicle_type = vehicle_type if vehicle_type in VEHICLE_TYPES else "automovil"
    lines: List[dict] = []
    without_rate: List[dict] = []
    claims: List[str] = []
    units: List[dict] = []
    for idx, s in items:
        sid = (s.get("service") or "").lower()
        name = s.get("description") or s.get("service") or "Servicio"
        price = float(s.get("price") or 0) + sum(float((e or {}).get("price") or 0) for e in (s.get("extras") or []))
        pol = next((r for r in POLARIZADO_RATES.values() if sid in r["services"]), None)
        if sid == "sunroof_adicional":
            continue  # el techo se cobra con la tarifa Tesla techos (opción al cobrar)
        if pol:
            all_pieces = _polarizado_pieces(s)
            units.append({"index": idx, "name": name, "kind": "polarizado",
                          "pieces": [{"id": p, "name": PIECE_NAMES.get(p, p)} for p in all_pieces]})
            chosen = all_pieces if pieces is None else [p for p in (pieces.get(str(idx)) or []) if p in all_pieces]
            if chosen:
                lines += _polarizado_line(pol, vehicle_type, chosen, all_pieces)
                claims += [f"{idx}:{p}" for p in chosen]
            continue
        kind = "tarifa" if sid in ULTRASECURE_RATES else "sin_tarifa"
        units.append({"index": idx, "name": name, "kind": kind})
        if services is not None and idx not in services:
            continue
        claims.append(str(idx))
        if sid in ULTRASECURE_RATES:
            lines.append({"concept": f"Ultrasecure {sid.replace('micras_', '')} micras · automóvil completo",
                          "amount": ULTRASECURE_RATES[sid]})
        else:
            without_rate.append({"index": idx, "name": name})
    if tesla_roof in TESLA_ROOF_RATES:
        label, amount = TESLA_ROOF_RATES[tesla_roof]
        lines.append({"concept": label, "amount": amount})
        claims.append("techo")
    for r in removals or []:
        if r in REMOVAL_RATES:
            label, amount = REMOVAL_RATES[r]
            lines.append({"concept": label, "amount": amount})
            claims.append(f"retirada:{r}")
    return {
        "vehicle_type": vehicle_type,
        "lines": lines,
        "total": sum(line["amount"] for line in lines),
        "without_rate": [w["name"] for w in without_rate],
        "claims": claims,
        "units": units,
        "is_tesla": (brand or "").strip().lower() == "tesla",
    }


def claim_label(claim: str, units: List[dict]) -> str:
    """Nombre legible de una 'claim' (para avisar qué ya cobró el otro técnico)."""
    if claim == "techo":
        return "techo Tesla"
    if claim.startswith("retirada:"):
        return f"retirada de película ({claim.split(':', 1)[1]})"
    idx, _, piece = claim.partition(":")
    unit = next((u for u in units if str(u["index"]) == idx), None)
    name = unit["name"] if unit else "servicio"
    return f"{name} · {PIECE_NAMES.get(piece, piece)}" if piece else name


# ===================== PAGO A ASESORES =====================
# Polarizado: full (auto o camioneta), full con descuento, y por piezas
ADVISOR_POLARIZADO_RATES: Dict[str, dict] = {
    "nano": {"label": "Nanocerámica", "services": ["nanooptik"],
             "full": 15000, "descuento": 10000, "panoramico": 5000, "panoramicos": 10000, "lateral": 5000, "laterales": 10000},
    "black_ceramic": {"label": "Black Ceramic", "services": ["black_ceramic_autobahn"],
                      "full": 20000, "descuento": 15000, "panoramico": 5000, "panoramicos": 10000, "lateral": 5000, "laterales": 10000},
    "ultra_optik": {"label": "Ultra Optik", "services": ["ultraoptik_aswf"],
                    "full": 25000, "descuento": 20000, "panoramico": 5000, "panoramicos": 10000, "lateral": 5000, "laterales": 12500},
    "ceramic_ir_3m": {"label": "Ceramic IR 3M", "services": ["ceramic_ir_3m", "3m_ir", "3m"],
                      "full": 35000, "descuento": 30000, "panoramico": 15000, "panoramicos": 15000, "lateral": 5000, "laterales": 10000},
    "ceramic_i3": {"label": "Ceramic I3 Autobahn", "services": ["ceramic_i3_autobahn"],
                   "full": 40000, "descuento": 30000, "panoramico": 15000, "panoramicos": 15000, "lateral": 5000, "laterales": 10000},
    "huperoptik": {"label": "Huperoptik", "services": ["huperoptik"],
                   "full": 50000, "descuento": 40000, "panoramico": 15000, "panoramicos": 15000, "lateral": 5000, "laterales": 10000},
}
ADVISOR_PIECE_LABELS = {"full": "Auto/camioneta full", "descuento": "Automóvil descuento", "panoramico": "Panorámico",
                        "panoramicos": "2 panorámicos", "lateral": "1 lateral", "laterales": "4 laterales"}

# Ultrasecure: por micras y por película, (full, descuento)
ADVISOR_US_FILMS = {"nano": "Nano", "black_ceramic": "Black Ceramic", "ultra_optik": "Ultra Optik",
                    "3m_ir": "3M", "ceramic_i3": "Ceramic I3", "huperoptik": "Huperoptik"}
ADVISOR_ULTRASECURE_RATES: Dict[str, Dict[str, tuple]] = {
    "micras_300": {"nano": (25000, 20000), "black_ceramic": (30000, 25000), "ultra_optik": (35000, 30000),
                   "3m_ir": (35000, 30000), "ceramic_i3": (40000, 35000), "huperoptik": (45000, 40000)},
    "micras_500": {"nano": (35000, 30000), "black_ceramic": (40000, 35000), "ultra_optik": (45000, 40000),
                   "3m_ir": (45000, 40000), "ceramic_i3": (50000, 45000), "huperoptik": (55000, 50000)},
    "micras_700": {"nano": (45000, 40000), "black_ceramic": (55000, 50000), "ultra_optik": (65000, 60000),
                   "3m_ir": (65000, 60000), "ceramic_i3": (75000, 70000), "huperoptik": (80000, 75000)},
    "micras_1000": {"nano": (75000, 70000), "black_ceramic": (80000, 75000), "ultra_optik": (85000, 80000),
                    "3m_ir": (85000, 80000), "ceramic_i3": (90000, 85000), "huperoptik": (85000, 80000)},
    "micras_1700": {"nano": (110000, 100000), "black_ceramic": (120000, 110000), "ultra_optik": (125000, 120000),
                    "3m_ir": (125000, 120000), "ceramic_i3": (130000, 120000), "huperoptik": (140000, 130000)},
}
ADVISOR_ROOF_RATE = 5000  # techo (sunroof): sobre el valor de la venta


def _advisor_polarizado_line(rates: dict, parts: List[str], discounted: bool) -> List[dict]:
    pieces = [p for p in (parts or []) if p in PANORAMIC_PARTS or p in LATERAL_PARTS] or list(FULL_PIECES)
    pan = len(PANORAMIC_PARTS & set(pieces))
    lat = len(LATERAL_PARTS & set(pieces))
    if pan >= 2 and lat >= 4:
        key = "descuento" if discounted else "full"
        return [{"concept": f"{rates['label']} · {ADVISOR_PIECE_LABELS[key].lower()}", "amount": rates[key]}]
    lines = []
    if pan >= 2:
        lines.append({"concept": f"{rates['label']} · 2 panorámicos", "amount": rates["panoramicos"]})
    elif pan == 1:
        lines.append({"concept": f"{rates['label']} · panorámico", "amount": rates["panoramico"]})
    if lat >= 4:
        lines.append({"concept": f"{rates['label']} · 4 laterales", "amount": rates["laterales"]})
    elif lat:
        lines.append({"concept": f"{rates['label']} · {lat} lateral{'es' if lat > 1 else ''}", "amount": rates["lateral"] * lat})
    return lines


def _service_discounted(service: dict, order_discount: bool) -> bool:
    """Venta con descuento: la orden tiene código de descuento o el servicio se vendió por debajo del precio de lista."""
    list_price = float(service.get("list_price") or 0)
    return order_discount or (list_price > 0 and float(service.get("price") or 0) < list_price)


def compute_advisor_commission(order: dict) -> dict:
    """Comisión del asesor que hizo el check-in, según lo vendido en la orden."""
    order_discount = bool(order.get("discount_code")) or float(order.get("discount_amount") or 0) > 0
    lines: List[dict] = []
    without_rate: List[str] = []
    for s in order.get("services") or []:
        if not isinstance(s, dict) or s.get("no_charge"):
            continue
        sid = (s.get("service") or "").lower()
        name = s.get("description") or s.get("service") or "Servicio"
        price = float(s.get("price") or 0) + sum(float((e or {}).get("price") or 0) for e in (s.get("extras") or []))
        discounted = _service_discounted(s, order_discount)
        pol = next((r for r in ADVISOR_POLARIZADO_RATES.values() if sid in r["services"]), None)
        if pol:
            lines += _advisor_polarizado_line(pol, s.get("parts") or [], discounted)
        elif sid in ADVISOR_ULTRASECURE_RATES:
            film = (s.get("film") or "").lower()
            film = "ultra_optik" if "ultra" in film else film
            rate = ADVISOR_ULTRASECURE_RATES[sid].get(film)
            micras = sid.replace("micras_", "")
            if rate:
                lines.append({"concept": f"Ultrasecure {micras} micras · {ADVISOR_US_FILMS[film]} {'descuento' if discounted else 'full'}",
                              "amount": rate[1] if discounted else rate[0]})
            else:
                without_rate.append(f"{name}{' (' + s.get('film_label') + ')' if s.get('film_label') else ''}")
        elif sid.startswith("ppf"):
            lines.append({"concept": f"PPF · venta ${price:,.0f}".replace(",", "."), "amount": _ppf_rate(price)})
        elif sid == "sunroof_adicional":
            lines.append({"concept": "Techo (sunroof)", "amount": ADVISOR_ROOF_RATE})
        else:
            without_rate.append(name)
    return {
        "lines": lines,
        "total": sum(line["amount"] for line in lines),
        "without_rate": without_rate,
        "discounted": order_discount,
    }


def rates_table() -> dict:
    """Las dos tablas, para mostrarlas en la app."""
    return {
        "installers": {
            "vehicle_types": VEHICLE_TYPES,
            "polarizado": [{"id": k, "label": v["label"], "automovil": v["automovil"], "camioneta": v["camioneta"]}
                           for k, v in POLARIZADO_RATES.items()],
            "piece_labels": PIECE_LABELS,
            "ultrasecure": [{"micras": k.replace("micras_", ""), "amount": v} for k, v in ULTRASECURE_RATES.items()],
            "tesla_roof": [{"id": k, "label": v[0], "amount": v[1]} for k, v in TESLA_ROOF_RATES.items()],
            "removals": [{"id": k, "label": v[0], "amount": v[1]} for k, v in REMOVAL_RATES.items()],
        },
        "advisors": {
            "polarizado": [{"id": k, "label": v["label"], **{p: v[p] for p in ADVISOR_PIECE_LABELS}}
                           for k, v in ADVISOR_POLARIZADO_RATES.items()],
            "piece_labels": ADVISOR_PIECE_LABELS,
            "ultrasecure_films": ADVISOR_US_FILMS,
            "ultrasecure": [{"micras": k.replace("micras_", ""), "rates": {f: {"full": r[0], "descuento": r[1]} for f, r in v.items()}}
                            for k, v in ADVISOR_ULTRASECURE_RATES.items()],
            "roof": ADVISOR_ROOF_RATE,
            "ppf": [{"since": s, "amount": a} for s, a in PPF_RATES],
        },
    }
