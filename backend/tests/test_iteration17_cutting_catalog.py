"""Iteration 17: Cutting Catalog endpoints
- /api/cutting/materials-catalog
- /api/cutting/car-average
- /api/cutting/car-averages
- /api/seed/cutting-catalog (admin, idempotent)
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://service-coordinator-1.preview.emergentagent.com").rstrip("/")


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    j = r.json()
    return j.get("access_token") or j["token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login("admin@polarizadosya.com", "admin123")


@pytest.fixture(scope="module")
def corte_token():
    return _login("corte@polarizadosya.com", "corte123")


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def corte_headers(corte_token):
    return {"Authorization": f"Bearer {corte_token}"}


class TestMaterialsCatalog:
    def test_materials_catalog_structure(self, corte_headers):
        r = requests.get(f"{BASE_URL}/api/cutting/materials-catalog", headers=corte_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert set(data.keys()) >= {"material_1", "material_2", "material_3", "rolls"}
        assert data["material_1"]["label"] == "Polarizados"
        assert data["material_2"]["label"] == "Seguridad / Ultrasecure"
        assert data["material_3"]["label"] == "PPF · Paint Protection"
        assert len(data["material_1"]["items"]) == 30, f"got {len(data['material_1']['items'])}"
        assert len(data["material_2"]["items"]) == 9
        assert len(data["material_3"]["items"]) == 16
        assert len(data["rolls"]) == 51


class TestCarAverage:
    @pytest.mark.parametrize("brand,model,expected", [
        ("Mazda", "CX5", 1.51),
        ("Mazda", "CX-5", 1.51),
        ("Mazda", "cx 5", 1.51),
        ("Toyota", "corolla", 1.30),
        ("Tesla", "Model Y", 2.26),
        ("Tesla", "modely", 2.26),
        ("Chevrolet", "onix", 1.34),
    ])
    def test_lookup_success(self, corte_headers, brand, model, expected):
        r = requests.get(f"{BASE_URL}/api/cutting/car-average",
                         params={"brand": brand, "model": model},
                         headers=corte_headers, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["found"] is True, f"not found for {brand} {model}: {data}"
        assert data["promedio_m"] == expected

    def test_lookup_not_found(self, corte_headers):
        r = requests.get(f"{BASE_URL}/api/cutting/car-average",
                         params={"brand": "NoExiste", "model": "NoExiste"},
                         headers=corte_headers, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["found"] is False
        assert data["promedio_m"] is None

    def test_car_averages_list(self, corte_headers):
        r = requests.get(f"{BASE_URL}/api/cutting/car-averages", headers=corte_headers, timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 175


class TestSeedCuttingCatalog:
    def test_seed_idempotent(self, admin_headers):
        # First call
        r1 = requests.post(f"{BASE_URL}/api/seed/cutting-catalog", headers=admin_headers, timeout=60)
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        # Second call should be idempotent
        r2 = requests.post(f"{BASE_URL}/api/seed/cutting-catalog", headers=admin_headers, timeout=60)
        assert r2.status_code == 200, r2.text
        d2 = r2.json()
        assert d2["created_count"] == 0, f"expected 0 created, got {d2['created_count']}"
        assert d2["skipped_count"] == 51, f"expected 51 skipped, got {d2['skipped_count']}"

    def test_seed_requires_admin(self, corte_headers):
        r = requests.post(f"{BASE_URL}/api/seed/cutting-catalog", headers=corte_headers, timeout=30)
        assert r.status_code in (401, 403), f"expected forbidden, got {r.status_code}"
