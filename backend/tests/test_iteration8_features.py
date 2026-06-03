"""
Iteration 8 backend tests for PolarizadosYA.

Validates the feature set requested in the iteration 8 review:
  1. GET /api/orders returns created_by / created_by_name / created_by_role
  2. POST /api/orders/complete-service (notes + completion_photos) transitions
     EN_PROCESO -> SERVICIO_COMPLETADO (or ENTREGADO for postventa) AND releases
     the bahia.
  3. POST /api/orders/complete-service rejects with 400 when status != en_proceso.
  4. POST /api/orders as Asesor persists created_by_name (visible in GET).
  5. Postventa creation via POST /api/orders (is_postventa=true) and
     GET /api/orders/history-by-plate/{plate} returns at least the placed order.
  6. PUT /api/cutting/{id}/complete with inventory_item_id + meters_used decrements
     metros_restantes correctly.
  7. GET /api/inventory/alerts returns alerts list with severity field.
"""

import os
import uuid
import pytest
import requests

def _read_frontend_env():
    try:
        with open("/app/frontend/.env", "r") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return None


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_env() or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not configured"
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@polarizadosya.com", "password": "admin123"}
ASESOR = {"email": "asesor@polarizadosya.com", "password": "asesor123"}
TECNICO = {"email": "tecnico@polarizadosya.com", "password": "tecnico123"}
CORTE = {"email": "corte@polarizadosya.com", "password": "corte123"}

BOOKING_PIN = "00000"
COMPLETION_PIN = "11111"

from datetime import datetime
FUTURE_DATE = datetime.now().strftime("%Y-%m-%d")  # use today so checkin time validation passes


# ---------- helpers / fixtures ----------

def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.text}"
    return r.json()["access_token"]


def _hdr(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def admin_token():
    return _login(ADMIN)


@pytest.fixture(scope="session")
def asesor_token():
    return _login(ASESOR)


@pytest.fixture(scope="session")
def tecnico_token():
    return _login(TECNICO)


@pytest.fixture(scope="session")
def corte_token():
    return _login(CORTE)


def _make_order_payload(plate, services=None, is_postventa=False):
    services = services or [{"service": "Lavado Completo", "price": 25000}]
    return {
        "client_name": f"TEST_Cliente_{plate}",
        "client_phone": "3001234567",
        "client_email": f"test_{plate.lower()}@example.com",
        "client_cedula": "1000000000",
        "plate": plate,
        "brand": "Mazda",
        "model": "CX5",
        "year": 2022,
        "color": "Negro",
        "date": FUTURE_DATE,
        "time_slot": "08-12",
        "services": services,
        "negotiated_value": 25000,
        "notes": "TEST iteration 8",
        "confirmation_pin": BOOKING_PIN,
        "is_postventa": is_postventa,
    }


def _create_order(token, plate, services=None, is_postventa=False, original_order_id=None):
    payload = _make_order_payload(plate, services=services, is_postventa=is_postventa)
    if is_postventa:
        payload["postventa_type"] = "garantia"
        payload["postventa_motivo"] = "TEST garantía"
        if original_order_id:
            payload["original_order_id"] = original_order_id
    r = requests.post(f"{API}/orders", json=payload, headers=_hdr(token), timeout=15)
    assert r.status_code == 200, f"create order failed: {r.status_code} {r.text}"
    return r.json()


def _drive_to_en_revision(admin_token, order):
    """agendado -> ingresado -> en_revision."""
    order_id = order["id"]
    # 1) checkin uses order_code
    r = requests.post(
        f"{API}/orders/checkin",
        json={"order_code": order["order_code"]},
        headers=_hdr(admin_token), timeout=15,
    )
    assert r.status_code == 200, f"checkin: {r.status_code} {r.text}"
    # 2) ingreso-approval -> INGRESADO
    r = requests.post(
        f"{API}/orders/ingreso-approval",
        json={
            "order_id": order_id,
            "services": order.get("services") or [{"service": "Lavado Completo", "price": 25000}],
            "final_value": order.get("negotiated_value") or 25000,
            "signature_url": "data:image/png;base64,TEST",
            "cedula_number": order.get("client_cedula") or "1000000000",
            "risk_agreement_accepted": True,
        },
        headers=_hdr(admin_token), timeout=15,
    )
    assert r.status_code == 200, f"ingreso-approval: {r.status_code} {r.text}"
    # 3) inspection -> EN_REVISION
    r = requests.post(
        f"{API}/orders/inspection",
        json={"order_id": order_id, "photos": [], "video_url": None, "notes": "TEST"},
        headers=_hdr(admin_token), timeout=15,
    )
    assert r.status_code == 200, f"inspection: {r.status_code} {r.text}"


def _checkin_assign_start(admin_token, order, technician_id=None):
    """Drive an order from agendado -> en_proceso so we can test complete-service.

    Returns (technician_id, bahia_id).
    """
    _drive_to_en_revision(admin_token, order)
    order_id = order["id"]

    # discover a technician id
    if technician_id is None:
        r = requests.get(f"{API}/users", headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200
        techs = [u for u in r.json() if u.get("role") == "tecnico"]
        assert techs, "No técnico user found"
        technician_id = techs[0]["id"]

    # find a free bahia (optional)
    bahia_id = None
    try:
        r = requests.get(f"{API}/bahias", headers=_hdr(admin_token), timeout=15)
        if r.status_code == 200:
            free = [b for b in r.json() if not b.get("current_order_id")]
            if free:
                bahia_id = free[0]["id"]
    except Exception:
        pass

    body = {"order_id": order_id, "technician_id": technician_id, "service_time_minutes": 60}
    if bahia_id:
        body["bahia_id"] = bahia_id
    r = requests.post(f"{API}/orders/assign", json=body, headers=_hdr(admin_token), timeout=15)
    assert r.status_code == 200, f"assign: {r.status_code} {r.text}"

    r = requests.post(
        f"{API}/orders/{order_id}/start-service",
        headers=_hdr(admin_token), timeout=15,
    )
    assert r.status_code == 200, f"start: {r.status_code} {r.text}"

    return technician_id, bahia_id


# tiny base64 1x1 PNG
TINY_PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/Pchi0gAAAABJRU5ErkJggg=="
)


# ---------- 1. created_by / created_by_name / created_by_role in GET /orders ----------

class TestOrdersExposeCreatorMetadata:
    def test_get_orders_includes_creator_fields(self, asesor_token, admin_token):
        plate = f"T{uuid.uuid4().hex[:6].upper()}"
        created = _create_order(asesor_token, plate)
        assert created.get("created_by_name"), "POST /orders response missing created_by_name"
        assert created.get("created_by_role") == "asesor"

        r = requests.get(f"{API}/orders", headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200
        match = next((o for o in r.json() if o["id"] == created["id"]), None)
        assert match, "created order not present in GET /orders"
        assert match.get("created_by"), "created_by missing on GET /orders item"
        assert match.get("created_by_name"), "created_by_name missing on GET /orders item"
        assert match.get("created_by_role") == "asesor"


# ---------- 2 & 3. complete-service happy path + 400 path ----------

class TestCompleteService:
    def test_complete_service_releases_bahia_and_changes_status(self, admin_token, tecnico_token):
        plate = f"T{uuid.uuid4().hex[:6].upper()}"
        order = _create_order(admin_token, plate)
        order_id = order["id"]
        _, bahia_id = _checkin_assign_start(admin_token, order)

        # Order should now be EN_PROCESO
        r = requests.get(f"{API}/orders/{order_id}", headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200
        assert r.json()["status"] == "en_proceso"

        # complete service as técnico
        r = requests.post(
            f"{API}/orders/complete-service",
            json={
                "order_id": order_id,
                "notes": "TEST servicio finalizado correctamente",
                "completion_photos": [TINY_PNG, TINY_PNG],
            },
            headers=_hdr(tecnico_token),
            timeout=20,
        )
        assert r.status_code == 200, f"complete-service: {r.status_code} {r.text}"

        # verify status transition + photos persisted
        r = requests.get(f"{API}/orders/{order_id}", headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "servicio_completado"
        # NOTE: service_completion_photos is stored in Mongo but NOT exposed by OrderResponse.
        # The technician_notes field is present and we assert that here.
        assert data.get("technician_notes") == "TEST servicio finalizado correctamente"

        # verify bahia released (if one was assigned)
        if bahia_id:
            r = requests.get(f"{API}/bahias", headers=_hdr(admin_token), timeout=15)
            assert r.status_code == 200
            bahia = next((b for b in r.json() if b["id"] == bahia_id), None)
            assert bahia is not None
            assert bahia.get("current_order_id") in (None, ""), (
                f"bahia not released: {bahia}"
            )

    def test_complete_service_rejects_when_not_en_proceso(self, admin_token, tecnico_token):
        # Fresh agendado order
        plate = f"T{uuid.uuid4().hex[:6].upper()}"
        order = _create_order(admin_token, plate)
        r = requests.post(
            f"{API}/orders/complete-service",
            json={
                "order_id": order["id"],
                "notes": "TEST",
                "completion_photos": [TINY_PNG],
            },
            headers=_hdr(tecnico_token),
            timeout=15,
        )
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"


# ---------- 4. Asesor visibility ----------

class TestAsesorCreator:
    def test_asesor_created_order_visible_with_role(self, asesor_token, admin_token):
        plate = f"T{uuid.uuid4().hex[:6].upper()}"
        created = _create_order(asesor_token, plate)
        r = requests.get(f"{API}/orders/{created['id']}", headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["created_by_role"] == "asesor"
        assert "asesor" in (data.get("created_by_name") or "").lower() or data.get("created_by_name")


# ---------- 5. Postventa creation + history-by-plate ----------

class TestPostventa:
    def test_create_postventa_and_history_by_plate(self, asesor_token):
        plate = f"PV{uuid.uuid4().hex[:5].upper()}"
        # Original order
        base = _create_order(asesor_token, plate)
        # Postventa garantía referencing the base order
        post = _create_order(
            asesor_token,
            plate,
            services=[{"service": "Garantía Polarizado", "price": 0}],
            is_postventa=True,
            original_order_id=base["id"],
        )
        assert post.get("is_postventa") is True
        assert post.get("postventa_type") == "garantia"

        # history-by-plate must include both orders
        r = requests.get(
            f"{API}/orders/history-by-plate/{plate}",
            headers=_hdr(asesor_token),
            timeout=15,
        )
        assert r.status_code == 200, f"history-by-plate: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("plate", "").upper() == plate.upper()
        ids = {o["id"] for o in body.get("orders", [])}
        assert base["id"] in ids and post["id"] in ids


# ---------- 6. Cutting completion auto-deducts inventory ----------

class TestCuttingAutoDeduct:
    def test_complete_cutting_deducts_meters(self, admin_token, corte_token):
        # Create a polarizado order so cutting flow applies
        plate = f"CT{uuid.uuid4().hex[:5].upper()}"
        order = _create_order(
            admin_token,
            plate,
            services=[{"service": "Polarizado 5%", "price": 350000}],
        )
        order_id = order["id"]

        # Drive to en_revision (checkin + ingreso-approval + inspection)
        _drive_to_en_revision(admin_token, order)
        # Now start cutting -> en_corte
        r = requests.put(
            f"{API}/cutting/{order_id}/start",
            headers=_hdr(corte_token), timeout=15,
        )
        assert r.status_code == 200, f"cutting start: {r.status_code} {r.text}"

        # Create a rollo to deduct from
        rollo_payload = {
            "nombre": f"TEST_Rollo_{uuid.uuid4().hex[:4]}",
            "categoria": "polarizado",
            "tipo_articulo": "rollo",
            "tipo_rollo": "spectra",
            "metros_iniciales": 50,
            "costo": 100000,
        }
        r = requests.post(f"{API}/inventory", json=rollo_payload, headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200, f"create rollo: {r.status_code} {r.text}"
        rollo = r.json()
        rollo_id = rollo["id"]
        initial_meters = rollo.get("metros_restantes") or 50

        # Complete cutting with manual meters_used=3
        r = requests.put(
            f"{API}/cutting/{order_id}/complete",
            json={
                "measurements": "Panoramico 150x60",
                "notes": "TEST",
                "inventory_item_id": rollo_id,
                "meters_used": 3,
            },
            headers=_hdr(corte_token),
            timeout=15,
        )
        assert r.status_code == 200, f"cutting complete: {r.status_code} {r.text}"
        body = r.json()
        assert body.get("inventory_deduction") is not None, "expected inventory_deduction in response"
        assert body["inventory_deduction"]["meters_used"] == 3

        # Verify rollo metros_restantes decreased by 3
        r = requests.get(f"{API}/inventory", headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200
        items = r.json() if isinstance(r.json(), list) else r.json().get("items", [])
        updated = next((i for i in items if i["id"] == rollo_id), None)
        assert updated, "rollo not found after deduction"
        assert abs((updated.get("metros_restantes") or 0) - (initial_meters - 3)) < 0.01, (
            f"expected metros_restantes={initial_meters-3}, got {updated.get('metros_restantes')}"
        )


# ---------- 7. Inventory alerts ----------

class TestInventoryAlerts:
    def test_alerts_endpoint_returns_severity(self, admin_token):
        r = requests.get(f"{API}/inventory/alerts", headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200, f"alerts: {r.status_code} {r.text}"
        body = r.json()
        assert "alerts" in body and isinstance(body["alerts"], list)
        assert "thresholds" in body
        # If any alert is returned, severity field must exist
        for a in body["alerts"]:
            assert a.get("severity") in {"critical", "high", "medium"}, a
            assert "tipo_rollo" in a and "current_count" in a and "threshold" in a
