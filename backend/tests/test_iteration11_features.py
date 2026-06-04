"""
Iteration 11 backend tests for PolarizadosYA.

Validates:
 1. PUT /api/cutting/{id}/complete with part_materials descontará metros por rollo
    según las medidas de cada parte.
 2. _meters_from_part_measurements: cada part_id se calcula y se suma al rollo asignado.
 3. Dos partes con el mismo inventory_item_id -> los metros se SUMAN (un solo movimiento).
 4. inventory_deduction.multi se devuelve cuando hay >1 rollo.
 5. Modo legacy con inventory_item_id agregado sigue funcionando si no hay part_materials.
 6. order.cutting_part_materials persiste y es retornado por GET /api/orders/{id}.
 7. inventory_movements crea un row de tipo 'deduct_auto_cutting' por cada rollo descontado.
"""
import os
import uuid
import requests
import pytest

from test_iteration8_features import (
    API, _login, _hdr, _create_order,
    ADMIN, CORTE, TINY_PNG,
)
from test_iteration10_features import _drive_to_en_revision_with_photo, _get_first_technician_id


@pytest.fixture(scope="session")
def admin_token():
    return _login(ADMIN)


@pytest.fixture(scope="session")
def corte_token():
    return _login(CORTE)


# ---------- Helpers ----------

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


def _drive_to_en_corte(admin_token, corte_token, plate=None):
    """Create polarizado order, drive to en_corte (pre-assign tech + start cutting)."""
    plate = plate or f"T11{uuid.uuid4().hex[:5].upper()}"
    order = _create_order(
        admin_token, plate,
        services=[{"service": "Polarizado 3M Crystalline", "price": 500000}],
    )
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

class TestPartMaterialsMultiRollo:
    def test_two_parts_two_different_rollos_deducts_each(self, admin_token, corte_token):
        rollo_a = _create_rollo(admin_token, "TEST_i11 Spectra A", "spectra", metros=50.0)
        rollo_b = _create_rollo(admin_token, "TEST_i11 BlackCeramic B", "black_ceramic", metros=50.0)
        order = _drive_to_en_corte(admin_token, corte_token)

        # Part panoramico => 150x80 cm => max=150 => 1.5m on rollo_a
        # Part vidrio_piloto => 100x50 cm => max=100 => 1.0m on rollo_b
        body = {
            "part_measurements": {
                "panoramico": "150x80 cm",
                "vidrio_piloto": "100x50 cm",
            },
            "part_materials": {
                "panoramico": {"tipo_rollo": "spectra", "inventory_item_id": rollo_a["id"]},
                "vidrio_piloto": {"tipo_rollo": "black_ceramic", "inventory_item_id": rollo_b["id"]},
            },
        }
        r = requests.put(
            f"{API}/cutting/{order['id']}/complete", json=body,
            headers=_hdr(corte_token), timeout=15,
        )
        assert r.status_code == 200, f"complete: {r.status_code} {r.text}"
        data = r.json()
        # inventory_deduction must contain multi (>1 rollo)
        deduction = data.get("inventory_deduction")
        assert deduction is not None, f"no inventory_deduction in response: {data}"
        assert "multi" in deduction, f"expected 'multi' key, got: {deduction}"
        multi = deduction["multi"]
        assert len(multi) == 2, f"expected 2 rollos in multi, got {len(multi)}: {multi}"

        by_id = {m["item_id"]: m for m in multi}
        assert by_id[rollo_a["id"]]["meters_used"] == 1.5, by_id[rollo_a["id"]]
        assert by_id[rollo_a["id"]]["new_remaining"] == 48.5
        assert by_id[rollo_a["id"]]["tipo_rollo"] == "spectra"
        assert by_id[rollo_a["id"]]["rollo_codigo"] == rollo_a["codigo"]
        assert by_id[rollo_b["id"]]["meters_used"] == 1.0
        assert by_id[rollo_b["id"]]["new_remaining"] == 49.0
        assert by_id[rollo_b["id"]]["tipo_rollo"] == "black_ceramic"

        # Verify inventory persisted
        a = _get_inventory_item(admin_token, rollo_a["id"])
        b = _get_inventory_item(admin_token, rollo_b["id"])
        assert a["metros_restantes"] == 48.5
        assert b["metros_restantes"] == 49.0

        # Verify inventory_movements: 2 deduct_auto_cutting rows
        movs = _get_movements_for_order(admin_token, order["id"])
        assert len(movs) == 2, f"expected 2 movements, got {len(movs)}: {movs}"
        mov_meters = sorted(m["metros"] for m in movs)
        assert mov_meters == [1.0, 1.5]

    def test_two_parts_same_rollo_sums_meters_single_movement(self, admin_token, corte_token):
        rollo = _create_rollo(admin_token, "TEST_i11 Same Rollo", "spectra", metros=50.0)
        order = _drive_to_en_corte(admin_token, corte_token)

        # Two parts, same rollo => 120 + 80 = 2.0m + 0.80m = 2.8m total
        body = {
            "part_measurements": {
                "panoramico": "120x60 cm",   # max=120 => 1.2m
                "vidrio_piloto": "80x40 cm",  # max=80 => 0.8m
            },
            "part_materials": {
                "panoramico": {"tipo_rollo": "spectra", "inventory_item_id": rollo["id"]},
                "vidrio_piloto": {"tipo_rollo": "spectra", "inventory_item_id": rollo["id"]},
            },
        }
        r = requests.put(
            f"{API}/cutting/{order['id']}/complete", json=body,
            headers=_hdr(corte_token), timeout=15,
        )
        assert r.status_code == 200, f"complete: {r.status_code} {r.text}"
        data = r.json()
        deduction = data.get("inventory_deduction")
        assert deduction is not None
        # Single rollo => NOT wrapped in multi (single object)
        assert "multi" not in deduction, f"expected single rollo (no multi), got: {deduction}"
        assert deduction["item_id"] == rollo["id"]
        assert deduction["meters_used"] == 2.0, f"expected 2.0 summed, got {deduction['meters_used']}"
        assert deduction["new_remaining"] == 48.0

        # Inventory persisted
        item = _get_inventory_item(admin_token, rollo["id"])
        assert item["metros_restantes"] == 48.0

        # Movements: 1 row only (not 2)
        movs = _get_movements_for_order(admin_token, order["id"])
        assert len(movs) == 1, f"expected 1 movement (sum), got {len(movs)}: {movs}"
        assert movs[0]["metros"] == 2.0


class TestPartMaterialsPersistence:
    def test_order_cutting_part_materials_persisted_and_returned(self, admin_token, corte_token):
        rollo = _create_rollo(admin_token, "TEST_i11 Persist", "spectra", metros=30.0)
        order = _drive_to_en_corte(admin_token, corte_token)

        body = {
            "part_measurements": {"panoramico": "100x60 cm"},
            "part_materials": {
                "panoramico": {"tipo_rollo": "spectra", "inventory_item_id": rollo["id"]},
            },
        }
        r = requests.put(
            f"{API}/cutting/{order['id']}/complete", json=body,
            headers=_hdr(corte_token), timeout=15,
        )
        assert r.status_code == 200

        # GET order and check field
        r = requests.get(f"{API}/orders/{order['id']}", headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        cpm = data.get("cutting_part_materials")
        assert cpm is not None, "cutting_part_materials not returned by OrderResponse"
        assert "panoramico" in cpm
        assert cpm["panoramico"]["tipo_rollo"] == "spectra"
        assert cpm["panoramico"]["inventory_item_id"] == rollo["id"]


class TestLegacyAggregatedInventory:
    def test_legacy_inventory_item_id_without_part_materials_still_works(self, admin_token, corte_token):
        rollo = _create_rollo(admin_token, "TEST_i11 Legacy", "ceramic_i3", metros=20.0)
        order = _drive_to_en_corte(admin_token, corte_token)

        body = {
            "part_measurements": {
                "panoramico": "150x70 cm",   # 1.5m
                "vidrio_piloto": "100x50 cm",  # 1.0m
            },
            "inventory_item_id": rollo["id"],
            # No part_materials => legacy path with meters computed from sum of all parts
        }
        r = requests.put(
            f"{API}/cutting/{order['id']}/complete", json=body,
            headers=_hdr(corte_token), timeout=15,
        )
        assert r.status_code == 200, f"complete: {r.status_code} {r.text}"
        data = r.json()
        deduction = data.get("inventory_deduction")
        assert deduction is not None
        assert "multi" not in deduction
        assert deduction["item_id"] == rollo["id"]
        # 1.5 + 1.0 = 2.5
        assert deduction["meters_used"] == 2.5
        assert deduction["new_remaining"] == 17.5

        # Movements: 1 row
        movs = _get_movements_for_order(admin_token, order["id"])
        assert len(movs) == 1
        assert movs[0]["metros"] == 2.5
