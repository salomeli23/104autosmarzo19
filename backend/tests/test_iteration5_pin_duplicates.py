"""
Backend regression tests for PolarizadosYA – iteration 5

Focus areas (per review request):
  - POST /api/orders confirmation_pin validation
  - POST /api/orders duplicate plate+date detection
  - GET/PUT /api/settings/booking-pin admin guard + validation
  - calculate_scheduled_time for TODAY vs FUTURE
  - OrderResponse extended cutting_* and bahia_* fields exposed
  - Idempotency of /api/seed/users
"""

import os
import math
import pytest
import requests
from datetime import datetime, timedelta, timezone

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fall back to reading frontend/.env directly
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass

API = f"{BASE_URL}/api"

# -------------------- helpers --------------------

def _post(client, path, **kwargs):
    return client.post(f"{API}{path}", **kwargs)

def _get(client, path, **kwargs):
    return client.get(f"{API}{path}", **kwargs)

def _put(client, path, **kwargs):
    return client.put(f"{API}{path}", **kwargs)

# -------------------- fixtures --------------------

@pytest.fixture(scope="session")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s

@pytest.fixture(scope="session", autouse=True)
def ensure_seed(http):
    # Idempotent
    r1 = _post(http, "/seed/users")
    r2 = _post(http, "/seed/users")
    assert r1.status_code == 200
    assert r2.status_code == 200
    # second call shouldn't create new users
    assert r2.json().get("message") == "Created 0 users", f"Seed not idempotent: {r2.json()}"
    _post(http, "/seed/bahias")

def _login(http, email, password):
    r = _post(http, "/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()["access_token"]

@pytest.fixture(scope="session")
def admin_token(http):
    return _login(http, "admin@polarizadosya.com", "admin123")

@pytest.fixture(scope="session")
def asesor_token(http):
    return _login(http, "asesor@polarizadosya.com", "asesor123")

@pytest.fixture(scope="session")
def coord_token(http):
    return _login(http, "coordinador@polarizadosya.com", "coord123")

def _auth(token):
    return {"Authorization": f"Bearer {token}"}

# -------------------- /api/time/colombia --------------------

@pytest.fixture(scope="session")
def colombia_now(http):
    r = _get(http, "/time/colombia")
    assert r.status_code == 200, r.text
    data = r.json()
    # tolerant: accept ISO string under various keys
    iso = data.get("now") or data.get("datetime") or data.get("colombia_time") or data.get("time")
    return data, iso

def _pick_business_date(future_offset_days: int = 1) -> str:
    """Return a YYYY-MM-DD date that is not Sunday, offset days from Colombia today."""
    base = datetime.now(timezone(timedelta(hours=-5))).date()
    d = base + timedelta(days=future_offset_days)
    while d.weekday() == 6:  # Sunday
        d = d + timedelta(days=1)
    return d.isoformat()

def _today_business_or_skip():
    d = datetime.now(timezone(timedelta(hours=-5))).date()
    if d.weekday() == 6:
        pytest.skip("Today is Sunday – closed")
    return d.isoformat()

# -------------------- Settings booking PIN --------------------

class TestBookingPin:
    def test_get_pin_requires_admin(self, http, asesor_token):
        r = _get(http, "/settings/booking-pin", headers=_auth(asesor_token))
        assert r.status_code == 403, f"expected 403 for asesor, got {r.status_code}"

    def test_get_pin_admin_ok(self, http, admin_token):
        r = _get(http, "/settings/booking-pin", headers=_auth(admin_token))
        assert r.status_code == 200, r.text
        assert "pin" in r.json()

    def test_put_pin_non_admin_forbidden(self, http, coord_token):
        r = _put(http, "/settings/booking-pin", json={"pin": "1234"}, headers=_auth(coord_token))
        assert r.status_code == 403

    def test_put_pin_validation_short(self, http, admin_token):
        r = _put(http, "/settings/booking-pin", json={"pin": "12"}, headers=_auth(admin_token))
        assert r.status_code == 400
        assert "PIN" in r.json().get("detail", "")

    def test_put_pin_validation_nonnumeric(self, http, admin_token):
        r = _put(http, "/settings/booking-pin", json={"pin": "abcd"}, headers=_auth(admin_token))
        assert r.status_code == 400

    def test_put_pin_update_and_restore(self, http, admin_token):
        new_pin = "98765"
        r = _put(http, "/settings/booking-pin", json={"pin": new_pin}, headers=_auth(admin_token))
        assert r.status_code == 200
        assert r.json()["pin"] == new_pin
        # verify GET reflects
        g = _get(http, "/settings/booking-pin", headers=_auth(admin_token))
        assert g.json()["pin"] == new_pin
        # restore default
        r2 = _put(http, "/settings/booking-pin", json={"pin": "00000"}, headers=_auth(admin_token))
        assert r2.status_code == 200
        assert r2.json()["pin"] == "00000"

# -------------------- Order creation: PIN + duplicate --------------------

def _order_payload(plate: str, date: str, time_slot: str = "franja_2", pin: str | None = "00000"):
    payload = {
        "client_name": f"TEST_{plate}",
        "client_phone": "3001234567",
        "client_email": f"test_{plate.lower()}@example.com",
        "client_cedula": "1000",
        "plate": plate,
        "brand": "Mazda",
        "model": "3",
        "year": 2022,
        "color": "Negro",
        "date": date,
        "time_slot": time_slot,
        "services": [{"service": "polarizado_full", "description": "Polarizado - Completo", "price": 500000}],
        "negotiated_value": 500000,
        "notes": "TEST iteration 5",
    }
    if pin is not None:
        payload["confirmation_pin"] = pin
    return payload

CREATED_ORDER_IDS = []

class TestOrderCreationPinAndDuplicate:
    def test_missing_pin_returns_400(self, http, asesor_token):
        d = _pick_business_date(1)
        body = _order_payload(f"TST{datetime.now().microsecond:03d}", d, pin=None)
        r = _post(http, "/orders", json=body, headers=_auth(asesor_token))
        assert r.status_code == 400, r.text
        assert "PIN" in r.json().get("detail", "")

    def test_wrong_pin_returns_400(self, http, asesor_token):
        d = _pick_business_date(1)
        body = _order_payload(f"WRG{datetime.now().microsecond:03d}", d, pin="11111")
        r = _post(http, "/orders", json=body, headers=_auth(asesor_token))
        assert r.status_code == 400, r.text
        assert "incorrecto" in r.json().get("detail", "").lower()

    def test_valid_pin_creates_order_and_duplicate_rejected(self, http, asesor_token):
        d = _pick_business_date(2)
        plate = f"DUP{datetime.now().microsecond:03d}"
        body = _order_payload(plate, d)
        r1 = _post(http, "/orders", json=body, headers=_auth(asesor_token))
        assert r1.status_code == 200, r1.text
        order = r1.json()
        CREATED_ORDER_IDS.append(order["id"])
        assert order["plate"] == plate.upper()
        # Duplicate
        r2 = _post(http, "/orders", json=body, headers=_auth(asesor_token))
        assert r2.status_code == 409, f"expected 409, got {r2.status_code} {r2.text}"
        assert plate.upper() in r2.json().get("detail", "")

# -------------------- scheduled_time logic --------------------

class TestScheduledTime:
    def test_future_date_uses_position(self, http, asesor_token):
        d = _pick_business_date(3)
        plate = f"FUT{datetime.now().microsecond:03d}"
        body = _order_payload(plate, d, time_slot="franja_1")
        r = _post(http, "/orders", json=body, headers=_auth(asesor_token))
        assert r.status_code == 200, r.text
        order = r.json()
        CREATED_ORDER_IDS.append(order["id"])
        # franja_1 weekday starts 08:30; first/few orders should be at/after 08:30 and well before 11:30
        st = order.get("scheduled_time")
        assert st is not None
        hh, mm = map(int, st.split(":"))
        total = hh * 60 + mm
        assert 8 * 60 + 30 <= total <= 11 * 60 + 30, f"unexpected scheduled_time {st}"

    def test_today_scheduled_after_now(self, http, asesor_token):
        try:
            d = _today_business_or_skip()
        except Exception:
            pytest.skip("Today not business day")
        now = datetime.now(timezone(timedelta(hours=-5)))
        current_min = now.hour * 60 + now.minute
        # franja config (weekday): f1 8:30-11:30, f2 11:30-14:30, f3 14:30-16:00
        if current_min < 11 * 60 + 30:
            slot = "franja_1"; start = 8 * 60 + 30; end = 11 * 60 + 30; cap = 20
        elif current_min < 14 * 60 + 30:
            slot = "franja_2"; start = 11 * 60 + 30; end = 14 * 60 + 30; cap = 10
        elif current_min < 15 * 60 + 30:
            slot = "franja_3"; start = 14 * 60 + 30; end = 16 * 60; cap = 10
        else:
            pytest.skip("Outside today's last_registration window")
        plate = f"TDY{datetime.now().microsecond:03d}"
        body = _order_payload(plate, d, time_slot=slot)
        r = _post(http, "/orders", json=body, headers=_auth(asesor_token))
        assert r.status_code == 200, r.text
        order = r.json()
        CREATED_ORDER_IDS.append(order["id"])
        st = order.get("scheduled_time")
        assert st is not None
        hh, mm = map(int, st.split(":"))
        scheduled_min = hh * 60 + mm
        interval = (end - start) / cap
        # If current_time is BEFORE slot_start, scheduled = slot_start (position 0).
        # Otherwise scheduled must be >= current_time and within the next interval boundary.
        if current_min < start:
            assert scheduled_min == start, f"scheduled {st} should be slot_start when booking before slot opens"
        else:
            assert scheduled_min + 1 >= current_min, f"scheduled {st} before now {now.strftime('%H:%M')}"
            assert scheduled_min <= current_min + math.ceil(interval) + 1, (
                f"scheduled {st} not within next interval (~{interval}min) of now {now.strftime('%H:%M')}"
            )

# -------------------- OrderResponse extended fields --------------------

class TestOrderResponseFields:
    def test_response_contains_cutting_and_bahia_keys(self, http, asesor_token):
        d = _pick_business_date(4)
        plate = f"FLD{datetime.now().microsecond:03d}"
        r = _post(http, "/orders", json=_order_payload(plate, d), headers=_auth(asesor_token))
        assert r.status_code == 200, r.text
        order = r.json()
        CREATED_ORDER_IDS.append(order["id"])
        for key in [
            "cutting_status", "cutting_started_at", "cutting_completed_at",
            "cutting_measurements", "cutting_notes", "bahia_id", "bahia_name"
        ]:
            assert key in order, f"missing {key} in OrderResponse"

    def test_get_orders_list_includes_fields(self, http, asesor_token):
        r = _get(http, "/orders", headers=_auth(asesor_token))
        assert r.status_code == 200, r.text
        orders = r.json()
        assert isinstance(orders, list) and len(orders) > 0
        sample = orders[0]
        for key in ["cutting_status", "bahia_id", "bahia_name"]:
            assert key in sample

# -------------------- /api/bahias sanity --------------------

class TestBahias:
    def test_list_bahias_has_10(self, http, coord_token):
        r = _get(http, "/bahias", headers=_auth(coord_token))
        assert r.status_code == 200, r.text
        data = r.json()
        ids = [b["id"] for b in data]
        for i in range(1, 11):
            assert f"bahia_{i}" in ids, f"missing bahia_{i}"

# -------------------- cleanup --------------------

@pytest.fixture(scope="session", autouse=True)
def cleanup_test_orders(http, request):
    yield
    # mark created orders as desistimiento via direct DB not available;
    # use desistimiento endpoint to soft-cancel and prevent duplicate-block in future runs
    # need any token with permission. Try admin.
    try:
        token = _login(http, "admin@polarizadosya.com", "admin123")
        for oid in CREATED_ORDER_IDS:
            try:
                _post(http, f"/orders/{oid}/desistimiento",
                      json={"reason": "TEST cleanup iteration 5"},
                      headers=_auth(token))
            except Exception:
                pass
    except Exception:
        pass
