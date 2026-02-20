"""
PolarizadosYA! Complete Flow Tests
Tests the full workflow: Login with different roles, Check-in, Assign, Technician, Billing
"""
import pytest
import requests
import os
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials for all roles
TEST_CREDENTIALS = {
    "admin": {"email": "admin@polarizadosya.com", "password": "admin123"},
    "asesor": {"email": "asesor@polarizadosya.com", "password": "asesor123"},
    "coordinador": {"email": "coordinador@polarizadosya.com", "password": "coord123"},
    "tecnico": {"email": "tecnico@polarizadosya.com", "password": "tecnico123"},
    "facturacion": {"email": "facturacion@polarizadosya.com", "password": "factura123"}
}


class TestLoginAllRoles:
    """Test login for all different user roles"""
    
    def test_admin_login(self):
        """Test admin login"""
        creds = TEST_CREDENTIALS["admin"]
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": creds["email"],
            "password": creds["password"]
        })
        assert response.status_code == 200, f"Admin login failed: {response.text}"
        data = response.json()
        assert data["user"]["role"] == "admin"
        print(f"✓ Admin login successful: {data['user']['name']}")
    
    def test_asesor_login(self):
        """Test asesor login"""
        creds = TEST_CREDENTIALS["asesor"]
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": creds["email"],
            "password": creds["password"]
        })
        assert response.status_code == 200, f"Asesor login failed: {response.text}"
        data = response.json()
        assert data["user"]["role"] == "asesor"
        print(f"✓ Asesor login successful: {data['user']['name']}")
    
    def test_coordinador_login(self):
        """Test coordinador login"""
        creds = TEST_CREDENTIALS["coordinador"]
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": creds["email"],
            "password": creds["password"]
        })
        assert response.status_code == 200, f"Coordinador login failed: {response.text}"
        data = response.json()
        assert data["user"]["role"] == "coordinador"
        print(f"✓ Coordinador login successful: {data['user']['name']}")
    
    def test_tecnico_login(self):
        """Test tecnico login"""
        creds = TEST_CREDENTIALS["tecnico"]
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": creds["email"],
            "password": creds["password"]
        })
        assert response.status_code == 200, f"Tecnico login failed: {response.text}"
        data = response.json()
        assert data["user"]["role"] == "tecnico"
        print(f"✓ Tecnico login successful: {data['user']['name']}")
    
    def test_facturacion_login(self):
        """Test facturacion login"""
        creds = TEST_CREDENTIALS["facturacion"]
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": creds["email"],
            "password": creds["password"]
        })
        assert response.status_code == 200, f"Facturacion login failed: {response.text}"
        data = response.json()
        assert data["user"]["role"] == "facturacion"
        print(f"✓ Facturacion login successful: {data['user']['name']}")


class TestCheckinFlow:
    """Test check-in endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login as asesor for check-in tests"""
        creds = TEST_CREDENTIALS["asesor"]
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": creds["email"],
            "password": creds["password"]
        })
        self.token = login_resp.json()["access_token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_create_order_for_checkin(self):
        """Create an order to test check-in"""
        today = datetime.now().strftime("%Y-%m-%d")
        
        order_data = {
            "client_name": "TEST_CheckinClient",
            "client_phone": "3001234567",
            "client_email": "checkin@test.com",
            "client_cedula": "1234567890",
            "plate": "CHK001",
            "brand": "Mazda",
            "model": "3",
            "year": 2023,
            "color": "Rojo",
            "date": today,
            "time_slot": "09:00 - 10:00",
            "services": [
                {"service": "polarizado", "price": 350000, "description": "Polarizado de vidrios"}
            ],
            "negotiated_value": 320000,
            "notes": "Test order for check-in"
        }
        
        response = requests.post(f"{BASE_URL}/api/orders", json=order_data, headers=self.headers)
        assert response.status_code == 200, f"Create order failed: {response.text}"
        
        created_order = response.json()
        assert created_order["status"] == "agendado"
        print(f"✓ Order created for check-in: {created_order['order_code']}")
        
        return created_order
    
    def test_checkin_endpoint(self):
        """Test check-in by order code"""
        # First create an order
        today = datetime.now().strftime("%Y-%m-%d")
        order_data = {
            "client_name": "TEST_CheckinFlow",
            "client_phone": "3001234568",
            "plate": "CHK002",
            "brand": "Honda",
            "model": "Civic",
            "date": today,
            "time_slot": "10:00 - 11:00",
            "services": [
                {"service": "nanoceramica", "price": 800000}
            ],
            "negotiated_value": 750000
        }
        
        create_resp = requests.post(f"{BASE_URL}/api/orders", json=order_data, headers=self.headers)
        assert create_resp.status_code == 200
        created_order = create_resp.json()
        order_code = created_order["order_code"]
        
        # Test check-in endpoint
        checkin_resp = requests.post(f"{BASE_URL}/api/orders/checkin", 
            json={"order_code": order_code}, 
            headers=self.headers
        )
        assert checkin_resp.status_code == 200, f"Check-in failed: {checkin_resp.text}"
        
        checkin_data = checkin_resp.json()
        assert checkin_data["order_code"] == order_code
        assert checkin_data["status"] == "agendado"
        print(f"✓ Check-in endpoint works for order: {order_code}")
    
    def test_ingreso_approval(self):
        """Test full ingreso approval flow"""
        # First create an order
        today = datetime.now().strftime("%Y-%m-%d")
        order_data = {
            "client_name": "TEST_IngresoApproval",
            "client_phone": "3001234569",
            "plate": "ING001",
            "brand": "Kia",
            "model": "Rio",
            "date": today,
            "time_slot": "11:00 - 12:00",
            "services": [
                {"service": "polarizado", "price": 350000}
            ],
            "negotiated_value": 330000
        }
        
        create_resp = requests.post(f"{BASE_URL}/api/orders", json=order_data, headers=self.headers)
        assert create_resp.status_code == 200
        order_id = create_resp.json()["id"]
        
        # Approve ingreso
        ingreso_data = {
            "order_id": order_id,
            "services": [{"service": "polarizado", "price": 350000}],
            "final_value": 330000,
            "signature_url": "data:image/png;base64,iVBORw0KGgoAAAANS",
            "cedula_number": "1234567890",
            "cedula_photo_url": "data:image/png;base64,iVBORw0KGgoAAAANS",
            "client_photo_url": None
        }
        
        ingreso_resp = requests.post(f"{BASE_URL}/api/orders/ingreso-approval", 
            json=ingreso_data, 
            headers=self.headers
        )
        assert ingreso_resp.status_code == 200, f"Ingreso approval failed: {ingreso_resp.text}"
        print(f"✓ Ingreso approval successful")
        
        # Verify status changed to ingresado
        order_resp = requests.get(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)
        assert order_resp.json()["status"] == "ingresado"
        print(f"✓ Order status changed to ingresado")


class TestOrderHistory:
    """Test order history endpoint for traceability"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login as admin"""
        creds = TEST_CREDENTIALS["admin"]
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": creds["email"],
            "password": creds["password"]
        })
        self.token = login_resp.json()["access_token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_get_order_history(self):
        """Test getting order history"""
        # Create order and process it
        today = datetime.now().strftime("%Y-%m-%d")
        order_data = {
            "client_name": "TEST_HistoryClient",
            "client_phone": "3009999999",
            "plate": "HST001",
            "brand": "Nissan",
            "model": "Versa",
            "date": today,
            "time_slot": "14:00 - 15:00",
            "services": [{"service": "polarizado", "price": 350000}],
            "negotiated_value": 330000
        }
        
        create_resp = requests.post(f"{BASE_URL}/api/orders", json=order_data, headers=self.headers)
        assert create_resp.status_code == 200
        order_id = create_resp.json()["id"]
        
        # Approve ingreso to create history entry
        ingreso_data = {
            "order_id": order_id,
            "services": [{"service": "polarizado", "price": 350000}],
            "final_value": 330000,
            "signature_url": "data:image/png;base64,test",
            "cedula_number": "9999999999",
            "cedula_photo_url": "data:image/png;base64,test"
        }
        requests.post(f"{BASE_URL}/api/orders/ingreso-approval", json=ingreso_data, headers=self.headers)
        
        # Get history
        history_resp = requests.get(f"{BASE_URL}/api/orders/{order_id}/history", headers=self.headers)
        assert history_resp.status_code == 200, f"Get history failed: {history_resp.text}"
        
        history = history_resp.json()
        assert isinstance(history, list), "History should be a list"
        
        if len(history) > 0:
            assert "action" in history[0]
            assert "old_status" in history[0]
            assert "new_status" in history[0]
            assert "changed_by_name" in history[0]
            print(f"✓ Order history returned {len(history)} entries")
        else:
            print("✓ Order history endpoint works (empty list)")


class TestCoordinatorAssignment:
    """Test coordinator assignment flow"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login as coordinador"""
        creds = TEST_CREDENTIALS["coordinador"]
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": creds["email"],
            "password": creds["password"]
        })
        self.token = login_resp.json()["access_token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_coordinador_cannot_create_order(self):
        """Coordinadores cannot create orders"""
        today = datetime.now().strftime("%Y-%m-%d")
        order_data = {
            "client_name": "TEST_CoordOrder",
            "client_phone": "3001111111",
            "plate": "CRD001",
            "brand": "Test",
            "model": "Car",
            "date": today,
            "time_slot": "09:00 - 10:00",
            "services": [{"service": "polarizado", "price": 350000}],
            "negotiated_value": 350000
        }
        
        response = requests.post(f"{BASE_URL}/api/orders", json=order_data, headers=self.headers)
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        print("✓ Coordinador correctly denied from creating orders")
    
    def test_get_technicians_list(self):
        """Test getting technicians list for assignment"""
        response = requests.get(f"{BASE_URL}/api/users/technicians", headers=self.headers)
        assert response.status_code == 200, f"Get technicians failed: {response.text}"
        
        technicians = response.json()
        assert isinstance(technicians, list)
        assert len(technicians) >= 1, "Should have at least one technician"
        
        for tech in technicians:
            assert tech["role"] == "tecnico"
        
        print(f"✓ Technicians list: {len(technicians)} technicians available")


class TestTechnicianFlow:
    """Test technician service flow"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login as tecnico"""
        creds = TEST_CREDENTIALS["tecnico"]
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": creds["email"],
            "password": creds["password"]
        })
        self.token = login_resp.json()["access_token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
        self.user = login_resp.json()["user"]
    
    def test_get_assigned_orders(self):
        """Test getting orders assigned to technician"""
        response = requests.get(f"{BASE_URL}/api/orders", headers=self.headers)
        assert response.status_code == 200, f"Get orders failed: {response.text}"
        
        orders = response.json()
        # Filter for this technician's orders
        my_orders = [o for o in orders if o.get("assigned_technician_id") == self.user["id"]]
        print(f"✓ Technician has {len(my_orders)} assigned orders")
    
    def test_tecnico_cannot_assign(self):
        """Technicians cannot assign orders"""
        assign_data = {
            "order_id": "fake-id",
            "technician_id": self.user["id"],
            "service_time_minutes": 60
        }
        
        response = requests.post(f"{BASE_URL}/api/orders/assign", json=assign_data, headers=self.headers)
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        print("✓ Technician correctly denied from assigning orders")


class TestBillingFlow:
    """Test facturacion billing flow"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login as facturacion"""
        creds = TEST_CREDENTIALS["facturacion"]
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": creds["email"],
            "password": creds["password"]
        })
        self.token = login_resp.json()["access_token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_get_orders_for_billing(self):
        """Test getting orders for billing"""
        response = requests.get(f"{BASE_URL}/api/orders", headers=self.headers)
        assert response.status_code == 200, f"Get orders failed: {response.text}"
        
        orders = response.json()
        # Filter orders that are ready for billing
        billing_orders = [o for o in orders if o["status"] in ["servicio_completado", "terminado_pagado", "terminado_falta_pago"]]
        print(f"✓ Facturacion sees {len(billing_orders)} orders ready for billing")
    
    def test_facturacion_cannot_create_order(self):
        """Facturacion cannot create orders"""
        today = datetime.now().strftime("%Y-%m-%d")
        order_data = {
            "client_name": "TEST_BillOrder",
            "client_phone": "3001111111",
            "plate": "BIL001",
            "brand": "Test",
            "model": "Car",
            "date": today,
            "time_slot": "09:00 - 10:00",
            "services": [{"service": "polarizado", "price": 350000}],
            "negotiated_value": 350000
        }
        
        response = requests.post(f"{BASE_URL}/api/orders", json=order_data, headers=self.headers)
        assert response.status_code == 403, f"Expected 403, got {response.status_code}"
        print("✓ Facturacion correctly denied from creating orders")


class TestCompleteWorkflow:
    """Test the complete workflow from agendamiento to entrega"""
    
    def get_token(self, role):
        """Get token for a specific role"""
        creds = TEST_CREDENTIALS[role]
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": creds["email"],
            "password": creds["password"]
        })
        return login_resp.json()["access_token"], login_resp.json()["user"]
    
    def test_full_workflow(self):
        """Test complete workflow from agendamiento to servicio completado"""
        today = datetime.now().strftime("%Y-%m-%d")
        
        # Step 1: Asesor creates order (Agendado)
        asesor_token, _ = self.get_token("asesor")
        asesor_headers = {"Authorization": f"Bearer {asesor_token}"}
        
        order_data = {
            "client_name": "TEST_FullWorkflow",
            "client_phone": "3005555555",
            "plate": "FLW001",
            "brand": "Toyota",
            "model": "Camry",
            "date": today,
            "time_slot": "13:00 - 14:00",
            "services": [{"service": "polarizado", "price": 350000}],
            "negotiated_value": 320000
        }
        
        create_resp = requests.post(f"{BASE_URL}/api/orders", json=order_data, headers=asesor_headers)
        assert create_resp.status_code == 200
        order = create_resp.json()
        order_id = order["id"]
        print(f"✓ Step 1: Order created with status: {order['status']}")
        
        # Step 2: Asesor approves ingreso (Ingresado)
        ingreso_data = {
            "order_id": order_id,
            "services": [{"service": "polarizado", "price": 350000}],
            "final_value": 320000,
            "signature_url": "data:image/png;base64,signature",
            "cedula_number": "5555555555",
            "cedula_photo_url": "data:image/png;base64,cedula"
        }
        
        ingreso_resp = requests.post(f"{BASE_URL}/api/orders/ingreso-approval", json=ingreso_data, headers=asesor_headers)
        assert ingreso_resp.status_code == 200
        print(f"✓ Step 2: Ingreso approved")
        
        # Step 3: Asesor completes inspection (En Revisión)
        inspection_data = {
            "order_id": order_id,
            "photos": ["data:image/png;base64,photo1", "data:image/png;base64,photo2"],
            "notes": "Vehicle inspected, all good"
        }
        
        inspection_resp = requests.post(f"{BASE_URL}/api/orders/inspection", json=inspection_data, headers=asesor_headers)
        assert inspection_resp.status_code == 200
        print(f"✓ Step 3: Inspection completed")
        
        # Step 4: Coordinador assigns technician (Asignado)
        coord_token, _ = self.get_token("coordinador")
        coord_headers = {"Authorization": f"Bearer {coord_token}"}
        
        # Get a technician
        tech_resp = requests.get(f"{BASE_URL}/api/users/technicians", headers=coord_headers)
        technicians = tech_resp.json()
        tech_id = technicians[0]["id"] if technicians else None
        
        if tech_id:
            assign_data = {
                "order_id": order_id,
                "technician_id": tech_id,
                "service_time_minutes": 60
            }
            
            assign_resp = requests.post(f"{BASE_URL}/api/orders/assign", json=assign_data, headers=coord_headers)
            assert assign_resp.status_code == 200
            print(f"✓ Step 4: Technician assigned")
            
            # Step 5: Technician starts service (En Proceso)
            tech_token, _ = self.get_token("tecnico")
            tech_headers = {"Authorization": f"Bearer {tech_token}"}
            
            start_resp = requests.post(f"{BASE_URL}/api/orders/{order_id}/start-service", headers=tech_headers)
            assert start_resp.status_code == 200
            print(f"✓ Step 5: Service started")
            
            # Step 5b: Technician completes service (Servicio Completado)
            complete_data = {
                "order_id": order_id,
                "notes": "Service completed successfully"
            }
            
            complete_resp = requests.post(f"{BASE_URL}/api/orders/complete-service", json=complete_data, headers=tech_headers)
            assert complete_resp.status_code == 200
            print(f"✓ Step 5b: Service completed")
            
            # Verify final status
            final_resp = requests.get(f"{BASE_URL}/api/orders/{order_id}", headers=asesor_headers)
            final_order = final_resp.json()
            assert final_order["status"] == "servicio_completado"
            print(f"✓ Full workflow completed! Final status: {final_order['status']}")
        else:
            print("⚠ No technicians available, skipping assignment steps")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
