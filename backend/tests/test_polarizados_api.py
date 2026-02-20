"""
PolarizadosYA! API Backend Tests
Tests authentication, orders CRUD, services catalog, and dashboard endpoints
"""
import pytest
import requests
import os
from datetime import datetime

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_ADMIN_EMAIL = "admin@polarizadosya.com"
TEST_ADMIN_PASSWORD = "admin123"

class TestAuthentication:
    """Authentication endpoint tests"""
    
    def test_login_success(self):
        """Test admin login with valid credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_ADMIN_EMAIL,
            "password": TEST_ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        
        data = response.json()
        assert "access_token" in data, "Token missing in response"
        assert "user" in data, "User object missing in response"
        assert data["user"]["email"] == TEST_ADMIN_EMAIL
        assert data["user"]["role"] == "admin"
        print(f"✓ Login successful for {TEST_ADMIN_EMAIL}")
    
    def test_login_invalid_credentials(self):
        """Test login with wrong password"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_ADMIN_EMAIL,
            "password": "wrongpassword"
        })
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("✓ Invalid credentials correctly rejected")
    
    def test_auth_me_with_token(self):
        """Test /auth/me endpoint with valid token"""
        # First login
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_ADMIN_EMAIL,
            "password": TEST_ADMIN_PASSWORD
        })
        token = login_resp.json()["access_token"]
        
        # Test /me endpoint
        response = requests.get(f"{BASE_URL}/api/auth/me", headers={
            "Authorization": f"Bearer {token}"
        })
        assert response.status_code == 200, f"Auth/me failed: {response.text}"
        
        data = response.json()
        assert data["email"] == TEST_ADMIN_EMAIL
        assert data["role"] == "admin"
        print("✓ Auth/me returns correct user data")


class TestServicesCatalog:
    """Services catalog endpoint tests"""
    
    def test_get_catalog(self):
        """Test services catalog returns available services"""
        response = requests.get(f"{BASE_URL}/api/services/catalog")
        assert response.status_code == 200, f"Catalog fetch failed: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Catalog should be a list"
        assert len(data) > 0, "Catalog should have services"
        
        # Check expected services
        service_names = [s["service"] for s in data]
        assert "polarizado" in service_names, "Polarizado service missing"
        assert "nanoceramica" in service_names, "Nanoceramica service missing"
        assert "autobahn_black" in service_names, "Autobahn Black service missing"
        assert "ultrasecure" in service_names, "Ultrasecure service missing"
        
        # Verify service structure
        for service in data:
            assert "service" in service
            assert "name" in service
            assert "suggested_price" in service
            assert isinstance(service["suggested_price"], (int, float))
        
        print(f"✓ Services catalog has {len(data)} services with correct structure")


class TestDashboard:
    """Dashboard stats endpoint tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get token for authenticated requests"""
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_ADMIN_EMAIL,
            "password": TEST_ADMIN_PASSWORD
        })
        self.token = login_resp.json()["access_token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_get_dashboard_stats(self):
        """Test dashboard stats endpoint"""
        response = requests.get(f"{BASE_URL}/api/dashboard/stats", headers=self.headers)
        assert response.status_code == 200, f"Dashboard stats failed: {response.text}"
        
        data = response.json()
        # Check all expected status counters
        expected_keys = [
            "agendados", "ingresados", "en_revision", "asignados", 
            "en_proceso", "servicio_completado", "terminado_falta_pago", 
            "terminado_pagado", "entregados_hoy", "citas_hoy"
        ]
        for key in expected_keys:
            assert key in data, f"Missing key: {key}"
            assert isinstance(data[key], int), f"{key} should be integer"
        
        print(f"✓ Dashboard stats returned with all {len(expected_keys)} status counters")


class TestOrdersCRUD:
    """Orders (Citas/Appointments) CRUD tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get token for authenticated requests"""
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_ADMIN_EMAIL,
            "password": TEST_ADMIN_PASSWORD
        })
        self.token = login_resp.json()["access_token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_create_order_and_verify(self):
        """Test creating a new order/appointment and verify it's created"""
        today = datetime.now().strftime("%Y-%m-%d")
        
        order_data = {
            "client_name": "TEST_Juan Pérez",
            "client_phone": "3001234567",
            "client_email": "test_juan@example.com",
            "client_cedula": "1234567890",
            "plate": "TEST123",
            "brand": "Chevrolet",
            "model": "Spark",
            "year": 2022,
            "color": "Blanco",
            "date": today,
            "time_slot": "09:00 - 10:00",
            "services": [
                {"service": "polarizado", "price": 350000, "description": "Polarizado de vidrios"}
            ],
            "negotiated_value": 320000,
            "notes": "Test order - please delete"
        }
        
        # Create order
        response = requests.post(f"{BASE_URL}/api/orders", json=order_data, headers=self.headers)
        assert response.status_code == 200, f"Create order failed: {response.text}"
        
        created_order = response.json()
        assert "id" in created_order, "Order ID missing"
        assert "order_code" in created_order, "Order code missing"
        assert "qr_code" in created_order, "QR code missing"
        assert created_order["client_name"] == order_data["client_name"]
        assert created_order["plate"] == order_data["plate"]
        assert created_order["status"] == "agendado"
        assert created_order["negotiated_value"] == order_data["negotiated_value"]
        
        order_id = created_order["id"]
        order_code = created_order["order_code"]
        print(f"✓ Order created with ID: {order_id}, Code: {order_code}")
        
        # Verify order can be retrieved by ID
        get_response = requests.get(f"{BASE_URL}/api/orders/{order_id}", headers=self.headers)
        assert get_response.status_code == 200, f"Get order by ID failed: {get_response.text}"
        
        fetched_order = get_response.json()
        assert fetched_order["id"] == order_id
        assert fetched_order["order_code"] == order_code
        print(f"✓ Order retrieved by ID successfully")
        
        # Verify order can be retrieved by code
        code_response = requests.get(f"{BASE_URL}/api/orders/code/{order_code}", headers=self.headers)
        assert code_response.status_code == 200, f"Get order by code failed: {code_response.text}"
        
        code_order = code_response.json()
        assert code_order["id"] == order_id
        print(f"✓ Order retrieved by code successfully")
        
        return order_id
    
    def test_get_orders_list(self):
        """Test getting all orders"""
        response = requests.get(f"{BASE_URL}/api/orders", headers=self.headers)
        assert response.status_code == 200, f"Get orders failed: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Orders should be a list"
        print(f"✓ Orders list returned with {len(data)} orders")
    
    def test_get_orders_by_date(self):
        """Test filtering orders by date"""
        today = datetime.now().strftime("%Y-%m-%d")
        response = requests.get(f"{BASE_URL}/api/orders", params={"date": today}, headers=self.headers)
        assert response.status_code == 200, f"Get orders by date failed: {response.text}"
        
        data = response.json()
        for order in data:
            assert order["date"] == today, f"Order date mismatch: {order['date']}"
        print(f"✓ Orders filtered by date returned {len(data)} orders")
    
    def test_create_order_with_multiple_services(self):
        """Test creating order with multiple services"""
        today = datetime.now().strftime("%Y-%m-%d")
        
        order_data = {
            "client_name": "TEST_Multiple Services",
            "client_phone": "3009876543",
            "plate": "MULTI01",
            "brand": "Toyota",
            "model": "Corolla",
            "date": today,
            "time_slot": "10:00 - 11:00",
            "services": [
                {"service": "polarizado", "price": 350000, "description": "Polarizado"},
                {"service": "nanoceramica", "price": 800000, "description": "Nanocerámica"},
                {"service": "ultrasecure", "price": 500000, "description": "Ultrasecure"}
            ],
            "negotiated_value": 1500000
        }
        
        response = requests.post(f"{BASE_URL}/api/orders", json=order_data, headers=self.headers)
        assert response.status_code == 200, f"Create order with multiple services failed: {response.text}"
        
        created_order = response.json()
        assert len(created_order["services"]) == 3, "Should have 3 services"
        print(f"✓ Order created with {len(created_order['services'])} services")
    
    def test_create_order_validation_missing_required(self):
        """Test order creation fails with missing required fields"""
        # Missing required fields
        invalid_data = {
            "client_name": "Test Client"
            # Missing: client_phone, plate, brand, model, date, time_slot, services, negotiated_value
        }
        
        response = requests.post(f"{BASE_URL}/api/orders", json=invalid_data, headers=self.headers)
        assert response.status_code == 422, f"Expected validation error 422, got {response.status_code}"
        print("✓ Order validation correctly rejects incomplete data")


class TestUsersEndpoints:
    """Users management endpoint tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get token for authenticated requests"""
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_ADMIN_EMAIL,
            "password": TEST_ADMIN_PASSWORD
        })
        self.token = login_resp.json()["access_token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_get_all_users(self):
        """Test getting all users"""
        response = requests.get(f"{BASE_URL}/api/users", headers=self.headers)
        assert response.status_code == 200, f"Get users failed: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Users should be a list"
        print(f"✓ Users list returned with {len(data)} users")
    
    def test_get_technicians(self):
        """Test getting technicians only"""
        response = requests.get(f"{BASE_URL}/api/users/technicians", headers=self.headers)
        assert response.status_code == 200, f"Get technicians failed: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Technicians should be a list"
        for tech in data:
            assert tech["role"] == "tecnico", f"Non-technician in results: {tech['role']}"
        print(f"✓ Technicians list returned with {len(data)} technicians")


class TestAlertsEndpoints:
    """Alerts/Notifications endpoint tests"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Login and get token for authenticated requests"""
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEST_ADMIN_EMAIL,
            "password": TEST_ADMIN_PASSWORD
        })
        self.token = login_resp.json()["access_token"]
        self.headers = {"Authorization": f"Bearer {self.token}"}
    
    def test_get_alerts(self):
        """Test getting user alerts"""
        response = requests.get(f"{BASE_URL}/api/alerts", headers=self.headers)
        assert response.status_code == 200, f"Get alerts failed: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Alerts should be a list"
        print(f"✓ Alerts list returned with {len(data)} alerts")
    
    def test_get_unread_count(self):
        """Test getting unread alert count"""
        response = requests.get(f"{BASE_URL}/api/alerts/unread-count", headers=self.headers)
        assert response.status_code == 200, f"Get unread count failed: {response.text}"
        
        data = response.json()
        assert "count" in data, "Count field missing"
        assert isinstance(data["count"], int), "Count should be integer"
        print(f"✓ Unread count returned: {data['count']}")


class TestRootEndpoint:
    """Root API endpoint test"""
    
    def test_api_root(self):
        """Test API root returns correct message"""
        response = requests.get(f"{BASE_URL}/api/")
        assert response.status_code == 200, f"API root failed: {response.text}"
        
        data = response.json()
        assert "message" in data
        assert "PolarizadosYA!" in data["message"]
        print(f"✓ API root message: {data['message']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
