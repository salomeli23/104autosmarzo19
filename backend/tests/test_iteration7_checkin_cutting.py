"""
Iteration 7 backend tests:
  1. POST /api/orders/checkin → already_checked_in structured detail (400)
  2. POST /api/orders/assign → blocks polarizado/PPF orders when cutting_status != 'completado' (400)
  3. POST /api/orders/assign → succeeds for en_corte + cutting_status=completado (200)
  4. GET /api/cutting/pending → returns orders in en_revision/en_corte with polarizado/PPF (no 'ingresado')
  5. PUT /api/cutting/{id}/start → 400 if order not in en_revision/en_corte
"""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@polarizadosya.com", "password": "admin123"}
ASESOR = {"email": "asesor@polarizadosya.com", "password": "asesor123"}
COORD = {"email": "coordinador@polarizadosya.com", "password": "coord123"}
CORTE = {"email": "corte@polarizadosya.com", "password": "corte123"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"Login failed for {creds['email']}: {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {_login(ADMIN)}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def asesor_session():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {_login(ASESOR)}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def coord_session():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {_login(COORD)}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def corte_session():
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {_login(CORTE)}", "Content-Type": "application/json"})
    return s


# Track resources created for cleanup
CREATED_ORDER_IDS = []


@pytest.fixture(scope="module", autouse=True)
def cleanup(admin_session):
    yield
    for oid in CREATED_ORDER_IDS:
        try:
            admin_session.post(f"{API}/orders/{oid}/desistimiento",
                               json={"reason": "TEST cleanup iteration7"})
        except Exception:
            pass


# ---------- helpers ----------
def _create_full_order(admin_session, *, services, plate=None):
    """Create order via admin /orders endpoint. Defaults date to today (Colombia 2026-05-26)."""
    plate = plate or f"T7{uuid.uuid4().hex[:4].upper()}"
    payload = {
        "client_name": f"TEST Iter7 {plate}",
        "client_phone": "3001234567",
        "client_email": "test_iter7@example.com",
        "plate": plate,
        "brand": "Toyota",
        "model": "Corolla",
        "year": 2024,
        "color": "Blanco",
        "date": "2026-05-26",
        "time_slot": "8:00 AM - 10:00 AM",
        "services": services,
        "negotiated_value": float(sum(s.get("price", 0) for s in services) or 100000),
        "confirmation_pin": "00000",
    }
    r = admin_session.post(f"{API}/orders", json=payload)
    assert r.status_code in (200, 201), f"create order failed: {r.status_code} {r.text}"
    data = r.json()
    oid = data.get("id")
    assert oid, f"no order id in response: {data}"
    CREATED_ORDER_IDS.append(oid)
    return data


def _approve_ingreso(asesor_session, order_id, services):
    payload = {
        "order_id": order_id,
        "services": services,
        "final_value": sum(s.get("price", 0) for s in services) or 100000,
        "signature_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==",
        "cedula_number": "1234567890",
        "risk_agreement_accepted": True,
    }
    r = asesor_session.post(f"{API}/orders/ingreso-approval", json=payload)
    assert r.status_code == 200, f"ingreso-approval failed: {r.status_code} {r.text}"


def _complete_inspection(asesor_session, order_id):
    payload = {
        "order_id": order_id,
        "photos": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg=="],
        "video_url": "",
        "notes": "TEST iter7 inspection",
    }
    r = asesor_session.post(f"{API}/orders/inspection", json=payload)
    assert r.status_code == 200, f"inspection failed: {r.status_code} {r.text}"


def _get_order(admin_session, order_id):
    r = admin_session.get(f"{API}/orders/{order_id}")
    assert r.status_code == 200
    return r.json()


# ---------- TEST 1: already_checked_in detail ----------
def test_checkin_already_ingresado_returns_structured_400(admin_session, asesor_session):
    services = [{"service": "lavado_premium", "description": "Lavado Premium", "price": 50000, "parts": []}]
    order = _create_full_order(admin_session, services=services)
    order_id = order["id"]
    plate = order["plate"]

    # advance to INGRESADO
    _approve_ingreso(asesor_session, order_id, services)

    # checkin again with same plate
    r = asesor_session.post(f"{API}/orders/checkin", json={"order_code": plate})
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
    body = r.json()
    detail = body.get("detail")
    assert isinstance(detail, dict), f"detail not dict: {detail}"
    assert detail.get("type") == "already_checked_in"
    assert detail.get("current_status") == "ingresado"
    assert "Aprobada" in detail.get("current_status_label", "")
    assert detail.get("plate") == plate
    assert detail.get("order_code") == order["order_code"]
    assert detail.get("client_name") == order["client_name"]
    assert "message" in detail and detail["message"]


# ---------- TEST 2 & 3: assignment cutting gate ----------
@pytest.fixture(scope="module")
def technician_id(admin_session):
    r = admin_session.get(f"{API}/users?role=tecnico")
    assert r.status_code == 200, r.text
    techs = r.json()
    assert techs, "no técnicos seeded"
    return techs[0]["id"]


def test_assign_polarizado_without_cutting_returns_400(admin_session, asesor_session, coord_session, technician_id):
    services = [{"service": "nanooptik", "description": "Polarizado NanoOptik", "price": 800000, "parts": ["parabrisas"]}]
    order = _create_full_order(admin_session, services=services)
    order_id = order["id"]

    _approve_ingreso(asesor_session, order_id, services)
    _complete_inspection(asesor_session, order_id)

    # now status should be en_revision, try to assign
    r = coord_session.post(f"{API}/orders/assign", json={
        "order_id": order_id,
        "technician_id": technician_id,
        "service_time_minutes": 120,
    })
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
    body = r.json()
    assert "Corte de Piezas" in (body.get("detail") or ""), f"missing cutting message: {body}"


def test_assign_after_cutting_completado_succeeds(admin_session, asesor_session, coord_session, corte_session, technician_id):
    services = [{"service": "ppf_brillante", "description": "PPF Brillante", "price": 1500000, "parts": ["capó"]}]
    order = _create_full_order(admin_session, services=services)
    order_id = order["id"]

    _approve_ingreso(asesor_session, order_id, services)
    _complete_inspection(asesor_session, order_id)

    # Start cutting → moves to en_corte
    r = corte_session.put(f"{API}/cutting/{order_id}/start")
    assert r.status_code == 200, f"cutting start failed: {r.status_code} {r.text}"

    # Mark cutting completed (endpoint takes query params)
    r = corte_session.put(f"{API}/cutting/{order_id}/complete",
                          params={"notes": "TEST iter7 done", "measurements": "200x100"})
    assert r.status_code == 200, f"cutting complete failed: {r.status_code} {r.text}"

    # Confirm cutting_status=completado and status=en_corte
    o = _get_order(admin_session, order_id)
    assert o.get("cutting_status") == "completado", f"cutting_status={o.get('cutting_status')}"
    assert o.get("status") == "en_corte", f"status={o.get('status')}"

    # Now assignment should succeed
    r = coord_session.post(f"{API}/orders/assign", json={
        "order_id": order_id,
        "technician_id": technician_id,
        "service_time_minutes": 240,
    })
    assert r.status_code == 200, f"assign should succeed: {r.status_code} {r.text}"

    o = _get_order(admin_session, order_id)
    assert o["status"] == "asignado"


# ---------- TEST 4: cutting/pending excludes 'ingresado' ----------
def test_cutting_pending_only_en_revision_or_en_corte(corte_session):
    r = corte_session.get(f"{API}/cutting/pending")
    assert r.status_code == 200, r.text
    orders = r.json()
    assert isinstance(orders, list)
    bad = [o for o in orders if o.get("status") not in ("en_revision", "en_corte")]
    assert bad == [], f"cutting/pending returned non-allowed statuses: {[(o.get('order_code'), o.get('status')) for o in bad]}"
    # ensure each has a polarizado/PPF/ultrasecure service signal
    for o in orders:
        cs = o.get("cutting_services") or []
        assert cs, f"order {o.get('order_code')} returned without cutting_services list"


# ---------- TEST 5: cutting/start requires en_revision/en_corte ----------
def test_cutting_start_rejects_agendado(admin_session, corte_session):
    services = [{"service": "nanooptik", "description": "Polarizado NanoOptik", "price": 800000, "parts": ["parabrisas"]}]
    order = _create_full_order(admin_session, services=services)
    order_id = order["id"]
    # status is 'agendado'
    r = corte_session.put(f"{API}/cutting/{order_id}/start")
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
    detail = r.json().get("detail", "")
    assert "Revisión 360" in detail or "revision" in detail.lower(), f"unexpected detail: {detail}"
