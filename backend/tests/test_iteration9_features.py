"""
Iteration 9 backend regression: validate that GET /api/orders and
GET /api/orders/{id} now expose service_completion_photos (list) and
service_completion_notes (string) after a técnico completes a service.

Re-uses helpers from test_iteration8_features.
"""
import uuid
import os
import requests
import pytest

from test_iteration8_features import (
    API, _login, _hdr, _create_order, _checkin_assign_start,
    ADMIN, TECNICO, TINY_PNG,
)


@pytest.fixture(scope="session")
def admin_token():
    return _login(ADMIN)


@pytest.fixture(scope="session")
def tecnico_token():
    return _login(TECNICO)


class TestCompletionFieldsExposed:
    def test_completion_photos_and_notes_returned_after_complete_service(
        self, admin_token, tecnico_token
    ):
        plate = f"T9{uuid.uuid4().hex[:5].upper()}"
        order = _create_order(admin_token, plate)
        order_id = order["id"]
        _checkin_assign_start(admin_token, order)

        # Complete service as técnico with notes + photos
        notes_text = "TEST iter9 servicio finalizado con fotos"
        r = requests.post(
            f"{API}/orders/complete-service",
            json={
                "order_id": order_id,
                "notes": notes_text,
                "completion_photos": [TINY_PNG, TINY_PNG, TINY_PNG],
            },
            headers=_hdr(tecnico_token),
            timeout=20,
        )
        assert r.status_code == 200, f"complete-service: {r.status_code} {r.text}"

        # GET /api/orders/{id} should expose the two new fields
        r = requests.get(f"{API}/orders/{order_id}", headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "servicio_completado"
        assert "service_completion_photos" in data, (
            "OrderResponse missing service_completion_photos"
        )
        assert "service_completion_notes" in data, (
            "OrderResponse missing service_completion_notes"
        )
        assert isinstance(data["service_completion_photos"], list)
        assert len(data["service_completion_photos"]) == 3, (
            f"expected 3 photos, got {len(data['service_completion_photos'])}"
        )
        assert data["service_completion_notes"] == notes_text

        # Same check on the list endpoint
        r = requests.get(f"{API}/orders", headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200
        match = next((o for o in r.json() if o["id"] == order_id), None)
        assert match, "order not found in GET /orders"
        assert "service_completion_photos" in match
        assert "service_completion_notes" in match
        assert len(match["service_completion_photos"]) == 3
        assert match["service_completion_notes"] == notes_text


class TestPostventaCompletesToEntregado:
    def test_postventa_complete_service_goes_to_entregado(self, admin_token, tecnico_token):
        # Create a base order for plate
        base_plate = f"PV9{uuid.uuid4().hex[:4].upper()}"
        base = _create_order(admin_token, base_plate)

        # Create postventa referencing base (non-polarizado service to skip cutting flow)
        post = _create_order(
            admin_token, base_plate,
            services=[{"service": "Revisión Garantía", "price": 0}],
            is_postventa=True, original_order_id=base["id"],
        )
        assert post.get("is_postventa") is True

        # Drive postventa order to en_proceso (same checkin/assign/start flow)
        _checkin_assign_start(admin_token, post)

        # Complete service -> for postventa should go directly to ENTREGADO
        r = requests.post(
            f"{API}/orders/complete-service",
            json={
                "order_id": post["id"],
                "notes": "TEST postventa finalizada",
                "completion_photos": [TINY_PNG],
            },
            headers=_hdr(tecnico_token),
            timeout=20,
        )
        assert r.status_code == 200, f"complete-service postventa: {r.status_code} {r.text}"

        r = requests.get(f"{API}/orders/{post['id']}", headers=_hdr(admin_token), timeout=15)
        assert r.status_code == 200
        data = r.json()
        # Postventa special path
        assert data["status"] == "entregado", (
            f"expected entregado for postventa, got {data['status']}"
        )
