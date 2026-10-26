"""Iteration 13 backend tests: Sedes CRUD, Car Series CRUD+Suggest, Inventory transfer-sede, User sede assignment."""
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
CORTE = {"email": "corte@polarizadosya.com", "password": "corte123"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def admin_headers():
    requests.post(f"{API}/seed/users", timeout=15)
    return {"Authorization": f"Bearer {_login(ADMIN)}"}


@pytest.fixture(scope="module")
def corte_headers():
    return {"Authorization": f"Bearer {_login(CORTE)}"}


# -------------------- SEDES CRUD --------------------
class TestSedesCRUD:
    def test_create_sede(self, admin_headers):
        ts = int(time.time() * 1000)
        payload = {"nombre": f"TEST_Sede_{ts}", "direccion": "Calle 1 #2-3", "telefono": "3001234567"}
        r = requests.post(f"{API}/sedes", json=payload, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["nombre"] == payload["nombre"]
        assert data["direccion"] == payload["direccion"]
        assert "id" in data
        assert "_id" not in data
        pytest.sede_id_a = data["id"]

        # Second sede for transfer tests
        r2 = requests.post(f"{API}/sedes", json={"nombre": f"TEST_Sede2_{ts}"}, headers=admin_headers, timeout=15)
        assert r2.status_code == 200
        pytest.sede_id_b = r2.json()["id"]

    def test_list_sedes_contains_created(self, admin_headers):
        r = requests.get(f"{API}/sedes", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        ids = [s["id"] for s in r.json()]
        assert pytest.sede_id_a in ids
        assert pytest.sede_id_b in ids

    def test_update_sede(self, admin_headers):
        r = requests.put(f"{API}/sedes/{pytest.sede_id_a}", json={"nombre": "TEST_Sede_Updated", "telefono": "555"}, headers=admin_headers, timeout=15)
        assert r.status_code == 200
        # verify via list
        items = requests.get(f"{API}/sedes", headers=admin_headers, timeout=15).json()
        match = next((s for s in items if s["id"] == pytest.sede_id_a), None)
        assert match and match["nombre"] == "TEST_Sede_Updated"

    def test_create_sede_requires_admin(self, corte_headers):
        r = requests.post(f"{API}/sedes", json={"nombre": "TEST_NoAuth"}, headers=corte_headers, timeout=15)
        assert r.status_code == 403


# -------------------- CAR SERIES CRUD + SUGGEST --------------------
class TestCarSeriesCRUD:
    def test_create_car_series(self, admin_headers):
        ts = int(time.time() * 1000)
        payload = {
            "brand": f"TEST_Mazda_{ts}",
            "model": "CX5",
            "version": "2020",
            "part_measurements": {"panoramico": 140, "vidrio_copiloto": 75, "vidrio_conductor": 75},
            "notes": "Serie de prueba",
        }
        r = requests.post(f"{API}/car-series", json=payload, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["brand"] == payload["brand"]
        assert data["model"] == "CX5"
        assert data["part_measurements"]["panoramico"] == 140
        assert "_id" not in data
        pytest.series_id = data["id"]
        pytest.series_brand = payload["brand"]

    def test_list_car_series(self, admin_headers):
        r = requests.get(f"{API}/car-series", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert any(s["id"] == pytest.series_id for s in r.json())

    def test_update_car_series(self, admin_headers):
        payload = {
            "brand": pytest.series_brand,
            "model": "CX5",
            "version": "2021",
            "part_measurements": {"panoramico": 142},
            "notes": "Updated",
        }
        r = requests.put(f"{API}/car-series/{pytest.series_id}", json=payload, headers=admin_headers, timeout=15)
        assert r.status_code == 200

    def test_suggest_case_insensitive_partial(self, admin_headers):
        # query lowercase partial of TEST_Mazda_{ts} → "test_mazda" + model "cx"
        brand_lower = pytest.series_brand.lower()
        r = requests.get(f"{API}/car-series/suggest", params={"brand": brand_lower, "model": "cx"}, headers=admin_headers, timeout=15)
        assert r.status_code == 200
        items = r.json()
        assert any(s["id"] == pytest.series_id for s in items), f"suggest returned {items}"

    def test_suggest_no_match(self, admin_headers):
        r = requests.get(f"{API}/car-series/suggest", params={"brand": "NoExisteMarcaXYZ"}, headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert r.json() == []


# -------------------- INVENTORY + TRANSFER SEDE --------------------
class TestInventorySede:
    def _create_rollo(self, headers, sede_id=None):
        payload = {
            "nombre": "TEST_i13_rollo",
            "categoria": "polarizados",
            "tipo_articulo": "rollo",
            "tipo_rollo": "polarizado",
            "metros_iniciales": 30,
            "costo": 100000,
        }
        if sede_id:
            payload["sede_id"] = sede_id
        r = requests.post(f"{API}/inventory", json=payload, headers=headers, timeout=15)
        assert r.status_code == 200, r.text
        return r.json()

    def test_create_inventory_with_sede(self, admin_headers):
        item = self._create_rollo(admin_headers, sede_id=pytest.sede_id_a)
        assert item["sede_id"] == pytest.sede_id_a
        assert item["sede_nombre"]
        pytest.inv_with_sede = item["id"]

    def test_create_inventory_without_sede_regression(self, admin_headers):
        item = self._create_rollo(admin_headers, sede_id=None)
        assert item["sede_id"] is None
        assert item["sede_nombre"] is None
        pytest.inv_no_sede = item["id"]

    def test_transfer_sede_success(self, admin_headers):
        r = requests.post(
            f"{API}/inventory/{pytest.inv_with_sede}/transfer-sede",
            json={"target_sede_id": pytest.sede_id_b, "reason": "test"},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 200, r.text
        # verify item updated
        items = requests.get(f"{API}/inventory", headers=admin_headers, timeout=15).json()
        item = next((i for i in items if i["id"] == pytest.inv_with_sede), None)
        assert item is not None
        assert item["sede_id"] == pytest.sede_id_b

    def test_transfer_same_sede_returns_400(self, admin_headers):
        r = requests.post(
            f"{API}/inventory/{pytest.inv_with_sede}/transfer-sede",
            json={"target_sede_id": pytest.sede_id_b},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 400

    def test_transfer_nonexistent_sede_returns_404(self, admin_headers):
        r = requests.post(
            f"{API}/inventory/{pytest.inv_with_sede}/transfer-sede",
            json={"target_sede_id": "nonexistent-uuid-123"},
            headers=admin_headers, timeout=15,
        )
        assert r.status_code == 404


# -------------------- USER SEDE ASSIGNMENT --------------------
class TestUserSedeAssignment:
    def test_assign_sede_to_user(self, admin_headers):
        users = requests.get(f"{API}/users", headers=admin_headers, timeout=15).json()
        tech = next((u for u in users if u["email"] == "tecnico@polarizadosya.com"), None)
        assert tech is not None
        pytest.tech_id = tech["id"]
        r = requests.put(f"{API}/users/{tech['id']}/sede", json={"sede_id": pytest.sede_id_a}, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("sede_nombre")

    def test_unassign_sede_with_null(self, admin_headers):
        r = requests.put(f"{API}/users/{pytest.tech_id}/sede", json={"sede_id": None}, headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert r.json().get("sede_nombre") is None

    def test_assign_unknown_sede_returns_404(self, admin_headers):
        r = requests.put(f"{API}/users/{pytest.tech_id}/sede", json={"sede_id": "no-existe-xxx"}, headers=admin_headers, timeout=15)
        assert r.status_code == 404
