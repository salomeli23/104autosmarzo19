"""Iteration 19 - Invoice PDF download + client-email edit + include_sent flag.

Covers new/changed endpoints:
- GET /api/orders/{id}/invoice-pdf: 200 application/pdf when invoice_number present; 400 when missing.
- PATCH /api/orders/{id}/client-email: 200 updates + propagates; 400 on invalid email.
- GET /api/orders-pending-invoice?include_sent=true: exposes already-sent invoices too.
- POST /api/orders/{id}/apply-retention: backend does NOT enforce retefuente>524k gate.
"""
import os
import uuid
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
def mongo_db():
    client = MongoClient(MONGO_URL)
    return client[DB_NAME]


def _seed_order(db, *, client_name, client_cedula=None, client_email="test@example.com",
                final_value=1000000.0, invoice_number=None, invoice_sent_at=None):
    now = datetime.now(timezone.utc).isoformat()
    order_id = str(uuid.uuid4())
    code = f"TEST-{uuid.uuid4().hex[:6].upper()}"
    doc = {
        "id": order_id,
        "order_code": code,
        "plate": f"IT9{uuid.uuid4().hex[:3].upper()}",
        "client_name": client_name,
        "client_cedula": client_cedula,
        "client_email": client_email,
        "client_phone": "3000000000",
        "final_value": final_value,
        "negotiated_value": final_value,
        "requires_invoice": True,
        "invoice_number": invoice_number,
        "invoice_sent_at": invoice_sent_at,
        "retention_applied": bool(invoice_number),
        "status": "ingresado",
        "ingreso_at": now,
        "created_at": now,
        "created_by": "test",
    }
    db.orders.insert_one(doc)
    return order_id, code


@pytest.fixture(scope="module")
def seeded(mongo_db):
    ids = []
    # order WITH invoice already generated
    inv_num = f"MOCK-FE-TEST-{uuid.uuid4().hex[:6].upper()}"
    o_sent, _ = _seed_order(mongo_db, client_name="TEST_it19 Sent",
                            client_email="sent@example.com",
                            invoice_number=inv_num,
                            invoice_sent_at=datetime.now(timezone.utc).isoformat())
    # order WITHOUT invoice yet
    o_pending, _ = _seed_order(mongo_db, client_name="TEST_it19 Pending",
                               client_email="pend@example.com")
    # Two orders same client for propagation
    shared = "TEST_it19 CorreoProp"
    o_a, _ = _seed_order(mongo_db, client_name=shared, client_cedula="777888999",
                         client_email="old@example.com")
    o_b, _ = _seed_order(mongo_db, client_name=shared, client_cedula="777888999",
                         client_email="old@example.com")
    # order with total <= 524000 for retefuente-any-total test
    o_small, _ = _seed_order(mongo_db, client_name="TEST_it19 Small",
                             client_email="s@example.com", final_value=400000.0)
    ids.extend([o_sent, o_pending, o_a, o_b, o_small])
    yield {"sent": o_sent, "invoice_num": inv_num, "pending": o_pending,
           "prop_a": o_a, "prop_b": o_b, "small": o_small}
    mongo_db.orders.delete_many({"id": {"$in": ids}})
    mongo_db.retentions.delete_many({"order_id": {"$in": ids}})


# ---------------- invoice-pdf ----------------
class TestInvoicePdf:
    def test_download_pdf_200(self, admin_headers, seeded):
        oid = seeded["sent"]
        r = requests.get(f"{BASE_URL}/api/orders/{oid}/invoice-pdf", headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("application/pdf")
        assert r.content[:4] == b"%PDF", f"Not a PDF: {r.content[:20]}"
        assert len(r.content) > 100
        cd = r.headers.get("content-disposition", "")
        assert seeded["invoice_num"] in cd

    def test_download_pdf_400_when_no_invoice(self, admin_headers, seeded):
        oid = seeded["pending"]
        r = requests.get(f"{BASE_URL}/api/orders/{oid}/invoice-pdf", headers=admin_headers, timeout=30)
        assert r.status_code == 400
        assert "factura" in r.json().get("detail", "").lower()

    def test_download_pdf_404_unknown(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/orders/does-not-exist/invoice-pdf",
                         headers=admin_headers, timeout=30)
        assert r.status_code == 404


# ---------------- client-email PATCH ----------------
class TestClientEmailUpdate:
    def test_invalid_email_400(self, admin_headers, seeded):
        oid = seeded["prop_a"]
        r = requests.patch(f"{BASE_URL}/api/orders/{oid}/client-email",
                           json={"client_email": "noesemail"}, headers=admin_headers, timeout=30)
        assert r.status_code == 400
        assert "correo" in r.json().get("detail", "").lower()

    def test_empty_email_400(self, admin_headers, seeded):
        oid = seeded["prop_a"]
        r = requests.patch(f"{BASE_URL}/api/orders/{oid}/client-email",
                           json={"client_email": ""}, headers=admin_headers, timeout=30)
        assert r.status_code == 400

    def test_valid_email_updates_and_propagates(self, admin_headers, seeded, mongo_db):
        oid = seeded["prop_a"]
        sibling = seeded["prop_b"]
        new_email = "nuevo@ejemplo.com"
        r = requests.patch(f"{BASE_URL}/api/orders/{oid}/client-email",
                           json={"client_email": new_email}, headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["client_email"] == new_email
        # Verify target
        a = mongo_db.orders.find_one({"id": oid})
        assert a["client_email"] == new_email
        # Verify propagation to sibling
        b = mongo_db.orders.find_one({"id": sibling})
        assert b["client_email"] == new_email, "propagation to same-client orders failed"

    def test_email_trim_whitespace(self, admin_headers, seeded, mongo_db):
        oid = seeded["prop_a"]
        r = requests.patch(f"{BASE_URL}/api/orders/{oid}/client-email",
                           json={"client_email": "  spaced@ejemplo.com  "},
                           headers=admin_headers, timeout=30)
        assert r.status_code == 200
        a = mongo_db.orders.find_one({"id": oid})
        assert a["client_email"] == "spaced@ejemplo.com"


# ---------------- orders-pending-invoice include_sent ----------------
class TestPendingInvoiceIncludeSent:
    def test_default_excludes_sent(self, admin_headers, seeded):
        r = requests.get(f"{BASE_URL}/api/orders-pending-invoice", headers=admin_headers, timeout=30)
        assert r.status_code == 200
        ids = [o["id"] for o in r.json()]
        assert seeded["pending"] in ids
        assert seeded["sent"] not in ids, "sent invoice should be excluded by default"

    def test_include_sent_true_includes_both(self, admin_headers, seeded):
        r = requests.get(f"{BASE_URL}/api/orders-pending-invoice?include_sent=true",
                         headers=admin_headers, timeout=30)
        assert r.status_code == 200
        items = r.json()
        ids = [o["id"] for o in items]
        assert seeded["pending"] in ids
        assert seeded["sent"] in ids
        # Sent one should carry invoice_sent_at and invoice_number
        sent_item = next(o for o in items if o["id"] == seeded["sent"])
        assert sent_item.get("invoice_sent_at") is not None
        assert sent_item.get("invoice_number") == seeded["invoice_num"]


# ---------------- apply-retention: backend has no total-gate ----------------
class TestApplyRetentionNoBackendGate:
    def test_retefuente_on_small_total(self, admin_headers, seeded, mongo_db):
        """Backend allows retefuente 2.5% on any total. UI enforces the 524k gate."""
        oid = seeded["small"]
        r = requests.post(f"{BASE_URL}/api/orders/{oid}/apply-retention",
                          json={"city": "Bogotá", "apply_retefuente": True, "retefuente_rate": 2.5},
                          headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()["retention"]
        assert j["retefuente_amount"] == int(int(400000.0 / 1.19 + 0.5) * 0.025 + 0.5)  # base sin IVA
        assert j["reteica_amount"] == 0

    def test_reteica_6_9(self, admin_headers, seeded, mongo_db):
        """Preset 6,9/1000 (por mil) is accepted by backend (no whitelist)."""
        oid = seeded["pending"]
        r = requests.post(f"{BASE_URL}/api/orders/{oid}/apply-retention",
                          json={"city": "Bogotá", "apply_reteica": True, "reteica_rate": 6.9},
                          headers=admin_headers, timeout=30)
        assert r.status_code == 200, r.text
        j = r.json()["retention"]
        assert j["reteica_rate"] == 6.9
        assert j["reteica_amount"] == int(int(1000000.0 / 1.19 + 0.5) * 6.9 / 1000 + 0.5)  # base sin IVA
