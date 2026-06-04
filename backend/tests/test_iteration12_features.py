"""
Iteration 12 backend tests for PolarizadosYA.

Validates the new feature set from iteration 12 review:
  1. PUT /api/cutting/{id}/complete with part_materials where one part has
     is_aprovechamiento=true -> does NOT deduct from stock, creates an
     'aprovechamientos' doc, response includes `aprovechamientos: [{...}]`.
  2. Mixed: one part aprovechamiento=true + another aprovechamiento=false
     on the SAME rollo -> only second part's meters deducted; first goes
     to aprovechamientos.
  3. GET /api/aprovechamientos returns the registered docs sorted by
     created_at DESC.
  4. GET /api/cutting/pending: orders include cutting_services[].part_percentages
     (may be empty dict but the field exists).
  5. Extended filter of cutting_services matches services with
     'polarizado', '3m', 'crystalline', 'mixto' in name/description.
"""
import os
import uuid
import time
import requests
import pytest

from test_iteration8_features import (
    API, _login, _hdr, _create_order,
    ADMIN, CORTE,
)
from test_iteration10_features import _drive_to_en_revision_with_photo, _get_first_technician_id


@pytest.fixture(scope="session")
def admin_token():
    return _login(ADMIN)


@pytest.fixture(scope="session")
def corte_token():
    return _login(CORTE)


# ---------- helpers ----------

def _create_rollo(admin_token, nombre, tipo_rollo, metros=50.0):
    payload = {
        "nombre": nombre,
        "categoria": "pelicula",
        "tipo_articulo": "rollo",
        "tipo_rollo": tipo_rollo,
        "metros_iniciales": metros,
        "costo": 100000,
    }
    r = requests.post(f"{API}/inventory", json=payload, headers=_hdr(admin_token), timeout=15)
    assert r.status_code == 200, f"inventory create: {r.status_code} {r.text}"
    return r.json()


def _drive_to_en_corte(admin_token, corte_token, service_name="Polarizado 3M Crystalline", plate=None,
                      part_percentages=None):
    plate = plate or f"T12{uuid.uuid4().hex[:5].upper()}"
    svc = {"service": service_name, "price": 500000}
    if part_percentages is not None:
        svc["part_percentages"] = part_percentages
    order = _create_order(admin_token, plate, services=[svc])
    _drive_to_en_revision_with_photo(admin_token, order)
    tech_id, _ = _get_first_technician_id(admin_token)
    r = requests.post(
        f"{API}/tech-queue/pre-assign",
        json={"order_id": order["id"], "technician_id": tech_id, "service_time_minutes": 60},
        headers=_hdr(admin_token), timeout=15,
    )
    assert r.status_code == 200, f"pre-assign: {r.status_code} {r.text}"
    r = requests.put(f"{API}/cutting/{order['id']}/start", headers=_hdr(corte_token), timeout=15)
    assert r.status_code == 200, f"cutting/start: {r.status_code} {r.text}"
    return order


def _get_inventory_item(admin_token, item_id):
    items = requests.get(f"{API}/inventory", headers=_hdr(admin_token), timeout=15).json()
    return next((x for x in items if x["id"] == item_id), None)


def _get_movements_for_order(admin_token, order_id):
    r = requests.get(f"{API}/inventory/movements", headers=_hdr(admin_token), timeout=15)
    assert r.status_code == 200
    return [m for m in r.json() if m.get("order_id") == order_id and m.get("type") == "deduct_auto_cutting"]


# ---------- Tests ----------

class TestAprovechamientos:
    def test_part_aprovechamiento_skips_stock_and_creates_aprov(self, admin_token, corte_token):
        rollo = _create_rollo(admin_token, "TEST_i12 AprovOnly Spectra", "spectra", metros=50.0)
        order = _drive_to_en_corte(admin_token, corte_token)
        initial_metros = rollo["metros_iniciales"]

        body = {
            "part_measurements": {"panoramico": "150x80 cm"},  # would be 1.5m
            "part_materials": {
                "panoramico": {
                    "tipo_rollo": "spectra",
                    "inventory_item_id": rollo["id"],
                    "is_aprovechamiento": True,
                },
            },
        }
        r = requests.put(f"{API}/cutting/{order['id']}/complete", json=body,
                         headers=_hdr(corte_token), timeout=15)
        assert r.status_code == 200, f"complete: {r.status_code} {r.text}"
        data = r.json()

        # response includes aprovechamientos
        aprov = data.get("aprovechamientos")
        assert isinstance(aprov, list), f"aprovechamientos missing: {data}"
        assert len(aprov) == 1, f"expected 1 aprovechamiento, got {aprov}"
        assert aprov[0]["part_id"] == "panoramico"
        assert aprov[0]["measurement"] == "150x80 cm"
        assert aprov[0]["meters"] == 1.5
        assert aprov[0]["tipo_rollo"] == "spectra"

        # NO inventory deduction
        assert data.get("inventory_deduction") in (None, {}), f"expected no deduction, got {data.get('inventory_deduction')}"

        # rollo still has full metros
        item = _get_inventory_item(admin_token, rollo["id"])
        assert item["metros_restantes"] == initial_metros, \
            f"expected metros_restantes={initial_metros}, got {item['metros_restantes']}"

        # No inventory movements created
        movs = _get_movements_for_order(admin_token, order["id"])
        assert len(movs) == 0, f"expected 0 movements, got {movs}"

    def test_mixed_aprov_and_normal_same_rollo(self, admin_token, corte_token):
        rollo = _create_rollo(admin_token, "TEST_i12 Mixed Spectra", "spectra", metros=50.0)
        order = _drive_to_en_corte(admin_token, corte_token)

        body = {
            "part_measurements": {
                "panoramico": "150x80 cm",      # 1.5m, aprovechamiento -> no deduction
                "vidrio_piloto": "100x60 cm",   # 1.0m, normal -> deduct 1.0
            },
            "part_materials": {
                "panoramico": {
                    "tipo_rollo": "spectra",
                    "inventory_item_id": rollo["id"],
                    "is_aprovechamiento": True,
                },
                "vidrio_piloto": {
                    "tipo_rollo": "spectra",
                    "inventory_item_id": rollo["id"],
                    "is_aprovechamiento": False,
                },
            },
        }
        r = requests.put(f"{API}/cutting/{order['id']}/complete", json=body,
                         headers=_hdr(corte_token), timeout=15)
        assert r.status_code == 200, f"complete: {r.status_code} {r.text}"
        data = r.json()

        # only vidrio_piloto's 1.0m deducted
        deduction = data.get("inventory_deduction")
        assert deduction is not None, "expected inventory_deduction for non-aprov part"
        assert "multi" not in deduction
        assert deduction["item_id"] == rollo["id"]
        assert deduction["meters_used"] == 1.0, f"expected 1.0, got {deduction['meters_used']}"
        assert deduction["new_remaining"] == 49.0

        # aprovechamientos contains panoramico only
        aprov = data.get("aprovechamientos") or []
        assert len(aprov) == 1
        assert aprov[0]["part_id"] == "panoramico"
        assert aprov[0]["meters"] == 1.5

        # rollo updated to 49.0 (not 47.5)
        item = _get_inventory_item(admin_token, rollo["id"])
        assert item["metros_restantes"] == 49.0

        # 1 inventory_movement
        movs = _get_movements_for_order(admin_token, order["id"])
        assert len(movs) == 1
        assert movs[0]["metros"] == 1.0


class TestAprovechamientosListEndpoint:
    def test_get_aprovechamientos_returns_list_sorted_desc(self, admin_token, corte_token):
        # Create two orders w/ aprovechamientos consecutively
        rollo = _create_rollo(admin_token, "TEST_i12 List Spectra", "spectra", metros=30.0)
        order1 = _drive_to_en_corte(admin_token, corte_token)
        r = requests.put(
            f"{API}/cutting/{order1['id']}/complete",
            json={
                "part_measurements": {"panoramico": "100x60 cm"},
                "part_materials": {
                    "panoramico": {
                        "tipo_rollo": "spectra",
                        "inventory_item_id": rollo["id"],
                        "is_aprovechamiento": True,
                    }
                },
            },
            headers=_hdr(corte_token), timeout=15,
        )
        assert r.status_code == 200

        time.sleep(1)
        order2 = _drive_to_en_corte(admin_token, corte_token)
        r = requests.put(
            f"{API}/cutting/{order2['id']}/complete",
            json={
                "part_measurements": {"vidrio_piloto": "80x50 cm"},
                "part_materials": {
                    "vidrio_piloto": {
                        "tipo_rollo": "spectra",
                        "inventory_item_id": rollo["id"],
                        "is_aprovechamiento": True,
                    }
                },
            },
            headers=_hdr(corte_token), timeout=15,
        )
        assert r.status_code == 200

        # GET /api/aprovechamientos
        r = requests.get(f"{API}/aprovechamientos", headers=_hdr(corte_token), timeout=15)
        assert r.status_code == 200, f"GET aprovechamientos: {r.status_code} {r.text}"
        items = r.json()
        assert isinstance(items, list)

        # Filter for the two orders we just created
        ours = [it for it in items if it.get("order_id") in (order1["id"], order2["id"])]
        assert len(ours) >= 2

        # Verify sorting DESC by created_at: order2 should appear before order1 in 'ours'
        # (because 'items' is sorted DESC globally; the first match by order_id should be order2)
        idx_o1 = next(i for i, it in enumerate(items) if it.get("order_id") == order1["id"])
        idx_o2 = next(i for i, it in enumerate(items) if it.get("order_id") == order2["id"])
        assert idx_o2 < idx_o1, f"expected order2 (newer) to appear before order1; o2_idx={idx_o2} o1_idx={idx_o1}"

        # Each item has required fields
        for it in ours:
            for field in ("id", "order_id", "part_id", "measurement", "meters",
                          "tipo_rollo", "created_at", "user_id", "user_name", "status"):
                assert field in it, f"missing field {field} in aprov: {it}"
            # no mongo _id leak
            assert "_id" not in it

    def test_get_aprovechamientos_admin_role(self, admin_token):
        r = requests.get(f"{API}/aprovechamientos", headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)


class TestCuttingPendingPartPercentages:
    def test_cutting_pending_includes_part_percentages(self, admin_token, corte_token):
        part_pct = {"panoramico": "35%", "vidrio_piloto": "20%"}
        order = _drive_to_en_corte(
            admin_token, corte_token,
            service_name="Polarizado 3M Crystalline",
            part_percentages=part_pct,
        )

        r = requests.get(f"{API}/cutting/pending", headers=_hdr(corte_token), timeout=15)
        assert r.status_code == 200
        orders = r.json()
        ours = next((o for o in orders if o["id"] == order["id"]), None)
        assert ours is not None, "our order not in cutting/pending"

        services = ours.get("cutting_services") or []
        assert len(services) >= 1
        first = services[0]
        assert "part_percentages" in first, f"part_percentages missing in cutting_services[0]: {first}"
        assert first["part_percentages"].get("panoramico") == "35%"
        assert first["part_percentages"].get("vidrio_piloto") == "20%"

    def test_cutting_pending_empty_part_percentages_present(self, admin_token, corte_token):
        # Order with no part_percentages -> field should still exist as {}
        order = _drive_to_en_corte(admin_token, corte_token)
        r = requests.get(f"{API}/cutting/pending", headers=_hdr(corte_token), timeout=15)
        assert r.status_code == 200
        ours = next((o for o in r.json() if o["id"] == order["id"]), None)
        assert ours is not None
        services = ours.get("cutting_services") or []
        assert len(services) >= 1
        assert "part_percentages" in services[0]
        assert isinstance(services[0]["part_percentages"], dict)


class TestExtendedCuttingFilter:
    @pytest.mark.parametrize("service_name", [
        "Polarizado 3M Crystalline",
        "Polarizado Premium",
        "3M Crystalline 70",
        "Servicio mixto SUV",
    ])
    def test_cutting_filter_includes_new_keywords(self, admin_token, corte_token, service_name):
        order = _drive_to_en_corte(admin_token, corte_token, service_name=service_name)
        r = requests.get(f"{API}/cutting/pending", headers=_hdr(corte_token), timeout=15)
        assert r.status_code == 200
        orders = r.json()
        ids = {o["id"] for o in orders}
        assert order["id"] in ids, f"order with service '{service_name}' not in cutting/pending"
