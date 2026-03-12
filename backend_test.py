import requests
import sys
import json
from datetime import datetime, timedelta

class PolarizadosYAAPITester:
    def __init__(self, base_url="https://service-coordinator-1.preview.emergentagent.com"):
        self.base_url = base_url
        self.api_base = f"{base_url}/api"
        self.admin_token = None
        self.asesor_token = None
        self.tecnico_token = None
        self.test_data = {}
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []

    def log_test(self, name, success, details=""):
        """Log test results"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
        else:
            print(f"❌ {name} - {details}")
            self.failed_tests.append(f"{name}: {details}")

    def make_request(self, method, endpoint, data=None, token=None, expected_status=200):
        """Make API request with proper headers"""
        url = f"{self.api_base}/{endpoint}"
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'

        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, params=data)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers)

            success = response.status_code == expected_status
            return success, response.json() if success else {}, response.status_code
        except Exception as e:
            return False, {}, str(e)

    def test_auth_endpoints(self):
        """Test authentication endpoints"""
        print("\n🔐 Testing Authentication...")
        
        # Test user registration with different roles
        timestamp = datetime.now().strftime("%H%M%S")
        
        # Register admin user
        admin_data = {
            "email": f"admin_{timestamp}@test.com",
            "password": "admin123",
            "name": "Admin Test",
            "role": "admin",
            "phone": "3001234567"
        }
        success, response, status = self.make_request('POST', 'auth/register', admin_data, expected_status=200)
        self.log_test("Admin Registration", success, f"Status: {status}")
        if success:
            self.admin_token = response.get('access_token')
            self.test_data['admin_user'] = response.get('user')

        # Register asesor user
        asesor_data = {
            "email": f"asesor_{timestamp}@test.com",
            "password": "asesor123",
            "name": "Asesor Test",
            "role": "asesor",
            "phone": "3001234568"
        }
        success, response, status = self.make_request('POST', 'auth/register', asesor_data, expected_status=200)
        self.log_test("Asesor Registration", success, f"Status: {status}")
        if success:
            self.asesor_token = response.get('access_token')
            self.test_data['asesor_user'] = response.get('user')

        # Register tecnico user
        tecnico_data = {
            "email": f"tecnico_{timestamp}@test.com",
            "password": "tecnico123",
            "name": "Tecnico Test",
            "role": "tecnico",
            "phone": "3001234569"
        }
        success, response, status = self.make_request('POST', 'auth/register', tecnico_data, expected_status=200)
        self.log_test("Tecnico Registration", success, f"Status: {status}")
        if success:
            self.tecnico_token = response.get('access_token')
            self.test_data['tecnico_user'] = response.get('user')

        # Test login with admin credentials
        login_data = {
            "email": admin_data["email"],
            "password": admin_data["password"]
        }
        success, response, status = self.make_request('POST', 'auth/login', login_data, expected_status=200)
        self.log_test("Admin Login", success, f"Status: {status}")

        # Test login with specific admin credentials from requirements
        admin_login_data = {
            "email": "admin@polarizadosya.com",
            "password": "admin123"
        }
        success, response, status = self.make_request('POST', 'auth/login', admin_login_data, expected_status=200)
        self.log_test("Specific Admin Login (admin@polarizadosya.com)", success, f"Status: {status}")
        if success:
            self.admin_token = response.get('access_token')  # Use this token for subsequent tests

        # Test /auth/me endpoint
        success, response, status = self.make_request('GET', 'auth/me', token=self.admin_token, expected_status=200)
        self.log_test("Get Current User", success, f"Status: {status}")

    def test_vehicle_endpoints(self):
        """Test vehicle management endpoints"""
        print("\n🚗 Testing Vehicle Management...")
        
        if not self.admin_token:
            print("❌ Skipping vehicle tests - no admin token")
            return

        # Create test vehicle
        vehicle_data = {
            "plate": "ABC123",
            "brand": "Toyota",
            "model": "Corolla",
            "year": 2020,
            "color": "Blanco",
            "vin": "1HGBH41JXMN109186",
            "client_name": "Juan Pérez",
            "client_phone": "3001234567",
            "client_email": "juan@test.com",
            "client_cedula": "12345678"
        }
        success, response, status = self.make_request('POST', 'vehicles', vehicle_data, self.admin_token, expected_status=200)
        self.log_test("Create Vehicle", success, f"Status: {status}")
        if success:
            self.test_data['vehicle'] = response

        # Get all vehicles
        success, response, status = self.make_request('GET', 'vehicles', token=self.admin_token, expected_status=200)
        self.log_test("Get All Vehicles", success, f"Status: {status}")

        # Get vehicle by plate
        if 'vehicle' in self.test_data:
            success, response, status = self.make_request('GET', f'vehicles/plate/{vehicle_data["plate"]}', token=self.admin_token, expected_status=200)
            self.log_test("Get Vehicle by Plate", success, f"Status: {status}")

    def test_appointment_endpoints(self):
        """Test appointment management endpoints"""
        print("\n📅 Testing Appointment Management...")
        
        if not self.asesor_token:
            print("❌ Skipping appointment tests - no asesor token")
            return

        # Create appointment
        tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        appointment_data = {
            "client_name": "María García",
            "client_phone": "3009876543",
            "client_email": "maria@test.com",
            "plate": "XYZ789",
            "brand": "Honda",
            "model": "Civic",
            "date": tomorrow,
            "time_slot": "09:00 - 10:00",
            "services": ["polarizado", "nanoceramica"],
            "notes": "Cliente prefiere polarizado oscuro"
        }
        success, response, status = self.make_request('POST', 'appointments', appointment_data, self.asesor_token, expected_status=200)
        self.log_test("Create Appointment", success, f"Status: {status}")
        if success:
            self.test_data['appointment'] = response

        # Get appointments for tomorrow
        success, response, status = self.make_request('GET', 'appointments', {'date': tomorrow}, self.asesor_token, expected_status=200)
        self.log_test("Get Appointments by Date", success, f"Status: {status}")

        # Update appointment status (FIXED: now uses JSON body)
        if 'appointment' in self.test_data:
            status_data = {"status": "en_proceso"}
            success, response, status = self.make_request('PUT', f'appointments/{self.test_data["appointment"]["id"]}/status', 
                                                        status_data, self.asesor_token, expected_status=200)
            self.log_test("Update Appointment Status (JSON body)", success, f"Status: {status}")

    def test_inspection_endpoints(self):
        """Test 360° inspection endpoints"""
        print("\n🔍 Testing 360° Inspections...")
        
        if not self.admin_token or 'vehicle' not in self.test_data:
            print("❌ Skipping inspection tests - missing requirements")
            return

        # Create inspection
        inspection_data = {
            "vehicle_id": self.test_data['vehicle']['id'],
            "items": [
                {
                    "area": "Parabrisas delantero",
                    "condition": "Bueno",
                    "notes": "Sin daños visibles",
                    "has_damage": False
                },
                {
                    "area": "Ventana lateral izquierda",
                    "condition": "Rayón menor",
                    "notes": "Rayón pequeño en esquina inferior",
                    "has_damage": True
                }
            ],
            "general_notes": "Vehículo en buen estado general",
            "photos": []
        }
        success, response, status = self.make_request('POST', 'inspections', inspection_data, self.admin_token, expected_status=200)
        self.log_test("Create 360° Inspection", success, f"Status: {status}")
        if success:
            self.test_data['inspection'] = response

        # Get inspections by vehicle
        success, response, status = self.make_request('GET', f'inspections/vehicle/{self.test_data["vehicle"]["id"]}', 
                                                    token=self.admin_token, expected_status=200)
        self.log_test("Get Vehicle Inspections", success, f"Status: {status}")

    def test_quote_endpoints(self):
        """Test quotation endpoints"""
        print("\n💰 Testing Quotations...")
        
        if not self.asesor_token or 'vehicle' not in self.test_data:
            print("❌ Skipping quote tests - missing requirements")
            return

        # Create quote
        quote_data = {
            "vehicle_id": self.test_data['vehicle']['id'],
            "client_name": "Juan Pérez",
            "client_email": "juan@test.com",
            "items": [
                {
                    "service": "polarizado",
                    "description": "Polarizado completo vehículo",
                    "price": 250000,
                    "quantity": 1
                },
                {
                    "service": "nanoceramica",
                    "description": "Aplicación nanocerámica",
                    "price": 180000,
                    "quantity": 1
                }
            ],
            "notes": "Descuento por cliente frecuente"
        }
        success, response, status = self.make_request('POST', 'quotes', quote_data, self.asesor_token, expected_status=200)
        self.log_test("Create Quote", success, f"Status: {status}")
        if success:
            self.test_data['quote'] = response

        # Get all quotes
        success, response, status = self.make_request('GET', 'quotes', token=self.asesor_token, expected_status=200)
        self.log_test("Get All Quotes", success, f"Status: {status}")

        # Approve quote
        if 'quote' in self.test_data:
            success, response, status = self.make_request('PUT', f'quotes/{self.test_data["quote"]["id"]}/approve', 
                                                        None, self.asesor_token, expected_status=200)
            self.log_test("Approve Quote", success, f"Status: {status}")

    def test_service_order_endpoints(self):
        """Test service order endpoints"""
        print("\n🔧 Testing Service Orders...")
        
        if not self.admin_token or 'vehicle' not in self.test_data:
            print("❌ Skipping service order tests - missing requirements")
            return

        # Create service order
        order_data = {
            "vehicle_id": self.test_data['vehicle']['id'],
            "services": ["polarizado", "nanoceramica"],
            "assigned_technician_id": self.test_data.get('tecnico_user', {}).get('id'),
            "estimated_hours": 4.0,
            "notes": "Prioridad alta - cliente VIP"
        }
        success, response, status = self.make_request('POST', 'service-orders', order_data, self.admin_token, expected_status=200)
        self.log_test("Create Service Order", success, f"Status: {status}")
        if success:
            self.test_data['service_order'] = response

        # Get all service orders
        success, response, status = self.make_request('GET', 'service-orders', token=self.admin_token, expected_status=200)
        self.log_test("Get All Service Orders", success, f"Status: {status}")

        # Update service order status (FIXED: now uses JSON body)
        if 'service_order' in self.test_data:
            status_data = {"status": "en_proceso"}
            success, response, status = self.make_request('PUT', f'service-orders/{self.test_data["service_order"]["id"]}/status', 
                                                        status_data, self.admin_token, expected_status=200)
            self.log_test("Update Service Order Status (JSON body)", success, f"Status: {status}")

        # Assign technician (FIXED: now uses JSON body)
        if 'service_order' in self.test_data and 'tecnico_user' in self.test_data:
            assign_data = {"technician_id": self.test_data['tecnico_user']['id']}
            success, response, status = self.make_request('PUT', f'service-orders/{self.test_data["service_order"]["id"]}/assign', 
                                                        assign_data, self.admin_token, expected_status=200)
            self.log_test("Assign Technician (JSON body)", success, f"Status: {status}")

    def test_notification_endpoints(self):
        """Test notification endpoints"""
        print("\n🔔 Testing Notifications...")
        
        if not self.tecnico_token:
            print("❌ Skipping notification tests - no tecnico token")
            return

        # Get notifications for tecnico (should have notifications from service order assignment)
        success, response, status = self.make_request('GET', 'notifications', token=self.tecnico_token, expected_status=200)
        self.log_test("Get Notifications", success, f"Status: {status}")

        # Get unread count
        success, response, status = self.make_request('GET', 'notifications/unread-count', token=self.tecnico_token, expected_status=200)
        self.log_test("Get Unread Count", success, f"Status: {status}")

    def test_dashboard_endpoints(self):
        """Test dashboard endpoints"""
        print("\n📊 Testing Dashboard...")
        
        if not self.admin_token:
            print("❌ Skipping dashboard tests - no admin token")
            return

        # Get dashboard stats
        success, response, status = self.make_request('GET', 'dashboard/stats', token=self.admin_token, expected_status=200)
        self.log_test("Get Dashboard Stats", success, f"Status: {status}")

    def test_user_management(self):
        """Test user management endpoints"""
        print("\n👥 Testing User Management...")
        
        if not self.admin_token:
            print("❌ Skipping user management tests - no admin token")
            return

        # Get all users (admin only)
        success, response, status = self.make_request('GET', 'users', token=self.admin_token, expected_status=200)
        self.log_test("Get All Users (Admin)", success, f"Status: {status}")

        # Get technicians
        success, response, status = self.make_request('GET', 'users/technicians', token=self.admin_token, expected_status=200)
        self.log_test("Get Technicians", success, f"Status: {status}")

        # Test role-based access - asesor should NOT access users endpoint
        success, response, status = self.make_request('GET', 'users', token=self.asesor_token, expected_status=403)
        self.log_test("Role-based Access Control (Asesor blocked from users)", success, f"Status: {status}")

    def test_api_root(self):
        """Test API root endpoint"""
        print("\n🏠 Testing API Root...")
        
        success, response, status = self.make_request('GET', '', expected_status=200)
        self.log_test("API Root Endpoint", success, f"Status: {status}")

    def run_all_tests(self):
        """Run all API tests"""
        print("🚀 Starting PolarizadosYA! API Tests...")
        print(f"🌐 Testing against: {self.base_url}")
        
        # Test API availability first
        self.test_api_root()
        
        # Core functionality tests
        self.test_auth_endpoints()
        self.test_user_management()
        self.test_vehicle_endpoints()
        self.test_appointment_endpoints()
        self.test_inspection_endpoints()
        self.test_quote_endpoints()
        self.test_service_order_endpoints()
        self.test_notification_endpoints()
        self.test_dashboard_endpoints()
        
        # Print summary
        print(f"\n📊 Test Summary:")
        print(f"✅ Passed: {self.tests_passed}/{self.tests_run}")
        print(f"❌ Failed: {len(self.failed_tests)}")
        
        if self.failed_tests:
            print(f"\n❌ Failed Tests:")
            for failure in self.failed_tests:
                print(f"  - {failure}")
        
        return len(self.failed_tests) == 0

def main():
    tester = PolarizadosYAAPITester()
    success = tester.run_all_tests()
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())