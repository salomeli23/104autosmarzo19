"""Iteration 18 - Retentions & Invoice Guard tests.

Covers:
- POST /api/orders/{id}/apply-retention (Bogotá, Medellín no_aplica, identity propagate, invalid rate)
- POST /api/orders/{id}/send-invoice-email guard (400 if no retention)
- GET /api/retentions (items sorted DESC + summary + q filter)
- GET /api/orders-pending-invoice includes retention_applied + retention_snapshot
"""
import os
import uuid
import time
import pytest
import requests
from datetime import datetime, timezone
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

assert BASE_URL, "REACT_APP_BACKEND_URL missing"


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    j = r.json()
    return j.get("access_token") or j["token"]


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_login('admin@polarizadosya.com', 'admin123')}"}


@pytest.fixture(scope="module")
def factura_headers():
    return {"Authorization": f"Bearer {_login('facturacion@polarizadosya.com', 'factura123')}"}


@pytest.fixture(scope="module")
def mongo_db():
    client = MongoClient(MONGO_URL)
    return client[DB_NAME]


def _seed_order(db, *, client_name, client_cedula=None, client_email=None, final_value=4521964.0,
                requires_invoice=True, retention_applied=False):
    """Seed an order directly in DB with the minimum fields needed for the flows."""
    now = datetime.now(timezone.utc).isoformat()
    order_id = str(uuid.uuid4())
    code = f"TEST-{uuid.uuid4().hex[:6].upper()}"
    doc = {
        "id": order_id,
        "order_code": code,
        "plate": f"TST{uuid.uuid4().hex[:3].upper()}",
        "client_name": client_name,
        "client_cedula": client_cedula,
        "client_email": client_email,
        "client_phone": "3000000000",
        "final_value": final_value,
        "negotiated_value": final_value,
        "requires_invoice": requires_invoice,
        "invoice_sent_at": None,
        "retention_applied": retention_applied,
        "status": "ingresado",
        "ingreso_at": now,
        "created_at": now,
        "created_by": "test",
    }
    db.orders.insert_one(doc)
    return order_id, code


@pytest.fixture(scope="module")
def seeded_orders(mongo_db):
    """Create a small pool of test orders. Cleanup at end."""
    ids = []
    o1, _ = _seed_order(mongo_db, client_name="TEST_Retencion Bogotá", client_cedula="900000001",
                        client_email="test1@example.com", final_value=4521964.0)
    o2, _ = _seed_order(mongo_db, client_name="TEST_Retencion Medellín", client_cedula="900000002",
                        client_email="test2@example.com", final_value=1200000.0)
    o3, _ = _seed_order(mongo_db, client_name="TEST_Sin Retencion", client_cedula="900000003",
                        client_email="test3@example.com", final_value=500000.0)
    # Two orders belonging to the same client (for identity propagation)
    shared = "TEST_ClienteAntiguo"
    o4, _ = _seed_order(mongo_db, client_name=shared, client_cedula="111222333",
                        client_email="c1@example.com", final_value=100000.0)
    o5, _ = _seed_order(mongo_db, client_name=shared, client_cedula="111222333",
                        client_email="c1@example.com", final_value=200000.0)
    ids.extend([o1, o2, o3, o4, o5])
    yield {"bogota": o1, "medellin": o2, "no_retention": o3, "prop_target": o4, "prop_sibling": o5}
    # Cleanup
    mongo_db.orders.delete_many({"id": {"$in": ids}})
    mongo_db.retentions.delete_many({"order_id": {"$in": ids}})


# ---------------------- Tests ----------------------

class TestApplyRetentionBogota:
    def test_bogota_reteica_retefuente(self, admin_headers, seeded_orders, mongo_db):
        oid = seeded_orders["bogota"]
        payload = {
            "city": "Bogotá",
            "apply_reteica": True, "reteica_rate": 0.966,
            "apply_retefuente": True, "retefuente_rate": 2.5,
            "no_aplica": False,
        }
        r = requests.post(f"{BASE_URL}/api/orders/{oid}/apply-retention", json=payload, headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()["retention"]
        assert j["reteica_amount"] == round(4521964.0 * 0.00966, 2)
        assert j["retefuente_amount"] == round(4521964.0 * 0.025, 2)
        assert j["total_retention"] == round(j["reteica_amount"] + j["retefuente_amount"], 2)
        assert j["city"] == "Bogotá"

        # Verify persisted in orders
        order = mongo_db.orders.find_one({"id": oid})
        assert order["retention_applied"] is True
        snap = order["retention_snapshot"]
        assert snap["reteica_amount"] == j["reteica_amount"]
        assert snap["retefuente_amount"] == j["retefuente_amount"]


class TestApplyRetentionNoAplica:
    def test_no_aplica_marks_applied(self, factura_headers, seeded_orders, mongo_db):
        oid = seeded_orders["medellin"]
        r = requests.post(f"{BASE_URL}/api/orders/{oid}/apply-retention",
                          json={"city": "Medellín", "no_aplica": True},
                          headers=factura_headers, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()["retention"]
        assert j["total_retention"] == 0
        assert j["no_aplica"] is True
        order = mongo_db.orders.find_one({"id": oid})
        assert order["retention_applied"] is True


class TestSendInvoiceGuard:
    def test_send_invoice_400_without_retention(self, admin_headers, seeded_orders):
        oid = seeded_orders["no_retention"]
        r = requests.post(f"{BASE_URL}/api/orders/{oid}/send-invoice-email",
                          headers=admin_headers, timeout=30)
        assert r.status_code == 400, r.text
        detail = r.json().get("detail", "")
        assert "retención" in detail.lower() or "retencion" in detail.lower()
        assert "no aplica" in detail.lower()


class TestIdentityPropagation:
    def test_update_identity_propagates_to_sibling_orders(self, admin_headers, seeded_orders, mongo_db):
        target = seeded_orders["prop_target"]
        sibling = seeded_orders["prop_sibling"]
        new_ced = "900123456"
        new_razon = "Nueva Empresa SAS"
        r = requests.post(f"{BASE_URL}/api/orders/{target}/apply-retention",
                          json={"city": "Bogotá", "no_aplica": True,
                                "update_identity": True,
                                "new_cedula": new_ced, "new_razon_social": new_razon},
                          headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        # Both orders should have new cedula + razon
        o_target = mongo_db.orders.find_one({"id": target})
        o_sibling = mongo_db.orders.find_one({"id": sibling})
        assert o_target["client_cedula"] == new_ced
        assert o_target["client_razon_social"] == new_razon
        assert o_sibling["client_cedula"] == new_ced, "identity should propagate to sibling order"
        assert o_sibling["client_razon_social"] == new_razon


class TestRetentionsList:
    def test_list_retentions_sorted_desc_with_summary(self, factura_headers):
        r = requests.get(f"{BASE_URL}/api/retentions", headers=factura_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "items" in data and "summary" in data
        items = data["items"]
        # sorted DESC by applied_at
        if len(items) >= 2:
            for a, b in zip(items, items[1:]):
                assert a.get("applied_at", "") >= b.get("applied_at", "")
        s = data["summary"]
        assert s["count"] == len(items)
        # summary consistency
        assert round(s["total_reteica"] + s["total_retefuente"], 2) == round(s["total_retention"], 2)

    def test_list_retentions_q_filter(self, factura_headers):
        r = requests.get(f"{BASE_URL}/api/retentions", params={"q": "TEST_Retencion Bogotá"},
                         headers=factura_headers, timeout=30)
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        # All returned items should have "TEST_" in some searchable field
        assert len(items) >= 1
        for it in items:
            blob = " ".join([str(it.get(k, "") or "") for k in ("plate", "client_cedula", "client_name", "order_code", "city")])
            assert "TEST_" in blob or "Bogotá" in blob


class TestPendingInvoiceIncludesRetention:
    def test_pending_orders_expose_retention_fields(self, admin_headers, seeded_orders):
        r = requests.get(f"{BASE_URL}/api/orders-pending-invoice", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list)
        ids = {o["id"] for o in arr}
        # bogota + medellin should be there (both had retention applied and invoice_sent_at is None)
        for key in ("bogota", "medellin", "no_retention"):
            assert seeded_orders[key] in ids, f"expected {key} in pending invoice list"
        by_id = {o["id"]: o for o in arr}
        assert by_id[seeded_orders["bogota"]]["retention_applied"] is True
        assert by_id[seeded_orders["bogota"]]["retention_snapshot"] is not None
        assert by_id[seeded_orders["no_retention"]]["retention_applied"] is False


class TestApplyRetentionValidation:
    def test_reteica_rate_negative_returns_400(self, admin_headers, seeded_orders):
        oid = seeded_orders["no_retention"]
        r = requests.post(f"{BASE_URL}/api/orders/{oid}/apply-retention",
                          json={"city": "Bogotá", "apply_reteica": True, "reteica_rate": -1.0},
                          headers=admin_headers, timeout=30)
        assert r.status_code == 400, r.text
