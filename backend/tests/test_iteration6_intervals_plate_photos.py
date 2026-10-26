"""
Backend regression tests for iteration 6:
- 15-min fixed interval between consecutive bookings
- Check-in by plate (not only by code)
- /orders/{id}/send-inspection-photos endpoint (compression + recipients)
"""
import os
import base64
import io
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
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

@pytest.fixture(scope="session")
def http():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(http, email, password):
    r = http.post(f"{API}/auth/login", json={"email": email, "password": password})
    r.raise_for_status()
    return r.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def asesor_token(http):
    http.post(f"{API}/seed/users")
    return _login(http, "asesor@polarizadosya.com", "asesor123")


@pytest.fixture(scope="session")
def admin_token(http):
    return _login(http, "admin@polarizadosya.com", "admin123")


def _future_date(days_ahead: int) -> str:
    """Pick a business date N days ahead, skipping Sundays."""
    d = datetime.now(timezone(timedelta(hours=-5)))
    for _ in range(14):
        d = d + timedelta(days=1 if days_ahead > 0 else 0)
        if d.weekday() != 6:
            days_ahead -= 1
            if days_ahead <= 0:
                return d.strftime("%Y-%m-%d")
    return d.strftime("%Y-%m-%d")


def _payload(plate, date_str, slot="franja_2"):
    return {
        "client_name": f"TEST_{plate}",
        "client_phone": "3001234567",
        "client_email": f"test_{plate.lower()}@example.com",
        "plate": plate,
        "brand": "Mazda",
        "model": "3",
        "date": date_str,
        "time_slot": slot,
        "services": [{"service": "polarizado_full", "description": "Polarizado", "price": 500000}],
        "negotiated_value": 500000,
        "confirmation_pin": "00000",
    }


CREATED = []


# -------------------- 15-min fixed interval --------------------

class TestFifteenMinInterval:
    def test_consecutive_orders_15_min_apart(self, http, asesor_token):
        d = _future_date(2)  # future date so no current-time adjustment
        times = []
        for i in range(4):
            plate = f"INT15{i}{datetime.now().microsecond:03d}"
            r = http.post(f"{API}/orders", json=_payload(plate, d, "franja_1"), headers=_auth(asesor_token))
            assert r.status_code == 200, r.text
            o = r.json()
            CREATED.append(o["id"])
            times.append(o["scheduled_time"])
        # Convert to minutes since midnight
        mins = []
        for t in times:
            hh, mm = map(int, t.split(":"))
            mins.append(hh * 60 + mm)
        # Each subsequent booking must be exactly 15 min after the previous
        for i in range(1, len(mins)):
            delta = mins[i] - mins[i - 1]
            assert delta == 15, f"Expected 15-min interval, got {delta} between {times[i-1]} and {times[i]}"


# -------------------- Check-in by plate --------------------

class TestCheckinByPlate:
    def test_checkin_finds_by_plate(self, http, asesor_token):
        d = _future_date(3)
        plate = f"PLT{datetime.now().microsecond:03d}"
        # Create order
        r = http.post(f"{API}/orders", json=_payload(plate, d), headers=_auth(asesor_token))
        assert r.status_code == 200, r.text
        o = r.json()
        CREATED.append(o["id"])
        order_code = o["order_code"]

        # The order is for a FUTURE date so check-in will reject with "wait until that day",
        # which is fine. We only care that the lookup BY PLATE succeeds (no 404).
        r2 = http.post(f"{API}/orders/checkin", json={"order_code": plate}, headers=_auth(asesor_token))
        # Should NOT be 404 (lookup succeeded). Either 200 or 400 (time validation).
        assert r2.status_code != 404, f"Lookup by plate failed: {r2.text}"
        # If 400, it should be the time-validation error, not "no encontrada"
        if r2.status_code == 400:
            detail = r2.json().get("detail", "")
            assert "no encontrada" not in str(detail).lower(), f"plate lookup returned 'not found': {detail}"

    def test_checkin_finds_by_code(self, http, asesor_token):
        d = _future_date(4)
        plate = f"COD{datetime.now().microsecond:03d}"
        r = http.post(f"{API}/orders", json=_payload(plate, d), headers=_auth(asesor_token))
        assert r.status_code == 200
        o = r.json()
        CREATED.append(o["id"])
        # Lookup by order_code still works
        r2 = http.post(f"{API}/orders/checkin", json={"order_code": o["order_code"]}, headers=_auth(asesor_token))
        assert r2.status_code != 404

    def test_checkin_404_for_unknown(self, http, asesor_token):
        r = http.post(f"{API}/orders/checkin", json={"order_code": "NOEXIST999"}, headers=_auth(asesor_token))
        assert r.status_code == 404


# -------------------- Send Inspection Photos --------------------

class TestSendInspectionPhotos:
    @pytest.fixture(scope="class")
    def order_with_photos(self, http, asesor_token, admin_token):
        """Create an order, set inspection_photos directly via Mongo (no upload endpoint here).
        We use the desistimiento+raw DB combo would be too invasive, so we'll just call
        the endpoint on an order that doesn't have photos to check the 400 path,
        then on the same order after we patch photos via PUT /api/orders/{id} (none exists).
        Instead, test the no-photos error path only.
        """
        d = _future_date(5)
        plate = f"PHO{datetime.now().microsecond:03d}"
        r = http.post(f"{API}/orders", json=_payload(plate, d), headers=_auth(asesor_token))
        assert r.status_code == 200
        o = r.json()
        CREATED.append(o["id"])
        return o

    def test_send_photos_no_photos_returns_400(self, http, asesor_token, order_with_photos):
        r = http.post(
            f"{API}/orders/{order_with_photos['id']}/send-inspection-photos",
            json={"order_id": order_with_photos["id"]},
            headers=_auth(asesor_token),
        )
        # The order has no inspection_photos yet → 400
        assert r.status_code == 400
        assert "fotos" in r.json().get("detail", "").lower()

    def test_send_photos_with_photos(self, http, asesor_token, order_with_photos):
        """Directly inject photos via DB and call the endpoint."""
        from pymongo import MongoClient
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        client = MongoClient(os.environ["MONGO_URL"])
        db = client[os.environ["DB_NAME"]]

        # Create a small test image
        from PIL import Image
        img = Image.new("RGB", (640, 480), color=(0, 128, 255))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
        data_url = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()

        db.orders.update_one(
            {"id": order_with_photos["id"]},
            {"$set": {"inspection_photos": [data_url, data_url], "client_email": "client@example.com"}},
        )

        r = http.post(
            f"{API}/orders/{order_with_photos['id']}/send-inspection-photos",
            json={"order_id": order_with_photos["id"]},
            headers=_auth(asesor_token),
        )
        # If Resend is configured, expect 200. Otherwise 500 with "no configurado".
        assert r.status_code in (200, 500)
        if r.status_code == 200:
            body = r.json()
            assert body["photos_sent"] == 2
            # Recipients should include both the client email and a coordinator email
            recipients = body.get("recipients", [])
            assert "client@example.com" in recipients
            assert any("coordinador" in e for e in recipients), f"no coordinator in recipients: {recipients}"

    def test_send_photos_404_for_unknown_order(self, http, asesor_token):
        r = http.post(
            f"{API}/orders/non-existent-id/send-inspection-photos",
            json={"order_id": "non-existent-id"},
            headers=_auth(asesor_token),
        )
        assert r.status_code == 404


# -------------------- cleanup --------------------

@pytest.fixture(scope="session", autouse=True)
def cleanup(http, request):
    yield
    try:
        token = _login(http, "admin@polarizadosya.com", "admin123")
        for oid in CREATED:
            try:
                http.post(f"{API}/orders/{oid}/desistimiento",
                          json={"reason": "iteration 6 cleanup"},
                          headers=_auth(token))
            except Exception:
                pass
    except Exception:
        pass
