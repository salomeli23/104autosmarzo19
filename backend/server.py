from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, UploadFile, File, BackgroundTasks
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
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
import asyncio
import resend
import re
from pdf_utils import build_ingreso_receipt, build_payment_statement, build_mock_invoice
from cutting_catalog import CAR_AVERAGES, MATERIALS_CATALOG, ROLLS_LIST, lookup_car_average
from email_templates import (
    build_appointment_confirmation_html,
    build_ingreso_html,
    build_invoice_html,
    qr_attachment,
)

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

# Resend Configuration
RESEND_API_KEY = os.environ.get('RESEND_API_KEY', '')
SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'onboarding@resend.dev')
if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY

# Create the main app
app = FastAPI(title="Polarizados Manager API")
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
    CORTE = "corte"  # Nuevo rol para corte de piezas

class ServiceType(str, Enum):
    POLARIZADO = "polarizado"
    NANOCERAMICA = "nanoceramica"
    AUTOBAHN_BLACK = "autobahn_black"
    ULTRASECURE = "ultrasecure"

class OrderStatus(str, Enum):
    AGENDADO = "agendado"
    INGRESADO = "ingresado"
    EN_CORTE = "en_corte"  # Nuevo estado para corte de piezas
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
    NUEVO_CORTE = "nuevo_corte"  # Alerta para área de corte
    CORTE_COMPLETADO = "corte_completado"  # Corte terminado
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
    sede_id: Optional[str] = None
    sede_nombre: Optional[str] = None
    tecnico_roles: List[str] = []  # roles funcionales del técnico
    created_at: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse

# Order/Cita Models
class ServiceItem(BaseModel):
    service: str  # Ahora acepta cualquier servicio del catálogo
    price: float
    description: Optional[str] = None
    parts: Optional[List[str]] = None  # Partes del vehículo para polarizado (panoramico, luneta, etc.)
    part_percentages: Optional[Dict[str, str]] = None  # {part_id: '35%', ...} para polarizado/ultrasecure
    # PPF-specific (Full o Partes)
    ppf_scope: Optional[str] = None  # 'full' | 'partes'
    ppf_parts_description: Optional[str] = None  # texto libre describiendo las partes
    # Extras aplicados a este servicio (id de service_extras y precio congelado al momento)
    extras: Optional[List[Dict[str, Any]]] = None  # [{id, nombre, price}]

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
    confirmation_pin: Optional[str] = None
    # Cita por prioridad (sin validar franja)
    is_priority: Optional[bool] = False
    authorization_code: Optional[str] = None
    priority_reason: Optional[str] = None
    # Postventa / Garantía
    is_postventa: Optional[bool] = False
    postventa_type: Optional[str] = None  # 'garantia' | 'postventa'
    postventa_motivo: Optional[str] = None
    original_order_id: Optional[str] = None

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
    scheduled_time: Optional[str] = None  # Hora específica de la cita (HH:MM)
    services: List[dict]
    negotiated_value: float
    final_value: Optional[float] = None
    status: str
    notes: Optional[str] = None
    # Ingreso data
    signature_url: Optional[str] = None
    risk_agreement_accepted: bool = False
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
    service_completion_notes: Optional[str] = None
    service_completion_photos: List[str] = []
    # Facturacion data
    payment_method: Optional[str] = None
    payment_reference: Optional[str] = None
    discount_code: Optional[str] = None
    discount_amount: Optional[float] = None
    paid_at: Optional[str] = None
    # Entrega data
    delivery_photo_url: Optional[str] = None
    delivered_at: Optional[str] = None
    # Cutting data
    cutting_status: Optional[str] = None
    cutting_started_at: Optional[str] = None
    cutting_completed_at: Optional[str] = None
    cutting_measurements: Optional[str] = None
    cutting_notes: Optional[str] = None
    cutting_part_measurements: Optional[Dict[str, str]] = None  # {part_id: "120x60 cm"}
    cutting_part_materials: Optional[Dict[str, Dict[str, Any]]] = None  # {part_id: {tipo_rollo, inventory_item_id}}
    ppf_vehicle_serial: Optional[str] = None
    ppf_vehicle_model: Optional[str] = None
    # Bahia data
    bahia_id: Optional[str] = None
    bahia_name: Optional[str] = None
    # Vehicle profile photo (taken at check-in)
    profile_photo_url: Optional[str] = None
    payment_method: Optional[str] = None
    requires_invoice: Optional[bool] = None
    # Pre-assignment (Autos por Asignar): técnico asignado antes de corte
    pre_assigned_technician_id: Optional[str] = None
    pre_assigned_technician_name: Optional[str] = None
    pre_assigned_at: Optional[str] = None
    # Route slots (Hoja de Ruta)
    route_slots: Optional[List[Dict[str, Any]]] = None
    route_rule_id: Optional[str] = None
    route_rule_name: Optional[str] = None
    amount_paid: Optional[float] = None  # facturación acumulada
    # Cita por prioridad
    is_priority: Optional[bool] = False
    priority_reason: Optional[str] = None
    # Postventa / Garantía
    is_postventa: Optional[bool] = False
    postventa_type: Optional[str] = None  # 'garantia' | 'postventa'
    postventa_motivo: Optional[str] = None
    original_order_id: Optional[str] = None
    # Metadata
    created_by: str
    created_by_name: Optional[str] = None
    created_by_role: Optional[str] = None
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
    risk_agreement_accepted: bool = False
    profile_photo_url: Optional[str] = None  # foto frontal del vehículo (requerida en /checkin)
    payment_method: Optional[str] = None  # 'efectivo' | 'tarjeta' | 'transferencia'
    requires_invoice: bool = False  # si True, se añadió IVA 19%

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
    completion_photos: Optional[List[str]] = None  # base64 data URLs, max 10

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

class NotificationRequest(BaseModel):
    order_id: str
    send_whatsapp: bool = False
    send_email: bool = False
    phone: Optional[str] = None
    email: Optional[EmailStr] = None

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
        role=UserRole(u["role"]), phone=u.get("phone"),
        sede_id=u.get("sede_id"), sede_nombre=u.get("sede_nombre"),
        tecnico_roles=u.get("tecnico_roles") or [],
        created_at=u["created_at"]
    ) for u in users]

@api_router.get("/users/technicians", response_model=List[UserResponse])
async def get_technicians(current_user: dict = Depends(get_current_user)):
    users = await db.users.find({"role": "tecnico"}, {"_id": 0, "password": 0}).to_list(1000)
    return [UserResponse(
        id=u["id"], email=u["email"], name=u["name"],
        role=UserRole(u["role"]), phone=u.get("phone"),
        sede_id=u.get("sede_id"), sede_nombre=u.get("sede_nombre"),
        tecnico_roles=u.get("tecnico_roles") or [],
        created_at=u["created_at"]
    ) for u in users]


# ==================== SEDES (Sucursales) ====================
class Sede(BaseModel):
    nombre: str
    direccion: Optional[str] = None
    telefono: Optional[str] = None

@api_router.get("/sedes")
async def list_sedes(current_user: dict = Depends(get_current_user)):
    items = await db.sedes.find({}, {"_id": 0}).sort("nombre", 1).to_list(500)
    return items

@api_router.post("/sedes")
async def create_sede(data: Sede, current_user: dict = Depends(require_roles([UserRole.ADMIN]))):
    if not data.nombre.strip():
        raise HTTPException(status_code=400, detail="El nombre es requerido")
    doc = {
        "id": str(uuid.uuid4()),
        "nombre": data.nombre.strip(),
        "direccion": data.direccion,
        "telefono": data.telefono,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.sedes.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.put("/sedes/{sede_id}")
async def update_sede(sede_id: str, data: Sede, current_user: dict = Depends(require_roles([UserRole.ADMIN]))):
    update = {"nombre": data.nombre.strip(), "direccion": data.direccion, "telefono": data.telefono}
    res = await db.sedes.update_one({"id": sede_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Sede no encontrada")
    return {"message": "Sede actualizada"}

@api_router.delete("/sedes/{sede_id}")
async def delete_sede(sede_id: str, current_user: dict = Depends(require_roles([UserRole.ADMIN]))):
    res = await db.sedes.delete_one({"id": sede_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Sede no encontrada")
    return {"message": "Sede eliminada"}


# ==================== CAR SERIES (Consejo de Corte) ====================
class CarSeries(BaseModel):
    brand: str
    model: str
    version: Optional[str] = None
    # {part_id: medida_cm}
    part_measurements: Dict[str, float] = {}
    notes: Optional[str] = None

@api_router.get("/car-series")
async def list_car_series(current_user: dict = Depends(get_current_user)):
    items = await db.car_series.find({}, {"_id": 0}).sort([("brand", 1), ("model", 1)]).to_list(1000)
    return items

@api_router.post("/car-series")
async def create_car_series(data: CarSeries, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.CORTE]))):
    if not data.brand.strip() or not data.model.strip():
        raise HTTPException(status_code=400, detail="Marca y modelo son requeridos")
    doc = {
        "id": str(uuid.uuid4()),
        "brand": data.brand.strip(),
        "model": data.model.strip(),
        "version": (data.version or "").strip() or None,
        "part_measurements": data.part_measurements or {},
        "notes": data.notes,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.car_series.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.put("/car-series/{series_id}")
async def update_car_series(series_id: str, data: CarSeries, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.CORTE]))):
    update = {
        "brand": data.brand.strip(),
        "model": data.model.strip(),
        "version": (data.version or "").strip() or None,
        "part_measurements": data.part_measurements or {},
        "notes": data.notes,
    }
    res = await db.car_series.update_one({"id": series_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Serie no encontrada")
    return {"message": "Serie actualizada"}

@api_router.delete("/car-series/{series_id}")
async def delete_car_series(series_id: str, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.CORTE]))):
    res = await db.car_series.delete_one({"id": series_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Serie no encontrada")
    return {"message": "Serie eliminada"}

@api_router.get("/car-series/suggest")
async def suggest_car_series(brand: Optional[str] = None, model: Optional[str] = None, current_user: dict = Depends(get_current_user)):
    """Auto-sugerencia: devuelve series que coinciden con brand+model (case-insensitive, contains)."""
    query = {}
    if brand:
        query["brand"] = {"$regex": re.escape(brand.strip()), "$options": "i"}
    if model:
        query["model"] = {"$regex": re.escape(model.strip()), "$options": "i"}
    items = await db.car_series.find(query, {"_id": 0}).limit(20).to_list(20)
    return items


# ==================== SERVICE EXTRAS (Sunroof y otros) ====================
class ServiceExtra(BaseModel):
    nombre: str
    price: float
    trigger_part: Optional[str] = None  # id de VEHICLE_PARTS que activa el extra (ej. 'sunroof')
    active: bool = True

@api_router.get("/service-extras")
async def list_service_extras(current_user: dict = Depends(get_current_user)):
    items = await db.service_extras.find({}, {"_id": 0}).sort("nombre", 1).to_list(100)
    return items

@api_router.post("/service-extras")
async def create_service_extra(data: ServiceExtra, current_user: dict = Depends(require_roles([UserRole.ADMIN]))):
    if not data.nombre.strip():
        raise HTTPException(status_code=400, detail="Nombre requerido")
    doc = {
        "id": str(uuid.uuid4()),
        "nombre": data.nombre.strip(),
        "price": float(data.price),
        "trigger_part": data.trigger_part,
        "active": bool(data.active),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.service_extras.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.put("/service-extras/{extra_id}")
async def update_service_extra(extra_id: str, data: ServiceExtra, current_user: dict = Depends(require_roles([UserRole.ADMIN]))):
    update = {"nombre": data.nombre.strip(), "price": float(data.price), "trigger_part": data.trigger_part, "active": bool(data.active)}
    res = await db.service_extras.update_one({"id": extra_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Extra no encontrado")
    return {"message": "Extra actualizado"}

@api_router.delete("/service-extras/{extra_id}")
async def delete_service_extra(extra_id: str, current_user: dict = Depends(require_roles([UserRole.ADMIN]))):
    res = await db.service_extras.delete_one({"id": extra_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Extra no encontrado")
    return {"message": "Extra eliminado"}


# ==================== SERVICE ROUTES (Hoja de Ruta - reglas de asignación) ====================
# Cada regla define: qué combinación de servicios la dispara y cuántos técnicos por rol necesita.
class RouteSlotDef(BaseModel):
    role: str  # 'lavado' | 'ceramico' | 'polarizado' | 'ppf' | 'accesorios' | 'latoneria_pintura' | 'detailing' | otro custom
    count: int = 1
    label: Optional[str] = None  # etiqueta opcional para el slot

class ServiceRoute(BaseModel):
    nombre: str  # p.ej. "Ultrasecure + Polarizado"
    service_triggers: List[str] = []  # ids/nombres de servicios que deben estar todos presentes para activar
    slots: List[RouteSlotDef] = []
    active: bool = True

@api_router.get("/service-routes")
async def list_service_routes(current_user: dict = Depends(get_current_user)):
    items = await db.service_routes.find({}, {"_id": 0}).sort("nombre", 1).to_list(200)
    return items

@api_router.post("/service-routes")
async def create_service_route(data: ServiceRoute, current_user: dict = Depends(require_roles([UserRole.ADMIN]))):
    if not data.nombre.strip():
        raise HTTPException(status_code=400, detail="Nombre requerido")
    doc = {
        "id": str(uuid.uuid4()),
        "nombre": data.nombre.strip(),
        "service_triggers": [s.strip() for s in data.service_triggers if s.strip()],
        "slots": [s.model_dump() for s in data.slots],
        "active": bool(data.active),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.service_routes.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.put("/service-routes/{route_id}")
async def update_service_route(route_id: str, data: ServiceRoute, current_user: dict = Depends(require_roles([UserRole.ADMIN]))):
    update = {
        "nombre": data.nombre.strip(),
        "service_triggers": [s.strip() for s in data.service_triggers if s.strip()],
        "slots": [s.model_dump() for s in data.slots],
        "active": bool(data.active),
    }
    res = await db.service_routes.update_one({"id": route_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Regla no encontrada")
    return {"message": "Regla actualizada"}

@api_router.delete("/service-routes/{route_id}")
async def delete_service_route(route_id: str, current_user: dict = Depends(require_roles([UserRole.ADMIN]))):
    res = await db.service_routes.delete_one({"id": route_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Regla no encontrada")
    return {"message": "Regla eliminada"}


# ==================== ORDER ROUTE (Hoja de Ruta por Orden) ====================
def _order_service_names(order: dict) -> List[str]:
    """Colecta ids/nombres de servicios de la orden en lowercase para matching."""
    names = []
    for s in (order.get("services") or []):
        for key in ("service", "serviceId", "name", "category", "description"):
            v = s.get(key)
            if v:
                names.append(str(v).lower())
    return names

def _match_service_route(order: dict, routes: List[dict]) -> Optional[dict]:
    """Escoge la primera regla activa cuyos triggers estén TODOS presentes en los servicios de la orden.
    Prefiere reglas con más triggers (más específicas)."""
    order_names = " ".join(_order_service_names(order))
    matches = []
    for r in routes:
        if not r.get("active", True):
            continue
        trigs = [t.lower() for t in (r.get("service_triggers") or []) if t]
        if not trigs:
            continue
        if all(t in order_names for t in trigs):
            matches.append(r)
    matches.sort(key=lambda r: len(r.get("service_triggers") or []), reverse=True)
    return matches[0] if matches else None

def _payment_status(order: dict) -> str:
    """Devuelve 'paid' | 'partial' | 'pending' desde datos de facturación."""
    total = float(order.get("final_value") or order.get("negotiated_value") or 0)
    paid = float(order.get("amount_paid") or 0)
    if total <= 0:
        return "pending"
    if paid >= total - 0.01:
        return "paid"
    if paid > 0:
        return "partial"
    return "pending"

@api_router.post("/orders/{order_id}/route/init")
async def init_order_route(order_id: str, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.COORDINADOR]))):
    """Genera los slots de la hoja de ruta según la regla que empate con los servicios de la orden."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    routes = await db.service_routes.find({}, {"_id": 0}).to_list(200)
    matched = _match_service_route(order, routes)
    slots = []
    if matched:
        idx = 0
        for slot_def in matched.get("slots") or []:
            for _ in range(int(slot_def.get("count") or 1)):
                idx += 1
                slots.append({
                    "id": str(uuid.uuid4()),
                    "index": idx,
                    "role": slot_def["role"],
                    "label": slot_def.get("label") or slot_def["role"].replace("_", " ").title(),
                    "technician_id": None,
                    "technician_name": None,
                    "agencia_nombre": None,
                    "status": "pendiente",  # pendiente | en_proceso | completado
                    "started_at": None,
                    "completed_at": None,
                })
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {
            "route_slots": slots,
            "route_rule_id": matched["id"] if matched else None,
            "route_rule_name": matched["nombre"] if matched else None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }}
    )
    return {"matched_rule": matched["nombre"] if matched else None, "slots": slots}


class AssignRouteSlot(BaseModel):
    technician_id: Optional[str] = None
    technician_name: Optional[str] = None  # override manual
    agencia_nombre: Optional[str] = None  # para latonería_pintura (tercero)

@api_router.post("/orders/{order_id}/route/slots/{slot_id}/assign")
async def assign_route_slot(order_id: str, slot_id: str, data: AssignRouteSlot, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.COORDINADOR]))):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    slots = order.get("route_slots") or []
    idx = next((i for i, s in enumerate(slots) if s["id"] == slot_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Slot no encontrado")
    tech_name = data.technician_name
    if data.technician_id:
        tech = await db.users.find_one({"id": data.technician_id}, {"_id": 0})
        if not tech:
            raise HTTPException(status_code=404, detail="Técnico no encontrado")
        tech_name = tech.get("name")
        # Validación soft: warning si no tiene el rol requerido (permitir de todos modos)
    slots[idx]["technician_id"] = data.technician_id
    slots[idx]["technician_name"] = tech_name
    slots[idx]["agencia_nombre"] = data.agencia_nombre
    await db.orders.update_one({"id": order_id}, {"$set": {"route_slots": slots, "updated_at": datetime.now(timezone.utc).isoformat()}})
    return {"message": "Slot asignado", "slot": slots[idx]}


class StartRouteSlot(BaseModel):
    service_time_minutes: Optional[int] = None


class CompleteRouteSlot(BaseModel):
    notes: Optional[str] = None
    completion_photos: Optional[List[str]] = None  # base64 data URLs, max 10


@api_router.post("/orders/{order_id}/route/slots/{slot_id}/start")
async def start_route_slot(order_id: str, slot_id: str, data: Optional[StartRouteSlot] = None, current_user: dict = Depends(get_current_user)):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    slots = order.get("route_slots") or []
    idx = next((i for i, s in enumerate(slots) if s["id"] == slot_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Slot no encontrado")
    slots[idx]["status"] = "en_proceso"
    slots[idx]["started_at"] = datetime.now(timezone.utc).isoformat()
    # Persistir tiempo estimado si viene o usar el de la orden
    stm = None
    if data and data.service_time_minutes:
        stm = int(data.service_time_minutes)
    elif order.get("service_time_minutes"):
        stm = int(order["service_time_minutes"])
    if stm:
        slots[idx]["service_time_minutes"] = stm
    await db.orders.update_one({"id": order_id}, {"$set": {"route_slots": slots}})
    return {"message": "Slot iniciado", "slot": slots[idx]}


@api_router.post("/orders/{order_id}/route/slots/{slot_id}/complete")
async def complete_route_slot(order_id: str, slot_id: str, data: Optional[CompleteRouteSlot] = None, current_user: dict = Depends(get_current_user)):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    slots = order.get("route_slots") or []
    idx = next((i for i, s in enumerate(slots) if s["id"] == slot_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail="Slot no encontrado")
    slots[idx]["status"] = "completado"
    slots[idx]["completed_at"] = datetime.now(timezone.utc).isoformat()
    if data:
        if data.notes:
            slots[idx]["notes"] = data.notes
        if data.completion_photos:
            slots[idx]["completion_photos"] = data.completion_photos[:10]
    update_fields = {"route_slots": slots, "updated_at": datetime.now(timezone.utc).isoformat()}
    # Si todos completados, avanzar a "servicio_completado" (listo para Facturación)
    all_done = all(s["status"] == "completado" for s in slots) and bool(slots)
    if all_done:
        update_fields["status"] = OrderStatus.SERVICIO_COMPLETADO.value
        update_fields["service_completed_at"] = datetime.now(timezone.utc).isoformat()
    await db.orders.update_one({"id": order_id}, {"$set": update_fields})
    return {"message": "Slot completado", "all_done": all_done}


class UserRolesUpdate(BaseModel):
    tecnico_roles: List[str] = []  # ['lavado','ceramico','polarizado','ppf','accesorios','latoneria_pintura','detailing']

@api_router.put("/users/{user_id}/tecnico-roles")
async def update_user_tecnico_roles(user_id: str, data: UserRolesUpdate, current_user: dict = Depends(require_roles([UserRole.ADMIN]))):
    roles = [r.strip() for r in data.tecnico_roles if r.strip()]
    res = await db.users.update_one({"id": user_id}, {"$set": {"tecnico_roles": roles}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return {"message": "Roles actualizados", "tecnico_roles": roles}


# ==================== INVENTORY: TRANSFERIR ENTRE SEDES ====================
class TransferSede(BaseModel):
    target_sede_id: str
    reason: Optional[str] = None

@api_router.post("/inventory/{item_id}/transfer-sede")
async def transfer_inventory_sede(item_id: str, data: TransferSede, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.CORTE, UserRole.COORDINADOR]))):
    item = await db.inventory.find_one({"id": item_id}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Artículo no encontrado")
    target_sede = await db.sedes.find_one({"id": data.target_sede_id}, {"_id": 0})
    if not target_sede:
        raise HTTPException(status_code=404, detail="Sede destino no encontrada")
    prev_sede_id = item.get("sede_id")
    if prev_sede_id == data.target_sede_id:
        raise HTTPException(status_code=400, detail="El artículo ya está en esa sede")
    await db.inventory.update_one(
        {"id": item_id},
        {"$set": {"sede_id": data.target_sede_id, "sede_nombre": target_sede["nombre"], "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    await db.inventory_movements.insert_one({
        "id": str(uuid.uuid4()),
        "inventory_item_id": item_id,
        "type": "transfer_sede",
        "metros": None,
        "cantidad": None,
        "from_sede_id": prev_sede_id,
        "to_sede_id": data.target_sede_id,
        "to_sede_nombre": target_sede["nombre"],
        "reason": data.reason or "Movimiento entre sedes",
        "user_id": current_user["id"],
        "user_name": current_user.get("name") or current_user.get("email"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"message": "Artículo transferido", "to_sede": target_sede["nombre"]}


# ==================== USERS: SEDE ASSIGNMENT ====================
class UserSedeUpdate(BaseModel):
    sede_id: Optional[str] = None

@api_router.put("/users/{user_id}/sede")
async def update_user_sede(user_id: str, data: UserSedeUpdate, current_user: dict = Depends(require_roles([UserRole.ADMIN]))):
    sede_name = None
    if data.sede_id:
        sede = await db.sedes.find_one({"id": data.sede_id}, {"_id": 0})
        if not sede:
            raise HTTPException(status_code=404, detail="Sede no encontrada")
        sede_name = sede["nombre"]
    res = await db.users.update_one(
        {"id": user_id},
        {"$set": {"sede_id": data.sede_id, "sede_nombre": sede_name}}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return {"message": "Sede del usuario actualizada", "sede_nombre": sede_name}


# ==================== ORDERS ENDPOINTS ====================
@api_router.post("/orders", response_model=OrderResponse)
async def create_order(order: OrderCreate, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ASESOR]))):
    """Step 1: Create new appointment - Status: AGENDADO"""
    # Validate confirmation PIN
    settings = await db.settings.find_one({"key": "booking_pin"}, {"_id": 0})
    expected_pin = (settings or {}).get("value", "00000")

    # Cita por PRIORIDAD: requiere código de autorización dedicado (default 00000)
    if order.is_priority:
        prio_settings = await db.settings.find_one({"key": "priority_pin"}, {"_id": 0})
        expected_priority = (prio_settings or {}).get("value", "00000")
        if not order.authorization_code:
            raise HTTPException(status_code=400, detail="Código de autorización requerido para citas por prioridad")
        if str(order.authorization_code).strip() != str(expected_priority).strip():
            raise HTTPException(status_code=400, detail="Código de autorización inválido")
    else:
        if not order.confirmation_pin:
            raise HTTPException(status_code=400, detail="PIN de confirmación requerido")
        if str(order.confirmation_pin).strip() != str(expected_pin).strip():
            raise HTTPException(status_code=400, detail="PIN de confirmación incorrecto")
    
    # Block duplicate: same plate + same date (excluding desistimiento and postventa)
    # Postventa/Garantía sí permite múltiples órdenes para misma placa+fecha si fuera necesario
    plate_upper = order.plate.upper()
    if not order.is_postventa:
        existing = await db.orders.find_one({
            "plate": plate_upper,
            "date": order.date,
            "is_postventa": {"$ne": True},
            "status": {"$nin": ["desistimiento"]}
        })
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"Ya existe una cita para la placa {plate_upper} en la fecha {order.date} (código: {existing.get('order_code', 'N/A')})"
            )
    
    order_id = str(uuid.uuid4())
    order_code = generate_order_code()
    qr_code = generate_qr_code(order_code)
    
    # Cita por PRIORIDAD: se agenda con la hora actual de Colombia y se
    # habilita el check-in inmediato (no se aplica gate de scheduled_time).
    if order.is_priority:
        col_now = get_colombia_time()
        scheduled_time = col_now.strftime("%H:%M")
        effective_time_slot = order.time_slot or "prioridad"
    else:
        scheduled_time = await calculate_scheduled_time(order.date, order.time_slot)
        effective_time_slot = order.time_slot
    
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
        "time_slot": effective_time_slot,
        "scheduled_time": scheduled_time,  # Hora específica de la cita
        "is_priority": bool(order.is_priority),
        "priority_reason": order.priority_reason if order.is_priority else None,
        "services": [s.model_dump() for s in order.services],
        "negotiated_value": order.negotiated_value,
        "final_value": None,
        "status": OrderStatus.AGENDADO.value,
        "notes": order.notes,
        # Empty fields for later steps
        "signature_url": None,
        "risk_agreement_accepted": False,
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
        # Postventa
        "is_postventa": bool(order.is_postventa),
        "postventa_type": order.postventa_type if order.is_postventa else None,
        "postventa_motivo": order.postventa_motivo if order.is_postventa else None,
        "original_order_id": order.original_order_id if order.is_postventa else None,
        "created_by": current_user["id"],
        "created_by_name": current_user.get("name") or current_user.get("email"),
        "created_by_role": current_user.get("role"),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": None
    }
    await db.orders.insert_one(order_doc)
    
    return OrderResponse(**{k: v for k, v in order_doc.items() if k != "_id"})

@api_router.get("/orders", response_model=List[OrderResponse])
async def get_orders(status: Optional[str] = None, date: Optional[str] = None, current_user: dict = Depends(get_current_user)):  # noqa: F811
    query = {}
    if status:
        query["status"] = status
    if date:
        query["date"] = date
    
    # Technicians only see their assigned orders (legacy assigned_technician_id OR route_slots)
    if current_user["role"] == "tecnico":
        query["$or"] = [
            {"assigned_technician_id": current_user["id"]},
            {"route_slots.technician_id": current_user["id"]},
        ]
    
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

# ==================== NOTIFICATION ENDPOINTS ====================
def generate_appointment_email_html(order: dict) -> str:
    """Generate HTML email for appointment confirmation"""
    services_list = ""
    for svc in order.get("services", []):
        svc_name = svc.get("description", svc.get("service", "Servicio"))
        svc_price = svc.get("price", 0)
        parts = svc.get("parts", [])
        parts_text = f" ({', '.join(parts)})" if parts else ""
        services_list += f"<li>{svc_name}{parts_text} - ${svc_price:,.0f}</li>"
    
    return f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body {{ font-family: Arial, sans-serif; background-color: #1a1a2e; color: #ffffff; margin: 0; padding: 20px; }}
            .container {{ max-width: 600px; margin: 0 auto; background-color: #16213e; border-radius: 10px; padding: 30px; }}
            .header {{ text-align: center; border-bottom: 2px solid #0f3460; padding-bottom: 20px; margin-bottom: 20px; }}
            .logo {{ color: #00d9ff; font-size: 28px; font-weight: bold; }}
            .code-box {{ background: linear-gradient(135deg, #0f3460, #1a1a2e); border: 2px solid #00d9ff; border-radius: 10px; padding: 20px; text-align: center; margin: 20px 0; }}
            .order-code {{ font-size: 32px; font-family: monospace; color: #00d9ff; letter-spacing: 3px; }}
            .scheduled-time {{ font-size: 24px; color: #00d9ff; margin-top: 10px; }}
            .info-section {{ background-color: #0f3460; border-radius: 8px; padding: 15px; margin: 15px 0; }}
            .info-label {{ color: #888; font-size: 12px; text-transform: uppercase; }}
            .info-value {{ color: #fff; font-size: 16px; margin-top: 5px; }}
            .services-list {{ list-style: none; padding: 0; }}
            .services-list li {{ padding: 8px 0; border-bottom: 1px solid #0f3460; }}
            .total {{ font-size: 20px; color: #00d9ff; text-align: right; margin-top: 15px; }}
            .footer {{ text-align: center; margin-top: 30px; color: #666; font-size: 12px; }}
            .qr-note {{ background-color: #0f3460; padding: 15px; border-radius: 8px; text-align: center; margin-top: 20px; }}
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <div class="logo">Polarizados Manager</div>
                <p>Confirmación de Cita</p>
            </div>
            
            <div class="code-box">
                <div class="info-label">Código de su cita</div>
                <div class="order-code">{order.get('order_code', 'N/A')}</div>
                {f'<div class="scheduled-time">Hora: {order.get("scheduled_time", "")}</div>' if order.get('scheduled_time') else ''}
            </div>
            
            <div class="info-section">
                <div class="info-label">Cliente</div>
                <div class="info-value">{order.get('client_name', 'N/A')}</div>
            </div>
            
            <div class="info-section">
                <div class="info-label">Vehículo</div>
                <div class="info-value">{order.get('plate', 'N/A')} - {order.get('brand', '')} {order.get('model', '')}</div>
            </div>
            
            <div class="info-section">
                <div class="info-label">Fecha y Hora</div>
                <div class="info-value">{order.get('date', 'N/A')} {order.get('scheduled_time', '')}</div>
            </div>
            
            <div class="info-section">
                <div class="info-label">Servicios</div>
                <ul class="services-list">
                    {services_list}
                </ul>
                <div class="total">Total: ${order.get('negotiated_value', 0):,.0f}</div>
            </div>
            
            <div class="qr-note">
                <p>Presente este código o el QR al momento de ingresar</p>
                <p><strong>El check-in estará disponible a partir de las {order.get('scheduled_time', 'hora indicada')}</strong></p>
            </div>
            
            <div class="footer">
                <p>Polarizados Manager - Servicio de Calidad</p>
                <p>Este es un correo automático, por favor no responda</p>
            </div>
        </div>
    </body>
    </html>
    """

def generate_whatsapp_message(order: dict) -> str:
    """Generate WhatsApp message text for appointment"""
    services_text = ""
    for svc in order.get("services", []):
        svc_name = svc.get("description", svc.get("service", "Servicio"))
        parts = svc.get("parts", [])
        parts_text = f" ({', '.join(parts)})" if parts else ""
        services_text += f"• {svc_name}{parts_text}\n"
    
    message = f"""🚗 *Polarizados Manager - Confirmación de Cita*

📋 *Código de Cita:* {order.get('order_code', 'N/A')}

👤 *Cliente:* {order.get('client_name', 'N/A')}
🚙 *Vehículo:* {order.get('plate', 'N/A')} - {order.get('brand', '')} {order.get('model', '')}

📅 *Fecha:* {order.get('date', 'N/A')}
⏰ *Hora:* {order.get('scheduled_time', 'Por confirmar')}

🔧 *Servicios:*
{services_text}
💰 *Total:* ${order.get('negotiated_value', 0):,.0f}

📱 Presente este código al momento de ingresar.
✅ El check-in estará disponible a partir de las {order.get('scheduled_time', 'hora indicada')}

_Polarizados Manager - Servicio de Calidad_"""
    
    return message

@api_router.post("/notifications/send")
async def send_notification(data: NotificationRequest, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ASESOR]))):
    """Send appointment notification via WhatsApp and/or Email"""
    order = await db.orders.find_one({"id": data.order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    
    results = {"whatsapp": None, "email": None}
    
    # Generate WhatsApp link
    if data.send_whatsapp:
        phone = data.phone or order.get("client_phone", "")
        if phone:
            # Clean phone number (remove spaces, dashes, etc.)
            clean_phone = ''.join(filter(str.isdigit, phone))
            # Add Colombia country code if not present
            if not clean_phone.startswith('57') and len(clean_phone) == 10:
                clean_phone = '57' + clean_phone
            
            message = generate_whatsapp_message(order)
            # URL encode the message
            import urllib.parse
            encoded_message = urllib.parse.quote(message)
            whatsapp_url = f"https://wa.me/{clean_phone}?text={encoded_message}"
            results["whatsapp"] = {"success": True, "url": whatsapp_url}
        else:
            results["whatsapp"] = {"success": False, "error": "Número de teléfono no proporcionado"}
    
    # Send Email
    if data.send_email:
        email = data.email or order.get("client_email")
        if email and RESEND_API_KEY:
            try:
                html_content = build_appointment_confirmation_html(order, qr_cid="qr-code")
                params = {
                    "from": SENDER_EMAIL,
                    "to": [email],
                    "subject": f"¡Tu cita está confirmada! #{order.get('order_code', '')} · PolarizadosYA!",
                    "html": html_content,
                    "attachments": [qr_attachment(order.get('order_code', ''), cid="qr-code")],
                }
                email_result = await asyncio.to_thread(resend.Emails.send, params)
                results["email"] = {"success": True, "email_id": email_result.get("id"), "sent_to": email}
            except Exception as e:
                logger.error(f"Failed to send email: {str(e)}")
                results["email"] = {"success": False, "error": str(e)}
        elif not email:
            results["email"] = {"success": False, "error": "Email no proporcionado"}
        elif not RESEND_API_KEY:
            results["email"] = {"success": False, "error": "Servicio de email no configurado"}
    
    return {"message": "Notificación procesada", "results": results}

@api_router.get("/notifications/whatsapp-url/{order_id}")
async def get_whatsapp_url(order_id: str, current_user: dict = Depends(get_current_user)):
    """Get WhatsApp URL for an order"""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    
    phone = order.get("client_phone", "")
    if not phone:
        raise HTTPException(status_code=400, detail="El cliente no tiene número de teléfono")
    
    clean_phone = ''.join(filter(str.isdigit, phone))
    if not clean_phone.startswith('57') and len(clean_phone) == 10:
        clean_phone = '57' + clean_phone
    
    message = generate_whatsapp_message(order)
    import urllib.parse
    encoded_message = urllib.parse.quote(message)
    whatsapp_url = f"https://wa.me/{clean_phone}?text={encoded_message}"
    
    return {"url": whatsapp_url}

# ==================== INSPECTION PHOTO EMAIL ====================
def _compress_data_url_image(data_url: str, max_dim: int = 1280, quality: int = 70) -> Optional[bytes]:
    """Compress a base64 data URL image and return JPEG bytes.
    Returns None on any failure. Max dimension defaults to 1280px and 70% JPEG quality.
    """
    try:
        from PIL import Image
        if not data_url or "," not in data_url:
            return None
        header, b64 = data_url.split(",", 1)
        raw = base64.b64decode(b64)
        img = Image.open(BytesIO(raw))
        # Convert RGBA / P modes to RGB for JPEG
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")
        # Resize if any dim > max_dim
        w, h = img.size
        if max(w, h) > max_dim:
            ratio = max_dim / max(w, h)
            img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
        out = BytesIO()
        img.save(out, format="JPEG", quality=quality, optimize=True)
        return out.getvalue()
    except Exception as e:
        logger.warning(f"Image compression failed: {e}")
        return None


class InspectionPhotosNotification(BaseModel):
    order_id: str
    additional_recipients: Optional[List[EmailStr]] = None  # Allow asesor to add extra recipients


@api_router.post("/orders/{order_id}/send-inspection-photos")
async def send_inspection_photos(
    order_id: str,
    payload: Optional[InspectionPhotosNotification] = None,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ASESOR, UserRole.COORDINADOR]))
):
    """Send inspection 360° photos (compressed) to client + coordinators by email."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if not RESEND_API_KEY:
        raise HTTPException(status_code=500, detail="Servicio de email no configurado")
    
    photos = order.get("inspection_photos") or []
    if not photos:
        raise HTTPException(status_code=400, detail="La orden no tiene fotos de inspección")
    
    # Build recipient list
    recipients = set()
    if order.get("client_email"):
        recipients.add(order["client_email"])
    # All coordinators receive a copy
    coord_users = await db.users.find({"role": UserRole.COORDINADOR.value}, {"_id": 0, "email": 1}).to_list(50)
    for u in coord_users:
        if u.get("email"):
            recipients.add(u["email"])
    if payload and payload.additional_recipients:
        for e in payload.additional_recipients:
            recipients.add(str(e))
    
    if not recipients:
        raise HTTPException(status_code=400, detail="No hay destinatarios (cliente sin email y sin coordinadores)")
    
    # Compress photos (run in thread pool to avoid blocking event loop)
    def _compress_all():
        out = []
        for idx, p in enumerate(photos):
            data = _compress_data_url_image(p, max_dim=1280, quality=70)
            if data:
                out.append({"filename": f"foto_{idx+1:02d}.jpg", "content": list(data)})
        return out
    
    attachments = await asyncio.to_thread(_compress_all)
    if not attachments:
        raise HTTPException(status_code=500, detail="No se pudieron procesar las fotos")
    
    # Build HTML body
    services_text = ", ".join([
        (s.get("description") or s.get("service") or "Servicio") for s in (order.get("services") or [])
    ])
    html = f"""
<div style="font-family: Arial, sans-serif; max-width:600px; margin:0 auto; color:#222;">
  <div style="background:#1e1e32; color:#fff; padding:16px 20px;">
    <h2 style="margin:0;">Polarizados Manager — Revisión 360°</h2>
  </div>
  <div style="padding:20px;">
    <p>Hola,</p>
    <p>Adjuntamos las fotos del estado de ingreso del vehículo de la revisión 360°.</p>
    <table style="width:100%; border-collapse:collapse; margin:16px 0;">
      <tr><td style="padding:6px 0;"><b>Código de Orden:</b></td><td>{order.get('order_code','N/A')}</td></tr>
      <tr><td style="padding:6px 0;"><b>Cliente:</b></td><td>{order.get('client_name','N/A')}</td></tr>
      <tr><td style="padding:6px 0;"><b>Vehículo:</b></td><td>{order.get('plate','N/A')} — {order.get('brand','')} {order.get('model','')}</td></tr>
      <tr><td style="padding:6px 0;"><b>Servicios:</b></td><td>{services_text}</td></tr>
      <tr><td style="padding:6px 0;"><b>Fotos adjuntas:</b></td><td>{len(attachments)}</td></tr>
    </table>
    <p style="font-size:13px; color:#666;">Las fotos fueron comprimidas para envío por correo. Los originales en alta calidad están almacenados en el sistema.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
    <p style="font-size:12px;color:#888;">Polarizados Manager — Notificación automática</p>
  </div>
</div>
""".strip()
    
    # Prepare resend attachments (base64-encoded content)
    resend_attachments = []
    for a in attachments:
        resend_attachments.append({
            "filename": a["filename"],
            "content": base64.b64encode(bytes(a["content"])).decode("ascii"),
        })
    
    # Resend has a per-email size limit (~25-40MB). Truncate if needed.
    MAX_ATTACHMENTS = 20
    if len(resend_attachments) > MAX_ATTACHMENTS:
        resend_attachments = resend_attachments[:MAX_ATTACHMENTS]
    
    try:
        params = {
            "from": SENDER_EMAIL,
            "to": list(recipients),
            "subject": f"Revisión 360° - {order.get('plate','N/A')} - Orden #{order.get('order_code','')}",
            "html": html,
            "attachments": resend_attachments,
        }
        email_result = await asyncio.to_thread(resend.Emails.send, params)
        # Log history
        await log_order_history(
            order_id, "FOTOS_ENVIADAS_EMAIL",
            order.get("status",""), order.get("status",""),
            current_user["id"], current_user["name"],
            {"recipients": list(recipients), "photos_sent": len(resend_attachments)}
        )
        return {
            "message": "Fotos enviadas por correo",
            "recipients": list(recipients),
            "photos_sent": len(resend_attachments),
            "email_id": email_result.get("id") if isinstance(email_result, dict) else None,
        }
    except Exception as e:
        logger.error(f"Failed to send inspection photos email: {e}")
        raise HTTPException(status_code=500, detail=f"Error al enviar correo: {str(e)}")

# Step 2: Ingreso - Check-in and approval
def get_colombia_time():
    """Get current time in Colombia (UTC-5)"""
    utc_now = datetime.now(timezone.utc)
    colombia_offset = timedelta(hours=-5)
    colombia_tz = timezone(colombia_offset)
    return utc_now.astimezone(colombia_tz)

def get_slot_start_time(slot_id: str, date_str: str):
    """Get the start time of a time slot based on day and slot ID"""
    date_obj = datetime.strptime(date_str, "%Y-%m-%d")
    day_of_week = date_obj.weekday()  # 0=Monday, 6=Sunday
    
    if day_of_week == 6:  # Domingo - cerrado
        return None
    
    config = TIME_SLOTS_CONFIG["saturday"] if day_of_week == 5 else TIME_SLOTS_CONFIG["weekday"]
    
    for slot in config["slots"]:
        if slot["id"] == slot_id:
            hour, minute = map(int, slot["start"].split(":"))
            return datetime(date_obj.year, date_obj.month, date_obj.day, hour, minute, 
                          tzinfo=timezone(timedelta(hours=-5)))
    return None

def get_slot_info(slot_id: str, date_str: str):
    """Get slot configuration (start, end, capacity) based on day and slot ID"""
    date_obj = datetime.strptime(date_str, "%Y-%m-%d")
    day_of_week = date_obj.weekday()
    
    if day_of_week == 6:
        return None
    
    config = TIME_SLOTS_CONFIG["saturday"] if day_of_week == 5 else TIME_SLOTS_CONFIG["weekday"]
    
    for slot in config["slots"]:
        if slot["id"] == slot_id:
            return slot
    return None

async def calculate_scheduled_time(date_str: str, slot_id: str):
    """Calculate specific scheduled time.
    
    Rule: each booking is spaced 15 minutes from the previous one in the same slot.
    Picks the next free 15-min boundary at-or-after slot_start (and at-or-after current
    Colombia time if booking is for today). Skips minutes already used by other orders
    in the same slot.
    """
    import math
    slot_info = get_slot_info(slot_id, date_str)
    if not slot_info:
        return None
    
    # Parse slot times
    start_hour, start_min = map(int, slot_info["start"].split(":"))
    end_hour, end_min = map(int, slot_info["end"].split(":"))
    start_total_min = start_hour * 60 + start_min
    end_total_min = end_hour * 60 + end_min
    
    INTERVAL_MIN = 1  # Citas separadas de 1 en 1 minuto (modo agendamiento ágil)
    LEAD_MIN = 1      # La cita debe estar al menos 1 minuto en el futuro
    
    # Determine earliest acceptable minute (relative to day)
    earliest_min = start_total_min
    now_colombia = get_colombia_time()
    today_str = now_colombia.strftime("%Y-%m-%d")
    if date_str == today_str:
        current_total_min = now_colombia.hour * 60 + now_colombia.minute + LEAD_MIN
        if current_total_min > start_total_min:
            earliest_min = current_total_min
    
    # Get all scheduled_time values already used in this slot
    cursor = db.orders.find(
        {"date": date_str, "time_slot": slot_id, "status": {"$nin": ["desistimiento"]}},
        {"_id": 0, "scheduled_time": 1}
    )
    taken = set()
    async for o in cursor:
        st = o.get("scheduled_time")
        if not st:
            continue
        try:
            hh, mm = map(int, st.split(":"))
            taken.add(hh * 60 + mm)
        except ValueError:
            continue
    
    # Walk forward in 15-min steps starting from earliest_min until we find a free slot
    candidate = earliest_min
    safety_limit = 1000  # avoid infinite loop
    while candidate < end_total_min and safety_limit > 0:
        if candidate not in taken:
            break
        candidate += INTERVAL_MIN
        safety_limit -= 1
    
    if candidate >= end_total_min:
        # Fallback: place at end - interval (over-capacity)
        candidate = end_total_min - INTERVAL_MIN
    
    h = int(candidate // 60)
    m = int(candidate % 60)
    return f"{h:02d}:{m:02d}"

def validate_checkin_time(order_date: str, scheduled_time: str):
    """
    Validate if check-in can be performed based on scheduled time.
    Returns (can_checkin: bool, message: str, time_remaining: str or None, scheduled_time: str)
    """
    now_colombia = get_colombia_time()
    today_str = now_colombia.strftime("%Y-%m-%d")
    
    # Check if the appointment date is today
    if order_date != today_str:
        order_date_obj = datetime.strptime(order_date, "%Y-%m-%d")
        if order_date_obj.date() > now_colombia.date():
            return False, f"La cita es para el {order_date}. Debe esperar hasta ese día.", None, scheduled_time
        else:
            # Past date - allow checkin
            return True, None, None, scheduled_time
    
    if not scheduled_time:
        return True, None, None, scheduled_time
    
    # Parse scheduled time
    sched_hour, sched_min = map(int, scheduled_time.split(":"))
    scheduled_datetime = now_colombia.replace(hour=sched_hour, minute=sched_min, second=0, microsecond=0)
    
    # Check if current time is before scheduled time
    if now_colombia < scheduled_datetime:
        time_diff = scheduled_datetime - now_colombia
        total_seconds = int(time_diff.total_seconds())
        hours, remainder = divmod(total_seconds, 3600)
        minutes, seconds = divmod(remainder, 60)
        
        if hours > 0:
            time_remaining = f"{hours}h {minutes}m"
        else:
            time_remaining = f"{minutes} minutos"
        
        return False, f"Su cita es a las {scheduled_time}. Debe esperar.", time_remaining, scheduled_time
    
    return True, None, None, scheduled_time

@api_router.post("/orders/checkin")
async def checkin_order(data: CheckInRequest, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ASESOR]))):
    """Check-in with QR code, order code or plate - validates scheduled time"""
    query_value = data.order_code.strip().upper()
    
    # Try order_code first, then plate (allows asesor to look up vehicles by plate at the door)
    order = await db.orders.find_one({"order_code": query_value}, {"_id": 0})
    if not order:
        # Search by plate – try AGENDADO first to prefer valid bookings,
        # then fall back to ANY order so we can show a clear status message.
        order = await db.orders.find_one(
            {"plate": query_value, "status": OrderStatus.AGENDADO.value},
            {"_id": 0}
        )
        if not order:
            order = await db.orders.find_one(
                {"plate": query_value, "status": {"$ne": OrderStatus.DESISTIMIENTO.value}},
                {"_id": 0}
            )
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada (revisa el código o la placa)")
    if order["status"] != OrderStatus.AGENDADO.value:
        status_labels = {
            "ingresado": "Aprobada (lista para Revisión 360°)",
            "en_revision": "En Revisión 360°",
            "en_corte": "En Corte de Piezas",
            "asignado": "Asignada a Técnico",
            "en_proceso": "Servicio en proceso",
            "servicio_completado": "Servicio Completado",
            "terminado_pagado": "Pagada",
            "entregado": "Entregada",
            "desistimiento": "Desistida",
        }
        current_label = status_labels.get(order["status"], order["status"])
        raise HTTPException(
            status_code=400,
            detail={
                "type": "already_checked_in",
                "message": f"Esta orden ya está {current_label}. No se puede repetir el check-in.",
                "current_status": order["status"],
                "current_status_label": current_label,
                "plate": order.get("plate"),
                "order_code": order.get("order_code"),
                "client_name": order.get("client_name"),
            }
        )
    
    # Validate check-in time based on scheduled time.
    # Citas por PRIORIDAD se pueden ingresar inmediatamente sin importar la hora.
    if not order.get("is_priority"):
        scheduled_time = order.get("scheduled_time")
        can_checkin, message, time_remaining, sched_time = validate_checkin_time(order["date"], scheduled_time)
        if not can_checkin:
            raise HTTPException(
                status_code=400, 
                detail={
                    "type": "time_validation",
                    "message": message,
                    "time_remaining": time_remaining,
                    "scheduled_time": sched_time,
                    "slot_time": order["time_slot"],
                    "appointment_date": order["date"]
                }
            )
    
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
    if not data.risk_agreement_accepted:
        raise HTTPException(status_code=400, detail="El acuerdo de riesgo debe ser aceptado")
    if not data.profile_photo_url:
        raise HTTPException(status_code=400, detail="La foto frontal del vehículo es requerida")
    
    update_data = {
        "services": [s.model_dump() for s in data.services],
        "final_value": data.final_value,
        "signature_url": data.signature_url,
        "client_cedula": data.cedula_number,
        "risk_agreement_accepted": data.risk_agreement_accepted,
        "profile_photo_url": data.profile_photo_url,
        "payment_method": data.payment_method,
        "requires_invoice": bool(data.requires_invoice),
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
    
    # Enviar recibo de ingreso por email (PDF firmado + foto frontal) si hay correo
    email_sent = False
    if order.get("client_email"):
        try:
            order_after = await db.orders.find_one({"id": data.order_id}, {"_id": 0})
            pdf_bytes = build_ingreso_receipt(order_after)
            attachments = [_pdf_attachment(f"recibo_ingreso_{order.get('order_code')}.pdf", pdf_bytes)]
            front = order_after.get("profile_photo_url")
            front_att = _photo_attachment("foto_frontal.jpg", front) if front else None
            if front_att:
                attachments.append(front_att)
            photo_count = 1 if front_att else 0
            html = build_ingreso_html(order_after, pdf_attached=True, photo_count=photo_count)
            eid = await _send_email_with_attachments(
                order["client_email"],
                f"¡Recibo de ingreso! #{order.get('order_code')} · PolarizadosYA!",
                html, attachments,
            )
            email_sent = bool(eid)
        except Exception as e:
            logger.error(f"[ingreso-email] {e}")

    return {"message": "Ingreso aprobado exitosamente", "email_sent": email_sent}

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
    # Si no hay profile_photo_url y se subieron fotos, usar la primera como foto de perfil
    if not order.get("profile_photo_url") and data.photos:
        update_data["profile_photo_url"] = data.photos[0]
    
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

# ============================================================
# Pre-Asignación de Técnico (Autos por Asignar) — antes de Corte
# ============================================================

class PreAssignTechnician(BaseModel):
    order_id: str
    technician_id: str
    service_time_minutes: int

@api_router.get("/tech-queue/pending")
async def get_pending_tech_assignment(current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.COORDINADOR]))):
    """Listado de autos en cola para pre-asignar técnico (en_revision sin técnico)."""
    cursor = db.orders.find(
        {
            "status": {"$in": ["en_revision", "en_corte"]},
            "$or": [
                {"pre_assigned_technician_id": {"$exists": False}},
                {"pre_assigned_technician_id": None},
            ],
            "assigned_technician_id": {"$in": [None]},
        },
        {"_id": 0}
    ).sort("ingreso_at", 1)
    return [OrderResponse(**o) async for o in cursor]

@api_router.get("/tech-queue/by-technician")
async def get_orders_by_technician(current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.COORDINADOR]))):
    """Autos ya pre-asignados a cada técnico (en_revision/en_corte, aún sin pasar a asignado)."""
    cursor = db.orders.find(
        {
            "status": {"$in": ["en_revision", "en_corte"]},
            "pre_assigned_technician_id": {"$ne": None},
            "assigned_technician_id": {"$in": [None]},
        },
        {"_id": 0}
    )
    return [OrderResponse(**o) async for o in cursor]

@api_router.post("/tech-queue/pre-assign")
async def pre_assign_technician(data: PreAssignTechnician, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.COORDINADOR]))):
    """Pre-asignar técnico a una orden ANTES del corte. No cambia status."""
    order = await db.orders.find_one({"id": data.order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order["status"] not in ("en_revision", "en_corte"):
        raise HTTPException(
            status_code=400,
            detail=f"La orden debe estar en Revisión 360° o En Corte. Estado actual: {order['status']}"
        )
    technician = await db.users.find_one({"id": data.technician_id, "role": "tecnico"}, {"_id": 0})
    if not technician:
        raise HTTPException(status_code=404, detail="Técnico no encontrado")

    await db.orders.update_one(
        {"id": data.order_id},
        {"$set": {
            "pre_assigned_technician_id": data.technician_id,
            "pre_assigned_technician_name": technician["name"],
            "service_time_minutes": data.service_time_minutes,
            "pre_assigned_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }}
    )
    await log_order_history(
        data.order_id, "TECNICO_PRE_ASIGNADO",
        order["status"], order["status"],
        current_user["id"], current_user["name"],
        {"technician_name": technician["name"], "service_time_minutes": data.service_time_minutes}
    )
    return {"message": "Técnico pre-asignado correctamente"}

@api_router.post("/orders/{order_id}/clear-pre-assignment")
async def clear_pre_assignment(order_id: str, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.COORDINADOR]))):
    """Limpiar pre-asignación (mover orden de vuelta a la cola)."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {
            "pre_assigned_technician_id": None,
            "pre_assigned_technician_name": None,
            "pre_assigned_at": None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }}
    )
    return {"message": "Pre-asignación removida"}

# Step 4: Assignment (Coordinator)
@api_router.post("/orders/assign")
async def assign_technician(data: AssignTechnician, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.COORDINADOR]))):
    """Step 4: Assign technician with service time - Status: ASIGNADO"""
    order = await db.orders.find_one({"id": data.order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    # Allow assignment from EN_REVISION (no cutting needed) or EN_CORTE with completed cutting
    current_status = order["status"]
    if current_status not in (OrderStatus.EN_REVISION.value, OrderStatus.EN_CORTE.value):
        raise HTTPException(
            status_code=400,
            detail=f"La orden debe estar en Revisión 360° completada o Corte completado. Estado actual: {current_status}"
        )
    
    # If order has cutting services, require cutting completion before assignment
    cutting_keywords = ["polarizado", "ppf", "ultrasecure", "nanooptik", "huperoptik",
                        "black_ceramic", "ultraoptik", "ceramic_i3", "matte", "brillante", "wrap"]
    has_cutting_service = False
    for svc in (order.get("services") or []):
        svc_id = (svc.get("service") or "").lower().replace(" ", "_")
        svc_desc = (svc.get("description") or "").lower()
        if any(kw in svc_id or kw in svc_desc for kw in cutting_keywords):
            has_cutting_service = True
            break
    if has_cutting_service and order.get("cutting_status") != "completado":
        raise HTTPException(
            status_code=400,
            detail="Esta orden requiere completar el Corte de Piezas antes de asignar al técnico."
        )
    
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
        current_status, OrderStatus.ASIGNADO.value,
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
    
    is_postventa = bool(order.get("is_postventa"))
    new_status = OrderStatus.ENTREGADO.value if is_postventa else OrderStatus.SERVICIO_COMPLETADO.value
    
    photos = (data.completion_photos or [])[:10]
    
    update_data = {
        "status": new_status,
        "service_completed_at": datetime.now(timezone.utc).isoformat(),
        "technician_notes": data.notes,
        "service_completion_notes": data.notes,
        "service_completion_photos": photos,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    if is_postventa:
        update_data["delivered_at"] = datetime.now(timezone.utc).isoformat()
        update_data["ready_for_delivery"] = True
    
    await db.orders.update_one({"id": data.order_id}, {"$set": update_data})
    
    # Auto-release bahía assigned to this order (technician completes → bahia is freed automatically)
    bahia_id = order.get("bahia_id")
    if bahia_id:
        await db.bahias.update_one(
            {"id": bahia_id},
            {"$set": {"current_order_id": None, "assigned_at": None}}
        )
    
    # Log history
    await log_order_history(
        data.order_id, "SERVICIO_COMPLETADO_POSTVENTA" if is_postventa else "SERVICIO_COMPLETADO_TECNICO",
        OrderStatus.EN_PROCESO.value, new_status,
        current_user["id"], current_user["name"],
        {"technician_notes": data.notes, "is_postventa": is_postventa, "photos_count": len(photos), "bahia_released": bahia_id}
    )
    
    if not is_postventa:
        # Alert facturacion (solo para órdenes normales)
        await create_alert(
            "facturacion", AlertType.PENDIENTE_FACTURACION,
            "Vehículo listo para facturación",
            f"Vehículo {order['plate']} - {order['client_name']} completó servicio",
            data.order_id
        )
        return {"message": "Servicio completado, enviado a facturación"}
    return {"message": "Postventa/Garantía completada y cerrada"}

# Step 6: Payment (Facturacion)
@api_router.post("/orders/payment")
async def process_payment(data: PaymentApproval, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.FACTURACION]))):
    """Process payment (legalizar) - Status: TERMINADO_PAGADO or TERMINADO_FALTA_PAGO.
    
    Once paid, sets ready_for_delivery=True so vehicle is queued for handover.
    """
    order = await db.orders.find_one({"id": data.order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order["status"] not in (OrderStatus.SERVICIO_COMPLETADO.value, OrderStatus.TERMINADO_FALTA_PAGO.value):
        raise HTTPException(
            status_code=400,
            detail=f"La orden debe estar en SERVICIO_COMPLETADO o TERMINADO_FALTA_PAGO. Estado actual: {order['status']}"
        )
    
    new_status = OrderStatus.TERMINADO_PAGADO.value if data.payment_method else OrderStatus.TERMINADO_FALTA_PAGO.value
    
    update_data = {
        "status": new_status,
        "payment_method": data.payment_method,
        "payment_reference": data.payment_reference,
        "discount_code": data.discount_code,
        "discount_amount": data.discount_amount,
        "paid_at": datetime.now(timezone.utc).isoformat() if data.payment_method else None,
        "ready_for_delivery": new_status == OrderStatus.TERMINADO_PAGADO.value,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.orders.update_one({"id": data.order_id}, {"$set": update_data})
    
    # Log history
    await log_order_history(
        data.order_id, "PAGO_LEGALIZADO" if data.payment_method else "PAGO_PENDIENTE",
        order["status"], new_status,
        current_user["id"], current_user["name"],
        {"payment_method": data.payment_method, "payment_reference": data.payment_reference, "discount_amount": data.discount_amount}
    )
    
    return {
        "message": "Pago legalizado - Listo para entrega" if data.payment_method else "Marcado como pendiente de pago",
        "new_status": new_status,
        "ready_for_delivery": new_status == OrderStatus.TERMINADO_PAGADO.value,
    }


@api_router.get("/billing/pending")
async def list_pending_billing(current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.FACTURACION, UserRole.COORDINADOR]))):
    """Listar todas las órdenes encoladas para pago/legalización (servicio_completado o terminado_falta_pago)."""
    orders = await db.orders.find(
        {"status": {"$in": [OrderStatus.SERVICIO_COMPLETADO.value, OrderStatus.TERMINADO_FALTA_PAGO.value]}},
        {"_id": 0}
    ).sort("service_completed_at", -1).to_list(200)
    return orders

# Step 7: Delivery
@api_router.post("/orders/delivery")
async def confirm_delivery(data: DeliveryConfirmation, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.FACTURACION]))):
    """Confirm delivery with photo - Status: ENTREGADO"""
    order = await db.orders.find_one({"id": data.order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order["status"] not in [OrderStatus.TERMINADO_PAGADO.value, OrderStatus.TERMINADO_FALTA_PAGO.value]:
        raise HTTPException(status_code=400, detail="La orden debe estar en estado de facturación")
    
    # Validate delivery photo
    if not data.delivery_photo_url:
        raise HTTPException(status_code=400, detail="La foto de entrega es obligatoria")
    
    update_data = {
        "status": OrderStatus.ENTREGADO.value,
        "delivery_photo_url": data.delivery_photo_url,
        "delivered_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.orders.update_one({"id": data.order_id}, {"$set": update_data})
    
    # Log history
    await log_order_history(
        data.order_id, "VEHICULO_ENTREGADO",
        order["status"], OrderStatus.ENTREGADO.value,
        current_user["id"], current_user["name"],
        {}
    )
    
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
    
    old_status = order["status"]
    update_data = {
        "status": OrderStatus.DESISTIMIENTO.value,
        "updated_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.orders.update_one({"id": order_id}, {"$set": update_data})
    
    # Log history
    await log_order_history(
        order_id, "DESISTIMIENTO",
        old_status, OrderStatus.DESISTIMIENTO.value,
        current_user["id"], current_user["name"],
        {"reason": "Cliente desistió del servicio"}
    )
    
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
# Catálogo completo de servicios organizados por categorías
SERVICES_CATALOG = {
    "polarizado_ultrasecure": {
        "name": "Polarizado/Ultrasecure",
        "services": [
            {"id": "nanooptik", "name": "Nanooptik"},
            {"id": "black_ceramic_autobahn", "name": "Black Ceramic Autobahn"},
            {"id": "ultraoptik_aswf", "name": "Ultraoptik ASWF"},
            {"id": "ceramic_i3_autobahn", "name": "Ceramic i3 Autobahn"},
            {"id": "ceramic_i3_plus_autobahn", "name": "Ceramic i3+ Autobahn"},
            {"id": "huperoptik", "name": "Huperoptik"},
            {"id": "mixto", "name": "Mixto"},
            {"id": "micras_300", "name": "300 Micras"},
            {"id": "micras_500", "name": "500 Micras"},
            {"id": "micras_700", "name": "700 Micras"},
            {"id": "micras_1000", "name": "1000 Micras"},
            {"id": "micras_1700", "name": "1.700 Micras"},
        ]
    },
    "ppf": {
        "name": "PPF",
        "services": [
            {"id": "ppf_matte", "name": "Matte"},
            {"id": "ppf_brillante", "name": "Brillante"},
            {"id": "ppf_negro_mate", "name": "Negro Mate"},
            {"id": "ppf_vinilo", "name": "Vinilo"},
            {"id": "ppf_graph", "name": "Graph"},
        ]
    },
    "accesorios": {
        "name": "Accesorios",
        "services": [
            {"id": "seguros_luna", "name": "Seguros de Luna"},
            {"id": "seguros_guaya", "name": "Seguros de Guaya"},
            {"id": "tuercas_i", "name": "Tuercas I (5 medidas)"},
            {"id": "pernos_i", "name": "Pernos I"},
            {"id": "tuercas_mg", "name": "Tuercas MG (5 medidas)"},
            {"id": "pernos_mg", "name": "Pernos MG"},
            {"id": "plumillas", "name": "Plumillas"},
            {"id": "glass_cleaner", "name": "Glass Cleaner"},
            {"id": "opulum", "name": "Opulum"},
            {"id": "hidrofilms", "name": "Hidrofilms"},
            {"id": "cadena_kryptonite", "name": "Cadena Kryptonite"},
            {"id": "camara_4k", "name": "Cámara de seguridad 4K"},
            {"id": "camara_hd", "name": "Cámara de seguridad HD"},
            {"id": "tiros_arrastre", "name": "Tiros de arrastre"},
            {"id": "cadena_defender", "name": "Cadena Defender"},
            {"id": "seguros_llanta", "name": "Seguros de llanta"},
            {"id": "tapetes_termoformado", "name": "Tapetes Termoformado Lengueta"},
            {"id": "tapetes_defender", "name": "Tapetes Defender Universal"},
        ]
    },
    "detailing": {
        "name": "Detailing",
        "services": [
            {"id": "polichado_profesional", "name": "Polichado Profesional"},
            {"id": "ceramico_3_anos", "name": "Cerámico 3 años"},
            {"id": "ceramico_5_anos", "name": "Cerámico 5 años"},
            {"id": "lavado", "name": "Lavado"},
            {"id": "mantenimiento_ceramico", "name": "Mantenimiento Cerámico"},
            {"id": "lavado_chasis", "name": "Lavado Chasis"},
            {"id": "ceramico_cojineria", "name": "Cerámico Cojinería"},
            {"id": "ceramico_plasticos", "name": "Cerámico Plásticos"},
            {"id": "correccion_pintura", "name": "Corrección de Pintura"},
            {"id": "lavado_interior", "name": "Lavado Interior"},
            {"id": "lavado_cojineria", "name": "Lavado Cojinería"},
            {"id": "ceramico_vidrios", "name": "Cerámico de Vidrios"},
        ]
    },
    "latoneria_pintura": {
        "name": "Latonería y Pintura",
        "services": [
            {"id": "correccion_farolas", "name": "Corrección de Farolas"},
            {"id": "pdr", "name": "PDR"},
            {"id": "latoneria", "name": "Latonería"},
        ]
    }
}

@api_router.get("/services/catalog")
async def get_services_catalog():
    """Get available services organized by category - prices are open/manual"""
    return SERVICES_CATALOG

@api_router.get("/services/catalog/flat")
async def get_services_catalog_flat():
    """Get flat list of all services for compatibility"""
    services = []
    for category_id, category in SERVICES_CATALOG.items():
        for service in category["services"]:
            services.append({
                "service": service["id"],
                "name": service["name"],
                "category": category["name"],
                "category_id": category_id,
                "suggested_price": 0  # Precio abierto
            })
    return services

# ==================== TIME SLOTS & AVAILABILITY ====================
# Configuración de franjas horarias
TIME_SLOTS_CONFIG = {
    "weekday": {  # Lunes a Viernes
        "operating_hours": {"start": "08:30", "end": "18:00"},
        "last_registration": "16:00",
        "slots": [
            {"id": "franja_1", "name": "Franja 1", "start": "08:30", "end": "11:30", "capacity": 20},
            {"id": "franja_2", "name": "Franja 2", "start": "11:30", "end": "14:30", "capacity": 10},
            {"id": "franja_3", "name": "Franja 3", "start": "14:30", "end": "16:00", "capacity": 10},
        ]
    },
    "saturday": {  # Sábados
        "operating_hours": {"start": "07:30", "end": "18:00"},
        "last_registration": "15:30",
        "slots": [
            {"id": "franja_1", "name": "Franja 1", "start": "07:30", "end": "11:00", "capacity": 20},
            {"id": "franja_2", "name": "Franja 2", "start": "11:00", "end": "14:00", "capacity": 12},
            {"id": "franja_3", "name": "Franja 3", "start": "14:00", "end": "15:30", "capacity": 8},
        ]
    },
    "sunday": None  # Cerrado
}

def get_day_config(date_str: str):
    """Get time slots configuration based on day of week"""
    date_obj = datetime.strptime(date_str, "%Y-%m-%d")
    day_of_week = date_obj.weekday()  # 0=Monday, 6=Sunday
    
    if day_of_week == 6:  # Domingo
        return None
    elif day_of_week == 5:  # Sábado
        return TIME_SLOTS_CONFIG["saturday"]
    else:  # Lunes a Viernes
        return TIME_SLOTS_CONFIG["weekday"]

@api_router.get("/slots/availability")
async def get_slot_availability(date: str):
    """Get available time slots with remaining capacity for a specific date"""
    # Validate date format
    try:
        date_obj = datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato de fecha inválido. Use YYYY-MM-DD")
    
    # Get day configuration
    day_config = get_day_config(date)
    
    # If Sunday, return closed message
    if day_config is None:
        return {
            "date": date,
            "is_open": False,
            "message": "Domingos cerrado",
            "slots": []
        }
    
    # Get booked counts for each slot on this date
    slots_with_availability = []
    
    for slot in day_config["slots"]:
        # Count orders for this slot on this date
        booked_count = await db.orders.count_documents({
            "date": date,
            "time_slot": slot["id"],
            "status": {"$nin": ["desistimiento"]}  # Exclude withdrawn orders
        })
        
        remaining = slot["capacity"] - booked_count
        
        slots_with_availability.append({
            "id": slot["id"],
            "name": slot["name"],
            "start": slot["start"],
            "end": slot["end"],
            "capacity": slot["capacity"],
            "booked": booked_count,
            "remaining": max(0, remaining),
            "available": remaining > 0
        })
    
    return {
        "date": date,
        "is_open": True,
        "operating_hours": day_config["operating_hours"],
        "last_registration": day_config["last_registration"],
        "slots": slots_with_availability
    }

@api_router.get("/")
async def root():
    return {"message": "Polarizados Manager API v2.0"}

@api_router.get("/time/colombia")
async def get_current_colombia_time():
    """Get current time in Colombia timezone"""
    colombia_time = get_colombia_time()
    return {
        "datetime": colombia_time.isoformat(),
        "date": colombia_time.strftime("%Y-%m-%d"),
        "time": colombia_time.strftime("%H:%M:%S"),
        "formatted": colombia_time.strftime("%d/%m/%Y %H:%M"),
        "timezone": "America/Bogota (UTC-5)"
    }

# ==================== ORDER HISTORY ====================
@api_router.get("/orders/{order_id}/history")
async def get_order_history(order_id: str, current_user: dict = Depends(get_current_user)):
    """Get complete history of an order for traceability"""
    history = await db.order_history.find({"order_id": order_id}, {"_id": 0}).sort("created_at", 1).to_list(100)
    return history

# ==================== SETTINGS ====================
class BookingPinUpdate(BaseModel):
    pin: str

@api_router.get("/settings/booking-pin")
async def get_booking_pin(current_user: dict = Depends(require_roles([UserRole.ADMIN]))):
    """Get the current booking confirmation PIN (admin only)."""
    settings = await db.settings.find_one({"key": "booking_pin"}, {"_id": 0})
    pin = (settings or {}).get("value", "00000")
    return {"pin": pin}

@api_router.put("/settings/booking-pin")
async def update_booking_pin(data: BookingPinUpdate, current_user: dict = Depends(require_roles([UserRole.ADMIN]))):
    """Update the booking confirmation PIN (admin only)."""
    pin = (data.pin or "").strip()
    if not pin or len(pin) < 4 or len(pin) > 10 or not pin.isdigit():
        raise HTTPException(status_code=400, detail="El PIN debe ser numérico de 4 a 10 dígitos")
    
    await db.settings.update_one(
        {"key": "booking_pin"},
        {"$set": {"key": "booking_pin", "value": pin, "updated_at": datetime.now(timezone.utc).isoformat(), "updated_by": current_user["id"]}},
        upsert=True
    )
    return {"message": "PIN actualizado correctamente", "pin": pin}


@api_router.get("/settings/completion-pin")
async def get_completion_pin(current_user: dict = Depends(require_roles([UserRole.ADMIN]))):
    """Get the service completion PIN (admin only)."""
    settings = await db.settings.find_one({"key": "completion_pin"}, {"_id": 0})
    pin = (settings or {}).get("value", "11111")
    return {"pin": pin}

@api_router.put("/settings/completion-pin")
async def update_completion_pin(data: BookingPinUpdate, current_user: dict = Depends(require_roles([UserRole.ADMIN]))):
    """Update the service completion PIN (admin only)."""
    pin = (data.pin or "").strip()
    if not pin or len(pin) < 4 or len(pin) > 10 or not pin.isdigit():
        raise HTTPException(status_code=400, detail="El PIN debe ser numérico de 4 a 10 dígitos")
    await db.settings.update_one(
        {"key": "completion_pin"},
        {"$set": {"key": "completion_pin", "value": pin, "updated_at": datetime.now(timezone.utc).isoformat(), "updated_by": current_user["id"]}},
        upsert=True
    )
    return {"message": "PIN de completar servicio actualizado correctamente", "pin": pin}

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
        {"email": "corte@polarizadosya.com", "name": "Luis Corte", "role": "corte", "password": "corte123"},
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

@api_router.post("/seed/bahias")
async def seed_bahias():
    """Create test bahias (garages/bays) for vehicle assignment"""
    bahias = [
        {"id": "bahia_1", "name": "Bahía 1", "description": "Polarizado Premium", "capacity": 1, "active": True},
        {"id": "bahia_2", "name": "Bahía 2", "description": "Polarizado Estándar", "capacity": 1, "active": True},
        {"id": "bahia_3", "name": "Bahía 3", "description": "PPF y Wrapping", "capacity": 1, "active": True},
        {"id": "bahia_4", "name": "Bahía 4", "description": "Ceramic Coating", "capacity": 1, "active": True},
        {"id": "bahia_5", "name": "Bahía 5", "description": "Detailing", "capacity": 1, "active": True},
        {"id": "bahia_6", "name": "Bahía 6", "description": "Multiservicio 1", "capacity": 1, "active": True},
        {"id": "bahia_7", "name": "Bahía 7", "description": "Multiservicio 2", "capacity": 1, "active": True},
        {"id": "bahia_8", "name": "Bahía 8", "description": "Reparaciones", "capacity": 1, "active": True},
        {"id": "bahia_9", "name": "Bahía 9", "description": "Express", "capacity": 1, "active": True},
        {"id": "bahia_10", "name": "Bahía 10", "description": "VIP", "capacity": 1, "active": True},
    ]
    
    created = []
    for bahia in bahias:
        existing = await db.bahias.find_one({"id": bahia["id"]})
        if not existing:
            bahia["created_at"] = datetime.now(timezone.utc).isoformat()
            bahia["current_order_id"] = None
            await db.bahias.insert_one(bahia)
            created.append(bahia["name"])
    
    return {"message": f"Created {len(created)} bahias", "bahias": created}

@api_router.get("/bahias")
async def get_bahias(current_user: dict = Depends(get_current_user)):
    """Get all bahias with their current status"""
    bahias = await db.bahias.find({}, {"_id": 0}).to_list(100)
    
    # Enrich with current order info
    for bahia in bahias:
        if bahia.get("current_order_id"):
            order = await db.orders.find_one({"id": bahia["current_order_id"]}, {"_id": 0})
            bahia["current_order"] = order
        else:
            bahia["current_order"] = None
    
    return bahias

@api_router.put("/bahias/{bahia_id}/assign")
async def assign_order_to_bahia(bahia_id: str, order_id: str, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.COORDINADOR]))):
    """Assign an order to a bahia"""
    bahia = await db.bahias.find_one({"id": bahia_id})
    if not bahia:
        raise HTTPException(status_code=404, detail="Bahía no encontrada")
    
    order = await db.orders.find_one({"id": order_id})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    
    # Update bahia
    await db.bahias.update_one(
        {"id": bahia_id},
        {"$set": {"current_order_id": order_id, "assigned_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    # Update order with bahia info
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {"bahia_id": bahia_id, "bahia_name": bahia["name"]}}
    )
    
    return {"message": f"Orden asignada a {bahia['name']}", "bahia_id": bahia_id, "order_id": order_id}

class BahiaReleaseRequest(BaseModel):
    completed: bool  # True = servicio terminado, False = falta algo
    completion_pin: Optional[str] = None  # required if completed=True
    notes: Optional[str] = None
    completion_photos: Optional[List[str]] = None  # base64 data URLs, max 10


@api_router.put("/bahias/{bahia_id}/release")
async def release_bahia(
    bahia_id: str,
    payload: BahiaReleaseRequest,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.COORDINADOR]))
):
    """Release a bahia. If completed=True, validates PIN, attaches notes+photos
    and moves the order to 'servicio_completado' for billing.
    If completed=False, just releases the bahia (order stays assigned, awaiting another bahia)."""
    
    bahia = await db.bahias.find_one({"id": bahia_id}, {"_id": 0})
    if not bahia:
        raise HTTPException(status_code=404, detail="Bahía no encontrada")
    
    current_order_id = bahia.get("current_order_id")
    
    if payload.completed:
        # Require PIN
        settings = await db.settings.find_one({"key": "completion_pin"}, {"_id": 0})
        expected_pin = (settings or {}).get("value", "11111")
        if not payload.completion_pin or str(payload.completion_pin).strip() != str(expected_pin).strip():
            raise HTTPException(status_code=400, detail="PIN de completar servicio incorrecto")
        
        # Limit photos
        photos = payload.completion_photos or []
        if len(photos) > 10:
            photos = photos[:10]
        
        # Update order if attached
        if current_order_id:
            current_order_for_postventa = await db.orders.find_one({"id": current_order_id}, {"_id": 0})
            is_postventa = bool(current_order_for_postventa.get("is_postventa")) if current_order_for_postventa else False
            target_status = OrderStatus.ENTREGADO.value if is_postventa else OrderStatus.SERVICIO_COMPLETADO.value
            
            set_fields = {
                "status": target_status,
                "service_completed_at": datetime.now(timezone.utc).isoformat(),
                "service_completion_notes": payload.notes,
                "service_completion_photos": photos,
                "released_by_coordinator_id": current_user["id"],
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            if is_postventa:
                set_fields["delivered_at"] = datetime.now(timezone.utc).isoformat()
                set_fields["ready_for_delivery"] = True
            
            await db.orders.update_one({"id": current_order_id}, {"$set": set_fields})
            # Get order for history & email
            order = await db.orders.find_one({"id": current_order_id}, {"_id": 0})
            
            # Log history
            try:
                await log_order_history(
                    current_order_id, "SERVICIO_COMPLETADO_LIBERAR_BAHIA",
                    order.get("status",""), OrderStatus.SERVICIO_COMPLETADO.value,
                    current_user["id"], current_user["name"],
                    {"bahia_id": bahia_id, "photos_count": len(photos)}
                )
            except Exception:
                pass
            
            # Best-effort email to client + coordinators (compressed)
            if photos and RESEND_API_KEY and order.get("client_email"):
                try:
                    def _compress_all():
                        out = []
                        for idx, p in enumerate(photos):
                            data = _compress_data_url_image(p, max_dim=1280, quality=70)
                            if data:
                                out.append({"filename": f"servicio_{idx+1:02d}.jpg", "content": data})
                        return out
                    attachments_raw = await asyncio.to_thread(_compress_all)
                    if attachments_raw:
                        resend_attachments = [
                            {"filename": a["filename"], "content": base64.b64encode(a["content"]).decode("ascii")}
                            for a in attachments_raw
                        ]
                        recipients = {order["client_email"]}
                        coord_users = await db.users.find({"role": UserRole.COORDINADOR.value}, {"_id": 0, "email": 1}).to_list(50)
                        for u in coord_users:
                            if u.get("email"):
                                recipients.add(u["email"])
                        html = f"""
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#222;">
  <div style="background:#1e1e32;color:#fff;padding:16px 20px;">
    <h2 style="margin:0;">Polarizados Manager — Servicio Completado</h2>
  </div>
  <div style="padding:20px;">
    <p>Hola,</p>
    <p>El servicio fue completado. Adjuntamos las fotos de evidencia final.</p>
    <p><b>Vehículo:</b> {order.get('plate')} — {order.get('brand','')} {order.get('model','')}<br>
       <b>Orden:</b> {order.get('order_code','')}<br>
       <b>Observaciones:</b> {payload.notes or '-'}</p>
    <p>El servicio quedó pendiente de validación de pago para entrega.</p>
  </div>
</div>
""".strip()
                        params = {
                            "from": SENDER_EMAIL,
                            "to": list(recipients),
                            "subject": f"Servicio Completado - {order.get('plate')} - {order.get('order_code','')}",
                            "html": html,
                            "attachments": resend_attachments,
                        }
                        await asyncio.to_thread(resend.Emails.send, params)
                except Exception as e:
                    logger.warning(f"Could not send completion email: {e}")
    else:
        # "Falta algo": order stays assigned (status keeps), only bahia gets freed
        if current_order_id:
            await db.orders.update_one(
                {"id": current_order_id},
                {"$set": {
                    "bahia_id": None,
                    "bahia_name": None,
                    "service_pending_notes": payload.notes,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }}
            )
            try:
                order = await db.orders.find_one({"id": current_order_id}, {"_id": 0})
                await log_order_history(
                    current_order_id, "BAHIA_LIBERADA_SIN_COMPLETAR",
                    order.get("status",""), order.get("status",""),
                    current_user["id"], current_user["name"],
                    {"bahia_id": bahia_id, "notes": payload.notes}
                )
            except Exception:
                pass
    
    # Always free the bahia
    await db.bahias.update_one(
        {"id": bahia_id},
        {"$set": {"current_order_id": None, "assigned_at": None}}
    )
    
    return {
        "message": "Servicio completado" if payload.completed else "Bahía liberada (servicio pendiente)",
        "completed": payload.completed,
    }

# ==================== CUTTING MODULE ====================
@api_router.get("/cutting/pending")
async def get_cutting_pending(current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.CORTE, UserRole.COORDINADOR]))):
    """Get orders pending cutting (polarizado/PPF services after check-in)"""
    # Services that require cutting
    cutting_services = [
        "nanooptik", "black_ceramic_autobahn", "ultraoptik_aswf", 
        "ceramic_i3_autobahn", "ceramic_i3_plus_autobahn", "huperoptik",
        "ultrasecure", "ppf_matte", "ppf_brillante", "matte", "brillante",
        "proteccion_ppf", "wrap", "polarizado", "3m", "crystalline", "mixto"
    ]
    
    # Find orders that finished 360 inspection (en_revision) or are currently in cutting
    orders = await db.orders.find(
        {"status": {"$in": ["en_revision", "en_corte"]}},
        {"_id": 0}
    ).to_list(100)
    
    # Filter orders that have cutting services
    cutting_orders = []
    for order in orders:
        services = order.get("services", [])
        has_cutting_service = False
        cutting_service_names = []
        
        for svc in services:
            svc_id = (svc.get("service") or "").lower().replace(" ", "_")
            svc_desc = (svc.get("description") or "").lower()
            
            # Check if this service requires cutting
            if any(cs in svc_id or cs in svc_desc for cs in cutting_services) or \
               "polarizado" in svc_desc or "ppf" in svc_desc or "ultrasecure" in svc_desc:
                has_cutting_service = True
                cutting_service_names.append({
                    "name": svc.get("description") or svc.get("service") or "Servicio",
                    "parts": svc.get("parts", []),
                    "part_percentages": svc.get("part_percentages") or {},
                    "price": svc.get("price", 0)
                })
        
        if has_cutting_service:
            order["cutting_services"] = cutting_service_names
            order["cutting_status"] = order.get("cutting_status", "pendiente")
            cutting_orders.append(order)
    
    return cutting_orders

@api_router.put("/cutting/{order_id}/start")
async def start_cutting(order_id: str, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.CORTE]))):
    """Mark cutting as started for an order. Must be in en_revision status (after 360 inspection)."""
    order = await db.orders.find_one({"id": order_id})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order.get("status") not in ("en_revision", "en_corte"):
        raise HTTPException(
            status_code=400,
            detail=f"La orden debe estar en Revisión 360° completada para iniciar corte. Estado actual: {order.get('status')}"
        )
    if not order.get("pre_assigned_technician_id") and not order.get("assigned_technician_id"):
        raise HTTPException(
            status_code=400,
            detail="Esta orden no tiene técnico asignado. Asígnela primero en 'Autos por Asignar'."
        )
    
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {
            "status": "en_corte",
            "cutting_status": "en_proceso",
            "cutting_started_at": datetime.now(timezone.utc).isoformat(),
            "cutting_started_by": current_user["id"]
        }}
    )
    
    # Add to history
    await db.order_history.insert_one({
        "id": str(uuid.uuid4()),
        "order_id": order_id,
        "action": "cutting_started",
        "status": "en_corte",
        "user_id": current_user["id"],
        "user_name": current_user.get("name", current_user["email"]),
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    return {"message": "Corte iniciado", "status": "en_corte"}

class CuttingCompleteRequest(BaseModel):
    measurements: Optional[str] = None  # legacy free-text
    notes: Optional[str] = None
    part_measurements: Optional[Dict[str, str]] = None  # {part_id: "120x60 cm"}
    ppf_vehicle_serial: Optional[str] = None
    ppf_vehicle_model: Optional[str] = None
    inventory_item_id: Optional[str] = None  # rollo utilizado para descuento automático (modo agregado)
    meters_used: Optional[float] = None  # override manual (si no, se calcula desde part_measurements)
    # Descuento granular: por pieza, qué rollo usar
    # {part_id: {"tipo_rollo": "spectra", "inventory_item_id": "INV-001", "is_aprovechamiento": bool}}
    part_materials: Optional[Dict[str, Dict[str, Any]]] = None


@api_router.put("/cutting/{order_id}/complete")
async def complete_cutting(
    order_id: str,
    payload: Optional[CuttingCompleteRequest] = None,
    measurements: Optional[str] = None,
    notes: Optional[str] = None,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.CORTE]))
):
    """Mark cutting as completed. Order must be currently in 'en_corte' status.
    
    Accepts either a JSON body (preferred) or legacy query params (measurements, notes).
    """
    order = await db.orders.find_one({"id": order_id})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order.get("status") != "en_corte":
        raise HTTPException(
            status_code=400,
            detail=f"Solo se puede completar corte si la orden está en estado 'en_corte'. Estado actual: {order.get('status')}"
        )
    
    # Resolve fields with body taking precedence over query params
    p = payload or CuttingCompleteRequest()
    final_measurements = p.measurements or measurements
    final_notes = p.notes or notes
    part_measurements = p.part_measurements or {}
    ppf_vehicle_serial = (p.ppf_vehicle_serial or "").strip() or None
    ppf_vehicle_model = (p.ppf_vehicle_model or "").strip() or None
    
    # If part_measurements provided but no aggregated measurements, build a readable summary
    if part_measurements and not final_measurements:
        labels = {
            "panoramico": "Panorámico",
            "vidrio_copiloto": "Vidrio Copiloto",
            "vidrio_piloto": "Vidrio Piloto",
            "vidrio_trasero": "Vidrio Trasero",
            "vidrio_trasero_copiloto": "Vidrio Trasero Copiloto",
            "trasero": "Trasero",
            "luneta": "Luneta",
            "sunroof": "Sunroof",
            "custodias": "Custodias",
        }
        parts_text = []
        for k, v in part_measurements.items():
            if v and str(v).strip():
                parts_text.append(f"{labels.get(k, k)}: {v}")
        final_measurements = "; ".join(parts_text)
    
    update_fields = {
        "cutting_status": "completado",
        "cutting_completed_at": datetime.now(timezone.utc).isoformat(),
        "cutting_completed_by": current_user["id"],
        "cutting_measurements": final_measurements,
        "cutting_notes": final_notes,
        "cutting_part_measurements": part_measurements or None,
        "cutting_part_materials": p.part_materials or None,
    }
    if ppf_vehicle_serial is not None:
        update_fields["ppf_vehicle_serial"] = ppf_vehicle_serial
    if ppf_vehicle_model is not None:
        update_fields["ppf_vehicle_model"] = ppf_vehicle_model
    
    await db.orders.update_one({"id": order_id}, {"$set": update_fields})
    
    # Auto-deduct from inventory
    # Modo granular (part_materials) tiene prioridad sobre inventory_item_id agregado
    inventory_deduction = None
    deductions_per_rollo = {}  # {inventory_item_id: meters_used}
    aprovechamientos_created = []  # piezas marcadas como aprovechamiento (no descuentan stock)

    if p.part_materials:
        # Agrupar metros por inventory_item_id basado en cada pieza
        for part_id, mat in (p.part_materials or {}).items():
            mat = mat or {}
            measurement = (part_measurements or {}).get(part_id) or ""
            meters = _meters_from_part_measurements({part_id: measurement})

            # Si es aprovechamiento, registrar en colección aprovechamientos
            # y NO descontar del stock del rollo
            if mat.get("is_aprovechamiento"):
                aprov_doc = {
                    "id": str(uuid.uuid4()),
                    "order_id": order_id,
                    "order_code": order.get("order_code"),
                    "part_id": part_id,
                    "measurement": measurement,
                    "meters": round(meters or 0, 2),
                    "tipo_rollo": mat.get("tipo_rollo"),
                    "source_inventory_item_id": mat.get("inventory_item_id"),
                    "plate": order.get("plate"),
                    "client_name": order.get("client_name"),
                    "user_id": current_user["id"],
                    "user_name": current_user.get("name") or current_user.get("email"),
                    "status": "consumido",  # se consumió en este corte
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                await db.aprovechamientos.insert_one(aprov_doc)
                aprov_doc.pop("_id", None)
                aprovechamientos_created.append({
                    "part_id": part_id,
                    "measurement": measurement,
                    "meters": aprov_doc["meters"],
                    "tipo_rollo": mat.get("tipo_rollo"),
                })
                continue

            inv_id = mat.get("inventory_item_id")
            if not inv_id:
                continue
            if meters and meters > 0:
                deductions_per_rollo[inv_id] = deductions_per_rollo.get(inv_id, 0) + meters
    elif p.inventory_item_id:
        # Modo legacy (un solo rollo)
        meters_used = p.meters_used
        if meters_used is None:
            meters_used = _meters_from_part_measurements(part_measurements)
        if meters_used and meters_used > 0:
            deductions_per_rollo[p.inventory_item_id] = meters_used

    deduction_results = []
    for inv_id, meters_used in deductions_per_rollo.items():
        rollo = await db.inventory.find_one({"id": inv_id})
        if rollo and rollo.get("tipo_articulo") == "rollo":
            new_remaining = max(0, (rollo.get("metros_restantes") or 0) - meters_used)
            await db.inventory.update_one(
                {"id": inv_id},
                {"$set": {"metros_restantes": new_remaining, "updated_at": datetime.now(timezone.utc).isoformat()}}
            )
            await db.inventory_movements.insert_one({
                "id": str(uuid.uuid4()),
                "inventory_item_id": inv_id,
                "type": "deduct_auto_cutting",
                "metros": round(meters_used, 2),
                "cantidad": None,
                "reason": f"Corte completado - Orden {order.get('order_code','')}",
                "order_id": order_id,
                "user_id": current_user["id"],
                "user_name": current_user.get("name") or current_user.get("email"),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            deduction_results.append({
                "item_id": inv_id,
                "rollo_codigo": rollo.get("codigo"),
                "rollo_nombre": rollo.get("nombre"),
                "tipo_rollo": rollo.get("tipo_rollo"),
                "meters_used": round(meters_used, 2),
                "new_remaining": round(new_remaining, 2),
            })

    if deduction_results:
        # legacy single-rollo fields kept for backward compatibility
        first = deduction_results[0]
        await db.orders.update_one(
            {"id": order_id},
            {"$set": {
                "inventory_deducted_from": first["item_id"],
                "inventory_meters_used": first["meters_used"],
                "inventory_deductions": deduction_results,
            }}
        )
        inventory_deduction = (
            deduction_results[0] if len(deduction_results) == 1 else {"multi": deduction_results}
        )
    await db.alerts.insert_one({
        "id": str(uuid.uuid4()),
        "type": "corte_completado",
        "title": "Corte Completado",
        "message": f"Corte completado para {order.get('plate')} - {order.get('brand')} {order.get('model')}",
        "order_id": order_id,
        "target_role": "coordinador",
        "read": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    # Add to history
    await db.order_history.insert_one({
        "id": str(uuid.uuid4()),
        "order_id": order_id,
        "action": "cutting_completed",
        "status": "en_corte",
        "details": {"measurements": measurements, "notes": notes},
        "user_id": current_user["id"],
        "user_name": current_user.get("name", current_user["email"]),
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    return {
        "message": "Corte completado",
        "status": "completado",
        "inventory_deduction": inventory_deduction,
        "aprovechamientos": aprovechamientos_created,
    }


@api_router.get("/aprovechamientos")
async def list_aprovechamientos(current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.CORTE, UserRole.COORDINADOR]))):
    """Lista los aprovechamientos registrados (retazos consumidos durante cortes)."""
    items = await db.aprovechamientos.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return items


@api_router.get("/orders/history-by-plate/{plate}")
async def get_orders_by_plate(plate: str, current_user: dict = Depends(get_current_user)):
    """Devuelve órdenes anteriores de una placa (orden por fecha descendente).
    Usado por el módulo de Postventa para reagendar.
    """
    plate_upper = plate.strip().upper()
    if not plate_upper:
        return {"plate": "", "orders": []}
    orders = await db.orders.find(
        {"plate": plate_upper, "status": {"$nin": ["desistimiento"]}},
        {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    
    # Build summary list with key fields
    summary = []
    last_client = None
    for o in orders:
        if not last_client:
            last_client = {
                "client_name": o.get("client_name"),
                "client_phone": o.get("client_phone"),
                "client_email": o.get("client_email"),
                "client_cedula": o.get("client_cedula"),
                "brand": o.get("brand"),
                "model": o.get("model"),
                "year": o.get("year"),
                "color": o.get("color"),
            }
        summary.append({
            "id": o.get("id"),
            "order_code": o.get("order_code"),
            "date": o.get("date"),
            "scheduled_time": o.get("scheduled_time"),
            "status": o.get("status"),
            "services": [{"description": s.get("description") or s.get("service"), "service": s.get("service")} for s in (o.get("services") or [])],
            "final_value": o.get("final_value") or o.get("negotiated_value"),
            "is_postventa": bool(o.get("is_postventa")),
            "postventa_type": o.get("postventa_type"),
        })
    
    return {
        "plate": plate_upper,
        "vehicle_data": last_client,
        "orders": summary,
        "total_orders": len(summary),
    }


# ==================== INVENTORY MODULE ====================
ROLLO_ALERT_THRESHOLDS = {
    # Polarizado / Ultrasecure
    "spectra": 5,
    "black_ceramic": 5,
    "ceramic_i3": 3,
    "upper_hoptik": 3,
    "edge": 3,
    "clear_4mil": 5,
    "clear_7mil": 2,
    "clear_12mil": 2,
    "clear_1500_micras": 4,
    # PPF
    "xpel_gloss": 4,
    "ppf_xpel_ultimate": 2,
    "ppf_autoban": 4,
    "ppf_techo": 3,
}

ROLLO_TYPE_LABELS = {
    "spectra": "Spectra",
    "black_ceramic": "Black Ceramic",
    "ceramic_i3": "Ceramic i3",
    "upper_hoptik": "Upper Hoptik",
    "edge": "Edge",
    "clear_4mil": "Clear 4mil",
    "clear_7mil": "Clear 7mil",
    "clear_12mil": "Clear 12mil",
    "clear_1500_micras": "Clear 1500 micras",
    "xpel_gloss": "Xpel Gloss",
    "ppf_xpel_ultimate": "PPF Xpel Ultimate",
    "ppf_autoban": "PPF Autoban",
    "ppf_techo": "PPF Techo",
}


class InventoryItemCreate(BaseModel):
    nombre: str  # nombre legible del articulo
    categoria: str  # 'polarizado', 'ultrasecure', 'ppf', 'accesorio', 'material'
    tipo_articulo: str  # 'rollo' o 'cantidad'
    tipo_rollo: Optional[str] = None  # spectra, black_ceramic, etc. (solo para rollos)
    factura_compra: Optional[str] = None
    metros_iniciales: Optional[float] = None  # para rollos
    cantidad_inicial: Optional[int] = None  # para accesorios/materiales
    costo: float = 0.0
    linked_service: Optional[str] = None  # Servicio que descuenta este artículo
    sede_id: Optional[str] = None  # Sede a la que pertenece el artículo
    fecha_ingreso: Optional[str] = None
    notes: Optional[str] = None


class InventoryItemUpdate(BaseModel):
    nombre: Optional[str] = None
    factura_compra: Optional[str] = None
    metros_restantes: Optional[float] = None
    cantidad_restante: Optional[int] = None
    costo: Optional[float] = None
    linked_service: Optional[str] = None
    notes: Optional[str] = None
    active: Optional[bool] = None


def _gen_inventory_code():
    # Consecutive 5-digit code per category-prefix-ish via timestamp
    import time
    return f"INV-{int(time.time()*1000) % 100000000}"


@api_router.post("/inventory")
async def create_inventory_item(
    item: InventoryItemCreate,
    current_user: dict = Depends(require_roles([UserRole.ADMIN]))
):
    """Crear un artículo de inventario (admin only)."""
    # Validation
    if item.tipo_articulo == "rollo":
        if not item.tipo_rollo:
            raise HTTPException(status_code=400, detail="tipo_rollo es requerido para rollos")
        if item.metros_iniciales is None or item.metros_iniciales <= 0:
            raise HTTPException(status_code=400, detail="metros_iniciales debe ser > 0 para rollos")
    elif item.tipo_articulo == "cantidad":
        if item.cantidad_inicial is None or item.cantidad_inicial <= 0:
            raise HTTPException(status_code=400, detail="cantidad_inicial debe ser > 0")
    else:
        raise HTTPException(status_code=400, detail="tipo_articulo debe ser 'rollo' o 'cantidad'")
    
    # Get next consecutive code
    last = await db.inventory.find_one({}, sort=[("created_at", -1)])
    seq = (last.get("seq", 0) + 1) if last else 1
    
    # Resolve sede name if sede_id provided
    sede_nombre = None
    if item.sede_id:
        sede = await db.sedes.find_one({"id": item.sede_id}, {"_id": 0})
        if not sede:
            raise HTTPException(status_code=404, detail="Sede no encontrada")
        sede_nombre = sede["nombre"]
    
    now_iso = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "seq": seq,
        "codigo": f"INV-{seq:05d}",
        "nombre": item.nombre,
        "categoria": item.categoria,
        "tipo_articulo": item.tipo_articulo,
        "tipo_rollo": item.tipo_rollo,
        "factura_compra": item.factura_compra,
        "metros_iniciales": item.metros_iniciales,
        "metros_restantes": item.metros_iniciales,
        "cantidad_inicial": item.cantidad_inicial,
        "cantidad_restante": item.cantidad_inicial,
        "costo": item.costo,
        "linked_service": item.linked_service,
        "sede_id": item.sede_id,
        "sede_nombre": sede_nombre,
        "fecha_ingreso": item.fecha_ingreso or now_iso,
        "notes": item.notes,
        "active": True,
        "created_by": current_user["id"],
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    await db.inventory.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/inventory")
async def list_inventory(
    categoria: Optional[str] = None,
    tipo_articulo: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Listar inventario (todos los roles autenticados pueden leer)."""
    query = {"active": True}
    if categoria:
        query["categoria"] = categoria
    if tipo_articulo:
        query["tipo_articulo"] = tipo_articulo
    items = await db.inventory.find(query, {"_id": 0}).sort("seq", -1).to_list(500)
    return items


@api_router.put("/inventory/{item_id}")
async def update_inventory_item(
    item_id: str,
    update: InventoryItemUpdate,
    current_user: dict = Depends(require_roles([UserRole.ADMIN]))
):
    """Actualizar artículo de inventario."""
    existing = await db.inventory.find_one({"id": item_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Artículo no encontrado")
    
    fields = {k: v for k, v in update.dict(exclude_unset=True).items() if v is not None}
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.inventory.update_one({"id": item_id}, {"$set": fields})
    return {"message": "Artículo actualizado"}


@api_router.delete("/inventory/{item_id}")
async def delete_inventory_item(
    item_id: str,
    current_user: dict = Depends(require_roles([UserRole.ADMIN]))
):
    """Soft delete (active=False)."""
    await db.inventory.update_one(
        {"id": item_id},
        {"$set": {"active": False, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"message": "Artículo eliminado"}


@api_router.get("/inventory/alerts")
async def get_inventory_alerts(current_user: dict = Depends(get_current_user)):
    """Devolver alertas de bajo stock por tipo de rollo según umbrales fijos."""
    pipeline = [
        {"$match": {"active": True, "tipo_articulo": "rollo", "tipo_rollo": {"$ne": None}, "metros_restantes": {"$gt": 0}}},
        {"$group": {"_id": "$tipo_rollo", "count": {"$sum": 1}, "total_metros": {"$sum": "$metros_restantes"}}},
    ]
    counts = {}
    async for row in db.inventory.aggregate(pipeline):
        counts[row["_id"]] = {"count": row["count"], "total_metros": row["total_metros"]}
    
    alerts = []
    for tipo, threshold in ROLLO_ALERT_THRESHOLDS.items():
        info = counts.get(tipo, {"count": 0, "total_metros": 0})
        if info["count"] <= threshold:
            alerts.append({
                "tipo_rollo": tipo,
                "label": ROLLO_TYPE_LABELS.get(tipo, tipo),
                "current_count": info["count"],
                "threshold": threshold,
                "total_metros_restantes": round(info["total_metros"], 2),
                "severity": "critical" if info["count"] == 0 else ("high" if info["count"] <= max(1, threshold // 2) else "medium"),
            })
    return {"alerts": alerts, "counts_by_type": counts, "thresholds": ROLLO_ALERT_THRESHOLDS}


@api_router.post("/inventory/{item_id}/deduct")
async def deduct_inventory(
    item_id: str,
    metros: Optional[float] = None,
    cantidad: Optional[int] = None,
    reason: Optional[str] = None,
    order_id: Optional[str] = None,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.CORTE, UserRole.COORDINADOR]))
):
    """Descontar uso de un artículo. Para rollos pasa metros; para accesorios pasa cantidad."""
    item = await db.inventory.find_one({"id": item_id})
    if not item:
        raise HTTPException(status_code=404, detail="Artículo no encontrado")
    
    update = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if item["tipo_articulo"] == "rollo":
        if metros is None or metros <= 0:
            raise HTTPException(status_code=400, detail="metros > 0 requerido")
        new_remaining = max(0, (item.get("metros_restantes") or 0) - metros)
        update["metros_restantes"] = new_remaining
    else:
        if cantidad is None or cantidad <= 0:
            raise HTTPException(status_code=400, detail="cantidad > 0 requerida")
        new_remaining = max(0, (item.get("cantidad_restante") or 0) - cantidad)
        update["cantidad_restante"] = new_remaining
    
    await db.inventory.update_one({"id": item_id}, {"$set": update})
    
    # Log usage
    await db.inventory_movements.insert_one({
        "id": str(uuid.uuid4()),
        "inventory_item_id": item_id,
        "type": "deduct",
        "metros": metros,
        "cantidad": cantidad,
        "reason": reason,
        "order_id": order_id,
        "user_id": current_user["id"],
        "user_name": current_user.get("name") or current_user.get("email"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"message": "Descuento registrado", "remaining": update.get("metros_restantes") or update.get("cantidad_restante")}


@api_router.get("/inventory/movements")
async def list_inventory_movements(
    item_id: Optional[str] = None,
    limit: int = 100,
    current_user: dict = Depends(get_current_user)
):
    """Historial de movimientos del inventario."""
    query = {}
    if item_id:
        query["inventory_item_id"] = item_id
    movements = await db.inventory_movements.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return movements


# Auto-deduction helper (used by cutting complete)
def _meters_from_part_measurements(part_measurements: Optional[Dict[str, str]]) -> float:
    """Suma los metros lineales consumidos (en metros) a partir de las medidas por pieza.
    Toma la dimensión mayor de cada AxB (en cm) y la convierte a metros.
    """
    if not part_measurements:
        return 0.0
    total_m = 0.0
    import re
    for v in part_measurements.values():
        if not v or not str(v).strip():
            continue
        s = str(v).lower()
        nums = re.findall(r"\d+(?:[\.,]\d+)?", s)
        if not nums:
            continue
        try:
            dims = [float(x.replace(",", ".")) for x in nums[:2]]
            cm = max(dims) if dims else 0
            total_m += cm / 100.0
        except ValueError:
            continue
    return round(total_m, 2)

# ============================================================
# PAGOS · FACTURACIÓN ELECTRÓNICA · AUTORIZACIÓN DE SALIDA
# ============================================================
import base64 as _b64_pay


class PaymentRegister(BaseModel):
    order_id: str
    amount: float
    method: str  # 'efectivo' | 'tarjeta' | 'transferencia' | 'nequi' | 'daviplata' | 'otro'
    reference: Optional[str] = None
    notes: Optional[str] = None


def _order_balance(order: dict) -> Dict[str, float]:
    total = float(order.get("final_value") or order.get("negotiated_value") or 0)
    paid = float(order.get("amount_paid") or 0)
    return {"total": round(total, 2), "paid": round(paid, 2), "balance": round(max(total - paid, 0), 2)}


async def _send_email_with_attachments(
    recipient: str,
    subject: str,
    html: str,
    attachments: List[Dict[str, Any]] = None,
) -> Optional[str]:
    """Send email via Resend with optional attachments (base64 bytes)."""
    if not RESEND_API_KEY or not recipient:
        return None
    params = {
        "from": SENDER_EMAIL,
        "to": [recipient],
        "subject": subject,
        "html": html,
    }
    if attachments:
        params["attachments"] = attachments
    try:
        res = await asyncio.to_thread(resend.Emails.send, params)
        return (res or {}).get("id") if isinstance(res, dict) else None
    except Exception as e:
        logger.error(f"[email] Resend send failed: {e}")
        return None


def _pdf_attachment(name: str, data: bytes) -> Dict[str, Any]:
    return {"filename": name, "content": list(data)}


def _photo_attachment(name: str, data_url: str) -> Optional[Dict[str, Any]]:
    if not data_url:
        return None
    try:
        raw = data_url.split(",", 1)[1] if data_url.startswith("data:") else data_url
        return {"filename": name, "content": list(_b64_pay.b64decode(raw))}
    except Exception:
        return None


@api_router.post("/payments")
async def register_payment(
    data: PaymentRegister,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.FACTURACION, UserRole.ASESOR, UserRole.COORDINADOR])),
):
    """Registra un abono/pago sobre una orden. Acumula en order.amount_paid."""
    if data.amount is None or data.amount <= 0:
        raise HTTPException(status_code=400, detail="El monto debe ser mayor a 0")
    order = await db.orders.find_one({"id": data.order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")

    bal_before = _order_balance(order)
    if data.amount > bal_before["balance"] + 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"El monto excede el saldo pendiente ({bal_before['balance']:.0f}).",
        )

    payment_doc = {
        "id": str(uuid.uuid4()),
        "order_id": data.order_id,
        "order_code": order.get("order_code"),
        "plate": order.get("plate"),
        "client_name": order.get("client_name"),
        "client_cedula": order.get("client_cedula"),
        "amount": round(float(data.amount), 2),
        "method": data.method,
        "reference": data.reference,
        "notes": data.notes,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "created_by": current_user["id"],
        "created_by_name": current_user["name"],
    }
    await db.payments.insert_one(payment_doc)
    payment_doc.pop("_id", None)

    new_paid = round(bal_before["paid"] + float(data.amount), 2)
    total = bal_before["total"]
    new_balance = round(max(total - new_paid, 0), 2)
    update = {
        "amount_paid": new_paid,
        "last_payment_at": payment_doc["created_at"],
        "updated_at": payment_doc["created_at"],
    }
    if new_balance <= 0.01 and total > 0:
        update["ready_for_delivery"] = True
        # Si estaba en TERMINADO_FALTA_PAGO o servicio_completado, marcarlo como pagado
        if order.get("status") in (OrderStatus.SERVICIO_COMPLETADO.value, OrderStatus.TERMINADO_FALTA_PAGO.value):
            update["status"] = OrderStatus.TERMINADO_PAGADO.value
            update["payment_method"] = order.get("payment_method") or data.method
            update["paid_at"] = payment_doc["created_at"]
    await db.orders.update_one({"id": data.order_id}, {"$set": update})

    await log_order_history(
        data.order_id, "PAGO_REGISTRADO",
        order.get("status", ""), order.get("status", ""),
        current_user["id"], current_user["name"],
        {"amount": data.amount, "method": data.method, "reference": data.reference,
         "balance_after": new_balance},
    )

    # Enviar estado de cuenta por email si hay correo del cliente
    email_id = None
    if order.get("client_email"):
        try:
            order_after = await db.orders.find_one({"id": data.order_id}, {"_id": 0})
            payments = await db.payments.find(
                {"order_id": data.order_id}, {"_id": 0}
            ).sort("created_at", 1).to_list(100)
            pdf_bytes = build_payment_statement(order_after, payments)
            html = (
                f"<div style='font-family:Arial,sans-serif;color:#0f172a;'>"
                f"<h2 style='color:#00e0d1'>Recibimos tu pago</h2>"
                f"<p>Hola <b>{order.get('client_name')}</b>,</p>"
                f"<p>Registramos un abono de <b>${data.amount:,.0f}</b> "
                f"({data.method}) para la orden <b>{order.get('order_code')}</b>.</p>"
                f"<p>Saldo pendiente: <b>${new_balance:,.0f}</b>.</p>"
                f"<p>Adjuntamos el estado de cuenta en PDF.</p>"
                f"<p style='color:#64748b;font-size:12px'>— PolarizadosYA!</p>"
                f"</div>"
            )
            email_id = await _send_email_with_attachments(
                order["client_email"],
                f"Estado de cuenta · Orden {order.get('order_code')}",
                html,
                [_pdf_attachment(f"estado_cuenta_{order.get('order_code')}.pdf", pdf_bytes)],
            )
        except Exception as e:
            logger.error(f"[payment-email] {e}")

    return {
        "message": "Pago registrado",
        "payment": payment_doc,
        "balance": new_balance,
        "total": total,
        "paid": new_paid,
        "ready_for_delivery": new_balance <= 0.01 and total > 0,
        "email_sent": bool(email_id),
    }


@api_router.get("/payments")
async def list_payments(
    q: Optional[str] = None,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.FACTURACION, UserRole.ASESOR, UserRole.COORDINADOR])),
):
    """Lista pagos, opcionalmente filtrados por placa o cedula (case-insensitive)."""
    filt: Dict[str, Any] = {}
    if q:
        rx = re.compile(re.escape(q), re.IGNORECASE)
        filt["$or"] = [
            {"plate": rx},
            {"client_cedula": rx},
            {"client_name": rx},
            {"order_code": rx},
        ]
    items = await db.payments.find(filt, {"_id": 0}).sort("created_at", -1).to_list(200)
    return items


@api_router.get("/payments/order/{order_id}")
async def payments_for_order(order_id: str, current_user: dict = Depends(get_current_user)):
    items = await db.payments.find({"order_id": order_id}, {"_id": 0}).sort("created_at", 1).to_list(100)
    return items


@api_router.get("/orders-with-balance")
async def orders_with_balance(
    q: Optional[str] = None,
    only_pending: bool = False,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.FACTURACION, UserRole.ASESOR, UserRole.COORDINADOR])),
):
    """Órdenes recientes con su saldo. Filtro opcional por placa/cédula."""
    filt: Dict[str, Any] = {
        "status": {"$in": [
            OrderStatus.INGRESADO.value, OrderStatus.EN_REVISION.value,
            OrderStatus.EN_CORTE.value, OrderStatus.ASIGNADO.value,
            OrderStatus.EN_PROCESO.value, OrderStatus.SERVICIO_COMPLETADO.value,
            OrderStatus.TERMINADO_FALTA_PAGO.value, OrderStatus.TERMINADO_PAGADO.value,
        ]},
    }
    if q:
        rx = re.compile(re.escape(q), re.IGNORECASE)
        filt["$or"] = [
            {"plate": rx}, {"client_cedula": rx},
            {"client_name": rx}, {"order_code": rx},
        ]
    cursor = db.orders.find(filt, {"_id": 0}).sort("ingreso_at", -1).limit(200)
    out = []
    async for o in cursor:
        b = _order_balance(o)
        if only_pending and b["balance"] <= 0.01:
            continue
        out.append({
            "id": o["id"],
            "order_code": o.get("order_code"),
            "plate": o.get("plate"),
            "brand": o.get("brand"),
            "model": o.get("model"),
            "client_name": o.get("client_name"),
            "client_cedula": o.get("client_cedula"),
            "client_phone": o.get("client_phone"),
            "client_email": o.get("client_email"),
            "status": o.get("status"),
            "ingreso_at": o.get("ingreso_at"),
            "payment_method": o.get("payment_method"),
            "requires_invoice": bool(o.get("requires_invoice")),
            "profile_photo_url": o.get("profile_photo_url"),
            **b,
        })
    return out


@api_router.get("/orders-pending-release")
async def orders_pending_release(
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.FACTURACION, UserRole.COORDINADOR])),
):
    """Autos por autorizar salida: servicio completado y aún no entregados."""
    cursor = db.orders.find(
        {"status": {"$in": [
            OrderStatus.SERVICIO_COMPLETADO.value,
            OrderStatus.TERMINADO_FALTA_PAGO.value,
            OrderStatus.TERMINADO_PAGADO.value,
        ]},
         "delivered_at": {"$in": [None]}},
        {"_id": 0},
    ).sort("service_completed_at", -1).limit(200)
    out = []
    async for o in cursor:
        b = _order_balance(o)
        out.append({
            "id": o["id"],
            "order_code": o.get("order_code"),
            "plate": o.get("plate"),
            "brand": o.get("brand"),
            "model": o.get("model"),
            "client_name": o.get("client_name"),
            "client_phone": o.get("client_phone"),
            "client_email": o.get("client_email"),
            "status": o.get("status"),
            "service_completed_at": o.get("service_completed_at"),
            "ready_for_delivery": bool(o.get("ready_for_delivery")),
            "profile_photo_url": o.get("profile_photo_url"),
            "release_authorized_at": o.get("release_authorized_at"),
            "release_authorized_by": o.get("release_authorized_by_name"),
            **b,
        })
    return out


@api_router.post("/orders/{order_id}/authorize-release")
async def authorize_release(
    order_id: str,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.FACTURACION, UserRole.COORDINADOR])),
):
    """Autoriza la salida del auto. Requiere saldo = 0."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    b = _order_balance(order)
    if b["balance"] > 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"No se puede autorizar salida: falta pago de ${b['balance']:,.0f}",
        )
    now = datetime.now(timezone.utc).isoformat()
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {
            "release_authorized": True,
            "release_authorized_at": now,
            "release_authorized_by": current_user["id"],
            "release_authorized_by_name": current_user["name"],
            "ready_for_delivery": True,
            "updated_at": now,
        }},
    )
    await log_order_history(
        order_id, "SALIDA_AUTORIZADA",
        order.get("status", ""), order.get("status", ""),
        current_user["id"], current_user["name"], {},
    )
    return {"message": "Salida autorizada", "release_authorized_at": now}


@api_router.get("/orders-pending-invoice")
async def orders_pending_invoice(
    include_sent: bool = False,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.FACTURACION, UserRole.ASESOR])),
):
    """Clientes que solicitaron factura electrónica. Por defecto solo pendientes; con include_sent=true incluye las ya enviadas."""
    query = {"requires_invoice": True}
    if not include_sent:
        query["invoice_sent_at"] = {"$in": [None]}
    cursor = db.orders.find(query, {"_id": 0}).sort("ingreso_at", -1).limit(300)
    out = []
    async for o in cursor:
        b = _order_balance(o)
        out.append({
            "id": o["id"],
            "order_code": o.get("order_code"),
            "plate": o.get("plate"),
            "client_name": o.get("client_name"),
            "client_cedula": o.get("client_cedula"),
            "client_email": o.get("client_email"),
            "client_phone": o.get("client_phone"),
            "client_razon_social": o.get("client_razon_social"),
            "status": o.get("status"),
            "ingreso_at": o.get("ingreso_at"),
            "invoice_number": o.get("invoice_number"),
            "invoice_sent_at": o.get("invoice_sent_at"),
            "retention_applied": bool(o.get("retention_applied")),
            "retention_snapshot": o.get("retention_snapshot"),
            **b,
        })
    return out


class ApplyRetention(BaseModel):
    city: Optional[str] = None
    apply_reteica: bool = False
    reteica_rate: Optional[float] = None  # % ej: 0.966
    apply_retefuente: bool = False
    retefuente_rate: Optional[float] = None  # % ej: 2.5 o 6.9
    update_identity: bool = False
    new_cedula: Optional[str] = None
    new_razon_social: Optional[str] = None
    no_aplica: bool = False


@api_router.post("/orders/{order_id}/apply-retention")
async def apply_retention(
    order_id: str,
    data: ApplyRetention,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.FACTURACION, UserRole.ASESOR])),
):
    """Aplica retenciones (Reteica/Retefuente) sobre la orden y opcionalmente actualiza
    cédula/razón social. Requerido antes de enviar la factura electrónica."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")

    total = float(order.get("final_value") or order.get("negotiated_value") or 0)
    reteica_amt = 0.0
    retefuente_amt = 0.0

    if not data.no_aplica:
        if data.apply_reteica:
            if data.reteica_rate is None or data.reteica_rate < 0:
                raise HTTPException(status_code=400, detail="Tasa de Reteica inválida")
            reteica_amt = round(total * (data.reteica_rate / 100.0), 2)
        if data.apply_retefuente:
            if data.retefuente_rate is None or data.retefuente_rate < 0:
                raise HTTPException(status_code=400, detail="Tasa de Retefuente inválida")
            retefuente_amt = round(total * (data.retefuente_rate / 100.0), 2)

    total_ret = round(reteica_amt + retefuente_amt, 2)
    now = datetime.now(timezone.utc).isoformat()

    retention_doc = {
        "id": str(uuid.uuid4()),
        "order_id": order_id,
        "order_code": order.get("order_code"),
        "plate": order.get("plate"),
        "client_name": order.get("client_name"),
        "client_cedula": data.new_cedula if data.update_identity and data.new_cedula else order.get("client_cedula"),
        "city": data.city,
        "no_aplica": bool(data.no_aplica),
        "reteica_applied": bool(data.apply_reteica) and not data.no_aplica,
        "reteica_rate": data.reteica_rate,
        "reteica_amount": reteica_amt,
        "retefuente_applied": bool(data.apply_retefuente) and not data.no_aplica,
        "retefuente_rate": data.retefuente_rate,
        "retefuente_amount": retefuente_amt,
        "total_retention": total_ret,
        "order_total_before": total,
        "order_total_after": round(total - total_ret, 2),
        "identity_updated": bool(data.update_identity),
        "old_cedula": order.get("client_cedula") if data.update_identity else None,
        "old_razon_social": order.get("client_razon_social") if data.update_identity else None,
        "new_cedula": data.new_cedula if data.update_identity else None,
        "new_razon_social": data.new_razon_social if data.update_identity else None,
        "applied_at": now,
        "applied_by": current_user["id"],
        "applied_by_name": current_user["name"],
    }
    await db.retentions.insert_one(retention_doc)
    retention_doc.pop("_id", None)

    # Update order with retention snapshot
    order_update = {
        "retention_applied": True,
        "retention_snapshot": {
            "no_aplica": bool(data.no_aplica),
            "city": data.city,
            "reteica_rate": data.reteica_rate if data.apply_reteica and not data.no_aplica else None,
            "reteica_amount": reteica_amt,
            "retefuente_rate": data.retefuente_rate if data.apply_retefuente and not data.no_aplica else None,
            "retefuente_amount": retefuente_amt,
            "total_retention": total_ret,
        },
        "retention_applied_at": now,
        "retention_applied_by": current_user["name"],
        "updated_at": now,
    }
    if data.update_identity:
        if data.new_cedula:
            order_update["client_cedula"] = data.new_cedula
        if data.new_razon_social:
            order_update["client_razon_social"] = data.new_razon_social

    await db.orders.update_one({"id": order_id}, {"$set": order_update})

    # Propagar el cambio de identidad a TODAS las órdenes históricas/futuras del cliente
    if data.update_identity and (data.new_cedula or data.new_razon_social):
        # Match por client_name (case-insensitive) O por client_cedula previa
        query_or = []
        if order.get("client_name"):
            query_or.append({"client_name": order["client_name"]})
        if order.get("client_cedula"):
            query_or.append({"client_cedula": order["client_cedula"]})
        if query_or:
            propagate = {"updated_at": now}
            if data.new_cedula:
                propagate["client_cedula"] = data.new_cedula
            if data.new_razon_social:
                propagate["client_razon_social"] = data.new_razon_social
            await db.orders.update_many({"$or": query_or, "id": {"$ne": order_id}}, {"$set": propagate})

    return {"message": "Retención aplicada", "retention": retention_doc}


@api_router.get("/retentions")
async def list_retentions(
    q: Optional[str] = None,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.FACTURACION])),
):
    """Reporte de retenciones aplicadas (para sección Impuestos)."""
    filt = {}
    if q:
        rx = re.compile(re.escape(q), re.IGNORECASE)
        filt["$or"] = [
            {"plate": rx}, {"client_cedula": rx},
            {"client_name": rx}, {"order_code": rx}, {"city": rx},
        ]
    items = await db.retentions.find(filt, {"_id": 0}).sort("applied_at", -1).to_list(500)
    # Summary totals
    total_reteica = sum(float(r.get("reteica_amount") or 0) for r in items)
    total_retefuente = sum(float(r.get("retefuente_amount") or 0) for r in items)
    return {
        "items": items,
        "summary": {
            "count": len(items),
            "total_reteica": round(total_reteica, 2),
            "total_retefuente": round(total_retefuente, 2),
            "total_retention": round(total_reteica + total_retefuente, 2),
        },
    }


class UpdateClientEmail(BaseModel):
    client_email: str


@api_router.patch("/orders/{order_id}/client-email")
async def update_client_email(
    order_id: str,
    data: UpdateClientEmail,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.FACTURACION, UserRole.ASESOR])),
):
    """Actualiza el correo del cliente en la orden y propaga a todas sus órdenes históricas."""
    email = (data.client_email or "").strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Correo inválido")
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    now = datetime.now(timezone.utc).isoformat()
    await db.orders.update_one({"id": order_id}, {"$set": {"client_email": email, "updated_at": now}})
    # Propagate to all orders of same client (by name+cedula)
    query_or = []
    if order.get("client_cedula"):
        query_or.append({"client_cedula": order["client_cedula"]})
    if order.get("client_name"):
        query_or.append({"client_name": order["client_name"]})
    if query_or:
        await db.orders.update_many(
            {"$or": query_or, "id": {"$ne": order_id}},
            {"$set": {"client_email": email, "updated_at": now}},
        )
    return {"message": "Correo actualizado", "client_email": email}


@api_router.get("/orders/{order_id}/invoice-pdf")
async def download_invoice_pdf(
    order_id: str,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.FACTURACION, UserRole.ASESOR])),
):
    """Devuelve el PDF de la Factura Electrónica (MOCK) generada."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if not order.get("invoice_number"):
        raise HTTPException(status_code=400, detail="La factura aún no ha sido generada")
    pdf_bytes = build_mock_invoice(order, order["invoice_number"])
    from fastapi.responses import Response
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="factura_{order["invoice_number"]}.pdf"'
        },
    )


@api_router.post("/orders/{order_id}/send-invoice-email")
async def send_invoice_email(
    order_id: str,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.FACTURACION, UserRole.ASESOR])),
):
    """Envía una Factura Electrónica MOCK por correo. TODO: reemplazar con Siigo real.

    Requisito: el usuario debe haber aplicado retención (o marcado 'no aplica') antes.
    """
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if not order.get("client_email"):
        raise HTTPException(status_code=400, detail="El cliente no tiene correo registrado")
    if not order.get("retention_applied"):
        raise HTTPException(
            status_code=400,
            detail="Debes aplicar retención (o marcarla como 'no aplica') antes de enviar la factura."
        )

    # Numeración simulada tipo Siigo
    invoice_number = order.get("invoice_number") or f"MOCK-FE-{datetime.now(timezone.utc).strftime('%Y%m%d')}-{order.get('order_code','')}"
    pdf_bytes = build_mock_invoice(order, invoice_number)

    html = build_invoice_html(order, invoice_number, is_mock=True)
    email_id = await _send_email_with_attachments(
        order["client_email"],
        f"Tu factura electrónica {invoice_number} · PolarizadosYA!",
        html,
        [_pdf_attachment(f"factura_{invoice_number}.pdf", pdf_bytes)],
    )
    now = datetime.now(timezone.utc).isoformat()
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {
            "invoice_number": invoice_number,
            "invoice_sent_at": now,
            "invoice_sent_by": current_user["id"],
            "invoice_sent_by_name": current_user["name"],
            "updated_at": now,
        }},
    )
    await log_order_history(
        order_id, "FACTURA_ENVIADA",
        order.get("status", ""), order.get("status", ""),
        current_user["id"], current_user["name"],
        {"invoice_number": invoice_number, "email_id": email_id},
    )
    return {"message": "Factura enviada (MOCK)", "invoice_number": invoice_number, "email_id": email_id}


@api_router.post("/orders/{order_id}/send-ingreso-receipt")
async def send_ingreso_receipt(
    order_id: str,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ASESOR, UserRole.COORDINADOR])),
):
    """Reenvía el recibo de ingreso (PDF firmado + fotos 360°)."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if not order.get("client_email"):
        raise HTTPException(status_code=400, detail="El cliente no tiene correo registrado")

    pdf_bytes = build_ingreso_receipt(order)

    attachments = [_pdf_attachment(f"recibo_ingreso_{order.get('order_code')}.pdf", pdf_bytes)]
    # Adjuntar fotos 360 (limitar a 8 para no exceder ~25MB)
    photos = (order.get("inspection_photos") or [])[:8]
    for i, ph in enumerate(photos, start=1):
        att = _photo_attachment(f"revision_360_{i}.jpg", ph)
        if att:
            attachments.append(att)
    front = order.get("profile_photo_url")
    front_att = _photo_attachment("foto_frontal.jpg", front) if front else None
    if front_att:
        attachments.insert(1, front_att)

    photo_count = len(photos) + (1 if front_att else 0)
    html = build_ingreso_html(order, pdf_attached=True, photo_count=photo_count)
    email_id = await _send_email_with_attachments(
        order["client_email"],
        f"¡Recibo de ingreso! #{order.get('order_code')} · PolarizadosYA!",
        html,
        attachments,
    )
    return {"message": "Recibo enviado", "email_id": email_id, "photos": len(photos)}


# ============================================================
# SEED de orden de prueba para probar Pagos / Facturación / Salida
# ============================================================
@api_router.post("/seed/test-orders")
async def seed_test_orders(current_user: dict = Depends(require_roles([UserRole.ADMIN]))):
    """Crea unas órdenes de prueba en distintos estados para poblar Pagos, Facturación y Salida."""
    now = datetime.now(timezone.utc).isoformat()
    samples = [
        {
            "client_name": "Carlos Pérez", "client_cedula": "1023456789",
            "client_phone": "3001112233", "client_email": None,
            "plate": "ABC123", "brand": "Mazda", "model": "CX-5",
            "final_value": 900000, "amount_paid": 300000,
            "status": OrderStatus.SERVICIO_COMPLETADO.value,
            "payment_method": "efectivo", "requires_invoice": False,
        },
        {
            "client_name": "Laura Gómez", "client_cedula": "52912345",
            "client_phone": "3145556677", "client_email": None,
            "plate": "XYZ789", "brand": "Toyota", "model": "Corolla",
            "final_value": 1200000, "amount_paid": 1200000,
            "status": OrderStatus.TERMINADO_PAGADO.value,
            "payment_method": "tarjeta", "requires_invoice": True,
            "ready_for_delivery": True,
        },
        {
            "client_name": "Andrés Rojas", "client_cedula": "80123456",
            "client_phone": "3009998877", "client_email": None,
            "plate": "GHI456", "brand": "Renault", "model": "Duster",
            "final_value": 650000, "amount_paid": 0,
            "status": OrderStatus.INGRESADO.value,
            "payment_method": "transferencia", "requires_invoice": True,
        },
    ]
    created = []
    for s in samples:
        exists = await db.orders.find_one({"plate": s["plate"], "client_cedula": s["client_cedula"]}, {"_id": 0})
        if exists:
            continue
        oid = str(uuid.uuid4())
        code = f"OT-{''.join(random.choices(string.ascii_uppercase + string.digits, k=6))}"
        doc = {
            "id": oid, "order_code": code, "qr_code": "",
            "client_name": s["client_name"], "client_phone": s["client_phone"],
            "client_email": s.get("client_email"), "client_cedula": s["client_cedula"],
            "plate": s["plate"], "brand": s["brand"], "model": s["model"],
            "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "time_slot": "seed", "services": [{"service": "Polarizado Ceramic i3", "price": s["final_value"]}],
            "negotiated_value": s["final_value"], "final_value": s["final_value"],
            "amount_paid": s.get("amount_paid", 0),
            "status": s["status"], "signature_url": None, "risk_agreement_accepted": True,
            "ingreso_at": now, "inspection_photos": [],
            "assigned_technician_id": None, "assigned_technician_name": None,
            "payment_method": s.get("payment_method"),
            "requires_invoice": s.get("requires_invoice", False),
            "profile_photo_url": None,
            "route_slots": [], "route_rule_id": None, "route_rule_name": None,
            "service_completed_at": now if s["status"] in (OrderStatus.SERVICIO_COMPLETADO.value, OrderStatus.TERMINADO_PAGADO.value) else None,
            "ready_for_delivery": s.get("ready_for_delivery", False),
            "created_by": current_user["id"], "created_by_name": current_user["name"],
            "created_by_role": current_user["role"],
            "created_at": now, "updated_at": now,
        }
        await db.orders.insert_one(doc)
        created.append({"id": oid, "order_code": code, "plate": s["plate"]})
    return {"created": created, "count": len(created)}


# ============================================================
# CUTTING CATALOG · Promedios y materiales
# ============================================================

@api_router.get("/cutting/materials-catalog")
async def get_materials_catalog(current_user: dict = Depends(get_current_user)):
    """Catálogo de materiales agrupados en 3 categorías + rollos físicos."""
    return {
        "material_1": MATERIALS_CATALOG["material_1"],
        "material_2": MATERIALS_CATALOG["material_2"],
        "material_3": MATERIALS_CATALOG["material_3"],
        "rolls": ROLLS_LIST,
    }


@api_router.get("/cutting/car-average")
async def get_car_average(
    brand: Optional[str] = None,
    model: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Promedio de material (m) para una marca+modelo. Devuelve null si no hay match."""
    if not brand and not model:
        return {"found": False, "brand": brand, "model": model, "promedio_m": None}
    row = lookup_car_average(brand or "", model or "")
    if not row:
        return {"found": False, "brand": brand, "model": model, "promedio_m": None}
    return {
        "found": True,
        "brand": row["brand"],
        "model": row["model"],
        "promedio_m": row["promedio_m"],
    }


@api_router.get("/cutting/car-averages")
async def list_car_averages(current_user: dict = Depends(get_current_user)):
    """Listado completo de marcas+modelos con promedio (útil para autocompletar en UI)."""
    return CAR_AVERAGES


@api_router.post("/seed/cutting-catalog")
async def seed_cutting_catalog(current_user: dict = Depends(require_roles([UserRole.ADMIN]))):
    """Carga los rollos del xlsx al inventario. Skip si ya existe por nombre (case-insensitive)."""
    existing = await db.inventory.find({}, {"_id": 0, "name": 1}).to_list(2000)
    existing_names = {(i.get("name") or "").strip().lower() for i in existing}
    created = []
    skipped = []
    now = datetime.now(timezone.utc).isoformat()
    for roll_name in ROLLS_LIST:
        key = roll_name.strip().lower()
        if key in existing_names:
            skipped.append(roll_name)
            continue
        item = {
            "id": str(uuid.uuid4()),
            "name": roll_name,
            "type": "rollo",
            "tipo_rollo": roll_name,
            "total_amount": 0,
            "unit": "m",
            "sede_id": None,
            "created_at": now,
            "updated_at": now,
            "created_by": current_user["id"],
            "created_by_name": current_user["name"],
        }
        await db.inventory.insert_one(item)
        item.pop("_id", None)
        created.append(roll_name)
        existing_names.add(key)
    return {
        "created_count": len(created),
        "skipped_count": len(skipped),
        "created": created,
        "skipped": skipped,
    }


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
