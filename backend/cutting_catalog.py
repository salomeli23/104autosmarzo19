"""Catálogo de datos para el Módulo de Corte:
- Promedios de material (metros) por marca + modelo
- Materiales agrupados en 3 categorías operativas
- Rollos físicos (para autoseeding de inventario)
"""

CAR_AVERAGES = [
    {"brand": "Audi", "model": "A3", "promedio_m": 1.65},
    {"brand": "Audi", "model": "A4", "promedio_m": 1.30},
    {"brand": "Audi", "model": "A6", "promedio_m": 2.60},
    {"brand": "Audi", "model": "Q3", "promedio_m": 2.15},
    {"brand": "Audi", "model": "Q5", "promedio_m": 1.97},
    {"brand": "Audi", "model": "Q6", "promedio_m": 1.50},
    {"brand": "Bestune", "model": "Xiaoma", "promedio_m": 1.00},
    {"brand": "BMW", "model": "118i", "promedio_m": 3.00},
    {"brand": "BMW", "model": "240i", "promedio_m": 1.10},
    {"brand": "BMW", "model": "316i", "promedio_m": 1.30},
    {"brand": "BMW", "model": "320i", "promedio_m": 1.18},
    {"brand": "BMW", "model": "420i", "promedio_m": 1.40},
    {"brand": "BMW", "model": "i3", "promedio_m": 1.80},
    {"brand": "BMW", "model": "iX1", "promedio_m": 3.00},
    {"brand": "BMW", "model": "iX2", "promedio_m": 1.40},
    {"brand": "BMW", "model": "X1", "promedio_m": 1.76},
    {"brand": "BMW", "model": "X3", "promedio_m": 2.22},
    {"brand": "BMW", "model": "X4", "promedio_m": 3.00},
    {"brand": "BMW", "model": "X5", "promedio_m": 1.98},
    {"brand": "BMW", "model": "X6", "promedio_m": 3.57},
    {"brand": "BYD", "model": "Dolphin", "promedio_m": 1.40},
    {"brand": "BYD", "model": "Seagull", "promedio_m": 1.30},
    {"brand": "BYD", "model": "Sealion", "promedio_m": 6.80},
    {"brand": "BYD", "model": "Shark", "promedio_m": 1.50},
    {"brand": "BYD", "model": "Song Plus", "promedio_m": 2.42},
    {"brand": "BYD", "model": "Tank L", "promedio_m": 1.80},
    {"brand": "BYD", "model": "Yuan", "promedio_m": 1.53},
    {"brand": "BYD", "model": "Yuan Up", "promedio_m": 1.29},
    {"brand": "Changan", "model": "E-Star", "promedio_m": 1.30},
    {"brand": "Chery", "model": "EQ7", "promedio_m": 1.35},
    {"brand": "Chery", "model": "iCar", "promedio_m": 2.94},
    {"brand": "Chery", "model": "Tiggo", "promedio_m": 1.50},
    {"brand": "Chevrolet", "model": "Aveo", "promedio_m": 1.30},
    {"brand": "Chevrolet", "model": "Blazer", "promedio_m": 1.40},
    {"brand": "Chevrolet", "model": "Captiva", "promedio_m": 1.48},
    {"brand": "Chevrolet", "model": "Equinox", "promedio_m": 1.50},
    {"brand": "Chevrolet", "model": "GT", "promedio_m": 1.20},
    {"brand": "Chevrolet", "model": "Joy", "promedio_m": 1.30},
    {"brand": "Chevrolet", "model": "Onix", "promedio_m": 1.34},
    {"brand": "Chevrolet", "model": "Spark", "promedio_m": 1.25},
    {"brand": "Chevrolet", "model": "Steem", "promedio_m": 1.00},
    {"brand": "Chevrolet", "model": "Tahoe", "promedio_m": 7.40},
    {"brand": "Chevrolet", "model": "Tracker", "promedio_m": 1.65},
    {"brand": "Chevrolet", "model": "Traverse", "promedio_m": 5.60},
    {"brand": "Citroën", "model": "Basalt", "promedio_m": 1.40},
    {"brand": "Citroën", "model": "C-Elysée", "promedio_m": 2.80},
    {"brand": "Citroën", "model": "C4", "promedio_m": 1.40},
    {"brand": "Cupra", "model": "Formentor", "promedio_m": 1.69},
    {"brand": "Cupra", "model": "Terramar", "promedio_m": 3.00},
    {"brand": "Daihatsu", "model": "Terios", "promedio_m": 1.40},
    {"brand": "Deepal", "model": "S05", "promedio_m": 1.77},
    {"brand": "Deepal", "model": "S07", "promedio_m": 1.82},
    {"brand": "Evasy", "model": "EV3", "promedio_m": 1.30},
    {"brand": "Fiat", "model": "500", "promedio_m": 1.10},
    {"brand": "Fiat", "model": "600", "promedio_m": 1.30},
    {"brand": "Ford", "model": "Bronco", "promedio_m": 1.55},
    {"brand": "Ford", "model": "EcoSport", "promedio_m": 2.35},
    {"brand": "Ford", "model": "Edge", "promedio_m": 2.55},
    {"brand": "Ford", "model": "Escape", "promedio_m": 1.31},
    {"brand": "Ford", "model": "Explorer", "promedio_m": 2.35},
    {"brand": "Ford", "model": "Fiesta", "promedio_m": 1.57},
    {"brand": "Ford", "model": "Fiesta ST", "promedio_m": 1.30},
    {"brand": "Ford", "model": "Ranger", "promedio_m": 1.30},
    {"brand": "Ford", "model": "Territory", "promedio_m": 1.92},
    {"brand": "GWM", "model": "ORA", "promedio_m": 1.30},
    {"brand": "GWM", "model": "ORA 03", "promedio_m": 1.40},
    {"brand": "Honda", "model": "Accord", "promedio_m": 1.30},
    {"brand": "Honda", "model": "Pilot", "promedio_m": 1.48},
    {"brand": "Hyundai", "model": "HB20", "promedio_m": 1.70},
    {"brand": "Hyundai", "model": "i25", "promedio_m": 1.30},
    {"brand": "Hyundai", "model": "i30", "promedio_m": 1.30},
    {"brand": "Hyundai", "model": "Kona", "promedio_m": 1.58},
    {"brand": "Hyundai", "model": "Santa Fe", "promedio_m": 1.30},
    {"brand": "Hyundai", "model": "Tucson", "promedio_m": 1.42},
    {"brand": "Hyundai", "model": "Venue", "promedio_m": 1.70},
    {"brand": "JAC", "model": "E30X", "promedio_m": 1.60},
    {"brand": "JAC", "model": "EX40", "promedio_m": 1.50},
    {"brand": "Jaguar", "model": "I-Pace", "promedio_m": 1.50},
    {"brand": "Jeep", "model": "Avenger", "promedio_m": 0.70},
    {"brand": "Jeep", "model": "Wrangler Rubicon", "promedio_m": 1.48},
    {"brand": "Karry", "model": "Yori", "promedio_m": 1.70},
    {"brand": "Kia", "model": "Cerato", "promedio_m": 1.30},
    {"brand": "Kia", "model": "EV5", "promedio_m": 3.10},
    {"brand": "Kia", "model": "K3", "promedio_m": 1.25},
    {"brand": "Kia", "model": "Niro", "promedio_m": 1.40},
    {"brand": "Kia", "model": "Picanto", "promedio_m": 0.80},
    {"brand": "Kia", "model": "Rio", "promedio_m": 1.23},
    {"brand": "Kia", "model": "Soluto", "promedio_m": 1.20},
    {"brand": "Kia", "model": "Sonet", "promedio_m": 1.35},
    {"brand": "Kia", "model": "Soul", "promedio_m": 1.30},
    {"brand": "Kia", "model": "Sportage", "promedio_m": 2.47},
    {"brand": "Kia", "model": "Stonic", "promedio_m": 1.41},
    {"brand": "Land Rover", "model": "Discovery", "promedio_m": 2.70},
    {"brand": "Mazda", "model": "2", "promedio_m": 1.09},
    {"brand": "Mazda", "model": "3", "promedio_m": 1.58},
    {"brand": "Mazda", "model": "6", "promedio_m": 1.00},
    {"brand": "Mazda", "model": "626", "promedio_m": 1.30},
    {"brand": "Mazda", "model": "CX-30", "promedio_m": 1.14},
    {"brand": "Mazda", "model": "CX-5", "promedio_m": 1.51},
    {"brand": "Mazda", "model": "CX-50", "promedio_m": 2.60},
    {"brand": "Mazda", "model": "CX-60", "promedio_m": 3.00},
    {"brand": "Mercedes-Benz", "model": "A200", "promedio_m": 1.20},
    {"brand": "Mercedes-Benz", "model": "C180", "promedio_m": 1.00},
    {"brand": "Mercedes-Benz", "model": "CLA 180", "promedio_m": 4.20},
    {"brand": "Mercedes-Benz", "model": "E250", "promedio_m": 1.00},
    {"brand": "Mercedes-Benz", "model": "GLA 200", "promedio_m": 1.30},
    {"brand": "Mercedes-Benz", "model": "GLC 250", "promedio_m": 1.60},
    {"brand": "Mercedes-Benz", "model": "GLC 300", "promedio_m": 1.50},
    {"brand": "Mercedes-Benz", "model": "GLC 500", "promedio_m": 1.80},
    {"brand": "Mercedes-Benz", "model": "GLS 450", "promedio_m": 9.00},
    {"brand": "MG", "model": "EU", "promedio_m": 1.40},
    {"brand": "MG", "model": "GLC220D", "promedio_m": 1.50},
    {"brand": "MG", "model": "S5", "promedio_m": 1.42},
    {"brand": "MINI", "model": "Cooper", "promedio_m": 1.50},
    {"brand": "Nissan", "model": "Almera", "promedio_m": 1.00},
    {"brand": "Nissan", "model": "Frontier", "promedio_m": 1.25},
    {"brand": "Nissan", "model": "Kicks", "promedio_m": 1.35},
    {"brand": "Nissan", "model": "March", "promedio_m": 1.20},
    {"brand": "Nissan", "model": "Pathfinder", "promedio_m": 3.40},
    {"brand": "Nissan", "model": "Qashqai", "promedio_m": 1.50},
    {"brand": "Nissan", "model": "Sentra", "promedio_m": 1.30},
    {"brand": "Nissan", "model": "Versa", "promedio_m": 1.30},
    {"brand": "Nissan", "model": "X-Trail", "promedio_m": 2.68},
    {"brand": "Peugeot", "model": "2008", "promedio_m": 1.24},
    {"brand": "Renault", "model": "Arkana", "promedio_m": 1.33},
    {"brand": "Renault", "model": "Clio", "promedio_m": 1.30},
    {"brand": "Renault", "model": "Duster", "promedio_m": 1.52},
    {"brand": "Renault", "model": "Kardian", "promedio_m": 1.30},
    {"brand": "Renault", "model": "Koleos", "promedio_m": 1.56},
    {"brand": "Renault", "model": "Kwid", "promedio_m": 1.28},
    {"brand": "Renault", "model": "Logan", "promedio_m": 1.95},
    {"brand": "Renault", "model": "Mégane", "promedio_m": 1.50},
    {"brand": "Renault", "model": "Sandero", "promedio_m": 1.22},
    {"brand": "Renault", "model": "Stepway", "promedio_m": 1.20},
    {"brand": "Renault", "model": "Symbol", "promedio_m": 1.20},
    {"brand": "Renault", "model": "Trafic", "promedio_m": 1.00},
    {"brand": "Renault", "model": "Twingo", "promedio_m": 1.10},
    {"brand": "SEAT", "model": "Arona", "promedio_m": 1.30},
    {"brand": "SsangYong", "model": "Musso", "promedio_m": 1.80},
    {"brand": "Subaru", "model": "Evoltis", "promedio_m": 3.60},
    {"brand": "Subaru", "model": "Forester", "promedio_m": 2.97},
    {"brand": "Subaru", "model": "WRX", "promedio_m": 1.30},
    {"brand": "Subaru", "model": "XV", "promedio_m": 1.40},
    {"brand": "Suzuki", "model": "Baleno", "promedio_m": 1.30},
    {"brand": "Suzuki", "model": "Dzire", "promedio_m": 1.10},
    {"brand": "Suzuki", "model": "Ertiga", "promedio_m": 1.80},
    {"brand": "Suzuki", "model": "Fronx", "promedio_m": 2.70},
    {"brand": "Suzuki", "model": "Grand Vitara", "promedio_m": 1.50},
    {"brand": "Suzuki", "model": "S-Cross", "promedio_m": 1.95},
    {"brand": "Suzuki", "model": "Swift", "promedio_m": 1.01},
    {"brand": "Tesla", "model": "Model 3", "promedio_m": 2.52},
    {"brand": "Tesla", "model": "Model Y", "promedio_m": 2.26},
    {"brand": "Toyota", "model": "4Runner", "promedio_m": 1.50},
    {"brand": "Toyota", "model": "Corolla", "promedio_m": 1.30},
    {"brand": "Toyota", "model": "Corolla Cross", "promedio_m": 1.58},
    {"brand": "Toyota", "model": "Corolla Sedan", "promedio_m": 2.40},
    {"brand": "Toyota", "model": "Fortuner", "promedio_m": 2.17},
    {"brand": "Toyota", "model": "Hilux", "promedio_m": 1.37},
    {"brand": "Toyota", "model": "LC 250", "promedio_m": 3.40},
    {"brand": "Toyota", "model": "Prado", "promedio_m": 4.10},
    {"brand": "Toyota", "model": "Prado LC 250", "promedio_m": 3.42},
    {"brand": "Toyota", "model": "RAV4", "promedio_m": 2.13},
    {"brand": "Toyota", "model": "Yaris", "promedio_m": 2.70},
    {"brand": "Toyota", "model": "Yaris Cross", "promedio_m": 1.90},
    {"brand": "Volkswagen", "model": "Amarok", "promedio_m": 1.40},
    {"brand": "Volkswagen", "model": "Beetle", "promedio_m": 1.10},
    {"brand": "Volkswagen", "model": "Gol", "promedio_m": 1.10},
    {"brand": "Volkswagen", "model": "Golf", "promedio_m": 1.20},
    {"brand": "Volkswagen", "model": "Jetta", "promedio_m": 1.47},
    {"brand": "Volkswagen", "model": "Nivus", "promedio_m": 1.40},
    {"brand": "Volkswagen", "model": "Polo", "promedio_m": 1.20},
    {"brand": "Volkswagen", "model": "Saveiro", "promedio_m": 0.80},
    {"brand": "Volkswagen", "model": "T-Cross", "promedio_m": 1.41},
    {"brand": "Volkswagen", "model": "Taos", "promedio_m": 2.47},
    {"brand": "Volkswagen", "model": "Tera", "promedio_m": 1.38},
    {"brand": "Volkswagen", "model": "Teramont", "promedio_m": 2.10},
    {"brand": "Volkswagen", "model": "Tiguan", "promedio_m": 1.50},
    {"brand": "Volkswagen", "model": "Virtus", "promedio_m": 1.40},
    {"brand": "Volvo", "model": "EX30", "promedio_m": 2.11},
    {"brand": "Volvo", "model": "XC60", "promedio_m": 4.00},
    {"brand": "Volvo", "model": "XC90", "promedio_m": 1.90},
    {"brand": "Zeekr", "model": "X", "promedio_m": 3.20},
]

# ============================================================
# REFERENCIAS DE CORTE · inventario de rollos (lista oficial)
# Cada grupo lleva la categoría de inventario de sus rollos.
# ============================================================
CUTTING_REFERENCE_GROUPS = [
    {"id": "black_ceramic", "label": "Black Ceramic", "categoria": "polarizado", "items": [
        "BLACK CERAMIC 15% 36X100", "BLACK CERAMIC 20% 40X100", "BLACK CERAMIC 20% 36X100",
        "BLACK CERAMIC 30% 40X100", "BLACK CERAMIC 30% 36X100",
    ]},
    {"id": "ceramic_i3_plus", "label": "Ceramic i3 Plus", "categoria": "polarizado", "items": [
        "CERAMIC I3 PLUS 5% 60X100", "CERAMIC I3 PLUS 40% 40X100", "CERAMIC I3 PLUS 30% 40X100",
    ]},
    {"id": "air", "label": "Air", "categoria": "polarizado", "items": [
        "AIR CERAMIC 70% CORTO", "AIR CERAMIC 70% LARGO",
    ]},
    {"id": "3m", "label": "3M", "categoria": "polarizado", "items": [
        "3M CERAMIC IR 5%", "3M CERAMIC IR 15%", "3M CERAMIC IR 25%",
    ]},
    {"id": "ceramic_i3", "label": "Ceramic i3", "categoria": "polarizado", "items": [
        "CERAMIC I3 5% 40X100", "CERAMIC I3 5% 60X100", "CERAMIC I3 15% 40X100", "CERAMIC I3 15% 60X100",
        "CERAMIC I3 22% 40X100", "CERAMIC I3 33% 40X100", "CERAMIC I3 56% 40X100",
    ]},
    {"id": "ultraoptik", "label": "Ultraoptik", "categoria": "polarizado", "items": [
        "ULTRAOPTIK HUPEROPTIK XTREME 20% 60X100", "ULTRAOPTIK HUPEROPTIK XTREME 20% 40X100",
        "ULTRAOPTIK HUPEROPTIK XTREME 30% 40X100", "ULTRAOPTIK HUPEROPTIK XTREME 5% 60X100",
        "ULTRAOPTIK HUPEROPTIK XTREME 5% EDGE SPECTRA HP 60X100",
        "ULTRAOPTIK HUPEROPTIK XTREME 15% EDGE SPECTRA HP 60X100",
    ]},
    {"id": "huperoptik", "label": "Huperoptik", "categoria": "polarizado", "items": [
        "HUPEROPTIK METALIZADO 20% 60X100", "HUPEROPTIK METALIZADO 30% 36X100",
    ]},
    {"id": "asfw", "label": "ASWF", "categoria": "polarizado", "items": [
        "ASWF CHARCOAL 7%", "ASWF CHARCOAL 12%", "ASWF CHARCOAL 35%", "ASWF NANO S IR 15%", "ASWF CLEAR PLEX",
    ]},
    {"id": "nano_spectra", "label": "Nano Spectra", "categoria": "polarizado", "items": [
        "NANOCERAMICA SPECTRA 5% ULTRACARBON", "NANOCERAMICA SPECTRA 20% ULTRACARBON",
        "NANOCERAMICA SPECTRA 35% ULTRACARBON", "NANOCERAMICA SPECTRA 50% NANOCERAMICA",
        "NANOCERAMICA SPECTRA 35% NANOCERAMICA",
    ]},
    {"id": "nicrome", "label": "Nicrome HD Spectra", "categoria": "polarizado", "items": [
        "NICROME HD 10% LARGO", "NICROME HD 20% CORTO", "NICROME HD 20% LARGO",
        "NICROME HD 35% CORTO", "NICROME HD 35% LARGO",
    ]},
    {"id": "nano_seguridad", "label": "Nano Seguridad", "categoria": "ultrasecure", "items": [
        "NANOSEGURIDAD SPECTRA 5%", "NANOSEGURIDAD SPECTRA 15%", "NANOSEGURIDAD SPECTRA 35%",
    ]},
    {"id": "ultrasecure", "label": "Ultrasecure", "categoria": "ultrasecure", "items": [
        "ULTRASECURE 4 MIL", "ULTRASECURE 7 MIL", "ULTRASECURE 12 MIL", "ULTRASECURE 21 MIL", "ULTRASECURE 24 MIL",
    ]},
    {"id": "steck_smart", "label": "Steck Smart", "categoria": "ultrasecure", "items": [
        "STECK SMART 0,05", "STECK SMART 0,15", "STECK SMART 0,35",
    ]},
    {"id": "ppf", "label": "PPF", "categoria": "ppf", "items": [
        "PPF AUTOBAHN STARKE", "PPF AUTOBAHN ROAD GUARD", "PPF AUTOBAHN INCOGNITO X", "PPF AUTOBAHN HALT",
        "PPF AUTOBAHN MATTE EDGE", "PPF WINDSHIELD 20% BLACK",
        "PPF XPEL GLOSS", "PPF XPEL ULTIMATE", "PPF XPEL STEALTH",
        "PPF STEK", "PPF SPECTRA NEXUS", "PPF SPECTRA MATTE SUPREME",
        "PPF TERMINAX SANTI BLACK", "PPF TERMINAX ULTRANAX NANO", "PPF TERMINAX RACING ORANGE",
        "PPF TERMINAX DRAGON BLOOD RED",
    ]},
]

# Metros de un rollo nuevo (100 pies)
DEFAULT_ROLL_METERS = 30.48

# Materiales para el corte, en 3 categorías operativas (se arman desde las referencias)
_MATERIAL_CATEGORIES = [
    ("material_1", "Polarizados", "polarizado"),
    ("material_2", "Seguridad / Ultrasecure", "ultrasecure"),
    ("material_3", "PPF · Paint Protection", "ppf"),
]
MATERIALS_CATALOG = {
    key: {"label": label, "items": [it for g in CUTTING_REFERENCE_GROUPS if g["categoria"] == cat for it in g["items"]]}
    for key, label, cat in _MATERIAL_CATEGORIES
}

# Rollos físicos: un rollo por referencia
ROLLS_LIST = [it for g in CUTTING_REFERENCE_GROUPS for it in g["items"]]


def normalize(s: str) -> str:
    import unicodedata
    if not s:
        return ""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    # collapse dashes, spaces, dots to normalize e.g. "CX-5" ~ "CX 5" ~ "CX5"
    s = s.lower().strip()
    for ch in ("-", " ", ".", "_"):
        s = s.replace(ch, "")
    return s


def lookup_car_average(brand: str, model: str):
    """Case-insensitive, accent-insensitive lookup. Fallback: partial match by model."""
    if not brand and not model:
        return None
    nb, nm = normalize(brand), normalize(model)
    # Exact match
    for row in CAR_AVERAGES:
        if normalize(row["brand"]) == nb and normalize(row["model"]) == nm:
            return row
    # Fallback: model contains or contained by
    candidates = [r for r in CAR_AVERAGES if normalize(r["brand"]) == nb]
    for row in candidates:
        rm = normalize(row["model"])
        if rm in nm or nm in rm:
            return row
    return None
