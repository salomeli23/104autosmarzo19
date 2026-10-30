from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, UploadFile, File, BackgroundTasks
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi import Response as FastAPIResponse
from bson import Binary as BsonBinary
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import json
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
from installer_rates import claim_label, compute_advisor_commission, compute_installer_charge, rates_table
from pdf_utils import build_ingreso_receipt, build_payment_statement, build_mock_invoice, build_exit_certificate, build_retention_certificate
from cutting_catalog import (CAR_AVERAGES, MATERIALS_CATALOG, ROLLS_LIST, CUTTING_REFERENCE_GROUPS,
                             DEFAULT_ROLL_METERS, lookup_car_average)
from email_templates import (
    build_appointment_confirmation_html,
    build_ingreso_html,
    build_invoice_html,
    qr_attachment,
    qr_png_bytes,
    appointment_qr_attachments,
    public_qr_url,
    brand_attachments,
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
    ACCESORIOS = "accesorios"  # Despacha accesorios del inventario al técnico instalador
    CALIDAD = "calidad"  # Control de calidad después de la instalación
    SEGURIDAD = "seguridad"  # Jefe de seguridad: recibe el certificado de salida y controla la portería
    LIQUIDACIONES = "liquidaciones"  # Coordinador de liquidaciones: aprueba y paga los cobros de los técnicos

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
    EN_CALIDAD = "en_calidad"  # Instalación terminada, en control de calidad
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
    SOLICITUD_ACCESORIOS = "solicitud_accesorios"  # Pedido de accesorios por despachar
    ACCESORIOS_ENTREGADOS = "accesorios_entregados"  # Accesorios entregados al técnico
    MEDIDAS_TECNICO = "medidas_tecnico"  # El técnico confirmó las medidas para corte
    MATERIAL_ENTREGADO = "material_entregado"  # Corte entregó el material al técnico
    CONTROL_CALIDAD = "control_calidad"  # Vehículo listo para revisión de calidad
    CALIDAD_RECHAZADA = "calidad_rechazada"  # Calidad devolvió el vehículo a instalación
    LISTO_ENTREGA = "listo_entrega"  # Calidad aprobada: listo para entrega
    CERTIFICADO_SALIDA = "certificado_salida"  # Certificado de salida emitido
    COBRO_TECNICO = "cobro_tecnico"  # Un técnico pidió el cobro de un servicio terminado
    COBRO_REVISADO = "cobro_revisado"  # Liquidaciones aprobó, rechazó o pagó el cobro

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

def _cop(value) -> str:
    """Pesos colombianos con punto de miles: $500.000"""
    return "$" + f"{float(value or 0):,.0f}".replace(",", ".")

def _quality_entry_fields(now: str) -> dict:
    """Campos al terminar la instalación: el vehículo pasa a control de calidad."""
    return {
        "status": OrderStatus.EN_CALIDAD.value,
        "quality_required": True,
        "quality_status": "pendiente",
        "quality_sent_at": now,
    }

async def _notify_quality(order: dict):
    """Avisa a Calidad y al coordinador que el vehículo está listo para revisión (con alerta si no ha pagado)."""
    pay = _payment_status(order)
    pay_txt = " · ⚠ El cliente NO ha pagado" if pay == "pending" else " · ⚠ Pago parcial" if pay == "partial" else ""
    msg = f"Vehículo {order.get('plate')} - {order.get('client_name')} terminó instalación{pay_txt}"
    for role in (UserRole.CALIDAD.value, UserRole.COORDINADOR.value):
        await create_alert(role, AlertType.CONTROL_CALIDAD, "Vehículo listo para control de calidad", msg, order.get("id"))

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
    "en_proceso": ["en_calidad", "servicio_completado", "desistimiento"],
    "en_calidad": ["servicio_completado", "terminado_pagado", "en_proceso", "desistimiento"],
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
    # PPF-specific (Full Body o Partes)
    ppf_scope: Optional[str] = None  # 'full' | 'partes'
    ppf_parts_description: Optional[str] = None  # texto libre describiendo las partes
    ppf_finish: Optional[str] = None  # 'brillante' | 'mate'
    ppf_color: Optional[str] = None  # color escrito por el asesor
    ppf_zones: Optional[List[str]] = None  # ['interior', 'exterior'] (solo plan partes)
    ppf_parts: Optional[List[str]] = None  # ['Bomper', 'Capot', ...] (solo plan partes)
    # Extras aplicados a este servicio (id de service_extras y precio congelado al momento)
    extras: Optional[List[Dict[str, Any]]] = None  # [{id, nombre, price}]
    # Solo en postventa: el servicio se marca sin pago (valor 0)
    no_charge: Optional[bool] = None
    # Ultrasecure: película de polarizado elegida y precio sugerido de la tabla (el precio final es editable)
    film: Optional[str] = None
    film_label: Optional[str] = None
    list_price: Optional[float] = None

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
    # Código de descuento (opcional)
    discount_code: Optional[str] = None
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
    assigned_technician_2_id: Optional[str] = None  # técnico de apoyo
    assigned_technician_2_name: Optional[str] = None
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
    discount_type: Optional[str] = None  # 'percentage' | 'fixed'
    discount_value: Optional[float] = None
    discount_applied_at: Optional[str] = None
    discount_applied_stage: Optional[str] = None  # 'appointment' | 'checkin'
    paid_at: Optional[str] = None
    # Entrega data
    delivery_photo_url: Optional[str] = None
    delivered_at: Optional[str] = None
    # Cutting data
    cutting_status: Optional[str] = None
    tech_measurements: Optional[Dict[str, Any]] = None  # medidas sugeridas por el técnico
    material_delivered_at: Optional[str] = None
    material_delivered_by_name: Optional[str] = None
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
    # Reagendación
    rescheduled_at: Optional[str] = None
    rescheduled_by: Optional[str] = None
    reschedule_count: Optional[int] = 0
    # Postventa / Garantía
    is_postventa: Optional[bool] = False
    postventa_type: Optional[str] = None  # 'garantia' | 'postventa'
    postventa_motivo: Optional[str] = None
    original_order_id: Optional[str] = None
    # Metadata
    created_by: str
    created_by_name: Optional[str] = None
    # Asesor que realizó el check-in
    checkin_by_id: Optional[str] = None
    checkin_by_name: Optional[str] = None
    signed_order_pdf_url: Optional[str] = None
    # Última actualización de servicios/valores (botón "Actualizar orden")
    last_updated_at: Optional[str] = None
    last_updated_by_name: Optional[str] = None
    accessory_status: Optional[str] = None  # pendiente | despachado | entregado
    # Control de calidad y certificado de salida
    quality_required: Optional[bool] = None
    quality_status: Optional[str] = None  # pendiente | aprobado | rechazado
    quality_sent_at: Optional[str] = None
    quality_checked_at: Optional[str] = None
    quality_by_name: Optional[str] = None
    quality_notes: Optional[str] = None
    quality_answers: Optional[List[Dict[str, Any]]] = None
    quality_photos: Optional[List[str]] = None
    quality_video_url: Optional[str] = None
    quality_rejections: Optional[int] = None
    quality_rating: Optional[int] = None  # calificación de calidad 1-5
    quality_reviews: Optional[List[Dict[str, Any]]] = None  # historial de revisiones de calidad
    installed_services: Optional[List[Dict[str, Any]]] = None  # servicios que el técnico marcó como instalados
    installed_by_name: Optional[str] = None
    exit_certificate: Optional[Dict[str, Any]] = None
    security_exit_at: Optional[str] = None
    security_exit_by_name: Optional[str] = None
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
    payment_method: Optional[str] = None  # 'efectivo' | 'tarjeta' | 'transferencia' | 'sin_pago' (solo postventa)
    requires_invoice: bool = False  # si True, se añadió IVA 19%
    discount_code: Optional[str] = None  # código de descuento opcional (solo si la orden no tiene uno)
    order_pdf: Optional[str] = None  # PDF de la orden firmada por el cliente (data URI base64)

class InspectionData(BaseModel):
    order_id: str
    photos: List[str]
    video_url: Optional[str] = None
    notes: Optional[str] = None

class AssignTechnician(BaseModel):
    order_id: str
    technician_id: str
    service_time_minutes: Optional[int] = None


class AssignTechnicians(BaseModel):
    technician_ids: List[str]  # técnico principal y técnico de apoyo (1 o 2)
    service_time_minutes: Optional[int] = None

class TechnicianReport(BaseModel):
    order_id: str
    notes: str
    completion_photos: Optional[List[str]] = None  # base64 data URLs, mín. 5 y máx. 10
    installed_services: Optional[List[int]] = None  # posiciones de order.services que el técnico instaló

MIN_COMPLETION_PHOTOS = 5

def _service_label(svc) -> str:
    if isinstance(svc, dict):
        return svc.get("description") or svc.get("service") or "Servicio"
    return str(svc)

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

# ==================== DISCOUNT CODES ====================
DISCOUNT_ADMIN_PASSWORD = os.environ.get('DISCOUNT_ADMIN_PASSWORD', '')

class DiscountCodeCreate(BaseModel):
    code: str
    discount_type: str  # 'percentage' | 'fixed'
    discount_value: float
    expires_at: Optional[str] = None  # ISO date 'YYYY-MM-DD'
    active: bool = True
    admin_password: str
    notes: Optional[str] = None
    kind: str = "codigo"  # 'cupon' | 'codigo'
    max_uses: Optional[int] = None  # None = usos ilimitados

class DiscountCodeUpdate(BaseModel):
    discount_type: Optional[str] = None
    discount_value: Optional[float] = None
    expires_at: Optional[str] = None
    active: Optional[bool] = None
    notes: Optional[str] = None
    kind: Optional[str] = None
    max_uses: Optional[int] = None  # 0 = quitar el límite
    admin_password: str

DISCOUNT_KINDS = ("cupon", "codigo")

def _is_discount_exhausted(doc: dict) -> bool:
    limit = (doc or {}).get("max_uses")
    return bool(limit) and int((doc or {}).get("usage_count") or 0) >= int(limit)

class DiscountAdminAuth(BaseModel):
    admin_password: str

def _normalize_code(code: str) -> str:
    return (code or "").strip().upper()

def _is_discount_expired(doc: dict) -> bool:
    exp = (doc or {}).get("expires_at")
    if not exp:
        return False
    try:
        # Format YYYY-MM-DD => expired al terminar ese día
        exp_date = datetime.strptime(exp, "%Y-%m-%d").date()
        today = get_colombia_time().date()
        return today > exp_date
    except Exception:
        return False

def _compute_discount_amount(subtotal: float, dtype: str, dvalue: float) -> float:
    """Devuelve el monto absoluto a descontar (nunca mayor al subtotal)."""
    try:
        subtotal = float(subtotal or 0)
        dvalue = float(dvalue or 0)
    except Exception:
        return 0.0
    if subtotal <= 0 or dvalue <= 0:
        return 0.0
    if (dtype or "").lower() == "percentage":
        return round(min(subtotal * dvalue / 100.0, subtotal), 2)
    return round(min(dvalue, subtotal), 2)


def _price_with_discount_and_iva(base: float, dtype: Optional[str], dvalue: Optional[float], with_iva: bool) -> Dict[str, float]:
    """Valor de la orden: el descuento se aplica sobre la base (sin IVA) y el IVA 19% sobre lo que queda.
    Es el mismo cálculo que muestran el check-in y el PDF de la orden. Redondeo al peso."""
    base = float(base or 0)
    discount = _round_peso(_compute_discount_amount(base, dtype, dvalue)) if dtype else 0
    tax_base = max(base - discount, 0)
    iva = _round_peso(tax_base * IVA_RATE) if with_iva else 0
    return {"base": base, "discount": discount, "tax_base": tax_base, "iva": iva, "total": tax_base + iva}

async def _resolve_discount_code(code: str) -> Optional[dict]:
    """Busca un código activo y vigente. Devuelve el documento o None."""
    norm = _normalize_code(code)
    if not norm:
        return None
    doc = await db.discount_codes.find_one({"code": norm}, {"_id": 0})
    if not doc:
        return None
    if not doc.get("active", True):
        return None
    if _is_discount_expired(doc):
        return None
    if _is_discount_exhausted(doc):
        return None
    return doc

# ==================== AUTH ENDPOINTS ====================
@api_router.post("/auth/register", response_model=TokenResponse)
async def register(user_data: UserCreate, current_user: dict = Depends(require_roles([UserRole.ADMIN]))):
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

IVA_RATE = 0.19


def _round_peso(value: float) -> int:
    """Redondeo al peso (mitad hacia arriba), como en la liquidación de retenciones."""
    return int(float(value) + 0.5)


def _retention_base(order: dict) -> Dict[str, float]:
    """Las retenciones se liquidan sobre la base gravable (valor antes de IVA), no sobre el total."""
    total = float(order.get("final_value") or order.get("negotiated_value") or 0)
    if order.get("requires_invoice"):
        # tax_base: base gravable guardada en el check-in (ya con el descuento); órdenes anteriores: total / 1,19
        base = order.get("tax_base")
        base = _round_peso(total / (1 + IVA_RATE)) if base is None else base
    else:
        base = total
    return {"base": base, "iva": round(total - base, 2), "total": total}


def _order_retention(order: dict) -> float:
    """Valor retenido por el cliente (Reteica + Retefuente): se descuenta de lo que debe pagar."""
    snap = order.get("retention_snapshot") or {}
    return float(snap.get("total_retention") or 0) if order.get("retention_applied") else 0.0


def _payment_status(order: dict) -> str:
    """Devuelve 'paid' | 'partial' | 'pending' desde datos de facturación."""
    total = float(order.get("final_value") or order.get("negotiated_value") or 0) - _order_retention(order)
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
    completion_photos: Optional[List[str]] = None  # base64 data URLs, mín. 5 y máx. 10


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
    if len([p for p in ((data.completion_photos if data else None) or []) if p]) < MIN_COMPLETION_PHOTOS:
        raise HTTPException(status_code=400, detail=f"Adjunta mínimo {MIN_COMPLETION_PHOTOS} fotos del servicio terminado")
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
        now = datetime.now(timezone.utc).isoformat()
        if order.get("is_postventa"):
            update_fields["status"] = OrderStatus.SERVICIO_COMPLETADO.value
        else:
            update_fields.update(_quality_entry_fields(now))
        update_fields["service_completed_at"] = now
    await db.orders.update_one({"id": order_id}, {"$set": update_fields})
    if all_done and not order.get("is_postventa"):
        await _notify_quality(order)
    return {"message": "Slot completado", "all_done": all_done}


class UserRoleUpdate(BaseModel):
    role: UserRole


@api_router.put("/users/{user_id}/role")
async def update_user_role(user_id: str, data: UserRoleUpdate, current_user: dict = Depends(require_roles([UserRole.ADMIN]))):
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="No puedes cambiar tu propio rol")
    res = await db.users.update_one({"id": user_id}, {"$set": {"role": data.role.value}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return {"message": "Rol actualizado", "role": data.role.value}


class UserPasswordReset(BaseModel):
    new_password: str


@api_router.put("/users/{user_id}/password")
async def reset_user_password(user_id: str, data: UserPasswordReset, current_user: dict = Depends(require_roles([UserRole.ADMIN]))):
    """El admin pone una nueva contraseña a un usuario (p. ej. cuando la olvida)."""
    pwd = data.new_password or ""
    if len(pwd) < 6:
        raise HTTPException(status_code=400, detail="La contraseña debe tener al menos 6 caracteres")
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, "name": 1})
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    now = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"id": user_id}, {"$set": {
        "password": hash_password(pwd),
        "password_reset_at": now,
        "password_reset_by": current_user["id"],
    }})
    logger.info(f"[users] contraseña restablecida para {user_id} por {current_user['id']}")
    return {"message": f"Contraseña actualizada para {user['name']}"}


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
    elif order.is_postventa and order.authorization_code is not None:
        # Postventa agendada desde "Nueva Cita": contraseña propia (default 00000)
        pv_settings = await db.settings.find_one({"key": "postventa_pin"}, {"_id": 0})
        expected_postventa = (pv_settings or {}).get("value", "00000")
        if str(order.authorization_code).strip() != str(expected_postventa).strip():
            raise HTTPException(status_code=400, detail="Contraseña de postventa incorrecta")
    else:
        if not order.confirmation_pin:
            raise HTTPException(status_code=400, detail="PIN de confirmación requerido")
        if str(order.confirmation_pin).strip() != str(expected_pin).strip():
            raise HTTPException(status_code=400, detail="PIN de confirmación incorrecto")

    # "Sin pago" solo se permite en servicios de postventa, y siempre vale 0
    if any(s.no_charge for s in order.services):
        if not order.is_postventa:
            raise HTTPException(status_code=400, detail="Solo los servicios de postventa pueden marcarse sin pago")
        for s in order.services:
            if s.no_charge:
                s.price = 0
    
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
    
    # Resolver código de descuento (si se envió)
    disc_doc = None
    disc_amount = 0.0
    if order.discount_code:
        disc_doc = await _resolve_discount_code(order.discount_code)
        if not disc_doc:
            raise HTTPException(status_code=400, detail="Código de descuento inválido, inactivo, vencido o agotado")
        disc_amount = _compute_discount_amount(
            order.negotiated_value, disc_doc.get("discount_type"), disc_doc.get("discount_value")
        )
    
    # Valor negociado neto (ya con descuento aplicado)
    net_value = round(max(float(order.negotiated_value) - disc_amount, 0), 2)
    
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
        "negotiated_value": net_value,
        "negotiated_value_before_discount": float(order.negotiated_value),
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
        "discount_code": disc_doc.get("code") if disc_doc else None,
        "discount_amount": disc_amount if disc_doc else None,
        "discount_type": disc_doc.get("discount_type") if disc_doc else None,
        "discount_value": disc_doc.get("discount_value") if disc_doc else None,
        "discount_applied_at": datetime.now(timezone.utc).isoformat() if disc_doc else None,
        "discount_applied_stage": "appointment" if disc_doc else None,
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
    
    # Incrementar contador de uso del código de descuento
    if disc_doc:
        try:
            await db.discount_codes.update_one(
                {"code": disc_doc["code"]},
                {"$inc": {"usage_count": 1}, "$set": {"last_used_at": datetime.now(timezone.utc).isoformat()}}
            )
        except Exception as _e:
            logger.warning(f"[discount] no se pudo incrementar uso de {disc_doc.get('code')}: {_e}")
    
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
            {"assigned_technician_2_id": current_user["id"]},
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
    qr_url = public_qr_url(order.get("order_code", ""))
    qr_line = f"\n🔳 Tu QR de la cita: {qr_url}" if qr_url else ""
    
    message = f"""🚗 *Polarizados Manager - Confirmación de Cita*

📋 *Código de Cita:* {order.get('order_code', 'N/A')}

👤 *Cliente:* {order.get('client_name', 'N/A')}
🚙 *Vehículo:* {order.get('plate', 'N/A')} - {order.get('brand', '')} {order.get('model', '')}

📅 *Fecha:* {order.get('date', 'N/A')}
⏰ *Hora:* {order.get('scheduled_time', 'Por confirmar')}

🔧 *Servicios:*
{services_text}
💰 *Total:* ${order.get('negotiated_value', 0):,.0f}

📱 Presente este código al momento de ingresar.{qr_line}
✅ El check-in estará disponible a partir de las {order.get('scheduled_time', 'hora indicada')}

_Polarizados Manager - Servicio de Calidad_"""
    
    return message

async def _log_notification(order_id: str, channel: str, to: str, success: bool, user: dict, error: str = None):
    """Registra en la orden cada envío de la cita (correo) o apertura de WhatsApp."""
    now = datetime.now(timezone.utc).isoformat()
    entry = {"channel": channel, "to": to, "success": success, "at": now,
             "by": user.get("name") or user.get("email"), "error": error}
    update = {"$push": {"notifications_log": {"$each": [entry], "$slice": -20}}}
    if success:
        update["$set"] = {f"last_{channel}_at": now, f"last_{channel}_to": to}
    await db.orders.update_one({"id": order_id}, update)


@api_router.get("/notifications/appointments")
async def list_appointment_notifications(
    q: Optional[str] = None,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ASESOR, UserRole.COORDINADOR])),
):
    """Citas agendadas para reenviar la notificación o corregir el contacto.
    Sin búsqueda: citas de hoy en adelante. Con búsqueda: código, placa, cliente, teléfono o correo."""
    query: Dict[str, Any] = {"status": OrderStatus.AGENDADO.value}
    term = (q or "").strip()
    if term:
        rx = {"$regex": re.escape(term), "$options": "i"}
        query["$or"] = [{"order_code": rx}, {"plate": rx}, {"client_name": rx},
                        {"client_phone": rx}, {"client_email": rx}]
    else:
        query["date"] = {"$gte": get_colombia_time().strftime("%Y-%m-%d")}
    fields = {"_id": 0, "id": 1, "order_code": 1, "plate": 1, "brand": 1, "model": 1, "client_name": 1,
              "client_phone": 1, "client_email": 1, "date": 1, "scheduled_time": 1, "time_slot": 1,
              "status": 1, "is_postventa": 1, "notifications_log": 1,
              "last_email_at": 1, "last_email_to": 1, "last_whatsapp_at": 1, "last_whatsapp_to": 1}
    return await db.orders.find(query, fields).sort([("date", 1), ("scheduled_time", 1)]).to_list(300)


class UpdateClientContact(BaseModel):
    client_phone: Optional[str] = None
    client_email: Optional[EmailStr] = None
    reason: Optional[str] = None


@api_router.patch("/orders/{order_id}/client-contact")
async def update_client_contact(
    order_id: str,
    data: UpdateClientContact,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ASESOR, UserRole.COORDINADOR])),
):
    """Corrige el teléfono y/o el correo del cliente en la cita."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    changes: Dict[str, Any] = {}
    if data.client_phone is not None:
        phone = data.client_phone.strip()
        digits = "".join(ch for ch in phone if ch.isdigit())
        if not 7 <= len(digits) <= 15:
            raise HTTPException(status_code=400, detail="Teléfono inválido")
        if phone != (order.get("client_phone") or ""):
            changes["client_phone"] = phone
    if data.client_email is not None:
        email = str(data.client_email).strip().lower()
        if email != (order.get("client_email") or "").lower():
            changes["client_email"] = email
    if not changes:
        return {"message": "Sin cambios", "order": order}

    now = datetime.now(timezone.utc).isoformat()
    await db.orders.update_one({"id": order_id}, {"$set": {**changes, "updated_at": now}})
    await log_order_history(
        order_id, "CONTACTO_ACTUALIZADO",
        order.get("status"), order.get("status"),
        current_user["id"], current_user["name"],
        {"reason": data.reason,
         **{f"old_{k}": order.get(k) for k in changes},
         **{f"new_{k}": v for k, v in changes.items()}},
    )
    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    return {"message": "Contacto actualizado", "order": updated}


@api_router.post("/notifications/send")
async def send_notification(data: NotificationRequest, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ASESOR, UserRole.COORDINADOR]))):
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
            await _log_notification(order["id"], "whatsapp", clean_phone, True, current_user)
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
                    "attachments": [*appointment_qr_attachments(order.get('order_code', ''), cid="qr-code"), *brand_attachments()],
                }
                email_result = await asyncio.to_thread(resend.Emails.send, params)
                results["email"] = {"success": True, "email_id": email_result.get("id"), "sent_to": email}
                await _log_notification(order["id"], "email", email, True, current_user)
            except Exception as e:
                logger.error(f"Failed to send email: {str(e)}")
                results["email"] = {"success": False, "error": str(e)}
                await _log_notification(order["id"], "email", email, False, current_user, str(e)[:200])
        elif not email:
            results["email"] = {"success": False, "error": "Email no proporcionado"}
        elif not RESEND_API_KEY:
            results["email"] = {"success": False, "error": "Servicio de email no configurado"}
    
    return {"message": "Notificación procesada", "results": results}

@api_router.get("/public/qr/{code}.png")
async def public_appointment_qr(code: str):
    """Imagen del QR de una cita (enlace de respaldo en el correo). Solo codifica el código recibido."""
    norm = (code or "").strip().upper()
    if not re.fullmatch(r"[A-Z0-9-]{4,20}", norm):
        raise HTTPException(status_code=404, detail="Código inválido")
    return FastAPIResponse(content=qr_png_bytes(norm), media_type="image/png",
                    headers={"Cache-Control": "public, max-age=86400"})


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
            "en_revision": "Revisión 360° lista · Técnico por asignar",
            "en_corte": "En Corte de Piezas",
            "asignado": "Asignada a Técnico",
            "en_proceso": "Servicio en proceso",
            "en_calidad": "En control de calidad",
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

    # "Sin pago" solo se permite en servicios de postventa, y siempre vale 0
    if any(svc.no_charge for svc in data.services):
        if not order.get("is_postventa"):
            raise HTTPException(status_code=400, detail="Solo los servicios de postventa pueden marcarse sin pago")
        for svc in data.services:
            if svc.no_charge:
                svc.price = 0
    if data.payment_method == "sin_pago" and not order.get("is_postventa"):
        raise HTTPException(status_code=400, detail="Solo las órdenes de postventa pueden ir sin pago")
    
    # ===== Código de descuento en check-in =====
    # Si la orden ya tiene un código aplicado (desde agendamiento), no se puede aplicar otro.
    final_value_raw = float(data.final_value or 0)
    disc_doc_ci = None
    disc_amount_ci = 0.0
    existing_disc = order.get("discount_code")
    if data.discount_code:
        if existing_disc:
            raise HTTPException(
                status_code=400,
                detail=f"Esta orden ya tiene aplicado el código {existing_disc}. No se puede aplicar otro código.",
            )
        disc_doc_ci = await _resolve_discount_code(data.discount_code)
        if not disc_doc_ci:
            raise HTTPException(status_code=400, detail="Código de descuento inválido, inactivo, vencido o agotado")
        disc_amount_ci = _compute_discount_amount(
            final_value_raw, disc_doc_ci.get("discount_type"), disc_doc_ci.get("discount_value")
        )
    elif existing_disc:
        # Reaplicar el descuento existente del agendamiento sobre el final_value bruto nuevo
        disc_amount_ci = _compute_discount_amount(
            final_value_raw, order.get("discount_type"), order.get("discount_value")
        )
    
    # final_value neto: descuento sobre la base sin IVA y luego IVA 19% (igual que el check-in y el PDF)
    disc_src = disc_doc_ci or (order if existing_disc else {})
    raw_base = _round_peso(final_value_raw / (1 + IVA_RATE)) if data.requires_invoice else final_value_raw
    price = _price_with_discount_and_iva(raw_base, disc_src.get("discount_type"), disc_src.get("discount_value"),
                                         bool(data.requires_invoice))
    disc_amount_ci = price["discount"]
    net_final_value = round(price["total"], 2) if (disc_doc_ci or existing_disc) else final_value_raw
    
    update_data = {
        "services": [s.model_dump() for s in data.services],
        "final_value": net_final_value,
        "final_value_before_discount": final_value_raw if (disc_doc_ci or existing_disc) else order.get("final_value_before_discount"),
        "tax_base": price["tax_base"],
        "iva_amount": price["iva"],
        "signature_url": data.signature_url,
        "client_cedula": data.cedula_number,
        "risk_agreement_accepted": data.risk_agreement_accepted,
        "profile_photo_url": data.profile_photo_url,
        "payment_method": data.payment_method,
        "requires_invoice": bool(data.requires_invoice),
        "status": OrderStatus.INGRESADO.value,
        "ingreso_at": datetime.now(timezone.utc).isoformat(),
        # Asesor que realizó el check-in
        "checkin_by_id": current_user["id"],
        "checkin_by_name": current_user["name"],
        "updated_at": datetime.now(timezone.utc).isoformat()
    }

    # Orden firmada (PDF): queda archivada con las fotos y el video de la orden
    signed_pdf_bytes = _decode_signed_order_pdf(data.order_pdf)
    if signed_pdf_bytes:
        await db.order_documents.update_one(
            {"order_id": data.order_id, "kind": "orden_firmada"},
            {"$set": {
                "order_id": data.order_id, "kind": "orden_firmada",
                "data": BsonBinary(signed_pdf_bytes), "content_type": "application/pdf",
                "size": len(signed_pdf_bytes), "uploaded_by": current_user["id"],
                "created_at": datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True,
        )
        update_data["signed_order_pdf_url"] = f"/orders/{data.order_id}/signed-order-pdf"

    if disc_doc_ci:
        update_data.update({
            "discount_code": disc_doc_ci.get("code"),
            "discount_amount": disc_amount_ci,
            "discount_type": disc_doc_ci.get("discount_type"),
            "discount_value": disc_doc_ci.get("discount_value"),
            "discount_applied_at": datetime.now(timezone.utc).isoformat(),
            "discount_applied_stage": "checkin",
        })
    elif existing_disc:
        # Actualizar monto del descuento ya existente para reflejar el nuevo final_value_before_discount
        update_data["discount_amount"] = disc_amount_ci
    
    await db.orders.update_one({"id": data.order_id}, {"$set": update_data})
    
    # Incrementar uso del código si se aplicó en check-in
    if disc_doc_ci:
        try:
            await db.discount_codes.update_one(
                {"code": disc_doc_ci["code"]},
                {"$inc": {"usage_count": 1}, "$set": {"last_used_at": datetime.now(timezone.utc).isoformat()}}
            )
        except Exception as _e:
            logger.warning(f"[discount] no se pudo incrementar uso de {disc_doc_ci.get('code')}: {_e}")
    
    # Log history
    await log_order_history(
        data.order_id, "INGRESO_APROBADO", 
        OrderStatus.AGENDADO.value, OrderStatus.INGRESADO.value,
        current_user["id"], current_user["name"],
        {"final_value": data.final_value, "services_count": len(data.services)}
    )
    
    # Si lleva accesorios, crear la solicitud de despacho para el usuario de accesorios
    try:
        order_ci = await db.orders.find_one({"id": data.order_id}, {"_id": 0})
        await _sync_accessory_request(order_ci, current_user)
    except Exception as e:
        logger.error(f"[accesorios] solicitud al aprobar ingreso {data.order_id}: {e}")

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
            if signed_pdf_bytes:
                attachments.insert(0, _pdf_attachment(f"orden_firmada_{order.get('order_code')}.pdf", signed_pdf_bytes))
            attachments.extend(brand_attachments())
            front = order_after.get("profile_photo_url")
            front_att = _photo_attachment("foto_frontal.jpg", front) if front else None
            if front_att:
                attachments.append(front_att)
            photo_count = 1 if front_att else 0
            html = build_ingreso_html(order_after, pdf_attached=True, photo_count=photo_count,
                                      signed_order_attached=bool(signed_pdf_bytes))
            eid = await _send_email_with_attachments(
                order["client_email"],
                f"¡Recibo de ingreso! #{order.get('order_code')} · PolarizadosYA!",
                html, attachments,
            )
            email_sent = bool(eid)
        except Exception as e:
            logger.error(f"[ingreso-email] {e}")

    return {"message": "Ingreso aprobado exitosamente", "email_sent": email_sent}

MAX_SIGNED_ORDER_PDF_BYTES = 5 * 1024 * 1024

def _decode_signed_order_pdf(data_uri: Optional[str]) -> Optional[bytes]:
    """Decodifica el PDF firmado (data URI o base64). Devuelve None si no es un PDF válido."""
    if not data_uri:
        return None
    try:
        b64 = data_uri.split(",", 1)[1] if data_uri.startswith("data:") else data_uri
        raw = base64.b64decode(b64)
    except Exception:
        return None
    if not raw.startswith(b"%PDF") or len(raw) > MAX_SIGNED_ORDER_PDF_BYTES:
        return None
    return raw


@api_router.get("/orders/{order_id}/signed-order-pdf")
async def get_signed_order_pdf(order_id: str, current_user: dict = Depends(get_current_user)):
    """Descarga la orden firmada por el cliente en el check-in."""
    doc = await db.order_documents.find_one({"order_id": order_id, "kind": "orden_firmada"}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Esta orden no tiene PDF firmado")
    return FastAPIResponse(content=bytes(doc["data"]), media_type="application/pdf")


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

# Video de la Revisión 360° — se guarda en su propia colección para no inflar
# el documento de la orden (GET /orders devuelve órdenes completas).
MAX_INSPECTION_VIDEO_BYTES = 15 * 1024 * 1024

@api_router.post("/orders/{order_id}/inspection-video")
async def upload_inspection_video(
    order_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ASESOR])),
):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0, "id": 1})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="El video está vacío")
    if len(data) > MAX_INSPECTION_VIDEO_BYTES:
        raise HTTPException(status_code=413, detail="El video supera el tamaño máximo (15 MB)")

    now = datetime.now(timezone.utc).isoformat()
    await db.inspection_videos.update_one(
        {"order_id": order_id},
        {"$set": {
            "order_id": order_id,
            "data": BsonBinary(data),
            "content_type": file.content_type or "video/webm",
            "size": len(data),
            "uploaded_by": current_user["id"],
            "created_at": now,
        }},
        upsert=True,
    )
    video_url = f"/orders/{order_id}/inspection-video"
    await db.orders.update_one({"id": order_id}, {"$set": {"inspection_video_url": video_url, "updated_at": now}})
    return {"video_url": video_url, "size": len(data)}

@api_router.get("/orders/{order_id}/inspection-video")
async def get_inspection_video(order_id: str, current_user: dict = Depends(get_current_user)):
    doc = await db.inspection_videos.find_one({"order_id": order_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Esta orden no tiene video de revisión")
    return FastAPIResponse(content=bytes(doc["data"]), media_type=doc.get("content_type") or "video/webm")

@api_router.get("/inspected-vehicles")
async def get_inspected_vehicles(
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ASESOR, UserRole.COORDINADOR])),
):
    """Vehículos con Revisión 360° completada (sin las fotos, solo el conteo)."""
    pipeline = [
        {"$match": {"inspection_at": {"$ne": None}}},
        {"$sort": {"inspection_at": -1}},
        {"$limit": 500},
        {"$project": {
            "_id": 0, "id": 1, "order_code": 1, "plate": 1, "brand": 1, "model": 1, "year": 1,
            "color": 1, "client_name": 1, "client_phone": 1, "status": 1, "is_postventa": 1,
            "checkin_by_name": 1, "signed_order_pdf_url": 1,
            "ingreso_at": 1, "inspection_at": 1, "inspection_notes": 1, "inspection_video_url": 1,
            "photos_count": {"$size": {"$ifNull": ["$inspection_photos", []]}},
        }},
    ]
    return await db.orders.aggregate(pipeline).to_list(500)

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
# Flujo: Revisión 360° → asignar 2 técnicos → Corte (si lleva Polarizado/PPF/Ultrasecure) → Instalación.
CUTTING_KEYWORDS = ["polarizado", "ppf", "ultrasecure", "nanooptik", "huperoptik", "black_ceramic",
                    "ultraoptik", "ceramic_i3", "mixto", "micras", "sunroof", "matte", "brillante", "wrap"]


def _order_needs_cutting(order: dict) -> bool:
    """La orden pasa por Corte si tiene algún servicio de Polarizado, PPF o Ultrasecure."""
    for svc in (order.get("services") or []):
        if not isinstance(svc, dict):
            continue
        svc_id = (svc.get("service") or "").lower().replace(" ", "_")
        svc_desc = (svc.get("description") or "").lower()
        if any(kw in svc_id or kw in svc_desc for kw in CUTTING_KEYWORDS):
            return True
    return False


async def _assign_technicians(order: dict, technician_ids: List[str], minutes: Optional[int], current_user: dict) -> dict:
    ids = [t for t in dict.fromkeys(i.strip() for i in technician_ids if i and i.strip())]
    if not 1 <= len(ids) <= 2:
        raise HTTPException(status_code=400, detail="Asigna el técnico principal y, si aplica, el técnico de apoyo (máximo 2)")
    status = order["status"]
    if status == OrderStatus.INGRESADO.value:
        raise HTTPException(status_code=400, detail="Primero completa la Revisión 360° del vehículo")
    if status not in (OrderStatus.EN_REVISION.value, OrderStatus.EN_CORTE.value, OrderStatus.ASIGNADO.value):
        raise HTTPException(status_code=400, detail=f"No se pueden cambiar los técnicos en estado {status}")
    techs = []
    for tid in ids:
        tech = await db.users.find_one({"id": tid, "role": UserRole.TECNICO.value}, {"_id": 0})
        if not tech:
            raise HTTPException(status_code=404, detail="Técnico no encontrado")
        techs.append(tech)

    needs_cutting = _order_needs_cutting(order)
    new_status = status
    if status == OrderStatus.EN_REVISION.value:
        new_status = OrderStatus.EN_CORTE.value if needs_cutting else OrderStatus.ASIGNADO.value
    now = datetime.now(timezone.utc).isoformat()
    second = techs[1] if len(techs) > 1 else None
    update = {
        "assigned_technician_id": techs[0]["id"],
        "assigned_technician_name": techs[0]["name"],
        "assigned_technician_2_id": second["id"] if second else None,
        "assigned_technician_2_name": second["name"] if second else None,
        # Corte de Piezas muestra el técnico pre-asignado
        "pre_assigned_technician_id": techs[0]["id"],
        "pre_assigned_technician_name": techs[0]["name"],
        "service_time_minutes": minutes or order.get("service_time_minutes") or 60,
        "assigned_at": order.get("assigned_at") or now,
        "status": new_status,
        "updated_at": now,
    }
    if new_status == OrderStatus.EN_CORTE.value and not order.get("cutting_status"):
        update["cutting_status"] = "pendiente"
    await db.orders.update_one({"id": order["id"]}, {"$set": update})

    names = " y ".join(t["name"] for t in techs)
    await log_order_history(
        order["id"], "TECNICOS_ASIGNADOS", status, new_status,
        current_user["id"], current_user["name"],
        {"technicians": [t["name"] for t in techs], "next_step": "corte" if new_status == OrderStatus.EN_CORTE.value else "instalacion"},
    )
    if status == OrderStatus.EN_REVISION.value and new_status == OrderStatus.EN_CORTE.value:
        await create_alert(
            UserRole.CORTE.value, AlertType.NUEVO_CORTE,
            "Nuevo vehículo para corte",
            f"{order.get('plate')} · técnicos: {names}",
            order["id"],
        )
    step = "Pasa a Corte; te avisaremos cuando esté listo para instalar" if new_status == OrderStatus.EN_CORTE.value \
        else "Listo para instalación"
    for t in techs:
        await db.alerts.insert_one({
            "id": str(uuid.uuid4()),
            "recipient_id": t["id"],
            "alert_type": AlertType.SERVICIO_ASIGNADO.value,
            "title": "Nuevo servicio asignado",
            "message": f"Vehículo {order.get('plate')} con {names}. {step}.",
            "order_id": order["id"],
            "read": False,
            "created_at": now,
        })
    return {"message": "Técnicos asignados", "status": new_status, "needs_cutting": needs_cutting}


@api_router.post("/orders/{order_id}/assign-technicians")
async def assign_technicians(order_id: str, data: AssignTechnicians, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.COORDINADOR]))):
    """Asigna técnico principal y de apoyo. Si la orden lleva Polarizado/PPF/Ultrasecure pasa a Corte;
    si no, queda lista para instalación."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    return await _assign_technicians(order, data.technician_ids, data.service_time_minutes, current_user)


@api_router.post("/orders/assign")
async def assign_technician(data: AssignTechnician, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.COORDINADOR]))):
    """Compatibilidad: asignar un solo técnico (mismo flujo que assign-technicians)."""
    order = await db.orders.find_one({"id": data.order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    return await _assign_technicians(order, [data.technician_id], data.service_time_minutes, current_user)

# Step 5: Start service (Technician)
@api_router.post("/orders/{order_id}/start-service")
async def start_service(order_id: str, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.TECNICO]))):
    """Technician starts working - Status: EN_PROCESO"""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order["status"] != OrderStatus.ASIGNADO.value:
        raise HTTPException(status_code=400, detail="La orden debe estar lista para instalación")
    if current_user["role"] == UserRole.TECNICO.value and current_user["id"] not in (
            order.get("assigned_technician_id"), order.get("assigned_technician_2_id")):
        raise HTTPException(status_code=403, detail="Este servicio no está asignado a ti")
    
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
    
    if current_user["role"] == UserRole.TECNICO.value and current_user["id"] not in (
            order.get("assigned_technician_id"), order.get("assigned_technician_2_id")):
        raise HTTPException(status_code=403, detail="Este servicio no está asignado a ti")
    
    is_postventa = bool(order.get("is_postventa"))
    new_status = OrderStatus.ENTREGADO.value if is_postventa else OrderStatus.EN_CALIDAD.value
    
    photos = [p for p in (data.completion_photos or []) if p][:10]
    if len(photos) < MIN_COMPLETION_PHOTOS:
        raise HTTPException(status_code=400, detail=f"Adjunta mínimo {MIN_COMPLETION_PHOTOS} fotos del servicio terminado")
    services = order.get("services") or []
    picked = sorted({i for i in (data.installed_services or []) if isinstance(i, int) and 0 <= i < len(services)})
    if services and not picked:
        raise HTTPException(status_code=400, detail="Marca qué servicios instalaste")
    installed = [{"index": i, "name": _service_label(services[i])} for i in picked]
    now = datetime.now(timezone.utc).isoformat()
    
    update_data = {
        **({} if is_postventa else _quality_entry_fields(now)),
        "installed_services": installed,
        "installed_by_id": current_user["id"],
        "installed_by_name": current_user["name"],
        "status": new_status,
        "service_completed_at": now,
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
        {"technician_notes": data.notes, "is_postventa": is_postventa, "photos_count": len(photos), "bahia_released": bahia_id,
         "installed_services": [x["name"] for x in installed]}
    )
    
    if not is_postventa:
        # Pasa a control de calidad (solo órdenes normales)
        await _notify_quality(order)
        return {"message": "Instalación completada, enviada a control de calidad"}
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
    if order.get("quality_required") and not order.get("exit_certificate"):
        raise HTTPException(status_code=400, detail="Genera el certificado de salida antes de entregar el vehículo")
    
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
        "en_calidad": await db.orders.count_documents({"status": "en_calidad"}),
        "servicio_completado": await db.orders.count_documents({"status": "servicio_completado"}),
        "terminado_falta_pago": await db.orders.count_documents({"status": "terminado_falta_pago"}),
        "terminado_pagado": await db.orders.count_documents({"status": "terminado_pagado"}),
        "entregados_hoy": await db.orders.count_documents({"status": "entregado", "delivered_at": {"$regex": f"^{today}"}}),
        "citas_hoy": await db.orders.count_documents({"date": today}),
    }
    
    return stats

# ==================== SERVICES CATALOG ====================
# Catálogo completo de servicios organizados por categorías
# Películas de polarizado que acompañan al Ultrasecure (definen su precio sugerido)
ULTRASECURE_FILMS = [
    {"id": "nano", "label": "Nano"},
    {"id": "black_ceramic", "label": "Black Ceramic"},
    {"id": "3m_ir", "label": "3M IR"},
    {"id": "ceramic_i3", "label": "Ceramic i3"},
    {"id": "ceramic_i3_plus", "label": "Ceramic i3+"},
    {"id": "huperoptik", "label": "Hüperoptik"},
]

def _acc_options(prefix: str, names: List[str]) -> List[Dict[str, str]]:
    def slug(t: str) -> str:
        t = t.lower().replace("ñ", "n")
        for a, b in (("á", "a"), ("é", "e"), ("í", "i"), ("ó", "o"), ("ú", "u")):
            t = t.replace(a, b)
        return re.sub(r"[^a-z0-9]+", "_", t).strip("_")
    return [{"id": f"acc_{prefix}_{slug(n)}", "name": n} for n in names]


ACCESSORY_GROUPS = [
    {"id": "tuercas", "name": "Tuercas", "type": "select", "options": _acc_options("tuercas", [
        "Tuercas MG 12 x 1.5 CC", "Tuercas MG 12 x 1.5 SC", "Tuercas MG 12 x 1.25 SC", "Tuercas MG 14 x 1.5 CC",
        "Tuercas MG 14 x 1.5 CS", "Tuercas IMAPAR 12 x 1.5 SC", "Tuercas IMAPAR 12 x 1.25 SC",
        "Tuercas IMAPAR 14 x 1.5 SC", "Tuercas MG 14 x 1.5 CS Tesla", "Tuerca FARAD 14 x 1.5 Tesla"])},
    {"id": "pernos", "name": "Pernos de seguridad", "type": "select", "options": _acc_options("pernos", [
        "Pernos de seguridad 12 x 1.5", "Pernos de seguridad 12 x 1.25", "Pernos de seguridad 14 x 1.5"])},
    {"id": "productos", "name": "Productos", "type": "multi", "options": _acc_options("productos", [
        "Guayas", "Cinta amarilla", "Cinta negra", "Colonbinas", "Tollas amarillas", "Silicona", "Sika",
        "Glass Cleaner"])},
    {"id": "plumillas", "name": "Plumillas Defender", "type": "select", "options": _acc_options("plumillas", [
        f"Plumillas Defender {n} pulgadas" for n in (12, 14, 16, 18, 20, 22, 24, 26, 28)])},
    {"id": "tapetes", "name": "Tapetes", "type": "select", "options": _acc_options("tapetes", [
        "Tapetes Prado LC250", "Tapetes Toyota Corolla Cross", "Tapetes baúl Toyota Corolla Cross", "Tapetes de KA",
        "Tapetes de Magdas 2", "Tapetes de Prado cara vieja", "Tapetes de Tesla Model 3",
        "Tapetes universales Defender", "Tapetes de Tesla Model Y"])},
    {"id": "tiro_arrastre", "name": "Tiro de arrastre", "type": "single", "options": _acc_options("tiro", [
        "Tiro de arrastre Toyota Corolla Cross", "Tiro de arrastre Toyota Prado Runner",
        "Tiro de arrastre Toyota Fortuner"])},
    {"id": "otros", "name": "Otros", "type": "single", "options": _acc_options("otros", [
        "Cadenas Defender", "Lengüetas", "Seguro de llanta Toyota", "Plato de Defender",
        "Seguro de llanta Toyota universal", "Seguro de llanta Toyota Prado", "Hidrofilms", "Opulum"])},
    {"id": "camaras", "name": "Cámaras", "type": "single", "options": _acc_options("camaras", [
        "Cámara 4K", "Cámara estándar"])},
    {"id": "guayas_camaras", "name": "Guayas cámaras", "type": "multi", "options": _acc_options("guayas_camaras", [
        "Guayas para cámaras"])},
]


SERVICES_CATALOG = {
    "polarizado": {
        "name": "Polarizado",
        "services": [
            {"id": "nanooptik", "name": "Nanooptik"},
            {"id": "black_ceramic_autobahn", "name": "Black Ceramic Autobahn"},
            {"id": "ultraoptik_aswf", "name": "Ultraoptik ASWF"},
            {"id": "ceramic_i3_autobahn", "name": "Ceramic i3 Autobahn"},
            {"id": "ceramic_i3_plus_autobahn", "name": "Ceramic i3+ Autobahn"},
            {"id": "huperoptik", "name": "Huperoptik"},
            {"id": "mixto", "name": "Mixto"},
        ]
    },
    # Ultrasecure (película de seguridad). protection_level: nivel de protección (%) para mostrar.
    "ultrasecure": {
        "name": "Ultrasecure",
        # El precio depende de la película de polarizado que se instala con el Ultrasecure
        # (incluye otros componentes y servicios). Es precio sugerido: se puede modificar.
        "films": ULTRASECURE_FILMS,
        "services": [
            {"id": "micras_300", "name": "300 Micras", "tagline": "Entrada",
             "description": "Protección básica del vidrio", "protection_level": 40,
             "resistencia": ["4 a 6 golpes contundentes", "2 a 3 impactos con arma traumática"],
             "entrega": "Entrega 1 día hábil",
             "film_prices": {"nano": 1200000, "black_ceramic": 1800000, "3m_ir": 2500000,
                             "ceramic_i3": 2800000, "ceramic_i3_plus": 3500000, "huperoptik": 3500000}},
            {"id": "micras_500", "name": "500 Micras", "tagline": "Alta resistencia",
             "description": "Mayor resistencia al impacto", "protection_level": 55,
             "resistencia": ["10 a 12 golpes contundentes", "4 a 6 impactos con arma traumática"],
             "entrega": "Entrega 1 día hábil",
             "film_prices": {"nano": 2000000, "black_ceramic": 2500000, "3m_ir": 3500000,
                             "ceramic_i3": 3800000, "ceramic_i3_plus": 4000000, "huperoptik": 4000000}},
            {"id": "micras_700", "name": "700 Micras", "tagline": "Protección reforzada",
             "protection_level": 70,
             "resistencia": ["14 a 16 golpes contundentes", "10 a 12 impactos con arma traumática"],
             "entrega": "Entrega 1 día hábil",
             "film_prices": {"nano": 3500000, "black_ceramic": 4000000, "3m_ir": 5000000,
                             "ceramic_i3": 5300000, "ceramic_i3_plus": 5500000, "huperoptik": 5500000}},
            {"id": "micras_1000", "name": "1.000 Micras", "tagline": "Protección superior",
             "description": "Refuerzo superior contra impactos", "protection_level": 85,
             "resistencia": ["20 a 22 golpes contundentes", "16 a 18 impactos con arma traumática"],
             "entrega": "Entrega de 1 a 2 días hábiles",
             "film_prices": {"nano": 5500000, "black_ceramic": 5800000, "3m_ir": 6000000,
                             "ceramic_i3": 6300000, "ceramic_i3_plus": 6500000, "huperoptik": 6500000}},
            {"id": "micras_1700", "name": "1.700 Micras", "tagline": "Máxima protección",
             "description": "Máximo nivel de protección disponible", "protection_level": 100,
             "resistencia": ["25 golpes contundentes", "45 a 50 impactos con arma traumática",
                             "1 impacto con arma calibre .38", "4 impactos con arma calibre .765"],
             "entrega": "Entrega de 1 a 2 días hábiles",
             "nota": "No se garantiza como balístico",
             "film_prices": {"nano": 7500000, "black_ceramic": 8000000, "3m_ir": 8500000,
                             "ceramic_i3": 8800000, "ceramic_i3_plus": 9000000, "huperoptik": 9000000}},
        ]
    },
    "ppf": {
        "name": "PPF",
        "services": [
            {"id": "ppf_full_body", "name": "Full Body"},
            {"id": "ppf_partes", "name": "Partes / Piezas"},
        ]
    },
    "accesorios": {
        "name": "Accesorios",
        # Grupos como en el formulario: select/single = una opción por grupo; multi = varias.
        "groups": ACCESSORY_GROUPS,
        # Lista plana de todas las opciones (pedidos de accesorios, inventario y despacho)
        "services": [{"id": o["id"], "name": o["name"], "group": g["id"]} for g in ACCESSORY_GROUPS for o in g["options"]],
    },
    "detailing": {
        "name": "Detailing",
        "services": [
            {"id": "polichado_profesional", "name": "Polichado Profesional"},
            {"id": "ceramico_3_anos", "name": "Cerámico 3 años", "default_price": 1500000, "min_price": 1300000},
            {"id": "ceramico_5_anos", "name": "Cerámico 5 años", "default_price": 2000000, "min_price": 1800000},
            {"id": "lavado", "name": "Lavado", "default_price": 60000, "min_price": 50000},
            {"id": "manto_1_ano_ceras", "name": "Manto 1 año (ceras)", "default_price": 800000, "min_price": 600000},
            {"id": "mantenimiento_manto_1_ano", "name": "Mantenimiento Manto 1 año", "default_price": 400000, "min_price": 300000},
            {"id": "mantenimiento_ceramico", "name": "Mantenimiento Cerámico 3 y 5 años", "default_price": 500000, "min_price": 400000},
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
def _require_seed_enabled():
    # Public seed endpoints only work when ALLOW_SEED=true (keep it off in production)
    if os.environ.get('ALLOW_SEED', '').lower() != 'true':
        raise HTTPException(status_code=403, detail="Seed deshabilitado")

@api_router.post("/seed/users")
async def seed_test_users():
    """Create test users for each role (only works if users don't exist)"""
    _require_seed_enabled()
    test_users = [
        {"email": "admin@polarizadosya.com", "name": "Admin PolarizadosYA", "role": "admin", "password": "admin123"},
        {"email": "asesor@polarizadosya.com", "name": "Carlos Asesor", "role": "asesor", "password": "asesor123"},
        {"email": "coordinador@polarizadosya.com", "name": "Maria Coordinadora", "role": "coordinador", "password": "coord123"},
        {"email": "tecnico@polarizadosya.com", "name": "Juan Técnico", "role": "tecnico", "password": "tecnico123"},
        {"email": "tecnico2@polarizadosya.com", "name": "Pedro Técnico", "role": "tecnico", "password": "tecnico123"},
        {"email": "facturacion@polarizadosya.com", "name": "Ana Facturación", "role": "facturacion", "password": "factura123"},
        {"email": "corte@polarizadosya.com", "name": "Luis Corte", "role": "corte", "password": "corte123"},
        {"email": "accesorios@polarizadosya.com", "name": "Bodega Accesorios", "role": "accesorios", "password": "accesorios123"},
        {"email": "calidad@polarizadosya.com", "name": "Sandra Calidad", "role": "calidad", "password": "calidad123"},
        {"email": "seguridad@polarizadosya.com", "name": "Jorge Jefe de Seguridad", "role": "seguridad", "password": "seguridad123"},
        {"email": "liquidaciones@polarizadosya.com", "name": "Laura Liquidaciones", "role": "liquidaciones", "password": "liquida123"},
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
    _require_seed_enabled()
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
            target_status = OrderStatus.ENTREGADO.value if is_postventa else OrderStatus.EN_CALIDAD.value
            
            set_fields = {
                **({} if is_postventa else _quality_entry_fields(datetime.now(timezone.utc).isoformat())),
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
                    OrderStatus.EN_PROCESO.value, target_status,
                    current_user["id"], current_user["name"],
                    {"bahia_id": bahia_id, "photos_count": len(photos)}
                )
            except Exception:
                pass
            if not is_postventa:
                await _notify_quality(order)
            
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
    <p>El vehículo pasa a control de calidad antes de la entrega.</p>
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
# ==================== MEDIDAS DEL TÉCNICO (antes de completar corte) ====================
MEASURE_ZONES = ("panoramico", "trasero", "laterales_delanteros", "laterales_traseros", "sunroof")


class MeasureZone(BaseModel):
    aplica: bool = True
    medida_cm: Optional[float] = None  # medida lineal de material (cm)
    piezas: Optional[int] = None       # solo laterales: número de vidrios de ese lado


class TechMeasurements(BaseModel):
    panoramico: MeasureZone
    trasero: MeasureZone
    laterales_delanteros: MeasureZone  # vidrios de las puertas delanteras (piloto y copiloto)
    laterales_traseros: MeasureZone    # vidrios de las puertas traseras y custodias
    sunroof: MeasureZone
    notes: Optional[str] = None


@api_router.put("/orders/{order_id}/tech-measurements")
async def save_tech_measurements(
    order_id: str,
    data: TechMeasurements,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.COORDINADOR, UserRole.TECNICO])),
):
    """El técnico instalador confirma las medidas que necesita por zona. Corte recibe la notificación
    y solo entonces puede completar el corte."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if current_user["role"] == UserRole.TECNICO.value and current_user["id"] not in (
            order.get("assigned_technician_id"), order.get("assigned_technician_2_id")):
        raise HTTPException(status_code=403, detail="Este vehículo no está asignado a ti")
    if order.get("status") != OrderStatus.EN_CORTE.value:
        raise HTTPException(status_code=400, detail="Las medidas se colocan cuando el vehículo está en Corte")
    if order.get("cutting_status") == "completado":
        raise HTTPException(status_code=400, detail="El corte ya se completó; no se pueden cambiar las medidas")

    zones = {}
    for key in MEASURE_ZONES:
        z: MeasureZone = getattr(data, key)
        if not z.aplica:
            zones[key] = {"aplica": False}
            continue
        if not z.medida_cm or z.medida_cm <= 0 or z.medida_cm > 1000:
            raise HTTPException(status_code=400, detail=f"Coloca la medida lineal de {key}, o márcalo como No aplica")
        zone = {"aplica": True, "medida_cm": round(float(z.medida_cm), 1)}
        if key.startswith("laterales"):
            zone["piezas"] = max(1, int(z.piezas or 1))
        zones[key] = zone
    if not any(z["aplica"] for z in zones.values()):
        raise HTTPException(status_code=400, detail="Coloca las medidas de al menos una zona")

    now = datetime.now(timezone.utc).isoformat()
    first_time = not (order.get("tech_measurements") or {}).get("confirmed_at")
    record = {**zones, "notes": (data.notes or "").strip() or None, "confirmed_at": now,
              "confirmed_by_id": current_user["id"], "confirmed_by_name": current_user["name"]}
    await db.orders.update_one({"id": order_id}, {"$set": {"tech_measurements": record, "updated_at": now}})
    await log_order_history(
        order_id, "MEDIDAS_TECNICO", order["status"], order["status"],
        current_user["id"], current_user["name"], {"zones": zones, "notes": record["notes"]},
    )
    await create_alert(
        UserRole.CORTE.value, AlertType.MEDIDAS_TECNICO,
        "Medidas listas para corte" if first_time else "Medidas actualizadas",
        f"{order.get('plate')} · {current_user['name']} confirmó las medidas. Ya puedes completar el corte.",
        order_id,
    )
    return {"message": "Medidas confirmadas", "tech_measurements": record}


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
    
    # Corte recibe los vehículos cuando ya tienen técnicos asignados (estado en_corte)
    orders = await db.orders.find(
        {"status": "en_corte"},
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
    if order.get("status") != "en_corte" or not order.get("assigned_technician_id"):
        raise HTTPException(
            status_code=400,
            detail="Esta orden no tiene técnicos asignados. Asígnalos primero en 'Autos por Asignar'."
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
    # Cortes por zona de las medidas del técnico: {zona: [{material, inventory_item_id, metros, reutilizable}]}
    zone_cuts: Optional[Dict[str, List["ZoneCutLine"]]] = None


class ZoneCutLine(BaseModel):
    material: str
    inventory_item_id: Optional[str] = None  # rollo del que sale el corte
    metros: float
    reutilizable: bool = False  # material reutilizable: no descuenta del rollo


CuttingCompleteRequest.model_rebuild()

# (máx. materiales, máx. rollos) por zona
ZONE_CUT_LIMITS = {
    "panoramico": (1, 1),
    "trasero": (1, 1),
    "laterales_delanteros": (3, 2),
    "laterales_traseros": (3, 2),
    # Zonas anteriores (medidas tomadas antes del cambio a delanteros/traseros)
    "laterales_izquierdo": (3, 2),
    "laterales_derecho": (3, 2),
    "sunroof": (1, 1),
}
ZONE_LABELS = {
    "panoramico": "Panorámico", "trasero": "Trasero / Luneta", "laterales_delanteros": "Laterales delanteros",
    "laterales_traseros": "Laterales traseros", "sunroof": "Sunroof",
    "laterales_izquierdo": "Laterales lado izquierdo", "laterales_derecho": "Laterales lado derecho",
}


async def _plan_zone_cuts(zone_cuts: Dict[str, List[ZoneCutLine]]) -> Dict[str, Any]:
    """Valida los cortes por zona (límites de materiales/rollos y stock) antes de descontar nada."""
    lines = []
    per_roll: Dict[str, float] = {}
    for zone, zlines in (zone_cuts or {}).items():
        if zone not in ZONE_CUT_LIMITS:
            raise HTTPException(status_code=400, detail=f"Zona desconocida: {zone}")
        max_mat, max_rolls = ZONE_CUT_LIMITS[zone]
        label = ZONE_LABELS[zone]
        if len(zlines) > max_mat:
            raise HTTPException(status_code=400, detail=f"{label} admite máximo {max_mat} material(es)")
        rolls = {ln.inventory_item_id for ln in zlines if ln.inventory_item_id and not ln.reutilizable}
        if len(rolls) > max_rolls:
            raise HTTPException(status_code=400, detail=f"{label} admite máximo {max_rolls} rollo(s)")
        for ln in zlines:
            if not (ln.material or "").strip():
                raise HTTPException(status_code=400, detail=f"Elige el material de {label}")
            if not ln.metros or ln.metros <= 0 or ln.metros > 60:
                raise HTTPException(status_code=400, detail=f"Metros inválidos en {label}")
            if not ln.reutilizable and not ln.inventory_item_id:
                raise HTTPException(status_code=400, detail=f"Elige el rollo de {label} o márcalo como reutilizable")
            if not ln.reutilizable:
                per_roll[ln.inventory_item_id] = round(per_roll.get(ln.inventory_item_id, 0) + ln.metros, 2)
            lines.append({"zone": zone, "material": ln.material.strip(), "inventory_item_id": ln.inventory_item_id,
                          "metros": round(ln.metros, 2), "reutilizable": bool(ln.reutilizable)})
    if not lines:
        raise HTTPException(status_code=400, detail="Registra al menos un corte")
    rolls_info = {}
    for inv_id, meters in per_roll.items():
        roll = await db.inventory.find_one({"id": inv_id, "active": True}, {"_id": 0})
        if not roll or roll.get("tipo_articulo") != "rollo":
            raise HTTPException(status_code=400, detail="Rollo no válido")
        if roll.get("en_stock_corte") is False:
            raise HTTPException(status_code=400,
                                detail=f"El rollo {roll.get('codigo')} está en bodega: muévelo al stock de corte desde Inventario")
        if (roll.get("metros_restantes") or 0) + 1e-6 < meters:
            raise HTTPException(status_code=400,
                                detail=f"El rollo {roll.get('codigo')} ({roll.get('nombre')}) solo tiene {roll.get('metros_restantes') or 0} m y se necesitan {meters} m")
        rolls_info[inv_id] = roll
    for ln in lines:
        roll = rolls_info.get(ln["inventory_item_id"]) if not ln["reutilizable"] else None
        ln["rollo_codigo"] = roll.get("codigo") if roll else None
        ln["rollo_nombre"] = roll.get("nombre") if roll else None
    summary = "; ".join(
        f"{ZONE_LABELS[ln['zone']]}: {ln['metros']} m {ln['material']}"
        + (" (reutilizable)" if ln["reutilizable"] else f" · {ln['rollo_codigo']}")
        for ln in lines
    )
    return {"lines": lines, "per_roll": per_roll, "summary": summary}


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
    if not (order.get("tech_measurements") or {}).get("confirmed_at"):
        raise HTTPException(
            status_code=400,
            detail="El técnico aún no ha colocado las medidas. No se puede completar el corte."
        )
    
    # Resolve fields with body taking precedence over query params
    p = payload or CuttingCompleteRequest()
    zone_plan = await _plan_zone_cuts(p.zone_cuts) if p.zone_cuts else None
    final_measurements = p.measurements or measurements or (zone_plan["summary"] if zone_plan else None)
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
        "cutting_zone_cuts": zone_plan["lines"] if zone_plan else None,
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

    if zone_plan:
        # Cortes por zona: descuenta cada rollo; lo reutilizable queda como aprovechamiento
        deductions_per_rollo.update(zone_plan["per_roll"])
        for ln in zone_plan["lines"]:
            if not ln["reutilizable"]:
                continue
            aprov_doc = {
                "id": str(uuid.uuid4()),
                "order_id": order_id,
                "order_code": order.get("order_code"),
                "part_id": ln["zone"],
                "measurement": f"{ln['metros']} m",
                "meters": ln["metros"],
                "tipo_rollo": ln["material"],
                "source_inventory_item_id": ln.get("inventory_item_id"),
                "plate": order.get("plate"),
                "client_name": order.get("client_name"),
                "user_id": current_user["id"],
                "user_name": current_user.get("name") or current_user.get("email"),
                "status": "consumido",
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            await db.aprovechamientos.insert_one(aprov_doc)
            aprovechamientos_created.append({"part_id": ln["zone"], "measurement": aprov_doc["measurement"],
                                             "meters": ln["metros"], "tipo_rollo": ln["material"]})
    elif p.part_materials:
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


@api_router.put("/cutting/{order_id}/deliver")
async def deliver_cut_material(order_id: str, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.CORTE]))):
    """Corte confirma que entregó el material cortado al técnico → el vehículo queda Por Instalar."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order.get("status") != OrderStatus.EN_CORTE.value or order.get("cutting_status") != "completado":
        raise HTTPException(status_code=400, detail="Primero completa el corte del material")
    now = datetime.now(timezone.utc).isoformat()
    user_name = current_user.get("name") or current_user.get("email")
    await db.orders.update_one({"id": order_id}, {"$set": {
        "status": OrderStatus.ASIGNADO.value,
        "material_delivered_at": now,
        "material_delivered_by_id": current_user["id"],
        "material_delivered_by_name": user_name,
        "updated_at": now,
    }})
    techs = [t for t in (order.get("assigned_technician_name"), order.get("assigned_technician_2_name")) if t]
    await log_order_history(
        order_id, "MATERIAL_ENTREGADO", OrderStatus.EN_CORTE.value, OrderStatus.ASIGNADO.value,
        current_user["id"], user_name, {"technicians": techs},
    )
    for tid in (order.get("assigned_technician_id"), order.get("assigned_technician_2_id")):
        if tid:
            await db.alerts.insert_one({
                "id": str(uuid.uuid4()),
                "recipient_id": tid,
                "alert_type": AlertType.MATERIAL_ENTREGADO.value,
                "title": "Material entregado · listo para instalar",
                "message": f"{order.get('plate')} - {order.get('brand')} {order.get('model')}: Corte te entregó el material.",
                "order_id": order_id,
                "read": False,
                "created_at": now,
            })
    return {"message": "Material entregado al técnico", "status": OrderStatus.ASIGNADO.value}


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


def _lookup_summary(orders: list) -> Optional[dict]:
    if not orders:
        return None
    last = orders[0]
    return {
        "total_orders": len(orders),
        "last_order": {
            "id": last.get("id"),
            "order_code": last.get("order_code"),
            "date": last.get("date"),
            "status": last.get("status"),
            "plate": last.get("plate"),
            "services": [s.get("description") or s.get("service") for s in (last.get("services") or [])],
        },
        "client_data": {
            "client_name": last.get("client_name"),
            "client_phone": last.get("client_phone"),
            "client_email": last.get("client_email"),
            "client_cedula": last.get("client_cedula"),
            "plate": last.get("plate"),
            "brand": last.get("brand"),
            "model": last.get("model"),
        },
    }


@api_router.get("/clients/lookup")
async def lookup_existing_client(
    plate: Optional[str] = None,
    document: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
):
    """Detecta si una placa o un documento ya tienen órdenes registradas (para Nueva Cita)."""
    projection = {"_id": 0, "id": 1, "order_code": 1, "date": 1, "status": 1, "plate": 1, "services": 1,
                  "client_name": 1, "client_phone": 1, "client_email": 1, "client_cedula": 1, "brand": 1, "model": 1}
    base = {"status": {"$nin": ["desistimiento"]}}
    result = {"plate": None, "document": None}
    plate_upper = (plate or "").strip().upper()
    if plate_upper:
        orders = await db.orders.find({**base, "plate": plate_upper}, projection).sort("created_at", -1).to_list(50)
        result["plate"] = _lookup_summary(orders)
    doc = (document or "").strip()
    if doc:
        orders = await db.orders.find({**base, "client_cedula": doc}, projection).sort("created_at", -1).to_list(50)
        result["document"] = _lookup_summary(orders)
    return result


# ==================== INVENTORY MODULE ====================
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
    stock_minimo: Optional[int] = None  # alerta de bajo stock (accesorios/materiales)


class InventoryItemUpdate(BaseModel):
    nombre: Optional[str] = None
    factura_compra: Optional[str] = None
    metros_restantes: Optional[float] = None
    cantidad_restante: Optional[int] = None
    costo: Optional[float] = None
    linked_service: Optional[str] = None
    notes: Optional[str] = None
    active: Optional[bool] = None
    stock_minimo: Optional[int] = None


def _ensure_can_edit_inventory(current_user: dict, categoria: Optional[str]):
    """El rol accesorios solo administra artículos de la categoría accesorio."""
    if current_user["role"] == UserRole.ACCESORIOS.value and categoria != "accesorio":
        raise HTTPException(status_code=403, detail="Solo puedes administrar el inventario de accesorios")


def _gen_inventory_code():
    # Consecutive 5-digit code per category-prefix-ish via timestamp
    import time
    return f"INV-{int(time.time()*1000) % 100000000}"


@api_router.post("/inventory")
async def create_inventory_item(
    item: InventoryItemCreate,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ACCESORIOS]))
):
    """Crear un artículo de inventario (admin; el rol accesorios solo crea accesorios)."""
    _ensure_can_edit_inventory(current_user, item.categoria)
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
        "stock_minimo": item.stock_minimo,
        "active": True,
        # Los rollos nuevos quedan en bodega hasta moverlos al stock de corte con la foto de la caja
        **({"en_stock_corte": False} if item.tipo_articulo == "rollo" else {}),
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
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ACCESORIOS]))
):
    """Actualizar artículo de inventario."""
    existing = await db.inventory.find_one({"id": item_id})
    if not existing:
        raise HTTPException(status_code=404, detail="Artículo no encontrado")
    _ensure_can_edit_inventory(current_user, existing.get("categoria"))
    
    fields = {k: v for k, v in update.dict(exclude_unset=True).items() if v is not None}
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.inventory.update_one({"id": item_id}, {"$set": fields})
    return {"message": "Artículo actualizado"}


@api_router.delete("/inventory/{item_id}")
async def delete_inventory_item(
    item_id: str,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ACCESORIOS]))
):
    """Soft delete (active=False)."""
    existing = await db.inventory.find_one({"id": item_id}, {"_id": 0, "categoria": 1})
    if not existing:
        raise HTTPException(status_code=404, detail="Artículo no encontrado")
    _ensure_can_edit_inventory(current_user, existing.get("categoria"))
    await db.inventory.update_one(
        {"id": item_id},
        {"$set": {"active": False, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {"message": "Artículo eliminado"}


ROLL_LOW_METERS = 5  # alerta cuando a una referencia le quedan menos metros que esto


@api_router.get("/inventory/alerts")
async def get_inventory_alerts(current_user: dict = Depends(get_current_user)):
    """Alertas de bajo stock por referencia de corte: sin rollos (crítica) o con pocos metros."""
    pipeline = [
        {"$match": {"active": True, "tipo_articulo": "rollo", "tipo_rollo": {"$ne": None}, "metros_restantes": {"$gt": 0}}},
        {"$group": {"_id": "$tipo_rollo", "count": {"$sum": 1}, "total_metros": {"$sum": "$metros_restantes"}}},
    ]
    counts = {}
    async for row in db.inventory.aggregate(pipeline):
        counts[row["_id"]] = {"count": row["count"], "total_metros": row["total_metros"]}

    alerts = []
    for ref in ROLLS_LIST:
        info = counts.get(ref, {"count": 0, "total_metros": 0})
        if info["count"] == 0 or info["total_metros"] < ROLL_LOW_METERS:
            alerts.append({
                "tipo_rollo": ref,
                "label": ref,
                "current_count": info["count"],
                "threshold": 1,
                "total_metros_restantes": round(info["total_metros"], 2),
                "severity": "critical" if info["count"] == 0 else "high",
            })
    return {"alerts": alerts, "counts_by_type": counts, "low_meters": ROLL_LOW_METERS}


@api_router.post("/inventory/cutting-rolls/reset")
async def reset_cutting_rolls(current_user: dict = Depends(require_roles([UserRole.ADMIN]))):
    """Deja solo las referencias oficiales de corte: desactiva los rollos anteriores
    (quedan en el historial) y carga 1 rollo nuevo por referencia."""
    now = datetime.now(timezone.utc).isoformat()
    old = await db.inventory.update_many(
        {"$or": [{"tipo_articulo": "rollo"}, {"type": "rollo"}], "active": {"$ne": False}},
        {"$set": {"active": False, "deactivated_at": now, "deactivated_reason": "Reemplazado por el inventario de corte oficial",
                  "updated_at": now}},
    )
    last = await db.inventory.find_one({}, {"_id": 0, "seq": 1}, sort=[("seq", -1)])
    seq = int((last or {}).get("seq") or 0)
    docs = []
    for group in CUTTING_REFERENCE_GROUPS:
        for ref in group["items"]:
            seq += 1
            docs.append({
                "id": str(uuid.uuid4()),
                "seq": seq,
                "codigo": f"INV-{seq:05d}",
                "nombre": ref,
                "categoria": group["categoria"],
                "grupo_corte": group["label"],
                "tipo_articulo": "rollo",
                "tipo_rollo": ref,
                "factura_compra": None,
                "metros_iniciales": DEFAULT_ROLL_METERS,
                "metros_restantes": DEFAULT_ROLL_METERS,
                "cantidad_inicial": None,
                "cantidad_restante": None,
                "costo": 0.0,
                "linked_service": None,
                "sede_id": None,
                "sede_nombre": None,
                "fecha_ingreso": now,
                "notes": "Inventario de corte inicial · 1 rollo por referencia",
                "stock_minimo": None,
                "active": True,
                "en_stock_corte": False,  # en bodega hasta que se lea su caja
                "created_by": current_user["id"],
                "created_at": now,
                "updated_at": now,
            })
    if docs:
        await db.inventory.insert_many(docs)
    return {"message": f"Inventario de corte cargado: {len(docs)} rollos", "deactivated": old.modified_count,
            "created": len(docs), "meters_per_roll": DEFAULT_ROLL_METERS}


# ==================== STOCK DE CORTE · activar rollos leyendo la caja ====================
# Un rollo nuevo queda en bodega (en_stock_corte=False) hasta que se toma la foto de su caja
# y se mueve al stock de corte. Los rollos anteriores a esta función (sin el campo) siguen disponibles.
CUTTING_STOCK_ROLES = [UserRole.ADMIN, UserRole.COORDINADOR, UserRole.CORTE]
ROLL_BOX_MODEL = "claude-opus-5-5"

ROLL_BOX_SCHEMA = {
    "type": "object",
    "properties": {
        "referencia": {"type": ["string", "null"], "description": "Referencia exacta de la lista que corresponde a la caja, o null si ninguna coincide"},
        "marca": {"type": ["string", "null"]},
        "producto": {"type": ["string", "null"], "description": "Nombre del producto tal como aparece en la caja"},
        "porcentaje": {"type": ["string", "null"], "description": "Porcentaje de transmisión de luz (VLT), p. ej. 20%"},
        "ancho": {"type": ["string", "null"], "description": "Ancho del rollo con su unidad, p. ej. 40 in o 1.52 m"},
        "largo": {"type": ["string", "null"], "description": "Largo del rollo con su unidad, p. ej. 100 ft o 30 m"},
        "metros": {"type": ["number", "null"], "description": "Largo del rollo convertido a metros"},
        "lote": {"type": ["string", "null"], "description": "Número de lote (LOT / batch)"},
        "serial": {"type": ["string", "null"], "description": "Número de serie o código del rollo"},
        "fecha": {"type": ["string", "null"], "description": "Fecha de fabricación o vencimiento impresa en la caja"},
        "texto_leido": {"type": "string", "description": "Texto relevante leído en la etiqueta"},
        "confianza": {"type": "string", "enum": ["alta", "media", "baja"]},
    },
    "required": ["referencia", "marca", "producto", "porcentaje", "ancho", "largo", "metros", "lote", "serial",
                 "fecha", "texto_leido", "confianza"],
    "additionalProperties": False,
}


def _roll_box_prompt() -> str:
    refs = "\n".join(f"- {g['label']}: " + " | ".join(g["items"]) for g in CUTTING_REFERENCE_GROUPS)
    return (
        "Esta es la foto de la caja (o la etiqueta) de un rollo de película para vehículos: polarizado, "
        "película de seguridad o PPF. Lee los datos impresos y devuélvelos en el formato pedido.\n\n"
        "En `referencia` escribe exactamente una de estas referencias del inventario si la caja corresponde a ella "
        "(compara marca, línea de producto, porcentaje y medida del rollo, p. ej. 40X100 = 40 pulgadas x 100 pies). "
        "Si ninguna coincide con seguridad, deja `referencia` en null; no inventes una.\n"
        f"{refs}\n\n"
        "Convierte el largo a metros en `metros` (100 ft = 30.48 m). Deja en null lo que no se pueda leer. "
        "En `confianza` indica qué tan seguro estás de la referencia."
    )


async def _read_roll_box(photo: str) -> dict:
    """Lee la foto de la caja con Claude y devuelve los datos estructurados."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(status_code=503, detail="La lectura automática de la caja no está configurada. Escribe los datos a mano.")
    jpeg = await asyncio.to_thread(_compress_data_url_image, photo, 1568, 85)
    if not jpeg:
        raise HTTPException(status_code=400, detail="La foto de la caja no es válida")
    import anthropic
    client = anthropic.AsyncAnthropic()
    try:
        response = await client.beta.messages.create(
            model=ROLL_BOX_MODEL,
            max_tokens=4096,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            output_config={"format": {"type": "json_schema", "schema": ROLL_BOX_SCHEMA}},
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                             "data": base64.b64encode(jpeg).decode("ascii")}},
                {"type": "text", "text": _roll_box_prompt()},
            ]}],
        )
    except anthropic.RateLimitError:
        raise HTTPException(status_code=429, detail="El lector de cajas está ocupado. Intenta en un momento.")
    except anthropic.APIStatusError as e:
        logger.error(f"[roll-box] Claude API error {e.status_code}: {e.message}")
        raise HTTPException(status_code=502, detail="No se pudo leer la caja. Escribe los datos a mano.")
    except anthropic.APIConnectionError:
        raise HTTPException(status_code=502, detail="No hay conexión con el lector de cajas. Escribe los datos a mano.")
    if response.stop_reason == "refusal":
        raise HTTPException(status_code=422, detail="No se pudo leer esta foto. Escribe los datos a mano.")
    text = next((b.text for b in response.content if b.type == "text"), "")
    try:
        data = json.loads(text)
    except Exception:
        raise HTTPException(status_code=502, detail="No se pudo interpretar la lectura de la caja")
    if data.get("referencia") not in ROLLS_LIST:
        data["referencia"] = None
    return data


class RollBoxRead(BaseModel):
    photo: str  # data URL de la foto de la caja


@api_router.post("/inventory/cutting-stock/read-box")
async def read_roll_box(data: RollBoxRead, current_user: dict = Depends(require_roles(CUTTING_STOCK_ROLES))):
    """Lee la caja del rollo y sugiere el rollo en bodega que corresponde."""
    box = await _read_roll_box(data.photo)
    candidates = []
    if box.get("referencia"):
        candidates = await db.inventory.find(
            {"active": True, "tipo_articulo": "rollo", "tipo_rollo": box["referencia"], "en_stock_corte": False},
            {"_id": 0, "id": 1, "codigo": 1, "nombre": 1, "metros_restantes": 1},
        ).sort("seq", 1).to_list(20)
    return {"box": box, "candidates": candidates}


class CuttingStockMove(BaseModel):
    item_id: Optional[str] = None  # rollo en bodega; si falta se crea uno nuevo con la referencia
    referencia: str
    photo: str
    metros: Optional[float] = None
    box: Optional[Dict[str, Any]] = None  # datos leídos / corregidos de la caja


@api_router.post("/inventory/cutting-stock")
async def move_to_cutting_stock(data: CuttingStockMove, current_user: dict = Depends(require_roles(CUTTING_STOCK_ROLES))):
    """Mueve un rollo al stock de corte con la foto de su caja: queda activo para usar en Corte."""
    if data.referencia not in ROLLS_LIST:
        raise HTTPException(status_code=400, detail="Elige una referencia del inventario de corte")
    jpeg = await asyncio.to_thread(_compress_data_url_image, data.photo, 1280, 75)
    if not jpeg:
        raise HTTPException(status_code=400, detail="Toma la foto de la caja del rollo")
    metros = round(float(data.metros), 2) if data.metros else None
    if metros is not None and metros <= 0:
        raise HTTPException(status_code=400, detail="Los metros del rollo deben ser mayores a 0")
    now = datetime.now(timezone.utc).isoformat()
    group = next(g for g in CUTTING_REFERENCE_GROUPS if data.referencia in g["items"])
    box = {k: v for k, v in (data.box or {}).items() if k in ROLL_BOX_SCHEMA["properties"]}

    if data.item_id:
        item = await db.inventory.find_one({"id": data.item_id, "active": True}, {"_id": 0})
        if not item or item.get("tipo_articulo") != "rollo":
            raise HTTPException(status_code=404, detail="Rollo no encontrado")
        if item.get("en_stock_corte") is not False:
            raise HTTPException(status_code=400, detail=f"El rollo {item.get('codigo')} ya está en el stock de corte")
        if item.get("tipo_rollo") != data.referencia:
            raise HTTPException(status_code=400, detail=f"La caja es {data.referencia} pero el rollo {item.get('codigo')} es {item.get('tipo_rollo')}")
    else:
        last = await db.inventory.find_one({}, {"_id": 0, "seq": 1}, sort=[("seq", -1)])
        seq = int((last or {}).get("seq") or 0) + 1
        item = {
            "id": str(uuid.uuid4()), "seq": seq, "codigo": f"INV-{seq:05d}",
            "nombre": data.referencia, "categoria": group["categoria"], "grupo_corte": group["label"],
            "tipo_articulo": "rollo", "tipo_rollo": data.referencia, "factura_compra": None,
            "metros_iniciales": metros or DEFAULT_ROLL_METERS, "metros_restantes": metros or DEFAULT_ROLL_METERS,
            "cantidad_inicial": None, "cantidad_restante": None, "costo": 0.0, "linked_service": None,
            "sede_id": None, "sede_nombre": None, "fecha_ingreso": now, "notes": "Creado al mover al stock de corte",
            "stock_minimo": None, "active": True, "en_stock_corte": False,
            "created_by": current_user["id"], "created_at": now, "updated_at": now,
        }
        await db.inventory.insert_one(dict(item))

    await db.roll_box_photos.update_one(
        {"item_id": item["id"]},
        {"$set": {"item_id": item["id"], "data": BsonBinary(jpeg), "content_type": "image/jpeg",
                  "uploaded_by": current_user["id"], "created_at": now}},
        upsert=True,
    )
    update = {
        "en_stock_corte": True,
        "stock_corte_at": now,
        "stock_corte_by_id": current_user["id"],
        "stock_corte_by_name": current_user["name"],
        "datos_caja": box or None,
        "lote": box.get("lote") or item.get("lote"),
        "serial": box.get("serial") or item.get("serial"),
        "caja_foto_url": f"/inventory/{item['id']}/box-photo",
        "updated_at": now,
    }
    # Metros reales de la caja, solo si el rollo aún no se ha usado
    if metros and data.item_id and (item.get("metros_restantes") or 0) >= (item.get("metros_iniciales") or 0) - 1e-6:
        update.update({"metros_iniciales": metros, "metros_restantes": metros})
    await db.inventory.update_one({"id": item["id"]}, {"$set": update})
    item.update(update)
    item.pop("_id", None)
    return {"message": f"Rollo {item['codigo']} activo en el stock de corte", "item": item}


@api_router.get("/inventory/{item_id}/box-photo")
async def get_roll_box_photo(item_id: str, current_user: dict = Depends(get_current_user)):
    doc = await db.roll_box_photos.find_one({"item_id": item_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Este rollo no tiene foto de la caja")
    return FastAPIResponse(content=bytes(doc["data"]), media_type=doc.get("content_type") or "image/jpeg")


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


class InventoryRestock(BaseModel):
    cantidad: int
    factura_compra: Optional[str] = None
    notes: Optional[str] = None


@api_router.post("/inventory/{item_id}/restock")
async def restock_inventory(
    item_id: str,
    data: InventoryRestock,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ACCESORIOS])),
):
    """Ingresar unidades a un artículo por cantidad (p. ej. llegó mercancía de accesorios)."""
    item = await db.inventory.find_one({"id": item_id, "active": True}, {"_id": 0})
    if not item:
        raise HTTPException(status_code=404, detail="Artículo no encontrado")
    _ensure_can_edit_inventory(current_user, item.get("categoria"))
    if item.get("tipo_articulo") != "cantidad":
        raise HTTPException(status_code=400, detail="Solo se pueden ingresar unidades a artículos por cantidad")
    if data.cantidad is None or data.cantidad <= 0:
        raise HTTPException(status_code=400, detail="La cantidad debe ser mayor a 0")

    now = datetime.now(timezone.utc).isoformat()
    await db.inventory.update_one(
        {"id": item_id},
        {"$inc": {"cantidad_restante": data.cantidad, "cantidad_inicial": data.cantidad},
         "$set": {"updated_at": now}},
    )
    await db.inventory_movements.insert_one({
        "id": str(uuid.uuid4()),
        "inventory_item_id": item_id,
        "type": "ingreso",
        "cantidad": data.cantidad,
        "reason": data.notes or (f"Factura {data.factura_compra}" if data.factura_compra else "Ingreso de unidades"),
        "factura_compra": data.factura_compra,
        "user_id": current_user["id"],
        "user_name": current_user.get("name") or current_user.get("email"),
        "created_at": now,
    })
    updated = await db.inventory.find_one({"id": item_id}, {"_id": 0})
    return updated


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
    retention = _order_retention(order)
    return {"total": round(total, 2), "paid": round(paid, 2), "retention": round(retention, 2),
            "balance": round(max(total - retention - paid, 0), 2)}


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

    if order.get("requires_invoice") and not order.get("retention_applied"):
        raise HTTPException(
            status_code=409,
            detail="El cliente solicitó factura: registra primero la retención (o márcala como 'no aplica') "
                   "en Clientes por facturar y después el abono.",
        )

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
    new_balance = round(max(total - bal_before["retention"] - new_paid, 0), 2)
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
            OrderStatus.EN_PROCESO.value, OrderStatus.EN_CALIDAD.value, OrderStatus.SERVICIO_COMPLETADO.value,
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
            "retention_applied": bool(o.get("retention_applied")),
            "retention_snapshot": o.get("retention_snapshot"),
            "profile_photo_url": o.get("profile_photo_url"),
            **b,
        })
    return out


@api_router.get("/orders-pending-release")
async def orders_pending_release(
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.FACTURACION, UserRole.COORDINADOR,
                                                UserRole.CALIDAD, UserRole.SEGURIDAD])),
):
    """Listo para entrega: calidad aprobada (o flujo anterior sin calidad) y aún no entregados."""
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
            "quality_status": o.get("quality_status"),
            "quality_checked_at": o.get("quality_checked_at"),
            "quality_by_name": o.get("quality_by_name"),
            "exit_certificate": o.get("exit_certificate"),
            "security_exit_at": o.get("security_exit_at"),
            "security_exit_by_name": o.get("security_exit_by_name"),
            "certificate_blockers": _certificate_blockers(o) if not o.get("exit_certificate") else [],
            "payment_status": _payment_status(o) if b["total"] > 0 else "paid",
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
    if order.get("quality_required") and order.get("quality_status") != "aprobado":
        raise HTTPException(status_code=400, detail="No se puede autorizar salida: falta aprobar el control de calidad")
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


# ==================== CONTROL DE CALIDAD ====================
# Cuestionario por tipo de servicio. Cada pregunta se responde: ok | no_ok | na
QUALITY_CHECKLIST = {
    "general": {
        "label": "Revisión general",
        "items": [
            ("gen_limpieza_ext", "Vehículo limpio por fuera (sin huellas, residuos ni agua)"),
            ("gen_limpieza_int", "Interior limpio: tapicería, tablero y pisos sin residuos"),
            ("gen_sin_danos", "Sin rayones, golpes o daños nuevos frente a la Revisión 360°"),
            ("gen_pertenencias", "Pertenencias y accesorios del cliente en su lugar"),
            ("gen_electrico", "Luces, vidrios eléctricos y tablero funcionan sin testigos nuevos"),
        ],
    },
    "polarizado": {
        "label": "Polarizado",
        "items": [
            ("pol_burbujas", "Sin burbujas, pliegues ni contaminación (polvo, pelos)"),
            ("pol_bordes", "Bordes uniformes, sin despegues ni luz en los filos"),
            ("pol_tono", "Tono / % de opacidad igual al contratado en cada vidrio"),
            ("pol_ventanas", "Ventanas suben y bajan sin rozar la película"),
            ("pol_desempanador", "Desempañador trasero intacto y funcionando"),
        ],
    },
    "ultrasecure": {
        "label": "Ultrasecure",
        "items": [
            ("us_adhesion", "Película de seguridad bien adherida, sin burbujas ni ondas"),
            ("us_bordes", "Bordes sellados y recortes limpios"),
            ("us_vision", "Visibilidad nítida, sin distorsión"),
            ("us_ventanas", "Ventanas suben y bajan correctamente"),
        ],
    },
    "ppf": {
        "label": "PPF",
        "items": [
            ("ppf_burbujas", "Sin burbujas, levantamientos ni marcas de agua atrapada"),
            ("ppf_bordes", "Bordes envueltos o sellados, sin despegues"),
            ("ppf_cortes", "Sin marcas de cuchilla en la pintura"),
            ("ppf_partes", "Todas las partes contratadas están cubiertas"),
            ("ppf_acabado", "Acabado uniforme (brillante / mate) según lo contratado"),
        ],
    },
    "sunroof": {
        "label": "Sunroof",
        "items": [
            ("sun_pelicula", "Película del sunroof sin burbujas y con bordes limpios"),
            ("sun_funciona", "Sunroof y cortinilla abren y cierran sin rozar"),
        ],
    },
    "accesorios": {
        "label": "Accesorios",
        "items": [
            ("acc_instalados", "Todos los accesorios de la orden quedaron instalados"),
            ("acc_funcionan", "Accesorios probados y funcionando (cámaras, luces, etc.)"),
            ("acc_firmes", "Tuercas, pernos y piezas firmes y bien ajustadas"),
        ],
    },
    "detailing": {
        "label": "Detailing",
        "items": [
            ("det_superficie", "Superficies sin hologramas, manchas ni residuos de producto"),
            ("det_aplicacion", "Cera / manto / recubrimiento aplicado de forma uniforme"),
            ("det_rincones", "Rincones, emblemas y juntas sin restos de producto"),
        ],
    },
    "latoneria_pintura": {
        "label": "Latonería y pintura",
        "items": [
            ("lat_acabado", "Acabado y color iguales al resto de la carrocería"),
            ("lat_ajuste", "Piezas alineadas y bien ajustadas"),
        ],
    },
}


def _service_category(svc: dict) -> Optional[str]:
    svc_id = (svc.get("service") or "").lower()
    desc = (svc.get("description") or "").lower()
    if svc_id in ("sunroof_adicional", "sunroof"):
        return "sunroof"
    if svc_id.startswith("acc_"):
        return "accesorios"
    for cat_key, cat in SERVICES_CATALOG.items():
        if any(x.get("id") == svc_id for x in (cat.get("services") or [])):
            return cat_key
        for g in (cat.get("groups") or []):
            if any(o.get("id") == svc_id for o in (g.get("options") or [])):
                return cat_key
    if "ppf" in svc_id or "ppf" in desc:
        return "ppf"
    if "ultrasecure" in svc_id or "ultrasecure" in desc:
        return "ultrasecure"
    if "accesorio" in desc:
        return "accesorios"
    if any(k in svc_id or k in desc for k in ("polarizado", "optik", "ceramic", "mixto")):
        return "polarizado"
    return None


def _quality_sections(order: dict) -> List[dict]:
    """Secciones del cuestionario según los servicios de la orden (siempre incluye la revisión general)."""
    cats = []
    for svc in (order.get("services") or []):
        if not isinstance(svc, dict):
            continue
        cat = _service_category(svc)
        if cat and cat not in cats and cat in QUALITY_CHECKLIST:
            cats.append(cat)
        parts = [str(p).lower() for p in (svc.get("parts") or [])]
        extras = " ".join(str(e.get("nombre") or e.get("id") or "") for e in (svc.get("extras") or []) if isinstance(e, dict)).lower()
        if ("sunroof" in parts or "sunroof" in extras) and "sunroof" not in cats:
            cats.append("sunroof")
    order_keys = ["general", "polarizado", "ultrasecure", "ppf", "sunroof", "accesorios", "detailing", "latoneria_pintura"]
    keys = ["general"] + [k for k in order_keys if k in cats]
    return [
        {"id": k, "label": QUALITY_CHECKLIST[k]["label"],
         "items": [{"id": i, "label": label} for i, label in QUALITY_CHECKLIST[k]["items"]]}
        for k in keys
    ]


def _quality_order_summary(o: dict) -> dict:
    b = _order_balance(o)
    return {
        "id": o["id"],
        "order_code": o.get("order_code"),
        "plate": o.get("plate"),
        "brand": o.get("brand"),
        "model": o.get("model"),
        "color": o.get("color"),
        "client_name": o.get("client_name"),
        "client_phone": o.get("client_phone"),
        "status": o.get("status"),
        "services": o.get("services") or [],
        "profile_photo_url": o.get("profile_photo_url"),
        "assigned_technician_name": o.get("assigned_technician_name"),
        "assigned_technician_2_name": o.get("assigned_technician_2_name"),
        "service_completed_at": o.get("service_completed_at"),
        "quality_sent_at": o.get("quality_sent_at"),
        "quality_status": o.get("quality_status"),
        "quality_notes": o.get("quality_notes"),
        "quality_rejections": o.get("quality_rejections") or 0,
        "service_completion_notes": o.get("service_completion_notes"),
        "is_postventa": bool(o.get("is_postventa")),
        "payment_status": _payment_status(o) if b["total"] > 0 else "paid",
        "sections": _quality_sections(o),
        **b,
    }


QUALITY_ROLES = [UserRole.ADMIN, UserRole.CALIDAD, UserRole.COORDINADOR]


@api_router.get("/quality/pending")
async def quality_pending(current_user: dict = Depends(require_roles(QUALITY_ROLES))):
    """Vehículos con instalación terminada esperando control de calidad."""
    cursor = db.orders.find({"status": OrderStatus.EN_CALIDAD.value}, {"_id": 0}).sort("quality_sent_at", 1).limit(200)
    return [_quality_order_summary(o) async for o in cursor]


@api_router.post("/orders/{order_id}/quality-video")
async def upload_quality_video(
    order_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(require_roles(QUALITY_ROLES)),
):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0, "id": 1, "status": 1})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order.get("status") != OrderStatus.EN_CALIDAD.value:
        raise HTTPException(status_code=400, detail="La orden no está en control de calidad")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="El video está vacío")
    if len(data) > MAX_INSPECTION_VIDEO_BYTES:
        raise HTTPException(status_code=413, detail="El video supera el tamaño máximo (15 MB)")
    now = datetime.now(timezone.utc).isoformat()
    await db.quality_videos.update_one(
        {"order_id": order_id},
        {"$set": {
            "order_id": order_id,
            "data": BsonBinary(data),
            "content_type": file.content_type or "video/webm",
            "size": len(data),
            "uploaded_by": current_user["id"],
            "created_at": now,
        }},
        upsert=True,
    )
    video_url = f"/orders/{order_id}/quality-video"
    await db.orders.update_one({"id": order_id}, {"$set": {"quality_video_url": video_url, "updated_at": now}})
    return {"video_url": video_url, "size": len(data)}


@api_router.get("/orders/{order_id}/quality-video")
async def get_quality_video(order_id: str, current_user: dict = Depends(get_current_user)):
    doc = await db.quality_videos.find_one({"order_id": order_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Esta orden no tiene video de calidad")
    return FastAPIResponse(content=bytes(doc["data"]), media_type=doc.get("content_type") or "video/webm")


class QualityAnswer(BaseModel):
    id: str
    result: str  # ok | no_ok | na
    note: Optional[str] = None


class QualityReview(BaseModel):
    approved: bool
    answers: List[QualityAnswer]
    photos: List[str] = []
    notes: Optional[str] = None
    rating: Optional[int] = None  # calificación 1-5 estrellas


QUALITY_MIN_PHOTOS = 2


@api_router.post("/orders/{order_id}/quality")
async def submit_quality(order_id: str, data: QualityReview, current_user: dict = Depends(require_roles(QUALITY_ROLES))):
    """Guarda el cuestionario de calidad.
    Aprobado → listo para entrega (pagado o pendiente de pago). Rechazado → vuelve a instalación."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order.get("status") != OrderStatus.EN_CALIDAD.value:
        raise HTTPException(status_code=400, detail="La orden no está en control de calidad")

    sections = _quality_sections(order)
    labels = {i["id"]: (sec["label"], i["label"]) for sec in sections for i in sec["items"]}
    given = {a.id: a for a in data.answers}
    missing = [labels[k][1] for k in labels if k not in given or given[k].result not in ("ok", "no_ok", "na")]
    if missing:
        raise HTTPException(status_code=400, detail=f"Faltan {len(missing)} preguntas del cuestionario por responder")
    failed = [k for k in labels if given[k].result == "no_ok"]
    notes = (data.notes or "").strip()
    if data.rating is None or not 1 <= int(data.rating) <= 5:
        raise HTTPException(status_code=400, detail="Califica la calidad del servicio de 1 a 5 estrellas")
    rating = int(data.rating)

    if data.approved:
        if failed:
            raise HTTPException(status_code=400, detail="No se puede aprobar con puntos 'No cumple'. Devuélvelo a instalación.")
        photos = [p for p in (data.photos or []) if p][:10]
        if len(photos) < QUALITY_MIN_PHOTOS:
            raise HTTPException(status_code=400, detail=f"Toma al menos {QUALITY_MIN_PHOTOS} fotos del vehículo terminado")
        if not order.get("quality_video_url"):
            raise HTTPException(status_code=400, detail="Graba el video de calidad antes de aprobar")
    else:
        if not failed and not notes:
            raise HTTPException(status_code=400, detail="Indica qué debe corregir el técnico (marca 'No cumple' o escribe una observación)")
        photos = [p for p in (data.photos or []) if p][:10]

    now = datetime.now(timezone.utc).isoformat()
    answers = [
        {"id": k, "section": labels[k][0], "label": labels[k][1], "result": given[k].result,
         "note": (given[k].note or "").strip() or None}
        for k in labels
    ]
    b = _order_balance(order)
    paid = b["total"] <= 0 or b["balance"] <= 0.01
    review = {
        "result": "aprobado" if data.approved else "rechazado",
        "rating": rating,
        "notes": notes or None,
        "failed": [{"label": labels[k][1], "note": (given[k].note or "").strip() or None} for k in failed],
        "by_name": current_user["name"],
        "at": now,
    }
    update = {
        "quality_answers": answers,
        "quality_photos": photos,
        "quality_notes": notes or None,
        "quality_rating": rating,
        "quality_reviews": (order.get("quality_reviews") or []) + [review],
        "quality_checked_at": now,
        "quality_by_id": current_user["id"],
        "quality_by_name": current_user["name"],
        "updated_at": now,
    }
    if data.approved:
        new_status = OrderStatus.TERMINADO_PAGADO.value if paid and b["total"] > 0 else OrderStatus.SERVICIO_COMPLETADO.value
        update.update({"status": new_status, "quality_status": "aprobado", "ready_for_delivery": paid})
        action = "CALIDAD_APROBADA"
    else:
        new_status = OrderStatus.EN_PROCESO.value
        update.update({
            "status": new_status, "quality_status": "rechazado",
            "quality_rejections": int(order.get("quality_rejections") or 0) + 1,
            "service_started_at": now,
        })
        action = "CALIDAD_RECHAZADA"

    await db.orders.update_one({"id": order_id}, {"$set": update})
    await log_order_history(
        order_id, action, OrderStatus.EN_CALIDAD.value, new_status,
        current_user["id"], current_user["name"],
        {"failed": [labels[k][1] for k in failed], "photos_count": len(photos), "notes": notes or None,
         "balance": b["balance"]},
    )

    plate, client = order.get("plate"), order.get("client_name")
    if data.approved:
        pay_txt = "" if paid else f" · ⚠ Falta pago de {_cop(b['balance'])}"
        await create_alert(UserRole.COORDINADOR.value, AlertType.LISTO_ENTREGA, "Vehículo listo para entrega",
                           f"{plate} - {client} aprobó calidad{pay_txt}", order_id)
        if not paid:
            await create_alert(UserRole.FACTURACION.value, AlertType.PENDIENTE_FACTURACION, "Vehículo listo para facturación",
                               f"{plate} - {client} aprobó calidad y tiene saldo pendiente de {_cop(b['balance'])}", order_id)
        return {"message": "Calidad aprobada · listo para entrega", "new_status": new_status,
                "paid": paid, "balance": b["balance"]}

    detail = "; ".join(labels[k][1] for k in failed) or notes
    for tech_id in [t for t in (order.get("assigned_technician_id"), order.get("assigned_technician_2_id")) if t]:
        await db.alerts.insert_one({
            "id": str(uuid.uuid4()), "recipient_id": tech_id,
            "alert_type": AlertType.CALIDAD_RECHAZADA.value,
            "title": "Calidad devolvió el vehículo",
            "message": f"{plate}: corregir {detail}",
            "order_id": order_id, "read": False, "created_at": now,
        })
    await create_alert(UserRole.COORDINADOR.value, AlertType.CALIDAD_RECHAZADA, "Calidad devolvió el vehículo",
                       f"{plate} - {client}: {detail}", order_id)
    return {"message": "Vehículo devuelto a instalación", "new_status": new_status}


# ==================== LISTO PARA ENTREGA · CERTIFICADO DE SALIDA ====================
DELIVERY_ROLES = [UserRole.ADMIN, UserRole.FACTURACION, UserRole.COORDINADOR, UserRole.CALIDAD, UserRole.SEGURIDAD]
CERTIFICATE_ROLES = [UserRole.ADMIN, UserRole.FACTURACION, UserRole.COORDINADOR, UserRole.CALIDAD]


def _certificate_blockers(order: dict) -> List[str]:
    """Razones por las que no se puede emitir el certificado de salida."""
    out = []
    if order.get("status") not in (OrderStatus.SERVICIO_COMPLETADO.value, OrderStatus.TERMINADO_FALTA_PAGO.value,
                                   OrderStatus.TERMINADO_PAGADO.value):
        out.append("El vehículo no está listo para entrega")
    if order.get("quality_required") and order.get("quality_status") != "aprobado":
        out.append("Falta aprobar el control de calidad")
    b = _order_balance(order)
    if b["balance"] > 0.01:
        out.append(f"El cliente no ha pagado: saldo pendiente de {_cop(b['balance'])}")
    return out


async def _next_certificate_number() -> str:
    year = datetime.now(timezone.utc).strftime("%Y")
    counter = await db.counters.find_one_and_update(
        {"id": f"exit_certificate_{year}"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True,
    )
    return f"CS-{year}-{int(counter['seq']):05d}"


@api_router.post("/orders/{order_id}/exit-certificate")
async def issue_exit_certificate(order_id: str, current_user: dict = Depends(require_roles(CERTIFICATE_ROLES))):
    """Emite el certificado de salida (solo pagado y con calidad aprobada) y lo envía al coordinador y al jefe de seguridad."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order.get("exit_certificate"):
        raise HTTPException(status_code=400, detail=f"Ya tiene certificado de salida {order['exit_certificate'].get('number')}")
    blockers = _certificate_blockers(order)
    if blockers:
        raise HTTPException(status_code=400, detail="No se puede generar el certificado de salida: " + "; ".join(blockers))

    now = datetime.now(timezone.utc).isoformat()
    cert = {
        "number": await _next_certificate_number(),
        "issued_at": now,
        "issued_by_id": current_user["id"],
        "issued_by_name": current_user["name"],
    }
    update = {
        "exit_certificate": cert,
        "release_authorized": True,
        "release_authorized_at": now,
        "release_authorized_by": current_user["id"],
        "release_authorized_by_name": current_user["name"],
        "ready_for_delivery": True,
        "updated_at": now,
    }
    if order.get("status") != OrderStatus.TERMINADO_PAGADO.value:
        update["status"] = OrderStatus.TERMINADO_PAGADO.value
    await db.orders.update_one({"id": order_id}, {"$set": update})
    order.update(update)
    await log_order_history(
        order_id, "CERTIFICADO_SALIDA", order.get("status", ""), update.get("status", order.get("status", "")),
        current_user["id"], current_user["name"], {"number": cert["number"]},
    )

    # Envío al coordinador y al jefe de seguridad (alerta + correo con el PDF)
    msg = f"Certificado {cert['number']} · {order.get('plate')} - {order.get('client_name')} puede salir"
    recipients = []
    for role in (UserRole.COORDINADOR.value, UserRole.SEGURIDAD.value):
        await create_alert(role, AlertType.CERTIFICADO_SALIDA, "Certificado de salida emitido", msg, order_id)
        recipients += [u for u in await db.users.find({"role": role}, {"_id": 0, "email": 1, "name": 1, "role": 1}).to_list(50)
                       if u.get("email")]
    sent_to = []
    if RESEND_API_KEY and recipients:
        pdf_bytes = await asyncio.to_thread(build_exit_certificate, order)
        html = f"""
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#222;">
  <div style="background:#1e1e32;color:#fff;padding:16px 20px;"><h2 style="margin:0;">Certificado de salida {cert['number']}</h2></div>
  <div style="padding:20px;">
    <p>El vehículo está autorizado para salir: pagado y con control de calidad aprobado.</p>
    <p><b>Placa:</b> {order.get('plate')}<br><b>Vehículo:</b> {order.get('brand','')} {order.get('model','')}<br>
       <b>Cliente:</b> {order.get('client_name')}<br><b>Orden:</b> {order.get('order_code','')}<br>
       <b>Emitido por:</b> {current_user['name']}</p>
    <p>Adjuntamos el certificado en PDF.</p>
  </div>
</div>""".strip()
        for u in recipients:
            res = await _send_email_with_attachments(
                u["email"], f"Certificado de salida {cert['number']} - {order.get('plate')}", html,
                [_pdf_attachment(f"certificado_salida_{cert['number']}.pdf", pdf_bytes)],
            )
            if res:
                sent_to.append(u["email"])
    await db.orders.update_one({"id": order_id}, {"$set": {"exit_certificate.sent_to": sent_to}})
    return {"message": "Certificado de salida emitido", "certificate": {**cert, "sent_to": sent_to},
            "notified_roles": ["coordinador", "seguridad"]}


@api_router.get("/orders/{order_id}/exit-certificate.pdf")
async def download_exit_certificate(order_id: str, current_user: dict = Depends(require_roles(DELIVERY_ROLES))):
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if not order.get("exit_certificate"):
        raise HTTPException(status_code=404, detail="Esta orden no tiene certificado de salida")
    pdf_bytes = await asyncio.to_thread(build_exit_certificate, order)
    number = order["exit_certificate"].get("number", "certificado")
    return FastAPIResponse(content=pdf_bytes, media_type="application/pdf",
                           headers={"Content-Disposition": f'attachment; filename="certificado_salida_{number}.pdf"'})


@api_router.post("/orders/{order_id}/security-exit")
async def register_security_exit(
    order_id: str,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.SEGURIDAD, UserRole.COORDINADOR])),
):
    """El jefe de seguridad confirma en portería la salida con certificado."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if not order.get("exit_certificate"):
        raise HTTPException(status_code=400, detail="El vehículo no tiene certificado de salida: no puede salir")
    if order.get("security_exit_at"):
        raise HTTPException(status_code=400, detail="La salida ya fue registrada")
    now = datetime.now(timezone.utc).isoformat()
    await db.orders.update_one({"id": order_id}, {"$set": {
        "security_exit_at": now,
        "security_exit_by_id": current_user["id"],
        "security_exit_by_name": current_user["name"],
        "updated_at": now,
    }})
    await log_order_history(order_id, "SALIDA_PORTERIA", order.get("status", ""), order.get("status", ""),
                            current_user["id"], current_user["name"],
                            {"certificate": order["exit_certificate"].get("number")})
    return {"message": "Salida registrada en portería", "security_exit_at": now}


# ==================== HISTORIAL DEL TÉCNICO · COBROS (LIQUIDACIONES) ====================
FINISHED_FOR_TECH = [
    OrderStatus.EN_CALIDAD.value, OrderStatus.SERVICIO_COMPLETADO.value,
    OrderStatus.TERMINADO_FALTA_PAGO.value, OrderStatus.TERMINADO_PAGADO.value, OrderStatus.ENTREGADO.value,
]
CHARGE_STATUSES = ["pendiente", "aprobado", "rechazado", "pagado"]


def _quality_summary(o: dict) -> dict:
    """Etiqueta de calidad del servicio: pendiente | aprobado | rechazado | sin_revision (órdenes anteriores)."""
    status = o.get("quality_status")
    if o.get("status") == OrderStatus.EN_CALIDAD.value:
        status = "pendiente"
    elif not status:
        status = "sin_revision"
    return {
        "quality_status": status,
        "quality_rating": o.get("quality_rating"),
        "quality_notes": o.get("quality_notes"),
        "quality_by_name": o.get("quality_by_name"),
        "quality_checked_at": o.get("quality_checked_at"),
        "quality_reviews": o.get("quality_reviews") or [],
    }


def _tech_service_names(o: dict) -> List[str]:
    installed = o.get("installed_services") or []
    if installed:
        return [x.get("name") for x in installed if x.get("name")]
    return [_service_label(s) for s in (o.get("services") or [])]


@api_router.get("/technician/history")
async def technician_history(current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.TECNICO]))):
    """Servicios terminados del técnico, con su etiqueta de calidad y el estado del cobro."""
    uid = current_user["id"]
    cursor = db.orders.find(
        {"status": {"$in": FINISHED_FOR_TECH},
         "$or": [{"assigned_technician_id": uid}, {"assigned_technician_2_id": uid}]},
        {"_id": 0, "quality_photos": 0, "service_completion_photos": 0, "inspection_photos": 0, "signature_url": 0},
    ).sort("service_completed_at", -1).limit(200)
    orders = [o async for o in cursor]
    charges = {c["order_id"]: c async for c in db.technician_charges.find(
        {"technician_id": uid, "order_id": {"$in": [o["id"] for o in orders]}}, {"_id": 0})}
    return [{
        "id": o["id"],
        "order_code": o.get("order_code"),
        "plate": o.get("plate"),
        "brand": o.get("brand"),
        "model": o.get("model"),
        "client_name": o.get("client_name"),
        "status": o.get("status"),
        "profile_photo_url": o.get("profile_photo_url"),
        "service_started_at": o.get("service_started_at"),
        "service_completed_at": o.get("service_completed_at"),
        "installed_services": _tech_service_names(o),
        "role": "principal" if o.get("assigned_technician_id") == uid else "apoyo",
        "partner_name": o.get("assigned_technician_2_name") if o.get("assigned_technician_id") == uid else o.get("assigned_technician_name"),
        "charge": charges.get(o["id"]),
        **_quality_summary(o),
    } for o in orders]


def _installed_service_items(o: dict) -> List[tuple]:
    """(índice, servicio) de lo que se marcó como instalado (o todos, en órdenes anteriores)."""
    services = o.get("services") or []
    installed = o.get("installed_services") or []
    picked = [(x["index"], services[x["index"]]) for x in installed
              if isinstance(x.get("index"), int) and 0 <= x["index"] < len(services) and isinstance(services[x["index"]], dict)]
    return picked or [(i, s) for i, s in enumerate(services) if isinstance(s, dict)]


class TechnicianChargeOptions(BaseModel):
    vehicle_type: str = "automovil"            # automovil | camioneta
    tesla_roof: Optional[str] = None           # medio | completo
    removals: Optional[List[str]] = None       # completo | laterales | panoramico
    # Lo que instaló este técnico (None = todo): {índice del servicio: [vidrios]} y otros servicios por índice
    pieces: Optional[Dict[str, List[str]]] = None
    services: Optional[List[int]] = None


class TechnicianChargeQuote(TechnicianChargeOptions):
    order_id: str


class TechnicianChargeCreate(TechnicianChargeOptions):
    order_id: str
    other_amount: Optional[float] = None       # valor de servicios sin tarifa (accesorios, detailing...)
    amount: Optional[float] = None             # ignorado: el valor sale de la tabla de tarifas
    notes: Optional[str] = None


def _charge_tariff(order: dict, data: TechnicianChargeOptions) -> dict:
    return compute_installer_charge(
        _installed_service_items(order), brand=order.get("brand"), vehicle_type=data.vehicle_type,
        tesla_roof=data.tesla_roof, removals=data.removals,
        pieces=data.pieces, services=data.services,
    )


async def _claims_taken_by_others(order_id: str, technician_id: str) -> Dict[str, str]:
    """Piezas/servicios que ya cobró el otro técnico de la orden (cobros no rechazados): {claim: técnico}."""
    taken: Dict[str, str] = {}
    async for c in db.technician_charges.find(
            {"order_id": order_id, "technician_id": {"$ne": technician_id}, "status": {"$ne": "rechazado"}}, {"_id": 0}):
        for claim in (c.get("tariff") or {}).get("claims") or []:
            taken[claim] = c.get("technician_name") or "otro técnico"
    return taken


@api_router.get("/technician-rates")
async def technician_rates(current_user: dict = Depends(require_roles(
        [UserRole.ADMIN, UserRole.LIQUIDACIONES, UserRole.TECNICO, UserRole.COORDINADOR]))):
    """Tablas de pago a instaladores y a asesores 2026."""
    return rates_table()


@api_router.post("/technician-charges/quote")
async def quote_technician_charge(data: TechnicianChargeQuote, current_user: dict = Depends(require_roles(
        [UserRole.ADMIN, UserRole.LIQUIDACIONES, UserRole.TECNICO]))):
    """Valor que le corresponde al técnico según la tabla de tarifas (antes de enviar el cobro)."""
    order = await db.orders.find_one({"id": data.order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if current_user["role"] == UserRole.TECNICO.value and current_user["id"] not in (
            order.get("assigned_technician_id"), order.get("assigned_technician_2_id")):
        raise HTTPException(status_code=403, detail="Este servicio no está asignado a ti")
    tariff = _charge_tariff(order, data)
    tariff["taken"] = await _claims_taken_by_others(order["id"], current_user["id"])
    return tariff


@api_router.post("/technician-charges")
async def create_technician_charge(data: TechnicianChargeCreate, current_user: dict = Depends(require_roles([UserRole.TECNICO]))):
    """El técnico cobra un servicio terminado: queda pendiente de aprobación por Liquidaciones."""
    order = await db.orders.find_one({"id": data.order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    uid = current_user["id"]
    if uid not in (order.get("assigned_technician_id"), order.get("assigned_technician_2_id")):
        raise HTTPException(status_code=403, detail="Este servicio no está asignado a ti")
    if order.get("status") not in FINISHED_FOR_TECH:
        raise HTTPException(status_code=400, detail="Solo puedes cobrar servicios terminados")
    # El valor sale de la tabla de pago a instaladores; solo los servicios sin tarifa llevan valor manual
    tariff = _charge_tariff(order, data)
    # Dos técnicos en el mismo carro: cada uno cobra solo lo que instaló, sin repetir lo del otro
    taken = await _claims_taken_by_others(order["id"], uid)
    repeated = [c for c in tariff["claims"] if c in taken]
    if repeated:
        names = ", ".join(claim_label(c, tariff["units"]) for c in repeated)
        raise HTTPException(status_code=409, detail=f"Ya lo cobró {taken[repeated[0]]}: {names}. Cobra solo lo que instalaste tú.")
    other_amount = round(float(data.other_amount or 0), 2) if tariff["without_rate"] else 0
    if other_amount < 0:
        raise HTTPException(status_code=400, detail="El valor de los servicios sin tarifa no puede ser negativo")
    if tariff["without_rate"] and other_amount > 0 and not (data.notes or "").strip():
        raise HTTPException(status_code=400, detail="Explica en la nota el valor de los servicios sin tarifa")
    amount = round(tariff["total"] + other_amount, 2)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Este servicio no tiene tarifa: escribe el valor y explica en la nota")
    existing = await db.technician_charges.find_one({"order_id": order["id"], "technician_id": uid}, {"_id": 0})
    if existing and existing.get("status") != "rechazado":
        raise HTTPException(status_code=400, detail="Ya enviaste el cobro de este servicio")

    now = datetime.now(timezone.utc).isoformat()
    charge = {
        "id": existing["id"] if existing else str(uuid.uuid4()),
        "order_id": order["id"],
        "order_code": order.get("order_code"),
        "plate": order.get("plate"),
        "brand": order.get("brand"),
        "model": order.get("model"),
        "client_name": order.get("client_name"),
        "technician_id": uid,
        "technician_name": current_user["name"],
        "technician_role": "principal" if order.get("assigned_technician_id") == uid else "apoyo",
        "services": _tech_service_names(order),
        "amount": amount,
        "tariff": tariff,
        "other_amount": other_amount or None,
        "partner_name": (order.get("assigned_technician_2_name") if order.get("assigned_technician_id") == uid
                         else order.get("assigned_technician_name")) if order.get("assigned_technician_2_id") else None,
        "notes": (data.notes or "").strip() or None,
        "status": "pendiente",
        "created_at": now,
        "previous_rejection": ({"notes": existing.get("review_notes"), "by_name": existing.get("reviewed_by_name")}
                               if existing else None),
        "reviewed_at": None, "reviewed_by_name": None, "review_notes": None, "approved_amount": None,
        "paid_at": None, "paid_by_name": None, "payment_reference": None,
    }
    await db.technician_charges.replace_one({"id": charge["id"]}, charge, upsert=True)
    await create_alert(UserRole.LIQUIDACIONES.value, AlertType.COBRO_TECNICO, "Nuevo cobro de técnico",
                       f"{current_user['name']} cobra {_cop(amount)} por {order.get('plate')}", order["id"])
    charge.pop("_id", None)
    return {"message": "Cobro enviado a liquidaciones", "charge": charge}


LIQUIDATION_ROLES = [UserRole.ADMIN, UserRole.LIQUIDACIONES]


@api_router.get("/technician-charges")
async def list_technician_charges(
    status: Optional[str] = None,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.LIQUIDACIONES, UserRole.TECNICO])),
):
    query: Dict[str, Any] = {}
    if status in CHARGE_STATUSES:
        query["status"] = status
    if current_user["role"] == UserRole.TECNICO.value:
        query["technician_id"] = current_user["id"]
    charges = await db.technician_charges.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    # Etiqueta de calidad actual de cada orden
    orders = {o["id"]: o async for o in db.orders.find(
        {"id": {"$in": list({c["order_id"] for c in charges})}},
        {"_id": 0, "id": 1, "status": 1, "quality_status": 1, "quality_rating": 1, "quality_notes": 1,
         "quality_by_name": 1, "quality_checked_at": 1, "quality_reviews": 1, "service_completed_at": 1,
         "profile_photo_url": 1})}
    out = []
    for c in charges:
        o = orders.get(c["order_id"]) or {}
        out.append({**c, "order_status": o.get("status"), "service_completed_at": o.get("service_completed_at"),
                    "profile_photo_url": o.get("profile_photo_url"), **(_quality_summary(o) if o else {})})
    return out


class TechnicianChargeReview(BaseModel):
    approved: bool
    amount: Optional[float] = None  # valor aprobado (si cambia el pedido)
    notes: Optional[str] = None


async def _alert_technician(charge: dict, title: str, message: str):
    await db.alerts.insert_one({
        "id": str(uuid.uuid4()), "recipient_id": charge["technician_id"],
        "alert_type": AlertType.COBRO_REVISADO.value, "title": title, "message": message,
        "order_id": charge["order_id"], "read": False, "created_at": datetime.now(timezone.utc).isoformat(),
    })


@api_router.put("/technician-charges/{charge_id}/review")
async def review_technician_charge(charge_id: str, data: TechnicianChargeReview,
                                   current_user: dict = Depends(require_roles(LIQUIDATION_ROLES))):
    charge = await db.technician_charges.find_one({"id": charge_id}, {"_id": 0})
    if not charge:
        raise HTTPException(status_code=404, detail="Cobro no encontrado")
    if charge["status"] != "pendiente":
        raise HTTPException(status_code=400, detail="Este cobro ya fue revisado")
    notes = (data.notes or "").strip() or None
    now = datetime.now(timezone.utc).isoformat()
    if data.approved:
        amount = round(float(data.amount if data.amount is not None else charge["amount"]), 2)
        if amount <= 0:
            raise HTTPException(status_code=400, detail="El valor aprobado debe ser mayor a 0")
        upd = {"status": "aprobado", "approved_amount": amount}
        msg = f"{charge['plate']}: cobro aprobado por {_cop(amount)}" + (f" · {notes}" if notes else "")
    else:
        if not notes:
            raise HTTPException(status_code=400, detail="Escribe el motivo del rechazo")
        upd = {"status": "rechazado", "approved_amount": None}
        msg = f"{charge['plate']}: cobro rechazado · {notes}"
    upd.update({"reviewed_at": now, "reviewed_by_id": current_user["id"], "reviewed_by_name": current_user["name"],
                "review_notes": notes})
    await db.technician_charges.update_one({"id": charge_id}, {"$set": upd})
    await _alert_technician(charge, "Cobro aprobado" if data.approved else "Cobro rechazado", msg)
    return {"message": "Cobro aprobado" if data.approved else "Cobro rechazado", "charge": {**charge, **upd}}


class TechnicianChargePay(BaseModel):
    reference: Optional[str] = None


@api_router.put("/technician-charges/{charge_id}/pay")
async def pay_technician_charge(charge_id: str, data: TechnicianChargePay,
                                current_user: dict = Depends(require_roles(LIQUIDATION_ROLES))):
    charge = await db.technician_charges.find_one({"id": charge_id}, {"_id": 0})
    if not charge:
        raise HTTPException(status_code=404, detail="Cobro no encontrado")
    if charge["status"] != "aprobado":
        raise HTTPException(status_code=400, detail="Solo se pagan cobros aprobados")
    now = datetime.now(timezone.utc).isoformat()
    upd = {"status": "pagado", "paid_at": now, "paid_by_id": current_user["id"], "paid_by_name": current_user["name"],
           "payment_reference": (data.reference or "").strip() or None}
    await db.technician_charges.update_one({"id": charge_id}, {"$set": upd})
    await _alert_technician(charge, "Cobro pagado", f"{charge['plate']}: te pagaron {_cop(charge.get('approved_amount'))}")
    return {"message": "Cobro marcado como pagado", "charge": {**charge, **upd}}


# ===================== Liquidación de asesores (comisión del check-in) =====================
ADVISOR_ORDER_EXCLUDED = [OrderStatus.AGENDADO.value, OrderStatus.DESISTIMIENTO.value]


def _advisor_commission_row(o: dict, rec: Optional[dict]) -> dict:
    """La comisión del asesor por una orden: calculada en vivo mientras está por revisar; congelada al aprobarla."""
    live = compute_advisor_commission(o)
    rec = rec or {}
    status = rec.get("status") or "pendiente"
    commission = rec.get("commission") if status in ("aprobado", "pagado") and rec.get("commission") else live
    return {
        "id": o["id"],
        "order_id": o["id"],
        "order_code": o.get("order_code"),
        "plate": o.get("plate"),
        "brand": o.get("brand"),
        "model": o.get("model"),
        "client_name": o.get("client_name"),
        "order_status": o.get("status"),
        "ingreso_at": o.get("ingreso_at"),
        "profile_photo_url": o.get("profile_photo_url"),
        "advisor_id": o.get("checkin_by_id"),
        "advisor_name": o.get("checkin_by_name"),
        "services": [_service_label(s) for s in (o.get("services") or []) if isinstance(s, dict)],
        "order_total": float(o.get("final_value") or o.get("negotiated_value") or 0),
        "payment_status": _payment_status(o),
        "commission": commission,
        "amount": commission["total"],
        "status": status,
        "approved_amount": rec.get("approved_amount"),
        "reviewed_at": rec.get("reviewed_at"), "reviewed_by_name": rec.get("reviewed_by_name"),
        "review_notes": rec.get("review_notes"),
        "paid_at": rec.get("paid_at"), "paid_by_name": rec.get("paid_by_name"),
        "payment_reference": rec.get("payment_reference"),
    }


@api_router.get("/advisor-commissions")
async def list_advisor_commissions(
    status: Optional[str] = None,
    current_user: dict = Depends(require_roles(LIQUIDATION_ROLES)),
):
    """Comisiones de los asesores por cada check-in que hicieron (tabla de pago a asesores)."""
    orders = await db.orders.find(
        {"checkin_by_id": {"$nin": [None, ""]}, "is_postventa": {"$ne": True},
         "status": {"$nin": ADVISOR_ORDER_EXCLUDED}},
        {"_id": 0, "inspection_photos": 0, "service_completion_photos": 0, "quality_photos": 0, "signature_url": 0},
    ).sort("ingreso_at", -1).to_list(1000)
    recs = {r["order_id"]: r async for r in db.advisor_commissions.find(
        {"order_id": {"$in": [o["id"] for o in orders]}}, {"_id": 0})}
    rows = [_advisor_commission_row(o, recs.get(o["id"])) for o in orders]
    if status in CHARGE_STATUSES:
        rows = [r for r in rows if r["status"] == status]
    return rows


class AdvisorCommissionReview(BaseModel):
    approved: bool
    amount: Optional[float] = None
    notes: Optional[str] = None


async def _advisor_commission_order(order_id: str) -> tuple:
    o = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not o or not o.get("checkin_by_id"):
        raise HTTPException(status_code=404, detail="Orden sin asesor de check-in")
    rec = await db.advisor_commissions.find_one({"order_id": order_id}, {"_id": 0})
    return o, rec


@api_router.put("/advisor-commissions/{order_id}/review")
async def review_advisor_commission(order_id: str, data: AdvisorCommissionReview,
                                    current_user: dict = Depends(require_roles(LIQUIDATION_ROLES))):
    o, rec = await _advisor_commission_order(order_id)
    if rec and rec.get("status") in ("aprobado", "pagado"):
        raise HTTPException(status_code=400, detail="Esta comisión ya fue aprobada")
    notes = (data.notes or "").strip() or None
    commission = compute_advisor_commission(o)
    now = datetime.now(timezone.utc).isoformat()
    upd = {"order_id": order_id, "advisor_id": o.get("checkin_by_id"), "advisor_name": o.get("checkin_by_name"),
           "reviewed_at": now, "reviewed_by_id": current_user["id"], "reviewed_by_name": current_user["name"],
           "review_notes": notes}
    if data.approved:
        amount = round(float(data.amount if data.amount is not None else commission["total"]), 2)
        if amount <= 0:
            raise HTTPException(status_code=400, detail="El valor aprobado debe ser mayor a 0")
        upd.update({"status": "aprobado", "approved_amount": amount, "commission": commission})
    else:
        if not notes:
            raise HTTPException(status_code=400, detail="Escribe el motivo del rechazo")
        upd.update({"status": "rechazado", "approved_amount": None, "commission": None})
    await db.advisor_commissions.update_one({"order_id": order_id}, {"$set": upd}, upsert=True)
    return {"message": "Comisión aprobada" if data.approved else "Comisión rechazada"}


@api_router.put("/advisor-commissions/{order_id}/reopen")
async def reopen_advisor_commission(order_id: str, current_user: dict = Depends(require_roles(LIQUIDATION_ROLES))):
    """Devuelve una comisión rechazada a 'Por revisar'."""
    _, rec = await _advisor_commission_order(order_id)
    if not rec or rec.get("status") != "rechazado":
        raise HTTPException(status_code=400, detail="Solo se reabren comisiones rechazadas")
    await db.advisor_commissions.update_one({"order_id": order_id}, {"$set": {"status": "pendiente"}})
    return {"message": "Comisión devuelta a por revisar"}


@api_router.put("/advisor-commissions/{order_id}/pay")
async def pay_advisor_commission(order_id: str, data: TechnicianChargePay,
                                 current_user: dict = Depends(require_roles(LIQUIDATION_ROLES))):
    _, rec = await _advisor_commission_order(order_id)
    if not rec or rec.get("status") != "aprobado":
        raise HTTPException(status_code=400, detail="Solo se pagan comisiones aprobadas")
    now = datetime.now(timezone.utc).isoformat()
    await db.advisor_commissions.update_one({"order_id": order_id}, {"$set": {
        "status": "pagado", "paid_at": now, "paid_by_id": current_user["id"], "paid_by_name": current_user["name"],
        "payment_reference": (data.reference or "").strip() or None}})
    return {"message": "Comisión marcada como pagada"}


@api_router.get("/orders-pending-invoice")
async def orders_pending_invoice(
    include_sent: bool = False,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.FACTURACION, UserRole.ASESOR, UserRole.COORDINADOR])),
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
            "retention_base": _retention_base(o)["base"],
            **b,
        })
    return out


class ApplyRetention(BaseModel):
    city: Optional[str] = None
    apply_reteica: bool = False
    reteica_rate: Optional[float] = None  # por mil (‰) ej: 6.9 → 6,9/1000
    apply_retefuente: bool = False
    retefuente_rate: Optional[float] = None  # % ej: 2.5
    update_identity: bool = False
    new_cedula: Optional[str] = None
    new_razon_social: Optional[str] = None
    no_aplica: bool = False


@api_router.post("/orders/{order_id}/apply-retention")
async def apply_retention(
    order_id: str,
    data: ApplyRetention,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.FACTURACION, UserRole.ASESOR, UserRole.COORDINADOR])),
):
    """Aplica retenciones (Reteica/Retefuente) sobre la orden y opcionalmente actualiza
    cédula/razón social. Requerido antes de enviar la factura electrónica."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")

    amounts = _retention_base(order)
    total, base = amounts["total"], amounts["base"]
    reteica_amt = 0
    retefuente_amt = 0

    if not data.no_aplica:
        if data.apply_reteica:
            if data.reteica_rate is None or data.reteica_rate < 0:
                raise HTTPException(status_code=400, detail="Tasa de Reteica inválida")
            reteica_amt = _round_peso(base * data.reteica_rate / 1000.0)
        if data.apply_retefuente:
            if data.retefuente_rate is None or data.retefuente_rate < 0:
                raise HTTPException(status_code=400, detail="Tasa de Retefuente inválida")
            retefuente_amt = _round_peso(base * data.retefuente_rate / 100.0)

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
        "reteica_unit": "por_mil",
        "reteica_amount": reteica_amt,
        "retefuente_applied": bool(data.apply_retefuente) and not data.no_aplica,
        "retefuente_rate": data.retefuente_rate,
        "retefuente_amount": retefuente_amt,
        "total_retention": total_ret,
        "retention_base": base,
        "iva": amounts["iva"],
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
            "reteica_unit": "por_mil",
            "reteica_amount": reteica_amt,
            "retefuente_rate": data.retefuente_rate if data.apply_retefuente and not data.no_aplica else None,
            "retefuente_amount": retefuente_amt,
            "total_retention": total_ret,
            "retention_base": base,
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


RETENTION_ROLES = [UserRole.ADMIN, UserRole.FACTURACION, UserRole.ASESOR, UserRole.COORDINADOR]


@api_router.get("/retentions/registry")
async def retentions_registry(
    q: Optional[str] = None,
    current_user: dict = Depends(require_roles(RETENTION_ROLES)),
):
    """Sección Retenciones: la retención vigente de cada orden (la última aplicada), con datos del cliente y del auto."""
    filt: Dict[str, Any] = {}
    if q:
        rx = re.compile(re.escape(q), re.IGNORECASE)
        filt["$or"] = [{"plate": rx}, {"client_cedula": rx}, {"client_name": rx},
                       {"order_code": rx}, {"city": rx}, {"certificate_number": rx}]
    items = await db.retentions.find(filt, {"_id": 0}).sort("applied_at", -1).to_list(2000)
    current: Dict[str, dict] = {}
    for r in items:
        if r["order_id"] in current:
            current[r["order_id"]]["times_modified"] += 1
        else:
            current[r["order_id"]] = {**r, "times_modified": 0}
    orders = await db.orders.find(
        {"id": {"$in": list(current)}},
        {"_id": 0, "id": 1, "brand": 1, "model": 1, "color": 1, "client_name": 1, "client_cedula": 1,
         "client_razon_social": 1, "client_email": 1, "invoice_number": 1, "retention_snapshot": 1, "requires_invoice": 1,
         "final_value": 1, "negotiated_value": 1},
    ).to_list(2000)
    by_id = {o["id"]: o for o in orders}
    out = []
    for oid, r in current.items():
        o = by_id.get(oid) or {}
        base = r.get("retention_base")
        if base is None:  # retenciones anteriores a la liquidación sobre la base sin IVA
            base = r.get("order_total_before") or 0
        out.append({
            **r,
            "retention_base": base,
            "brand": o.get("brand"), "model": o.get("model"), "color": o.get("color"),
            # Datos actuales del cliente (pudieron cambiar con "Cambiar NIT/Cédula")
            "client_name": o.get("client_name") or r.get("client_name"),
            "client_cedula": o.get("client_cedula") or r.get("client_cedula"),
            "client_razon_social": o.get("client_razon_social"),
            "client_email": o.get("client_email"),
            "invoice_number": o.get("invoice_number"),
        })
    with_ret = [r for r in out if not r.get("no_aplica")]
    return {
        "items": out,
        "summary": {
            "orders": len(out),
            "with_retention": len(with_ret),
            "clients": len({(r.get("client_cedula") or r.get("client_name") or "").strip().lower() for r in out}),
            "total_reteica": round(sum(float(r.get("reteica_amount") or 0) for r in with_ret), 2),
            "total_retefuente": round(sum(float(r.get("retefuente_amount") or 0) for r in with_ret), 2),
            "total_retention": round(sum(float(r.get("total_retention") or 0) for r in with_ret), 2),
        },
    }


@api_router.get("/retentions/{retention_id}/certificate.pdf")
async def retention_certificate_pdf(retention_id: str, current_user: dict = Depends(require_roles(RETENTION_ROLES))):
    """Certificado de retención en PDF. El número (CR-AAAA-00001) se asigna la primera vez que se genera."""
    ret = await db.retentions.find_one({"id": retention_id}, {"_id": 0})
    if not ret:
        raise HTTPException(status_code=404, detail="Retención no encontrada")
    if ret.get("no_aplica"):
        raise HTTPException(status_code=400, detail="Esta orden quedó sin retención: no hay certificado")
    if not ret.get("certificate_number"):
        year = datetime.now(timezone.utc).strftime("%Y")
        counter = await db.counters.find_one_and_update(
            {"id": f"retention_certificate_{year}"}, {"$inc": {"seq": 1}}, upsert=True, return_document=True,
        )
        number = f"CR-{year}-{int(counter['seq']):05d}"
        now = datetime.now(timezone.utc).isoformat()
        # Solo la primera solicitud asigna el número (evita dos números si se pide dos veces a la vez)
        await db.retentions.update_one(
            {"id": retention_id, "certificate_number": {"$in": [None]}},
            {"$set": {"certificate_number": number, "certificate_issued_at": now,
                      "certificate_issued_by_name": current_user["name"]}},
        )
        ret = await db.retentions.find_one({"id": retention_id}, {"_id": 0})
    order = await db.orders.find_one({"id": ret["order_id"]}, {"_id": 0}) or {}
    pdf_bytes = await asyncio.to_thread(build_retention_certificate, ret, order)
    return FastAPIResponse(content=pdf_bytes, media_type="application/pdf",
                           headers={"Content-Disposition": f'attachment; filename="certificado_retencion_{ret["certificate_number"]}.pdf"'})


class UpdateClientEmail(BaseModel):
    client_email: str


class UpdateOrderServices(BaseModel):
    services: List[ServiceItem]
    password: str          # contraseña de autorización (settings.update_order_pin, por defecto 00000)
    reason: Optional[str] = None


def _services_gross(services: List[ServiceItem]) -> float:
    """Suma de servicios + extras (sin descuento ni IVA)."""
    total = 0.0
    for s in services:
        total += float(s.price or 0)
        for e in (s.extras or []):
            total += float((e or {}).get("price") or 0)
    return round(total, 2)


@api_router.post("/orders/{order_id}/update-services")
async def update_order_services(
    order_id: str,
    data: UpdateOrderServices,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ASESOR, UserRole.COORDINADOR])),
):
    """Actualiza la orden: agrega/quita servicios o cambia sus valores. Requiere contraseña.
    Recalcula el valor de la orden reaplicando el descuento y el IVA que ya tenía."""
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order.get("status") in (OrderStatus.ENTREGADO.value, OrderStatus.DESISTIMIENTO.value):
        raise HTTPException(status_code=400, detail="No se puede actualizar una orden entregada o desistida")

    pin_doc = await db.settings.find_one({"key": "update_order_pin"}, {"_id": 0})
    expected_pin = (pin_doc or {}).get("value", "00000")
    if str(data.password).strip() != str(expected_pin).strip():
        raise HTTPException(status_code=400, detail="Contraseña incorrecta")

    if not data.services:
        raise HTTPException(status_code=400, detail="La orden debe tener al menos un servicio")
    for s in data.services:
        if float(s.price or 0) < 0:
            raise HTTPException(status_code=400, detail="El valor de un servicio no puede ser negativo")
        if s.no_charge:
            if not order.get("is_postventa"):
                raise HTTPException(status_code=400, detail="Solo los servicios de postventa pueden marcarse sin pago")
            s.price = 0

    gross = _services_gross(data.services)
    now = datetime.now(timezone.utc).isoformat()
    checked_in = order.get("final_value") is not None
    with_iva = bool(checked_in and order.get("requires_invoice"))
    # Descuento sobre la base sin IVA y luego IVA 19% (igual que el check-in y el PDF)
    price = _price_with_discount_and_iva(gross, order.get("discount_type"), order.get("discount_value"), with_iva)
    disc_amount = price["discount"]
    net = round(price["total"], 2)
    if with_iva:
        gross = gross + _round_peso(gross * IVA_RATE)  # valor antes del descuento, con IVA

    update_data = {
        "services": [s.model_dump() for s in data.services],
        "last_updated_by_id": current_user["id"],
        "last_updated_by_name": current_user["name"],
        "last_updated_at": now,
        "updated_at": now,
    }
    if order.get("discount_type"):
        update_data["discount_amount"] = disc_amount
    if checked_in:
        update_data["final_value"] = net
        update_data["final_value_before_discount"] = gross if order.get("discount_type") else order.get("final_value_before_discount")
        update_data["tax_base"] = price["tax_base"]
        update_data["iva_amount"] = price["iva"]
    else:
        update_data["negotiated_value"] = net
        update_data["negotiated_value_before_discount"] = gross

    await db.orders.update_one({"id": order_id}, {"$set": update_data})

    old_total = float(order.get("final_value") if checked_in else (order.get("negotiated_value") or 0))
    await log_order_history(
        order_id, "ORDEN_ACTUALIZADA",
        order.get("status"), order.get("status"),
        current_user["id"], current_user["name"],
        {
            "reason": data.reason,
            "old_services": [x.get("description") or x.get("service") for x in (order.get("services") or [])],
            "new_services": [s.description or s.service for s in data.services],
            "old_total": old_total,
            "new_total": net,
        },
    )

    updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    try:
        await _sync_accessory_request(updated, current_user)
        updated = await db.orders.find_one({"id": order_id}, {"_id": 0})
    except Exception as e:
        logger.error(f"[accesorios] sync tras actualizar orden {order_id}: {e}")
    return {"message": "Orden actualizada", "order": updated}


# ==================== SOLICITUDES DE ACCESORIOS ====================
# Si la orden lleva accesorios, al aprobar el ingreso se crea una solicitud para el
# usuario de accesorios: la despacha del inventario y la entrega al técnico instalador.

def _accessory_catalog_ids() -> set:
    return {s["id"] for s in SERVICES_CATALOG.get("accesorios", {}).get("services", [])}


def _accessory_items_from_services(services: List[dict]) -> List[dict]:
    """Servicios de la orden que son accesorios (por id del catálogo o categoría 'Accesorios')."""
    ids = _accessory_catalog_ids()
    names = {s["id"]: s["name"] for s in SERVICES_CATALOG.get("accesorios", {}).get("services", [])}
    items = []
    for svc in services or []:
        if not isinstance(svc, dict):
            continue
        sid = svc.get("service") or ""
        desc = (svc.get("description") or "").strip()
        if sid not in ids and not desc.lower().startswith("accesorio"):
            continue
        name = names.get(sid) or (desc.split(" - ", 1)[1] if " - " in desc else desc) or sid
        items.append({"service_id": sid, "name": name, "cantidad": 1})
    return items


def _accessory_key(item: dict) -> str:
    return f"{item.get('service_id') or ''}::{(item.get('name') or '').lower()}"


async def _sync_accessory_request(order: dict, current_user: dict):
    """Crea o actualiza la solicitud pendiente de accesorios de la orden.
    Los accesorios ya despachados en solicitudes anteriores no se vuelven a pedir."""
    if not order or order.get("status") in (OrderStatus.AGENDADO.value, OrderStatus.ENTREGADO.value,
                                             OrderStatus.DESISTIMIENTO.value):
        return None
    wanted = _accessory_items_from_services(order.get("services") or [])

    done_counts: Dict[str, int] = {}
    pending = None
    async for req in db.accessory_requests.find({"order_id": order["id"], "status": {"$ne": "cancelada"}}, {"_id": 0}):
        if req["status"] == "pendiente":
            pending = req
            continue
        for it in req.get("items") or []:
            k = _accessory_key(it)
            done_counts[k] = done_counts.get(k, 0) + 1

    remaining = []
    for it in wanted:
        k = _accessory_key(it)
        if done_counts.get(k, 0) > 0:
            done_counts[k] -= 1
        else:
            remaining.append(it)

    now = datetime.now(timezone.utc).isoformat()
    if not remaining:
        if pending:
            await db.accessory_requests.update_one(
                {"id": pending["id"]}, {"$set": {"status": "cancelada", "updated_at": now}})
        await _refresh_order_accessory_status(order["id"])
        return None

    if pending:
        await db.accessory_requests.update_one(
            {"id": pending["id"]}, {"$set": {"items": remaining, "updated_at": now}})
        await _refresh_order_accessory_status(order["id"])
        return pending["id"]

    seq_doc = await db.accessory_requests.find_one({}, {"_id": 0, "seq": 1}, sort=[("seq", -1)])
    seq = ((seq_doc or {}).get("seq") or 0) + 1
    req = {
        "id": str(uuid.uuid4()),
        "seq": seq,
        "code": f"ACC-{seq:05d}",
        "order_id": order["id"],
        "order_code": order.get("order_code"),
        "plate": order.get("plate"),
        "client_name": order.get("client_name"),
        "brand": order.get("brand"),
        "model": order.get("model"),
        "items": remaining,
        "status": "pendiente",
        "requested_by_id": current_user["id"],
        "requested_by_name": current_user.get("name"),
        "created_at": now,
        "updated_at": now,
    }
    await db.accessory_requests.insert_one(req)
    await _refresh_order_accessory_status(order["id"])
    await create_alert(
        UserRole.ACCESORIOS.value, AlertType.SOLICITUD_ACCESORIOS,
        "Despachar accesorios",
        f"{req['code']} · Vehículo {order.get('plate')}: " + ", ".join(i["name"] for i in remaining),
        order["id"],
    )
    return req["id"]


async def _refresh_order_accessory_status(order_id: str):
    """Guarda en la orden el estado del pedido de accesorios: pendiente > despachado > entregado."""
    statuses = set()
    async for req in db.accessory_requests.find({"order_id": order_id, "status": {"$ne": "cancelada"}}, {"_id": 0, "status": 1}):
        statuses.add(req["status"])
    status = None
    for s_ in ("pendiente", "despachado", "entregado"):
        if s_ in statuses:
            status = s_
            break
    await db.orders.update_one({"id": order_id}, {"$set": {"accessory_status": status}})


@api_router.get("/accessory-requests")
async def list_accessory_requests(
    status: Optional[str] = None,
    order_id: Optional[str] = None,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ACCESORIOS, UserRole.COORDINADOR,
                                                UserRole.ASESOR, UserRole.TECNICO])),
):
    query: Dict[str, Any] = {"status": status} if status else {"status": {"$ne": "cancelada"}}
    if order_id:
        query["order_id"] = order_id
    if current_user["role"] == UserRole.TECNICO.value:
        query["delivered_to_id"] = current_user["id"]
    reqs = await db.accessory_requests.find(query, {"_id": 0}).sort("seq", -1).to_list(500)
    order_ids = list({r["order_id"] for r in reqs})
    orders = {}
    if order_ids:
        async for o in db.orders.find({"id": {"$in": order_ids}},
                                      {"_id": 0, "id": 1, "status": 1, "assigned_technician_id": 1,
                                       "assigned_technician_name": 1, "sede_nombre": 1, "services": 1}):
            orders[o["id"]] = o
    for r in reqs:
        o = orders.get(r["order_id"]) or {}
        r["order_status"] = o.get("status")
        r["assigned_technician_id"] = o.get("assigned_technician_id")
        r["assigned_technician_name"] = o.get("assigned_technician_name")
        r["order_services"] = [s.get("description") or s.get("service") for s in (o.get("services") or [])
                               if isinstance(s, dict)]
    return reqs


@api_router.post("/inventory/test-accessories")
async def seed_test_accessories(current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ACCESORIOS]))):
    """Crea un inventario de prueba: 2 o 3 unidades de cada accesorio del catálogo que aún no tenga artículo."""
    existing = set()
    async for it in db.inventory.find({"active": True, "categoria": "accesorio"}, {"_id": 0, "linked_service": 1}):
        if it.get("linked_service"):
            existing.add(it["linked_service"])
    last = await db.inventory.find_one({}, {"_id": 0, "seq": 1}, sort=[("seq", -1)])
    seq = (last or {}).get("seq") or 0
    now = datetime.now(timezone.utc).isoformat()
    created = []
    for i, svc in enumerate(SERVICES_CATALOG.get("accesorios", {}).get("services", [])):
        if svc["id"] in existing:
            continue
        seq += 1
        qty = 2 if i % 2 == 0 else 3
        await db.inventory.insert_one({
            "id": str(uuid.uuid4()), "seq": seq, "codigo": f"INV-{seq:05d}",
            "nombre": svc["name"], "categoria": "accesorio", "tipo_articulo": "cantidad", "tipo_rollo": None,
            "factura_compra": None, "metros_iniciales": None, "metros_restantes": None,
            "cantidad_inicial": qty, "cantidad_restante": qty, "costo": 0, "linked_service": svc["id"],
            "sede_id": None, "sede_nombre": None, "fecha_ingreso": now, "notes": "Inventario de prueba",
            "stock_minimo": 1, "is_test": True, "active": True,
            "created_by": current_user["id"], "created_at": now, "updated_at": now,
        })
        created.append(f"{svc['name']} ({qty})")
    return {"created": created, "created_count": len(created), "skipped_count": len(existing)}


@api_router.post("/inventory/test-accessories/remove")
async def remove_test_accessories(current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ACCESORIOS]))):
    """Quita (desactiva) los artículos del inventario de prueba de accesorios."""
    res = await db.inventory.update_many(
        {"is_test": True, "active": True},
        {"$set": {"active": False, "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"removed_count": res.modified_count}


class AccessoryDispatchItem(BaseModel):
    inventory_item_id: Optional[str] = None
    cantidad: int = 1
    service_name: Optional[str] = None  # servicio de la orden para el que se entrega


class AccessoryDispatch(BaseModel):
    items: List[AccessoryDispatchItem]
    technician_id: str  # técnico instalador que recibe los accesorios
    pin: str
    notes: Optional[str] = None


async def _check_accessory_pin(pin: str):
    """PIN para confirmar despachos de accesorios (settings.accessory_dispatch_pin, por defecto 00000)."""
    doc = await db.settings.find_one({"key": "accessory_dispatch_pin"}, {"_id": 0})
    expected = (doc or {}).get("value", "00000")
    if str(pin or "").strip() != str(expected).strip():
        raise HTTPException(status_code=400, detail="PIN de despacho incorrecto")


@api_router.post("/accessory-requests/{request_id}/dispatch")
async def dispatch_accessory_request(
    request_id: str,
    data: AccessoryDispatch,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ACCESORIOS])),
):
    """Despacha el pedido al técnico instalador: descuenta cada accesorio del inventario,
    registra el técnico y el servicio de la orden para el que se entrega. Requiere PIN."""
    req = await db.accessory_requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")
    if req["status"] != "pendiente":
        raise HTTPException(status_code=400, detail="La solicitud ya fue despachada")
    if len(data.items) != len(req.get("items") or []):
        raise HTTPException(status_code=400, detail="Debes indicar cada accesorio de la solicitud")
    await _check_accessory_pin(data.pin)
    tech = await db.users.find_one({"id": data.technician_id, "role": UserRole.TECNICO.value}, {"_id": 0})
    if not tech:
        raise HTTPException(status_code=400, detail="Selecciona el técnico que recibe los accesorios")

    # Validar stock antes de descontar (sumando si dos accesorios salen del mismo artículo)
    needed: Dict[str, int] = {}
    for d in data.items:
        if d.cantidad is None or d.cantidad <= 0:
            raise HTTPException(status_code=400, detail="La cantidad debe ser mayor a 0")
        if d.inventory_item_id:
            needed[d.inventory_item_id] = needed.get(d.inventory_item_id, 0) + d.cantidad
    inv = {}
    for inv_id, qty in needed.items():
        it = await db.inventory.find_one({"id": inv_id, "active": True}, {"_id": 0})
        if not it or it.get("tipo_articulo") != "cantidad":
            raise HTTPException(status_code=400, detail="Artículo de inventario no válido")
        if (it.get("cantidad_restante") or 0) < qty:
            raise HTTPException(status_code=400,
                                detail=f"Stock insuficiente de {it['nombre']}: quedan {it.get('cantidad_restante') or 0}")
        inv[inv_id] = it

    now = datetime.now(timezone.utc).isoformat()
    user_name = current_user.get("name") or current_user.get("email")
    items = []
    for base, d in zip(req["items"], data.items):
        item = {**base, "cantidad": d.cantidad, "inventory_item_id": d.inventory_item_id,
                "service_name": (d.service_name or "").strip() or base.get("name"),
                "inventory_nombre": inv[d.inventory_item_id]["nombre"] if d.inventory_item_id else None,
                "inventory_codigo": inv[d.inventory_item_id].get("codigo") if d.inventory_item_id else None}
        items.append(item)
        if d.inventory_item_id:
            await db.inventory.update_one(
                {"id": d.inventory_item_id},
                {"$inc": {"cantidad_restante": -d.cantidad}, "$set": {"updated_at": now}})
            await db.inventory_movements.insert_one({
                "id": str(uuid.uuid4()),
                "inventory_item_id": d.inventory_item_id,
                "type": "deduct",
                "cantidad": d.cantidad,
                "reason": f"Despacho {req['code']} · {req.get('plate')} · {tech['name']}",
                "order_id": req["order_id"],
                "accessory_request_id": request_id,
                "user_id": current_user["id"],
                "user_name": user_name,
                "created_at": now,
            })

    await db.accessory_requests.update_one({"id": request_id}, {"$set": {
        "items": items,
        "status": "entregado",
        "dispatch_notes": data.notes,
        "dispatched_by_id": current_user["id"],
        "dispatched_by_name": user_name,
        "dispatched_at": now,
        "delivered_to_id": tech["id"],
        "delivered_to_name": tech["name"],
        "delivered_by_id": current_user["id"],
        "delivered_by_name": user_name,
        "delivered_at": now,
        "updated_at": now,
    }})
    await _refresh_order_accessory_status(req["order_id"])
    order = await db.orders.find_one({"id": req["order_id"]}, {"_id": 0, "status": 1})
    await log_order_history(
        req["order_id"], "ACCESORIOS_DESPACHADOS",
        (order or {}).get("status"), (order or {}).get("status"),
        current_user["id"], user_name,
        {"request": req["code"], "technician_name": tech["name"],
         "items": [f"{i['cantidad']} x {i['name']} → {i['service_name']}" for i in items]},
    )
    await db.alerts.insert_one({
        "id": str(uuid.uuid4()),
        "recipient_id": tech["id"],
        "alert_type": AlertType.ACCESORIOS_ENTREGADOS.value,
        "title": "Accesorios entregados",
        "message": f"Vehículo {req.get('plate')}: " + ", ".join(f"{i['cantidad']} x {i['name']} ({i['service_name']})" for i in items),
        "order_id": req["order_id"],
        "read": False,
        "created_at": now,
    })
    return await db.accessory_requests.find_one({"id": request_id}, {"_id": 0})


class AccessoryDeliver(BaseModel):
    technician_id: str
    pin: str
    notes: Optional[str] = None


@api_router.post("/accessory-requests/{request_id}/deliver")
async def deliver_accessory_request(
    request_id: str,
    data: AccessoryDeliver,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ACCESORIOS])),
):
    """Entrega los accesorios despachados al técnico instalador."""
    req = await db.accessory_requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(status_code=404, detail="Solicitud no encontrada")
    if req["status"] != "despachado":
        raise HTTPException(status_code=400, detail="Primero debes despachar la solicitud")
    await _check_accessory_pin(data.pin)
    tech = await db.users.find_one({"id": data.technician_id, "role": UserRole.TECNICO.value}, {"_id": 0})
    if not tech:
        raise HTTPException(status_code=404, detail="Técnico no encontrado")

    now = datetime.now(timezone.utc).isoformat()
    user_name = current_user.get("name") or current_user.get("email")
    await db.accessory_requests.update_one({"id": request_id}, {"$set": {
        "status": "entregado",
        "delivered_to_id": tech["id"],
        "delivered_to_name": tech["name"],
        "delivery_notes": data.notes,
        "delivered_by_id": current_user["id"],
        "delivered_by_name": user_name,
        "delivered_at": now,
        "updated_at": now,
    }})
    await _refresh_order_accessory_status(req["order_id"])
    order = await db.orders.find_one({"id": req["order_id"]}, {"_id": 0, "status": 1})
    await log_order_history(
        req["order_id"], "ACCESORIOS_ENTREGADOS",
        (order or {}).get("status"), (order or {}).get("status"),
        current_user["id"], user_name,
        {"request": req["code"], "technician_name": tech["name"]},
    )
    await db.alerts.insert_one({
        "id": str(uuid.uuid4()),
        "recipient_id": tech["id"],
        "alert_type": AlertType.ACCESORIOS_ENTREGADOS.value,
        "title": "Accesorios entregados",
        "message": f"Vehículo {req.get('plate')}: " + ", ".join(f"{i.get('cantidad', 1)} x {i['name']}" for i in req["items"]),
        "order_id": req["order_id"],
        "read": False,
        "created_at": now,
    })
    return await db.accessory_requests.find_one({"id": request_id}, {"_id": 0})


class RescheduleAppointment(BaseModel):
    new_date: str          # YYYY-MM-DD
    new_time_slot: str     # franja_X o 'prioridad'
    password: str          # contraseña de autorización para reagendar
    reason: Optional[str] = None


@api_router.post("/orders/{order_id}/reschedule")
async def reschedule_appointment(
    order_id: str,
    data: RescheduleAppointment,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ASESOR, UserRole.COORDINADOR])),
):
    """Reasigna (pospone o adelanta) una cita agendada. Requiere contraseña.

    - Actualiza date, time_slot y recalcula scheduled_time.
    - Envía correo con la cita actualizada al cliente.
    """
    order = await db.orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if order.get("status") != OrderStatus.AGENDADO.value:
        raise HTTPException(
            status_code=400,
            detail=f"Solo se puede reasignar una cita en estado AGENDADO. Estado actual: {order.get('status')}",
        )

    # Validar contraseña (configurable en /settings · default 861123)
    pin_settings = await db.settings.find_one({"key": "reschedule_pin"}, {"_id": 0})
    expected_pin = (pin_settings or {}).get("value", "861123")
    if str(data.password).strip() != str(expected_pin).strip():
        raise HTTPException(status_code=400, detail="Contraseña de reagendación inválida")

    # Parse new date
    try:
        new_date = datetime.strptime(data.new_date, "%Y-%m-%d").date()
    except Exception:
        raise HTTPException(status_code=400, detail="Fecha inválida (formato YYYY-MM-DD)")

    old_date = order.get("date")
    old_time = order.get("scheduled_time")
    old_slot = order.get("time_slot")

    # Recalcular scheduled_time (prioridad → hora actual Colombia; franja → queue position)
    if data.new_time_slot == "prioridad":
        col_now = get_colombia_time()
        new_scheduled_time = col_now.strftime("%H:%M")
        is_priority = True
    else:
        new_scheduled_time = await calculate_scheduled_time(data.new_date, data.new_time_slot)
        is_priority = False

    now = datetime.now(timezone.utc).isoformat()
    await db.orders.update_one(
        {"id": order_id},
        {"$set": {
            "date": data.new_date,
            "time_slot": data.new_time_slot,
            "scheduled_time": new_scheduled_time,
            "is_priority": is_priority,
            "rescheduled_at": now,
            "rescheduled_by": current_user["name"],
            "reschedule_count": int(order.get("reschedule_count") or 0) + 1,
            "reschedule_history": [
                *(order.get("reschedule_history") or []),
                {
                    "from_date": old_date, "from_time": old_time, "from_slot": old_slot,
                    "to_date": data.new_date, "to_time": new_scheduled_time, "to_slot": data.new_time_slot,
                    "at": now, "by": current_user["name"],
                    "reason": data.reason,
                },
            ],
            "updated_at": now,
        }},
    )

    await log_order_history(
        order_id, "CITA_REAGENDADA",
        old_date or "", data.new_date,
        current_user["id"], current_user["name"],
        {"old_time": old_time, "new_time": new_scheduled_time, "reason": data.reason},
    )

    # Enviar correo con la cita actualizada
    email_id = None
    if order.get("client_email"):
        try:
            order_after = await db.orders.find_one({"id": order_id}, {"_id": 0})
            html = build_appointment_confirmation_html(order_after, qr_cid="qr-code")
            email_id = await _send_email_with_attachments(
                order["client_email"],
                f"Cita reagendada · Nueva hora {new_scheduled_time} · #{order.get('order_code')} · PolarizadosYA!",
                html,
                [*appointment_qr_attachments(order.get("order_code", ""), cid="qr-code"), *brand_attachments()],
            )
        except Exception as e:
            logger.error(f"[reschedule-email] {e}")

    return {
        "message": "Cita reagendada",
        "old_date": old_date, "old_time": old_time,
        "new_date": data.new_date, "new_time": new_scheduled_time,
        "email_sent": bool(email_id),
    }


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
        [_pdf_attachment(f"factura_{invoice_number}.pdf", pdf_bytes), *brand_attachments()],
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
    attachments.extend(brand_attachments())
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
        "groups": CUTTING_REFERENCE_GROUPS,
        "default_roll_meters": DEFAULT_ROLL_METERS,
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


# ==================== DISCOUNT CODES ENDPOINTS ====================
def _require_discount_admin(password: str):
    if not DISCOUNT_ADMIN_PASSWORD or not password or password.strip() != DISCOUNT_ADMIN_PASSWORD:
        raise HTTPException(status_code=403, detail="Contraseña de administración inválida")

def _public_discount_doc(doc: dict) -> dict:
    """Serializa un documento de código quitando _id."""
    if not doc:
        return doc
    out = {k: v for k, v in doc.items() if k != "_id"}
    out["expired"] = _is_discount_expired(doc)
    out["exhausted"] = _is_discount_exhausted(doc)
    out.setdefault("kind", "codigo")
    return out

@api_router.post("/discount-codes/admin/verify")
async def discount_admin_verify(data: DiscountAdminAuth, current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ASESOR, UserRole.FACTURACION]))):
    """Verifica la contraseña de administración de códigos (william123)."""
    _require_discount_admin(data.admin_password)
    return {"ok": True}

@api_router.get("/discount-codes")
async def list_discount_codes(
    include_inactive: bool = True,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ASESOR, UserRole.FACTURACION]))
):
    q = {} if include_inactive else {"active": True}
    docs = await db.discount_codes.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return [_public_discount_doc(d) for d in docs]

@api_router.post("/discount-codes")
async def create_discount_code(
    data: DiscountCodeCreate,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ASESOR, UserRole.FACTURACION]))
):
    _require_discount_admin(data.admin_password)
    code = _normalize_code(data.code)
    if not code:
        raise HTTPException(status_code=400, detail="El código no puede estar vacío")
    if (data.discount_type or "").lower() not in ("percentage", "fixed"):
        raise HTTPException(status_code=400, detail="discount_type debe ser 'percentage' o 'fixed'")
    if data.discount_value is None or float(data.discount_value) <= 0:
        raise HTTPException(status_code=400, detail="El valor del descuento debe ser mayor a 0")
    if data.discount_type.lower() == "percentage" and float(data.discount_value) > 100:
        raise HTTPException(status_code=400, detail="El porcentaje no puede ser mayor a 100")
    if data.expires_at:
        try:
            datetime.strptime(data.expires_at, "%Y-%m-%d")
        except Exception:
            raise HTTPException(status_code=400, detail="Formato de fecha inválido (use YYYY-MM-DD)")
    kind = (data.kind or "codigo").lower()
    if kind not in DISCOUNT_KINDS:
        raise HTTPException(status_code=400, detail="kind debe ser 'cupon' o 'codigo'")
    if data.max_uses is not None and data.max_uses < 1:
        raise HTTPException(status_code=400, detail="El límite de usos debe ser al menos 1")
    existing = await db.discount_codes.find_one({"code": code})
    if existing:
        raise HTTPException(status_code=409, detail=f"El código {code} ya existe")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "code": code,
        "discount_type": data.discount_type.lower(),
        "discount_value": float(data.discount_value),
        "expires_at": data.expires_at,
        "active": bool(data.active),
        "notes": data.notes,
        "kind": kind,
        "max_uses": data.max_uses,
        "usage_count": 0,
        "last_used_at": None,
        "created_at": now,
        "created_by": current_user["id"],
        "created_by_name": current_user.get("name") or current_user.get("email"),
        "updated_at": None,
    }
    await db.discount_codes.insert_one(doc)
    return _public_discount_doc(doc)

@api_router.patch("/discount-codes/{code_id}")
async def update_discount_code(
    code_id: str,
    data: DiscountCodeUpdate,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ASESOR, UserRole.FACTURACION]))
):
    _require_discount_admin(data.admin_password)
    existing = await db.discount_codes.find_one({"id": code_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Código no encontrado")
    update: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if data.discount_type is not None:
        if data.discount_type.lower() not in ("percentage", "fixed"):
            raise HTTPException(status_code=400, detail="discount_type inválido")
        update["discount_type"] = data.discount_type.lower()
    if data.discount_value is not None:
        if float(data.discount_value) <= 0:
            raise HTTPException(status_code=400, detail="El valor debe ser mayor a 0")
        update["discount_value"] = float(data.discount_value)
    if data.expires_at is not None:
        if data.expires_at == "":
            update["expires_at"] = None
        else:
            try:
                datetime.strptime(data.expires_at, "%Y-%m-%d")
            except Exception:
                raise HTTPException(status_code=400, detail="Formato de fecha inválido (use YYYY-MM-DD)")
            update["expires_at"] = data.expires_at
    if data.active is not None:
        update["active"] = bool(data.active)
    if data.notes is not None:
        update["notes"] = data.notes
    if data.kind is not None:
        if data.kind.lower() not in DISCOUNT_KINDS:
            raise HTTPException(status_code=400, detail="kind debe ser 'cupon' o 'codigo'")
        update["kind"] = data.kind.lower()
    if data.max_uses is not None:
        if data.max_uses < 0:
            raise HTTPException(status_code=400, detail="El límite de usos no puede ser negativo")
        update["max_uses"] = data.max_uses or None
    if data.discount_value is not None and update.get("discount_type", existing.get("discount_type")) == "percentage" \
            and float(data.discount_value) > 100:
        raise HTTPException(status_code=400, detail="El porcentaje no puede ser mayor a 100")
    await db.discount_codes.update_one({"id": code_id}, {"$set": update})
    doc = await db.discount_codes.find_one({"id": code_id}, {"_id": 0})
    return _public_discount_doc(doc)

@api_router.delete("/discount-codes/{code_id}")
async def delete_discount_code(
    code_id: str,
    admin_password: str,
    current_user: dict = Depends(require_roles([UserRole.ADMIN, UserRole.ASESOR, UserRole.FACTURACION]))
):
    _require_discount_admin(admin_password)
    res = await db.discount_codes.delete_one({"id": code_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Código no encontrado")
    return {"ok": True}

@api_router.get("/discount-codes/validate")
async def validate_discount_code(
    code: str,
    subtotal: float = 0.0,
    current_user: dict = Depends(get_current_user),
):
    """Valida un código y devuelve el monto a descontar sobre un subtotal."""
    doc = await db.discount_codes.find_one({"code": _normalize_code(code)}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Código no encontrado")
    if not doc.get("active", True):
        raise HTTPException(status_code=400, detail="El código está inactivo")
    if _is_discount_expired(doc):
        raise HTTPException(status_code=400, detail="El código está vencido")
    if _is_discount_exhausted(doc):
        raise HTTPException(status_code=400, detail="El código ya alcanzó su límite de usos")
    amount = _compute_discount_amount(subtotal, doc.get("discount_type"), doc.get("discount_value"))
    return {
        "code": doc.get("code"),
        "discount_type": doc.get("discount_type"),
        "discount_value": doc.get("discount_value"),
        "expires_at": doc.get("expires_at"),
        "discount_amount": amount,
        "new_total": round(max(float(subtotal or 0) - amount, 0), 2),
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

@app.on_event("startup")
async def backfill_checkin_by():
    """Completa el asesor del check-in en órdenes antiguas usando el historial (INGRESO_APROBADO)."""
    try:
        pending = await db.orders.find(
            {"ingreso_at": {"$ne": None}, "checkin_by_name": None}, {"_id": 0, "id": 1}
        ).to_list(5000)
        for o in pending:
            h = await db.order_history.find_one(
                {"order_id": o["id"], "action": "INGRESO_APROBADO"}, {"_id": 0}, sort=[("created_at", -1)]
            )
            if h and h.get("changed_by_name"):
                await db.orders.update_one(
                    {"id": o["id"]},
                    {"$set": {"checkin_by_id": h.get("changed_by_id"), "checkin_by_name": h["changed_by_name"]}},
                )
    except Exception as e:
        logging.getLogger(__name__).warning(f"No se pudo completar checkin_by en órdenes antiguas: {e}")

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
