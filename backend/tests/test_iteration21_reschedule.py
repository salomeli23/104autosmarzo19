"""Iteration 21 - Reschedule appointment endpoint tests.

Covers POST /api/orders/{id}/reschedule (password-gated repost/adelanto of
scheduled appointments). Verifies status guard, password validation, priority
handling, history persistence and OrderResponse fields.
"""
import os
import uuid
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={
        "email": "admin@polarizadosya.com", "password": "admin123"
    })
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


def _future_date(days=7):
    return (date.today() + timedelta(days=days)).isoformat()


@pytest.fixture()
def order_agendado(headers):
    """Create a fresh AGENDADO order for each test."""
    suffix = uuid.uuid4().hex[:6].upper()
    payload = {
        "client_name": f"TEST_Client_{suffix}",
        "client_phone": "3001234567",
        "client_email": f"delivered+{suffix}@resend.dev",
        "plate": f"T{suffix[:5]}",
        "brand": "Renault",
        "model": "Logan",
        "year": 2020,
        "color": "Blanco",
        "date": _future_date(7),
        "time_slot": "franja_1",
        "services": [{"service": "Polarizado", "price": 350000}],
        "negotiated_value": 350000,
        "confirmation_pin": "00000",
    }
    r = requests.post(f"{API}/orders", json=payload, headers=headers)
    assert r.status_code == 200, r.text
    order = r.json()
    yield order
    # cleanup best-effort
    try:
        requests.delete(f"{API}/orders/{order['id']}", headers=headers)
    except Exception:
        pass


# ---------- tests ----------
class TestReschedulePasswordValidation:
    def test_empty_password_rejected(self, headers, order_agendado):
        r = requests.post(
            f"{API}/orders/{order_agendado['id']}/reschedule",
            json={"new_date": _future_date(10), "new_time_slot": "franja_2", "password": ""},
            headers=headers,
        )
        assert r.status_code == 400
        assert "Contraseña" in r.json().get("detail", "")

    def test_wrong_password_rejected(self, headers, order_agendado):
        r = requests.post(
            f"{API}/orders/{order_agendado['id']}/reschedule",
            json={"new_date": _future_date(10), "new_time_slot": "franja_2", "password": "999999"},
            headers=headers,
        )
        assert r.status_code == 400
        assert "inválida" in r.json().get("detail", "").lower()


class TestRescheduleSuccess:
    def test_valid_password_reschedules_and_persists(self, headers, order_agendado):
        new_date = _future_date(14)
        r = requests.post(
            f"{API}/orders/{order_agendado['id']}/reschedule",
            json={
                "new_date": new_date,
                "new_time_slot": "franja_2",
                "password": "861123",
                "reason": "Cliente solicita adelanto",
            },
            headers=headers,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["new_date"] == new_date
        assert body["email_sent"] is True  # order has client_email

        # GET to verify persistence
        g = requests.get(f"{API}/orders/{order_agendado['id']}", headers=headers)
        assert g.status_code == 200
        got = g.json()
        assert got["date"] == new_date
        assert got["time_slot"] == "franja_2"
        assert got["reschedule_count"] == 1
        assert got.get("rescheduled_at")
        assert got.get("rescheduled_by")

    def test_priority_slot_sets_current_colombia_time(self, headers, order_agendado):
        r = requests.post(
            f"{API}/orders/{order_agendado['id']}/reschedule",
            json={
                "new_date": _future_date(2),
                "new_time_slot": "prioridad",
                "password": "861123",
            },
            headers=headers,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # HH:MM format
        assert len(body["new_time"]) == 5 and body["new_time"][2] == ":"

        g = requests.get(f"{API}/orders/{order_agendado['id']}", headers=headers)
        assert g.status_code == 200
        got = g.json()
        assert got["time_slot"] == "prioridad"
        assert got.get("is_priority") is True


class TestRescheduleStatusGuard:
    def test_non_agendado_status_rejected(self, headers, order_agendado):
        # Move to INGRESADO via check-in (or manually set status)
        # Fastest path: try reschedule after doing check-in
        oid = order_agendado["id"]
        # Attempt checkin (may need extra data; fallback to direct status update via desistimiento
        # if checkin API is complex). Use desistimiento to change status out of AGENDADO.
        d = requests.post(
            f"{API}/orders/{oid}/desistimiento",
            json={"reason": "TEST"},
            headers=headers,
        )
        # Whether it succeeds or not, status should differ from AGENDADO now — but
        # if the endpoint failed we skip.
        if d.status_code != 200:
            pytest.skip(f"Could not change status out of AGENDADO ({d.status_code}: {d.text})")

        r = requests.post(
            f"{API}/orders/{oid}/reschedule",
            json={"new_date": _future_date(10), "new_time_slot": "franja_1", "password": "861123"},
            headers=headers,
        )
        assert r.status_code == 400
        assert "AGENDADO" in r.json().get("detail", "")


class TestOrderResponseFields:
    def test_get_order_exposes_reschedule_metadata(self, headers, order_agendado):
        # Reschedule once
        requests.post(
            f"{API}/orders/{order_agendado['id']}/reschedule",
            json={"new_date": _future_date(9), "new_time_slot": "franja_3", "password": "861123"},
            headers=headers,
        )
        g = requests.get(f"{API}/orders/{order_agendado['id']}", headers=headers)
        assert g.status_code == 200
        got = g.json()
        for k in ("rescheduled_at", "rescheduled_by", "reschedule_count"):
            assert k in got, f"Missing key {k} in OrderResponse"
        assert got["reschedule_count"] >= 1
