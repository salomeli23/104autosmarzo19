from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, UploadFile, File, BackgroundTasks
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
import jwt
import bcrypt
from enum import Enum
import random
import string
import qrcode
import base64
from io import BytesIO

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT Configuration
JWT_SECRET = os.environ.get('JWT_SECRET', 'polarizadosya-secret-key-2024')
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

# Create the main app
app = FastAPI(title="PolarizadosYA! API")
api_router = APIRouter(prefix="/api")
security = HTTPBearer()

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ==================== ENUMS ====================
class UserRole(str, Enum):
    ADMIN = "admin"
    ASESOR = "asesor"
    COORDINADOR = "coordinador"
    TECNICO = "tecnico"
    FACTURACION = "facturacion"

class ServiceType(str, Enum):
    POLARIZADO = "polarizado"
    NANOCERAMICA = "nanoceramica"
    AUTOBAHN_BLACK = "autobahn_black"
    ULTRASECURE = "ultrasecure"

class OrderStatus(str, Enum):
    AGENDADO = "agendado"
    INGRESADO = "ingresado"
    EN_REVISION = "en_revision"
    ASIGNADO = "asignado"
    EN_PROCESO = "en_proceso"
    SERVICIO_COMPLETADO = "servicio_completado"
    TERMINADO_FALTA_PAGO = "terminado_falta_pago"
    TERMINADO_PAGADO = "terminado_pagado"
    ENTREGADO = "entregado"
    DESISTIMIENTO = "desistimiento"

class AlertType(str, Enum):
    NUEVO_INGRESO = "nuevo_ingreso"
    SERVICIO_ASIGNADO = "servicio_asignado"
    SERVICIO_COMPLETADO = "servicio_completado"
    PENDIENTE_FACTURACION = "pendiente_facturacion"
    TIEMPO_EXCEDIDO = "tiempo_excedido"
    DESISTIMIENTO = "desistimiento"

# ==================== HELPERS ====================
def generate_order_code():
    """Generate unique 8-character order code"""
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=8))

def generate_qr_code(data: str) -> str:
    """Generate QR code as base64 string"""
    qr = qrcode.QRCode(version=1, box_size=10, border=5)
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = BytesIO()
    img.save(buffer, format='PNG')
    buffer.seek(0)
    return base64.b64encode(buffer.getvalue()).decode()

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "user_id": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"id": payload["user_id"]}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=401, detail="Usuario no encontrado")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")

def require_roles(allowed_roles: List[UserRole]):
    async def role_checker(current_user: dict = Depends(get_current_user)):
        if current_user["role"] not in [r.value for r in allowed_roles]:
            raise HTTPException(status_code=403, detail="Acceso denegado")
        return current_user
    return role_checker

async def create_alert(recipient_role: str, alert_type: AlertType, title: str, message: str, order_id: str = None):
    """Create alert for users with specific role"""
    users = await db.users.find({"role": recipient_role}, {"_id": 0}).to_list(100)
    for user in users:
        alert_doc = {
            "id": str(uuid.uuid4()),
            "recipient_id": user["id"],
            "alert_type": alert_type.value,
            "title": title,
            "message": message,
            "order_id": order_id,
            "read": False,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.alerts.insert_one(alert_doc)

async def log_order_history(order_id: str, action: str, old_status: str, new_status: str, user_id: str, user_name: str, details: dict = None):
    """Log order status change for traceability"""
    history_doc = {
        "id": str(uuid.uuid4()),
        "order_id": order_id,
        "action": action,
        "old_status": old_status,
        "new_status": new_status,
        "changed_by_id": user_id,
        "changed_by_name": user_name,
        "details": details or {},
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.order_history.insert_one(history_doc)

# Valid state transitions
VALID_TRANSITIONS = {
    "agendado": ["ingresado", "desistimiento"],
    "ingresado": ["en_revision", "desistimiento"],
    "en_revision": ["asignado", "desistimiento"],
    "asignado": ["en_proceso", "desistimiento"],
    "en_proceso": ["servicio_completado", "desistimiento"],
    "servicio_completado": ["terminado_pagado", "terminado_falta_pago"],
    "terminado_pagado": ["entregado"],
    "terminado_falta_pago": ["terminado_pagado", "entregado"],
    "entregado": [],
    "desistimiento": [],
}

def validate_transition(current_status: str, new_status: str) -> bool:
    """Validate if status transition is allowed"""
    allowed = VALID_TRANSITIONS.get(current_status, [])
    return new_status in allowed

# ==================== MODELS ====================
class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: UserRole = UserRole.ASESOR
    phone: Optional[str] = None

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    role: UserRole
    phone: Optional[str] = None
    created_at: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse

# Order/Cita Models
class ServiceItem(BaseModel):
    service: ServiceType
    price: float
    description: Optional[str] = None

class OrderCreate(BaseModel):
    client_name: str
    client_phone: str
    client_email: Optional[EmailStr] = None
    client_cedula: Optional[str] = None
    plate: str
    brand: str
    model: str
    year: Optional[int] = None
    color: Optional[str] = None
    date: str
    time_slot: str
    services: List[ServiceItem]
    negotiated_value: float
    notes: Optional[str] = None

class OrderResponse(BaseModel):
    id: str
    order_code: str
    qr_code: str
    client_name: str
    client_phone: str
    client_email: Optional[str] = None
    client_cedula: Optional[str] = None
    plate: str
    brand: str
    model: str
    year: Optional[int] = None
    color: Optional[str] = None
    date: str
    time_slot: str
    services: List[dict]
    negotiated_value: float
    final_value: Optional[float] = None
    status: str
    notes: Optional[str] = None
    # Ingreso data
    signature_url: Optional[str] = None
    cedula_photo_url: Optional[str] = None
    client_photo_url: Optional[str] = None
    ingreso_at: Optional[str] = None
    # Revision 360 data
    inspection_photos: List[str] = []
    inspection_video_url: Optional[str] = None
    inspection_notes: Optional[str] = None
    inspection_at: Optional[str] = None
    # Assignment data
    assigned_technician_id: Optional[str] = None
    assigned_technician_name: Optional[str] = None
    service_time_minutes: Optional[int] = None
    assigned_at: Optional[str] = None
    # Service data
    service_started_at: Optional[str] = None
    service_completed_at: Optional[str] = None
    technician_notes: Optional[str] = None
    # Facturacion data
    payment_method: Optional[str] = None
    payment_reference: Optional[str] = None
    discount_code: Optional[str] = None
    discount_amount: Optional[float] = None
    paid_at: Optional[str] = None
    # Entrega data
    delivery_photo_url: Optional[str] = None
    delivered_at: Optional[str] = None
    # Metadata
    created_by: str
    created_at: str
    updated_at: Optional[str] = None

class CheckInRequest(BaseModel):
    order_code: str

class IngresoApproval(BaseModel):
    order_id: str
    services: List[ServiceItem]
    final_value: float
    signature_url: str
    cedula_number: str
    cedula_photo_url: str
    client_photo_url: Optional[str] = None

class InspectionData(BaseModel):
    order_id: str
    photos: List[str]
    video_url: Optional[str] = None
    notes: Optional[str] = None

class AssignTechnician(BaseModel):
    order_id: str
    technician_id: str
    service_time_minutes: int

class TechnicianReport(BaseModel):
    order_id: str
    notes: str

class PaymentApproval(BaseModel):
    order_id: str
    payment_method: str
    payment_reference: Optional[str] = None
    discount_code: Optional[str] = None
    discount_amount: Optional[float] = None

class DeliveryConfirmation(BaseModel):
    order_id: str
    delivery_photo_url: str

class AlertResponse(BaseModel):
    id: str
    alert_type: str
    title: str
    message: str
    order_id: Optional[str] = None
    read: bool
    created_at: str

# ==================== AUTH ENDPOINTS ====================
@api_router.post("/auth/register", response_model=TokenResponse)
async def register(user_data: UserCreate):
    existing = await db.users.find_one({"email": user_data.email})
    if existing:
        raise HTTPException(status_code=400, detail="El email ya está registrado")
    
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "email": user_data.email,
        "password": hash_password(user_data.password),
        "name": user_data.name,
        "role": user_data.role.value,
        "phone": user_data.phone,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user_doc)
    
    token = create_token(user_id, user_data.email, user_data.role.value)
    return TokenResponse(
        access_token=token,
        user=UserResponse(
            id=user_id, email=user_data.email, name=user_data.name,
            role=user_data.role, phone=user_data.phone, created_at=user_doc["created_at"]
        )
    )

@api_router.post("/auth/login", response_model=TokenResponse)
async def login(credentials: UserLogin):
    user = await db.users.find_one({"email": credentials.email}, {"_id": 0})
    if not user or not verify_password(credentials.password, user["password"]):
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
    
    token = create_token(user["id"], user["email"], user["role"])
    return TokenResponse(
        access_token=token,
        user=UserResponse(
            id=user["id"], email=user["email"], name=user["name"],
            role=UserRole(user["role"]), phone=user.get("phone"), created_at=user["created_at"]
        )
    )

@api_router.get("/auth/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_user)):
    return UserResponse(
        id=current_user["id"], email=current_user["email"], name=current_user["name"],
        role=UserRole(current_user["role"]), phone=current_user.get("phone"), created_at=current_user["created_at"]
    )

# ==================== USERS ENDPOINTS ====================
@api_router.get("/users", response_model=List[UserResponse])
async def get_users(role: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if role:
        query["role"] = role
    users = await db.users.find(query, {"_id": 0, "password": 0}).to_list(1000)
    return [UserResponse(
        id=u["id"], email=u["email"], name=u["name"],
        role=UserRole(u["role"]), phone=u.get("phone"), created_at=u["created_at"]
    ) for u in users]

@api_router.get("/users/technicians", response_model=List[UserResponse])
async def get_technicians(current_user: dict = Depends(get_current_user)):
    users = await db.users.find({"role": "tecnico"}, {"_id": 0, "password": 0}).to_list(1000)
    return [UserResponse(
        id=u["id"], email=u["email"], name=u["name"],
        role=UserRole(u["role"]), phone=u.get("phone"), created_at=u["created_at"]
    ) for u in users]

# ==================== ORDERS ENDPOINTS ====================
@api_router.post("/orders", response_model=OrderResponse)
async def create_order(order: OrderCreate, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ASESOR]))):
    """Step 1: Create new appointment - Status: AGENDADO"""
    order_id = str(uuid.uuid4())
    order_code = generate_order_code()
    qr_code = generate_qr_code(order_code)
    
    order_doc = {
        "id": order_id,
        "order_code": order_code,
        "qr_code": qr_code,
        "client_name": order.client_name,
        "client_phone": order.client_phone,
        "client_email": order.client_email,
        "client_cedula": order.client_cedula,
        "plate": order.plate.upper(),
        "brand": order.brand,
        "model": order.model,
        "year": order.year,
        "color": order.color,
        "date": order.date,
        "time_slot": order.time_slot,
        "services": [s.model_dump() for s in order.services],
        "negotiated_value": order.negotiated_value,
        "final_value": None,
        "status": OrderStatus.AGENDADO.value,
        "notes": order.notes,
        # Empty fields for later steps
        "signature_url": None,
        "cedula_photo_url": None,
        "client_photo_url": None,
        "ingreso_at": None,
        "inspection_photos": [],
        "inspection_video_url": None,
        "inspection_notes": None,
        "inspection_at": None,
        "assigned_technician_id": None,
        "assigned_technician_name": None,
        "service_time_minutes": None,
        "assigned_at": None,
        "service_started_at": None,
        "service_completed_at": None,
        "technician_notes": None,
        "payment_method": None,
        "payment_reference": None,
        "discount_code": None,
        "discount_amount": None,
        "paid_at": None,
        "delivery_photo_url": None,
        "delivered_at": None,
        "created_by": current_user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": None
    }
    await db.orders.insert_one(order_doc)
    
    return OrderResponse(**{k: v for k, v in order_doc.items() if k != "_id"})

@api_router.get("/orders", response_model=List[OrderResponse])
async def get_orders(status: Optional[str] = None, date: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    query = {}
    if status:
        query["status"] = status
    if date:
        query["date"] = date
    
    # Technicians only see their assigned orders
    if current_user["role"] == "tecnico":
        query["assigned_technician_id"] = current_user["id"]
    
    orders = await db.orders.find(query, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return [OrderResponse(**o) for o in orders]

@api_router.get("/orders/{order_id}", response_model=OrderResponse)
async def get_order(order_id: str, current_user: dict = Depends(get_current_user)):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    return OrderResponse(**order)

@api_router.get("/orders/code/{order_code}", response_model=OrderResponse)
async def get_order_by_code(order_code: str, current_user: dict = Depends(get_current_user)):
    """Get order by QR code or order code for check-in"""
    order = await db.orders.find_one({"order_code": order_code.upper()}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    return OrderResponse(**order)

# Step 2: Ingreso - Check-in and approval
@api_router.post("/orders/checkin")
async def checkin_order(data: CheckInRequest, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ASESOR]))):
    """Check-in with QR code or order code"""
    order = await db.orders.find_one({"order_code": data.order_code.upper()}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order["status"] != OrderStatus.AGENDADO.value:
        raise HTTPException(status_code=400, detail=f"La orden no está en estado agendado. Estado actual: {order['status']}")
    return OrderResponse(**order)

@api_router.post("/orders/ingreso-approval")
async def approve_ingreso(data: IngresoApproval, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ASESOR]))):
    """Step 2: Approve ingreso with signature, cedula and photo - Status: INGRESADO"""
    order = await db.orders.find_one({"id": data.order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order["status"] != OrderStatus.AGENDADO.value:
        raise HTTPException(status_code=400, detail="La orden debe estar en estado AGENDADO")
    
    # Validate required fields
    if not data.signature_url:
        raise HTTPException(status_code=400, detail="La firma digital es requerida")
    if not data.cedula_number:
        raise HTTPException(status_code=400, detail="El número de cédula es requerido")
    
    update_data = {
        "services": [s.model_dump() for s in data.services],
        "final_value": data.final_value,
        "signature_url": data.signature_url,
        "client_cedula": data.cedula_number,
        "cedula_photo_url": data.cedula_photo_url,
        "client_photo_url": data.client_photo_url,
        "status": OrderStatus.INGRESADO.value,
        "ingreso_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.orders.update_one({"id": data.order_id}, {"$set": update_data})
    
    # Log history
    await log_order_history(
        data.order_id, "INGRESO_APROBADO", 
        OrderStatus.AGENDADO.value, OrderStatus.INGRESADO.value,
        current_user["id"], current_user["name"],
        {"final_value": data.final_value, "services_count": len(data.services)}
    )
    
    # Alert coordinators
    await create_alert(
        "coordinador", AlertType.NUEVO_INGRESO,
        "Nuevo vehículo ingresado",
        f"Vehículo {order['plate']} - {order['client_name']} listo para asignación",
        data.order_id
    )
    
    return {"message": "Ingreso aprobado exitosamente"}

# Step 3: Inspection 360
@api_router.post("/orders/inspection")
async def save_inspection(data: InspectionData, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ASESOR]))):
    """Step 3: Save inspection data - Status: EN_REVISION"""
    order = await db.orders.find_one({"id": data.order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order["status"] != OrderStatus.INGRESADO.value:
        raise HTTPException(status_code=400, detail="La orden debe estar en estado INGRESADO")
    
    update_data = {
        "inspection_photos": data.photos,
        "inspection_video_url": data.video_url,
        "inspection_notes": data.notes,
        "status": OrderStatus.EN_REVISION.value,
        "inspection_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.orders.update_one({"id": data.order_id}, {"$set": update_data})
    
    # Log history
    await log_order_history(
        data.order_id, "INSPECCION_COMPLETADA",
        OrderStatus.INGRESADO.value, OrderStatus.EN_REVISION.value,
        current_user["id"], current_user["name"],
        {"photos_count": len(data.photos), "has_video": bool(data.video_url)}
    )
    
    # Alert coordinators for assignment
    await create_alert(
        "coordinador", AlertType.NUEVO_INGRESO,
        "Vehículo listo para asignación",
        f"Inspección 360° completada para {order['plate']}",
        data.order_id
    )
    
    return {"message": "Inspección guardada exitosamente"}

# Step 4: Assignment (Coordinator)
@api_router.post("/orders/assign")
async def assign_technician(data: AssignTechnician, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.COORDINADOR]))):
    """Step 4: Assign technician with service time - Status: ASIGNADO"""
    order = await db.orders.find_one({"id": data.order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order["status"] != OrderStatus.EN_REVISION.value:
        raise HTTPException(status_code=400, detail="La orden debe estar en estado EN_REVISION")
    
    technician = await db.users.find_one({"id": data.technician_id, "role": "tecnico"}, {"_id": 0})
    if not technician:
        raise HTTPException(status_code=404, detail="Técnico no encontrado")
    
    update_data = {
        "assigned_technician_id": data.technician_id,
        "assigned_technician_name": technician["name"],
        "service_time_minutes": data.service_time_minutes,
        "status": OrderStatus.ASIGNADO.value,
        "assigned_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.orders.update_one({"id": data.order_id}, {"$set": update_data})
    
    # Log history
    await log_order_history(
        data.order_id, "TECNICO_ASIGNADO",
        OrderStatus.EN_REVISION.value, OrderStatus.ASIGNADO.value,
        current_user["id"], current_user["name"],
        {"technician_name": technician["name"], "service_time_minutes": data.service_time_minutes}
    )
    
    # Alert technician
    alert_doc = {
        "id": str(uuid.uuid4()),
        "recipient_id": data.technician_id,
        "alert_type": AlertType.SERVICIO_ASIGNADO.value,
        "title": "Nuevo servicio asignado",
        "message": f"Vehículo {order['plate']} - Tiempo estimado: {data.service_time_minutes} min",
        "order_id": data.order_id,
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.alerts.insert_one(alert_doc)
    
    return {"message": "Técnico asignado exitosamente"}

# Step 5: Start service (Technician)
@api_router.post("/orders/{order_id}/start-service")
async def start_service(order_id: str, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.TECNICO]))):
    """Technician starts working - Status: EN_PROCESO"""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order["status"] != OrderStatus.ASIGNADO.value:
        raise HTTPException(status_code=400, detail="La orden debe estar en estado ASIGNADO")
    
    update_data = {
        "status": OrderStatus.EN_PROCESO.value,
        "service_started_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.orders.update_one({"id": order_id}, {"$set": update_data})
    
    # Log history
    await log_order_history(
        order_id, "SERVICIO_INICIADO",
        OrderStatus.ASIGNADO.value, OrderStatus.EN_PROCESO.value,
        current_user["id"], current_user["name"],
        {}
    )
    
    return {"message": "Servicio iniciado"}

# Step 5b: Complete service (Technician)
@api_router.post("/orders/complete-service")
async def complete_service(data: TechnicianReport, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.TECNICO]))):
    """Technician completes service - Status: SERVICIO_COMPLETADO"""
    order = await db.orders.find_one({"id": data.order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order["status"] != OrderStatus.EN_PROCESO.value:
        raise HTTPException(status_code=400, detail="La orden debe estar en estado EN_PROCESO")
    
    update_data = {
        "status": OrderStatus.SERVICIO_COMPLETADO.value,
        "service_completed_at": datetime.now(timezone.utc).isoformat(),
        "technician_notes": data.notes,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.orders.update_one({"id": data.order_id}, {"$set": update_data})
    
    # Log history
    await log_order_history(
        data.order_id, "SERVICIO_COMPLETADO",
        OrderStatus.EN_PROCESO.value, OrderStatus.SERVICIO_COMPLETADO.value,
        current_user["id"], current_user["name"],
        {"technician_notes": data.notes}
    )
    
    # Alert facturacion
    await create_alert(
        "facturacion", AlertType.PENDIENTE_FACTURACION,
        "Vehículo listo para facturación",
        f"Vehículo {order['plate']} - {order['client_name']} completó servicio",
        data.order_id
    )
    
    return {"message": "Servicio completado, enviado a facturación"}

# Step 6: Payment (Facturacion)
@api_router.post("/orders/payment")
async def process_payment(data: PaymentApproval, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.FACTURACION]))):
    """Process payment - Status: TERMINADO_PAGADO or TERMINADO_FALTA_PAGO"""
    order = await db.orders.find_one({"id": data.order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order["status"] != OrderStatus.SERVICIO_COMPLETADO.value:
        raise HTTPException(status_code=400, detail="La orden debe estar en estado SERVICIO_COMPLETADO")
    
    new_status = OrderStatus.TERMINADO_PAGADO.value if data.payment_method else OrderStatus.TERMINADO_FALTA_PAGO.value
    
    update_data = {
        "status": new_status,
        "payment_method": data.payment_method,
        "payment_reference": data.payment_reference,
        "discount_code": data.discount_code,
        "discount_amount": data.discount_amount,
        "paid_at": datetime.now(timezone.utc).isoformat() if data.payment_method else None,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.orders.update_one({"id": data.order_id}, {"$set": update_data})
    
    return {"message": "Pago procesado exitosamente"}

# Step 7: Delivery
@api_router.post("/orders/delivery")
async def confirm_delivery(data: DeliveryConfirmation, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.FACTURACION]))):
    """Confirm delivery with photo - Status: ENTREGADO"""
    order = await db.orders.find_one({"id": data.order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order["status"] not in [OrderStatus.TERMINADO_PAGADO.value, OrderStatus.TERMINADO_FALTA_PAGO.value]:
        raise HTTPException(status_code=400, detail="La orden debe estar en estado de facturación")
    
    update_data = {
        "status": OrderStatus.ENTREGADO.value,
        "delivery_photo_url": data.delivery_photo_url,
        "delivered_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.orders.update_one({"id": data.order_id}, {"$set": update_data})
    
    return {"message": "Entrega confirmada exitosamente"}

# Desistimiento (Coordinator)
@api_router.post("/orders/{order_id}/desistimiento")
async def process_desistimiento(order_id: str, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.COORDINADOR]))):
    """Client withdraws - Status: DESISTIMIENTO"""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order["status"] in [OrderStatus.ENTREGADO.value, OrderStatus.DESISTIMIENTO.value]:
        raise HTTPException(status_code=400, detail="No se puede procesar desistimiento en este estado")
    
    update_data = {
        "status": OrderStatus.DESISTIMIENTO.value,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.orders.update_one({"id": order_id}, {"$set": update_data})
    
    # Alert all relevant roles
    await create_alert("facturacion", AlertType.DESISTIMIENTO, "Desistimiento de servicio", f"Cliente {order['client_name']} desistió del servicio", order_id)
    
    return {"message": "Desistimiento procesado"}

# ==================== ALERTS ENDPOINTS ====================
@api_router.get("/alerts", response_model=List[AlertResponse])
async def get_alerts(current_user: dict = Depends(get_current_user)):
    alerts = await db.alerts.find({"recipient_id": current_user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return [AlertResponse(**a) for a in alerts]

@api_router.put("/alerts/{alert_id}/read")
async def mark_alert_read(alert_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.alerts.update_one({"id": alert_id, "recipient_id": current_user["id"]}, {"$set": {"read": True}})
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Alerta no encontrada")
    return {"message": "Alerta marcada como leída"}

@api_router.get("/alerts/unread-count")
async def get_unread_alert_count(current_user: dict = Depends(get_current_user)):
    count = await db.alerts.count_documents({"recipient_id": current_user["id"], "read": False})
    return {"count": count}

# ==================== DASHBOARD ENDPOINTS ====================
@api_router.get("/dashboard/stats")
async def get_dashboard_stats(current_user: dict = Depends(get_current_user)):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    stats = {
        "agendados": await db.orders.count_documents({"status": "agendado"}),
        "ingresados": await db.orders.count_documents({"status": "ingresado"}),
        "en_revision": await db.orders.count_documents({"status": "en_revision"}),
        "asignados": await db.orders.count_documents({"status": "asignado"}),
        "en_proceso": await db.orders.count_documents({"status": "en_proceso"}),
        "servicio_completado": await db.orders.count_documents({"status": "servicio_completado"}),
        "terminado_falta_pago": await db.orders.count_documents({"status": "terminado_falta_pago"}),
        "terminado_pagado": await db.orders.count_documents({"status": "terminado_pagado"}),
        "entregados_hoy": await db.orders.count_documents({"status": "entregado", "delivered_at": {"$regex": f"^{today}"}}),
        "citas_hoy": await db.orders.count_documents({"date": today}),
    }
    
    return stats

# ==================== SERVICES CATALOG ====================
@api_router.get("/services/catalog")
async def get_services_catalog():
    """Get available services with suggested prices"""
    catalog = [
        {"service": "polarizado", "name": "Polarizado", "suggested_price": 350000, "description": "Polarizado de vidrios"},
        {"service": "nanoceramica", "name": "Nanocerámica", "suggested_price": 800000, "description": "Recubrimiento nanocerámico"},
        {"service": "autobahn_black", "name": "Autobahn Black CE", "suggested_price": 1200000, "description": "Película Autobahn Black CE premium"},
        {"service": "ultrasecure", "name": "Ultrasecure", "suggested_price": 500000, "description": "Película de seguridad Ultrasecure"},
    ]
    return catalog

@api_router.get("/")
async def root():
    return {"message": "PolarizadosYA! API v2.0"}

# ==================== ORDER HISTORY ====================
@api_router.get("/orders/{order_id}/history")
async def get_order_history(order_id: str, current_user: dict = Depends(get_current_user)):
    """Get complete history of an order for traceability"""
    history = await db.order_history.find({"order_id": order_id}, {"_id": 0}).sort("created_at", 1).to_list(100)
    return history

# ==================== SEED DATA ====================
@api_router.post("/seed/users")
async def seed_test_users():
    """Create test users for each role (only works if users don't exist)"""
    test_users = [
        {"email": "admin@polarizadosya.com", "name": "Admin PolarizadosYA", "role": "admin", "password": "admin123"},
        {"email": "asesor@polarizadosya.com", "name": "Carlos Asesor", "role": "asesor", "password": "asesor123"},
        {"email": "coordinador@polarizadosya.com", "name": "Maria Coordinadora", "role": "coordinador", "password": "coord123"},
        {"email": "tecnico@polarizadosya.com", "name": "Juan Técnico", "role": "tecnico", "password": "tecnico123"},
        {"email": "tecnico2@polarizadosya.com", "name": "Pedro Técnico", "role": "tecnico", "password": "tecnico123"},
        {"email": "facturacion@polarizadosya.com", "name": "Ana Facturación", "role": "facturacion", "password": "factura123"},
    ]
    
    created = []
    for user_data in test_users:
        existing = await db.users.find_one({"email": user_data["email"]})
        if not existing:
            user_doc = {
                "id": str(uuid.uuid4()),
                "email": user_data["email"],
                "password": hash_password(user_data["password"]),
                "name": user_data["name"],
                "role": user_data["role"],
                "phone": None,
                "created_at": datetime.now(timezone.utc).isoformat()
            }
            await db.users.insert_one(user_doc)
            created.append({"email": user_data["email"], "role": user_data["role"], "password": user_data["password"]})
    
    return {"message": f"Created {len(created)} users", "users": created}

# Include router and configure CORS
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
