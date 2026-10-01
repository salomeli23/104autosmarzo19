"""
Iteration 22 - Discount codes feature tests.
Covers admin verify, CRUD on /api/discount-codes, validate endpoint,
and integration with orders (create + check-in) stages.
"""
import os
import uuid
import time
import pytest
import requests
from datetime import date, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_PW = "william123"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={
        "email": "admin@polarizadosya.com", "password": "admin123"
    }, timeout=30)
    assert r.status_code == 200, f"login failed: {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def h(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def unique_suffix():
    return uuid.uuid4().hex[:6].upper()


# ---------- 1. Admin verify ----------
class TestAdminVerify:
    def test_wrong_password_403(self, h):
        r = requests.post(f"{API}/discount-codes/admin/verify",
                          json={"admin_password": "wrong"}, headers=h)
        assert r.status_code == 403, r.text

    def test_correct_password_ok(self, h):
        r = requests.post(f"{API}/discount-codes/admin/verify",
                          json={"admin_password": ADMIN_PW}, headers=h)
        assert r.status_code == 200
        assert r.json().get("ok") is True


# ---------- 2. CRUD discount codes ----------
class TestDiscountCRUD:
    created_ids = {}

    def test_create_percentage_requires_admin_pw(self, h, unique_suffix):
        code = f"TEST{unique_suffix}P"
        # wrong password
        r = requests.post(f"{API}/discount-codes", headers=h, json={
            "code": code, "discount_type": "percentage", "discount_value": 10,
            "admin_password": "nope"
        })
        assert r.status_code == 403

    def test_create_percentage_10(self, h, unique_suffix):
        code = f"TEST{unique_suffix}P"
        future = (date.today() + timedelta(days=30)).isoformat()
        r = requests.post(f"{API}/discount-codes", headers=h, json={
            "code": code, "discount_type": "percentage", "discount_value": 10,
            "expires_at": future, "admin_password": ADMIN_PW
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["code"] == code
        assert data["discount_type"] == "percentage"
        assert data["discount_value"] == 10
        assert data["expired"] is False
        assert data["active"] is True
        assert data["usage_count"] == 0
        TestDiscountCRUD.created_ids["pct"] = (data["id"], code)

    def test_create_fixed_50000(self, h, unique_suffix):
        code = f"TEST{unique_suffix}F"
        future = (date.today() + timedelta(days=30)).isoformat()
        r = requests.post(f"{API}/discount-codes", headers=h, json={
            "code": code, "discount_type": "fixed", "discount_value": 50000,
            "expires_at": future, "admin_password": ADMIN_PW
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["discount_type"] == "fixed"
        assert data["discount_value"] == 50000
        TestDiscountCRUD.created_ids["fix"] = (data["id"], code)

    def test_create_expired(self, h, unique_suffix):
        code = f"TEST{unique_suffix}E"
        past = (date.today() - timedelta(days=1)).isoformat()
        r = requests.post(f"{API}/discount-codes", headers=h, json={
            "code": code, "discount_type": "percentage", "discount_value": 15,
            "expires_at": past, "admin_password": ADMIN_PW
        })
        assert r.status_code == 200
        d = r.json()
        assert d["expired"] is True
        TestDiscountCRUD.created_ids["exp"] = (d["id"], code)

    def test_list_includes_expired_flag(self, h):
        r = requests.get(f"{API}/discount-codes", headers=h)
        assert r.status_code == 200
        docs = r.json()
        assert isinstance(docs, list)
        for d in docs:
            assert "expired" in d
            assert "_id" not in d  # mongo _id excluded


# ---------- 3. Validate endpoint ----------
class TestValidate:
    def test_validate_percentage(self, h):
        _id, code = TestDiscountCRUD.created_ids["pct"]
        r = requests.get(f"{API}/discount-codes/validate",
                         params={"code": code, "subtotal": 1_000_000}, headers=h)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["discount_amount"] == 100000.0  # 10% of 1,000,000
        assert d["new_total"] == 900000.0

    def test_validate_fixed(self, h):
        _id, code = TestDiscountCRUD.created_ids["fix"]
        r = requests.get(f"{API}/discount-codes/validate",
                         params={"code": code, "subtotal": 1_000_000}, headers=h)
        assert r.status_code == 200
        d = r.json()
        assert d["discount_amount"] == 50000.0
        assert d["new_total"] == 950000.0

    def test_validate_expired_400(self, h):
        _id, code = TestDiscountCRUD.created_ids["exp"]
        r = requests.get(f"{API}/discount-codes/validate",
                         params={"code": code, "subtotal": 100000}, headers=h)
        assert r.status_code == 400
        assert "vencido" in r.text.lower()

    def test_validate_nonexistent_404(self, h):
        r = requests.get(f"{API}/discount-codes/validate",
                         params={"code": "NOPE_XYZ_123", "subtotal": 100000}, headers=h)
        assert r.status_code == 404

    def test_validate_inactive(self, h, unique_suffix):
        # Create active then toggle off
        code = f"TEST{unique_suffix}INA"
        r = requests.post(f"{API}/discount-codes", headers=h, json={
            "code": code, "discount_type": "percentage", "discount_value": 5,
            "admin_password": ADMIN_PW
        })
        assert r.status_code == 200
        cid = r.json()["id"]
        # Deactivate
        r2 = requests.patch(f"{API}/discount-codes/{cid}", headers=h, json={
            "active": False, "admin_password": ADMIN_PW
        })
        assert r2.status_code == 200
        assert r2.json()["active"] is False
        # Validate -> 400 inactive
        rv = requests.get(f"{API}/discount-codes/validate",
                          params={"code": code, "subtotal": 100000}, headers=h)
        assert rv.status_code == 400
        assert "inactivo" in rv.text.lower()
        TestDiscountCRUD.created_ids["inactive"] = (cid, code)


# ---------- 4. Order integration ----------
def _make_order_payload(plate, discount_code=None, value=1_000_000):
    return {
        "client_name": "TEST Client",
        "client_phone": "+573000000000",
        "plate": plate,
        "brand": "Tesla",
        "model": "Model 3",
        "year": 2024,
        "color": "Blanco",
        "date": (date.today() + timedelta(days=14)).isoformat(),
        "time_slot": "franja_1",
        "services": [{"service": "Polarizado Completo", "price": value}],
        "negotiated_value": value,
        "is_priority": True,  # avoid franja validations/collisions easier
        "priority_reason": "test discount",
        "authorization_code": "00000",
        "discount_code": discount_code,
    }


class TestOrderDiscountIntegration:
    created_orders = {}

    def test_create_order_with_discount(self, h):
        _id, code = TestDiscountCRUD.created_ids["pct"]
        plate = f"TD{uuid.uuid4().hex[:5].upper()}"
        payload = _make_order_payload(plate, discount_code=code, value=1_000_000)
        r = requests.post(f"{API}/orders", headers=h, json=payload)
        assert r.status_code == 200, r.text
        o = r.json()
        assert o["discount_code"] == code
        assert o["discount_amount"] == 100000.0
        assert o["discount_type"] == "percentage"
        assert o["discount_value"] == 10
        assert o["discount_applied_stage"] == "appointment"
        assert o["negotiated_value"] == 900000.0  # neto
        TestOrderDiscountIntegration.created_orders["with_disc"] = o["id"]

    def test_create_order_with_invalid_code_400(self, h):
        plate = f"TD{uuid.uuid4().hex[:5].upper()}"
        payload = _make_order_payload(plate, discount_code="DOES_NOT_EXIST_XYZ")
        r = requests.post(f"{API}/orders", headers=h, json=payload)
        assert r.status_code == 400
        assert "descuento" in r.text.lower()

    def test_create_order_with_expired_code_400(self, h):
        _id, code = TestDiscountCRUD.created_ids["exp"]
        plate = f"TD{uuid.uuid4().hex[:5].upper()}"
        payload = _make_order_payload(plate, discount_code=code)
        r = requests.post(f"{API}/orders", headers=h, json=payload)
        assert r.status_code == 400

    def test_usage_count_incremented(self, h):
        _id, code = TestDiscountCRUD.created_ids["pct"]
        # list and find
        r = requests.get(f"{API}/discount-codes", headers=h)
        assert r.status_code == 200
        for d in r.json():
            if d["code"] == code:
                assert d["usage_count"] >= 1
                return
        pytest.fail("code not found in list")

    def test_create_order_no_discount_for_checkin(self, h):
        """Create an order without discount, will be used for check-in discount test."""
        plate = f"TD{uuid.uuid4().hex[:5].upper()}"
        payload = _make_order_payload(plate, discount_code=None, value=800_000)
        r = requests.post(f"{API}/orders", headers=h, json=payload)
        assert r.status_code == 200, r.text
        TestOrderDiscountIntegration.created_orders["no_disc"] = r.json()["id"]

    def _ingreso_payload(self, order_id, final_value, discount_code=None):
        return {
            "order_id": order_id,
            "services": [{"service": "Polarizado Completo", "price": final_value}],
            "final_value": final_value,
            "signature_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
            "cedula_number": "1234567890",
            "risk_agreement_accepted": True,
            "profile_photo_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
            "payment_method": "efectivo",
            "requires_invoice": False,
            "discount_code": discount_code,
        }

    def test_checkin_apply_discount_on_order_without_discount(self, h):
        _id, code = TestDiscountCRUD.created_ids["fix"]  # fixed 50000
        order_id = TestOrderDiscountIntegration.created_orders["no_disc"]
        payload = self._ingreso_payload(order_id, final_value=800_000, discount_code=code)
        r = requests.post(f"{API}/orders/ingreso-approval", headers=h, json=payload)
        assert r.status_code == 200, r.text
        # Fetch order
        o = requests.get(f"{API}/orders/{order_id}", headers=h).json()
        assert o["discount_code"] == code
        assert o["discount_applied_stage"] == "checkin"
        assert o["final_value"] == 750000.0  # 800000 - 50000
        assert o["discount_amount"] == 50000.0

    def test_checkin_with_discount_on_order_already_having_discount_400(self, h):
        _id, code_fix = TestDiscountCRUD.created_ids["fix"]
        order_id = TestOrderDiscountIntegration.created_orders["with_disc"]
        payload = self._ingreso_payload(order_id, final_value=1_200_000, discount_code=code_fix)
        r = requests.post(f"{API}/orders/ingreso-approval", headers=h, json=payload)
        assert r.status_code == 400
        assert "ya tiene" in r.text.lower() or "código" in r.text.lower()

    def test_checkin_without_discount_reapplies_appointment_discount(self, h):
        """Order has discount from appointment, check-in sends no code: must reapply pct 10% to new gross."""
        # Need a fresh order with discount from appointment
        _id, code = TestDiscountCRUD.created_ids["pct"]
        plate = f"TD{uuid.uuid4().hex[:5].upper()}"
        payload = _make_order_payload(plate, discount_code=code, value=1_000_000)
        r = requests.post(f"{API}/orders", headers=h, json=payload)
        assert r.status_code == 200
        oid = r.json()["id"]
        # Now check-in without discount_code but with new final_value gross = 1,200,000
        ingreso = {
            "order_id": oid,
            "services": [{"service": "Polarizado Completo", "price": 1_200_000}],
            "final_value": 1_200_000,
            "signature_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
            "cedula_number": "1234567890",
            "risk_agreement_accepted": True,
            "profile_photo_url": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
            "payment_method": "efectivo",
            "requires_invoice": False,
        }
        r2 = requests.post(f"{API}/orders/ingreso-approval", headers=h, json=ingreso)
        assert r2.status_code == 200, r2.text
        o = requests.get(f"{API}/orders/{oid}", headers=h).json()
        # 10% off 1,200,000 = 120,000 => final_value = 1,080,000
        assert o["final_value"] == 1_080_000.0
        assert o["discount_amount"] == 120000.0
        assert o["discount_applied_stage"] == "appointment"  # original stage preserved


# ---------- 5. PATCH toggle active + DELETE ----------
class TestPatchDelete:
    def test_toggle_active_back_on(self, h):
        cid, code = TestDiscountCRUD.created_ids["inactive"]
        r = requests.patch(f"{API}/discount-codes/{cid}", headers=h, json={
            "active": True, "admin_password": ADMIN_PW
        })
        assert r.status_code == 200
        assert r.json()["active"] is True

    def test_patch_wrong_password_403(self, h):
        cid, code = TestDiscountCRUD.created_ids["inactive"]
        r = requests.patch(f"{API}/discount-codes/{cid}", headers=h, json={
            "active": False, "admin_password": "bad"
        })
        assert r.status_code == 403

    def test_delete_wrong_password_403(self, h):
        cid, _ = TestDiscountCRUD.created_ids["inactive"]
        r = requests.delete(f"{API}/discount-codes/{cid}",
                            params={"admin_password": "bad"}, headers=h)
        assert r.status_code == 403

    def test_delete_ok(self, h):
        # Delete all created test codes (cleanup) - except pct/fix used later? all tests done
        for key in ("exp", "inactive"):
            cid, _ = TestDiscountCRUD.created_ids[key]
            r = requests.delete(f"{API}/discount-codes/{cid}",
                                params={"admin_password": ADMIN_PW}, headers=h)
            assert r.status_code == 200
        # Clean the pct and fix as well
        for key in ("pct", "fix"):
            cid, _ = TestDiscountCRUD.created_ids[key]
            r = requests.delete(f"{API}/discount-codes/{cid}",
                                params={"admin_password": ADMIN_PW}, headers=h)
            assert r.status_code == 200
