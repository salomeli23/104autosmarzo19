from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, UploadFile, File, BackgroundTasks
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict
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
    confirmation_pin: Optional[str] = None  # PIN de confirmación para evitar duplicados

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
    ppf_vehicle_serial: Optional[str] = None
    ppf_vehicle_model: Optional[str] = None
    # Bahia data
    bahia_id: Optional[str] = None
    bahia_name: Optional[str] = None
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
    risk_agreement_accepted: bool = False

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
    # Validate confirmation PIN
    settings = await db.settings.find_one({"key": "booking_pin"}, {"_id": 0})
    expected_pin = (settings or {}).get("value", "00000")
    
    if not order.confirmation_pin:
        raise HTTPException(status_code=400, detail="PIN de confirmación requerido")
    if str(order.confirmation_pin).strip() != str(expected_pin).strip():
        raise HTTPException(status_code=400, detail="PIN de confirmación incorrecto")
    
    # Block duplicate: same plate + same date (excluding desistimiento)
    plate_upper = order.plate.upper()
    existing = await db.orders.find_one({
        "plate": plate_upper,
        "date": order.date,
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
    
    # Calculate specific scheduled time based on queue position
    scheduled_time = await calculate_scheduled_time(order.date, order.time_slot)
    
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
        "scheduled_time": scheduled_time,  # Hora específica de la cita
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
                html_content = generate_appointment_email_html(order)
                params = {
                    "from": SENDER_EMAIL,
                    "to": [email],
                    "subject": f"Polarizados Manager - Confirmación de Cita #{order.get('order_code', '')}",
                    "html": html_content
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
    
    INTERVAL_MIN = 15
    
    # Determine earliest acceptable minute (relative to day)
    earliest_min = start_total_min
    now_colombia = get_colombia_time()
    today_str = now_colombia.strftime("%Y-%m-%d")
    if date_str == today_str:
        current_total_min = now_colombia.hour * 60 + now_colombia.minute
        if current_total_min > start_total_min:
            offset = current_total_min - start_total_min
            steps = math.ceil(offset / INTERVAL_MIN)
            earliest_min = start_total_min + steps * INTERVAL_MIN
    
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
    
    # Validate check-in time based on scheduled time
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
    
    update_data = {
        "services": [s.model_dump() for s in data.services],
        "final_value": data.final_value,
        "signature_url": data.signature_url,
        "client_cedula": data.cedula_number,
        "risk_agreement_accepted": data.risk_agreement_accepted,
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
    
    # Log history
    await log_order_history(
        data.order_id, "PAGO_PROCESADO",
        OrderStatus.SERVICIO_COMPLETADO.value, new_status,
        current_user["id"], current_user["name"],
        {"payment_method": data.payment_method, "discount_amount": data.discount_amount}
    )
    
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

@api_router.put("/bahias/{bahia_id}/release")
async def release_bahia(bahia_id: str, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.COORDINADOR]))):
    """Release a bahia (remove current order)"""
    await db.bahias.update_one(
        {"id": bahia_id},
        {"$set": {"current_order_id": None, "assigned_at": None}}
    )
    return {"message": "Bahía liberada"}

# ==================== CUTTING MODULE ====================
@api_router.get("/cutting/pending")
async def get_cutting_pending(current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.CORTE, UserRole.COORDINADOR]))):
    """Get orders pending cutting (polarizado/PPF services after check-in)"""
    # Services that require cutting
    cutting_services = [
        "nanooptik", "black_ceramic_autobahn", "ultraoptik_aswf", 
        "ceramic_i3_autobahn", "ceramic_i3_plus_autobahn", "huperoptik",
        "ultrasecure", "ppf_matte", "ppf_brillante", "matte", "brillante",
        "proteccion_ppf", "wrap"
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
    }
    if ppf_vehicle_serial is not None:
        update_fields["ppf_vehicle_serial"] = ppf_vehicle_serial
    if ppf_vehicle_model is not None:
        update_fields["ppf_vehicle_model"] = ppf_vehicle_model
    
    await db.orders.update_one({"id": order_id}, {"$set": update_fields})
    
    # Create alert for coordinator
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
    
    return {"message": "Corte completado", "status": "completado"}

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
