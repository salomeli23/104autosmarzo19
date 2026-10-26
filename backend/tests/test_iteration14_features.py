"""Iteration 14 backend tests:
- POST /seed/test-orders idempotence
- /orders-with-balance (filters, only_pending)
- /payments (register, exceed balance, complete balance => terminado_pagado)
- /payments GET history + by-order
- /orders-pending-release + /orders/{id}/authorize-release (balance gate)
- /orders-pending-invoice + /orders/{id}/send-invoice-email (missing email 400)
- /orders/{id}/send-ingreso-receipt (missing email 400)
"""
import os
import time
import pytest
import requests


def _read_backend_url():
    val = os.environ.get("REACT_APP_BACKEND_URL")
    if val:
        return val.rstrip("/")
    try:
        with open("/app/frontend/.env", "r") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass
    return ""


BASE_URL = _read_backend_url()
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@polarizadosya.com", "password": "admin123"}
FACTU = {"email": "facturacion@polarizadosya.com", "password": "factura123"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_headers():
    requests.post(f"{API}/seed/users", timeout=15)
    return {"Authorization": f"Bearer {_login(ADMIN)}"}


@pytest.fixture(scope="module")
def factu_headers():
    return {"Authorization": f"Bearer {_login(FACTU)}"}


@pytest.fixture(scope="module", autouse=True)
def seed_orders(admin_headers):
    r = requests.post(f"{API}/seed/test-orders", headers=admin_headers, timeout=30)
    assert r.status_code == 200, r.text
    # idempotent second call
    r2 = requests.post(f"{API}/seed/test-orders", headers=admin_headers, timeout=30)
    assert r2.status_code == 200
    assert r2.json().get("count", 0) == 0, f"Second call must be no-op, got {r2.json()}"


def _mongo():
    import pymongo
    mongo_url, db_name = None, None
    with open("/app/backend/.env") as f:
        for ln in f:
            if ln.startswith("MONGO_URL="):
                mongo_url = ln.split("=", 1)[1].strip().strip('"').strip("'")
            if ln.startswith("DB_NAME="):
                db_name = ln.split("=", 1)[1].strip().strip('"').strip("'")
    return pymongo.MongoClient(mongo_url)[db_name]


@pytest.fixture(scope="class", autouse=False)
def reset_abc_order():
    """Reset ABC123 seed order to freshly-partially-paid state before Payment tests."""
    m = _mongo()
    m.orders.update_one(
        {"plate": "ABC123"},
        {"$set": {
            "final_value": 900000, "negotiated_value": 900000,
            "amount_paid": 300000, "status": "servicio_completado",
            "ready_for_delivery": False, "release_authorized": False,
            "release_authorized_at": None, "release_authorized_by_name": None,
            "paid_at": None,
        }},
    )
    m.payments.delete_many({"plate": "ABC123"})
    yield


def _find_order_by_plate(headers, plate):
    r = requests.get(f"{API}/orders-with-balance", params={"q": plate}, headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    items = r.json()
    return next((o for o in items if o["plate"] == plate), None)


class TestOrdersWithBalance:
    def test_only_pending_returns_balance_gt_zero(self, admin_headers):
        r = requests.get(f"{API}/orders-with-balance", params={"only_pending": "true"}, headers=admin_headers, timeout=15)
        assert r.status_code == 200
        items = r.json()
        assert isinstance(items, list) and len(items) > 0
        for o in items:
            assert o["balance"] > 0.01, f"Order {o.get('plate')} has balance {o['balance']}"

    def test_filter_by_plate_case_insensitive(self, admin_headers):
        r = requests.get(f"{API}/orders-with-balance", params={"q": "abc"}, headers=admin_headers, timeout=15)
        assert r.status_code == 200
        items = r.json()
        assert any(o["plate"] == "ABC123" for o in items), f"got {[o['plate'] for o in items]}"

    def test_seed_orders_all_present(self, admin_headers):
        for plate in ("ABC123", "XYZ789", "GHI456"):
            o = _find_order_by_plate(admin_headers, plate)
            assert o is not None, f"seed order {plate} missing"


class TestPayments:
    @pytest.fixture(autouse=True, scope="class")
    def _reset(self, reset_abc_order):
        pass

    def test_partial_payment_accumulates(self, admin_headers):
        o = _find_order_by_plate(admin_headers, "ABC123")
        assert o is not None
        before_paid = o["paid"]
        before_balance = o["balance"]
        assert before_balance > 100
        payload = {"order_id": o["id"], "amount": 100000, "method": "efectivo", "reference": "TEST_iter14"}
        r = requests.post(f"{API}/payments", json=payload, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["paid"] == pytest.approx(before_paid + 100000, abs=1)
        assert data["balance"] == pytest.approx(before_balance - 100000, abs=1)
        pytest.abc_order_id = o["id"]
        pytest.abc_prev_balance = data["balance"]

    def test_exceed_balance_returns_400(self, admin_headers):
        r = requests.post(f"{API}/payments", json={
            "order_id": pytest.abc_order_id, "amount": 99999999, "method": "efectivo",
        }, headers=admin_headers, timeout=15)
        assert r.status_code == 400, r.text

    def test_complete_balance_sets_ready_and_terminado_pagado(self, admin_headers):
        r = requests.post(f"{API}/payments", json={
            "order_id": pytest.abc_order_id, "amount": pytest.abc_prev_balance, "method": "efectivo",
        }, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ready_for_delivery"] is True
        assert data["balance"] <= 0.01
        # Verify order status
        after = _find_order_by_plate(admin_headers, "ABC123")
        assert after["status"] == "terminado_pagado", f"got {after['status']}"

    def test_get_payments_history_desc(self, admin_headers):
        r = requests.get(f"{API}/payments", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 2
        # DESC sorted
        for a, b in zip(items, items[1:]):
            assert a["created_at"] >= b["created_at"], "history not DESC"

    def test_get_payments_for_order(self, admin_headers):
        r = requests.get(f"{API}/payments/order/{pytest.abc_order_id}", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 2
        for it in items:
            assert it["order_id"] == pytest.abc_order_id

    def test_amount_zero_returns_400(self, admin_headers):
        r = requests.post(f"{API}/payments", json={
            "order_id": pytest.abc_order_id, "amount": 0, "method": "efectivo",
        }, headers=admin_headers, timeout=15)
        assert r.status_code == 400


class TestOrdersPendingRelease:
    def test_list_pending_release(self, admin_headers):
        r = requests.get(f"{API}/orders-pending-release", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        items = r.json()
        plates = [o["plate"] for o in items]
        # ABC123 (now terminado_pagado), XYZ789 (terminado_pagado) should be listed
        assert "XYZ789" in plates or "ABC123" in plates, f"got {plates}"

    def test_authorize_release_fails_when_balance_gt_zero(self, admin_headers):
        # GHI456 has balance=650k (unpaid) but status INGRESADO — not in pending-release list.
        # We need an order that IS in service_completado/terminado_falta_pago w/ balance>0.
        # Craft one by finding one — else skip.
        r = requests.get(f"{API}/orders-pending-release", headers=admin_headers, timeout=15)
        pending = r.json()
        with_bal = [o for o in pending if o["balance"] > 0.01]
        if not with_bal:
            pytest.skip("no pending-release order with balance>0 in seed")
        r2 = requests.post(f"{API}/orders/{with_bal[0]['id']}/authorize-release", headers=admin_headers, timeout=15)
        assert r2.status_code == 400
        assert "pago" in r2.json().get("detail", "").lower()

    def test_authorize_release_success_when_balance_zero(self, admin_headers):
        # ABC123 now has balance=0 after tests above => in pending-release
        r = requests.get(f"{API}/orders-pending-release", headers=admin_headers, timeout=15)
        target = next((o for o in r.json() if o["plate"] == "ABC123"), None)
        assert target is not None, "ABC123 not in pending-release list"
        r2 = requests.post(f"{API}/orders/{target['id']}/authorize-release", headers=admin_headers, timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.json().get("release_authorized_at")


class TestOrdersPendingInvoice:
    @pytest.fixture(autouse=True, scope="class")
    def _reset_invoice(self):
        m = _mongo()
        m.orders.update_many(
            {"plate": {"$in": ["XYZ789", "GHI456"]}},
            {"$set": {"invoice_sent_at": None, "invoice_number": None, "requires_invoice": True}},
        )
        # Also make sure XYZ789 has no email
        m.orders.update_one({"plate": "XYZ789"}, {"$set": {"client_email": None}})
        yield

    def test_list_includes_seed_invoice_orders(self, admin_headers):
        r = requests.get(f"{API}/orders-pending-invoice", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        plates = [o["plate"] for o in r.json()]
        # Both XYZ789 and GHI456 have requires_invoice=True in seed
        assert "XYZ789" in plates, f"XYZ789 missing: {plates}"
        assert "GHI456" in plates, f"GHI456 missing: {plates}"

    def test_send_invoice_email_returns_400_when_no_email(self, admin_headers):
        r = requests.get(f"{API}/orders-pending-invoice", headers=admin_headers, timeout=15)
        target = next((o for o in r.json() if o["plate"] == "XYZ789"), None)
        assert target is not None
        r2 = requests.post(f"{API}/orders/{target['id']}/send-invoice-email", headers=admin_headers, timeout=15)
        assert r2.status_code == 400
        assert "correo" in r2.json().get("detail", "").lower()

    def test_send_invoice_success_with_email(self, admin_headers):
        # find GHI456 order id then set email directly in Mongo (no API endpoint exists)
        o = _find_order_by_plate(admin_headers, "GHI456")
        assert o is not None
        m = _mongo()
        m.orders.update_one({"id": o["id"]}, {"$set": {"client_email": "test_iter14@example.com", "invoice_sent_at": None}})
        r2 = requests.post(f"{API}/orders/{o['id']}/send-invoice-email", headers=admin_headers, timeout=30)
        assert r2.status_code == 200, r2.text
        data = r2.json()
        assert data.get("invoice_number", "").startswith("MOCK-FE-")
        # Now must NOT show in pending list
        r3 = requests.get(f"{API}/orders-pending-invoice", headers=admin_headers, timeout=15)
        plates = [p["plate"] for p in r3.json()]
        assert "GHI456" not in plates


class TestSendIngresoReceipt:
    def test_400_when_no_email(self, admin_headers):
        o = _find_order_by_plate(admin_headers, "XYZ789")
        assert o is not None
        r = requests.post(f"{API}/orders/{o['id']}/send-ingreso-receipt", headers=admin_headers, timeout=15)
        assert r.status_code == 400
        assert "correo" in r.json().get("detail", "").lower()
