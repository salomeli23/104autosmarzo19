import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
    return twMerge(clsx(inputs));
}

export const SERVICE_LABELS = {
    polarizado: 'Polarizado',
    nanoceramica: 'Nanocerámica',
    autobahn_black: 'Autobahn Black CE',
    ultrasecure: 'Ultrasecure',
};

export const ORDER_STATUS_LABELS = {
    agendado: 'Agendado',
    ingresado: 'Ingresado',
    en_revision: 'En Revisión',
    asignado: 'Asignado',
    en_proceso: 'En Proceso',
    servicio_completado: 'Servicio Completado',
    terminado_falta_pago: 'Falta Pago',
    terminado_pagado: 'Pagado',
    entregado: 'Facturado y Entregado',
    desistimiento: 'Desistido',
};

export const ORDER_STATUS_COLORS = {
    agendado: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    ingresado: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
    en_revision: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
    asignado: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
    en_proceso: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    servicio_completado: 'bg-teal-500/10 text-teal-500 border-teal-500/20',
    terminado_falta_pago: 'bg-red-500/10 text-red-500 border-red-500/20',
    terminado_pagado: 'bg-green-500/10 text-green-500 border-green-500/20',
    entregado: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    desistimiento: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
};

export const ROLE_LABELS = {
    admin: 'Administrador',
    asesor: 'Asesor',
    coordinador: 'Coordinador',
    tecnico: 'Técnico',
    facturacion: 'Facturación',
};

export const TIME_SLOTS = [
    '08:00 - 09:00', '09:00 - 10:00', '10:00 - 11:00', '11:00 - 12:00',
    '12:00 - 13:00', '14:00 - 15:00', '15:00 - 16:00', '16:00 - 17:00', '17:00 - 18:00',
];

export const CAR_BRANDS = [
    'Chevrolet', 'Renault', 'Mazda', 'Kia', 'Nissan', 'Toyota', 'Hyundai', 'Ford',
    'Volkswagen', 'Suzuki', 'Honda', 'BMW', 'Mercedes-Benz', 'Audi', 'Jeep',
    'Mitsubishi', 'Peugeot', 'Citroën', 'Fiat', 'Otro'
];

export const CAR_MODELS = {
    'Chevrolet': ['Spark', 'Sail', 'Onix', 'Tracker', 'Captiva', 'Equinox', 'Blazer', 'Tahoe', 'Trailblazer', 'N300', 'N400', 'Otro'],
    'Renault': ['Kwid', 'Sandero', 'Stepway', 'Logan', 'Duster', 'Koleos', 'Captur', 'Oroch', 'Kangoo', 'Master', 'Otro'],
    'Mazda': ['Mazda 2', 'Mazda 3', 'Mazda 6', 'CX-3', 'CX-30', 'CX-5', 'CX-9', 'MX-5', 'BT-50', 'Otro'],
    'Kia': ['Picanto', 'Rio', 'Cerato', 'K5', 'Soul', 'Seltos', 'Sportage', 'Sorento', 'Carnival', 'Stinger', 'Otro'],
    'Nissan': ['March', 'Versa', 'Sentra', 'Kicks', 'Qashqai', 'X-Trail', 'Pathfinder', 'Frontier', 'NP300', 'Otro'],
    'Toyota': ['Yaris', 'Corolla', 'Camry', 'Prius', 'C-HR', 'RAV4', 'Fortuner', 'Land Cruiser', 'Hilux', '4Runner', 'Otro'],
    'Hyundai': ['Grand i10', 'Accent', 'Elantra', 'Sonata', 'Venue', 'Kona', 'Tucson', 'Santa Fe', 'Palisade', 'Creta', 'Otro'],
    'Ford': ['Fiesta', 'Focus', 'Fusion', 'Mustang', 'EcoSport', 'Escape', 'Explorer', 'Expedition', 'Ranger', 'F-150', 'Otro'],
    'Volkswagen': ['Gol', 'Polo', 'Virtus', 'Jetta', 'Passat', 'T-Cross', 'Taos', 'Tiguan', 'Touareg', 'Amarok', 'Otro'],
    'Suzuki': ['Alto', 'Swift', 'Baleno', 'Ciaz', 'S-Presso', 'Vitara', 'Grand Vitara', 'Jimny', 'XL7', 'Otro'],
    'Honda': ['Brio', 'City', 'Civic', 'Accord', 'HR-V', 'CR-V', 'Pilot', 'Passport', 'Odyssey', 'Otro'],
    'BMW': ['Serie 1', 'Serie 2', 'Serie 3', 'Serie 4', 'Serie 5', 'Serie 7', 'X1', 'X3', 'X5', 'X7', 'Otro'],
    'Mercedes-Benz': ['Clase A', 'Clase C', 'Clase E', 'Clase S', 'GLA', 'GLC', 'GLE', 'GLS', 'Sprinter', 'Otro'],
    'Audi': ['A1', 'A3', 'A4', 'A6', 'A8', 'Q2', 'Q3', 'Q5', 'Q7', 'Q8', 'Otro'],
    'Jeep': ['Renegade', 'Compass', 'Cherokee', 'Grand Cherokee', 'Wrangler', 'Gladiator', 'Otro'],
    'Mitsubishi': ['Mirage', 'Lancer', 'ASX', 'Outlander', 'Eclipse Cross', 'Montero', 'L200', 'Otro'],
    'Peugeot': ['208', '301', '308', '408', '508', '2008', '3008', '5008', 'Partner', 'Otro'],
    'Citroën': ['C3', 'C4', 'C5 Aircross', 'Berlingo', 'Jumpy', 'Otro'],
    'Fiat': ['Mobi', 'Argo', 'Cronos', 'Tipo', '500', 'Toro', 'Ducato', 'Otro'],
    'Otro': ['Otro']
};

export const COLORS = ['Blanco', 'Negro', 'Gris', 'Plata', 'Rojo', 'Azul', 'Verde', 'Amarillo', 'Naranja', 'Café', 'Beige', 'Otro'];

// Legacy status labels for backwards compatibility
export const STATUS_LABELS = {
    agendado: 'Agendado',
    en_proceso: 'En Proceso',
    en_revision: 'En Revisión',
    terminado: 'Terminado',
    pending: 'Pendiente',
    approved: 'Aprobado',
};

export const VEHICLE_STATUS_LABELS = {
    agendado: 'Agendado',
    ingresado: 'Ingresado',
    con_tecnico: 'Con Técnico',
    en_proceso: 'En Proceso',
    finalizado: 'Finalizado',
};

export const INSPECTION_AREAS = [
    { id: 'capot', name: 'Capot' },
    { id: 'parabrisas', name: 'Parabrisas' },
    { id: 'techo', name: 'Techo' },
    { id: 'baul', name: 'Baúl/Maletero' },
    { id: 'puerta_frontal_izq', name: 'Puerta Frontal Izquierda' },
    { id: 'puerta_frontal_der', name: 'Puerta Frontal Derecha' },
    { id: 'puerta_trasera_izq', name: 'Puerta Trasera Izquierda' },
    { id: 'puerta_trasera_der', name: 'Puerta Trasera Derecha' },
    { id: 'espejo_izq', name: 'Espejo Izquierdo' },
    { id: 'espejo_der', name: 'Espejo Derecho' },
    { id: 'llanta_frontal_izq', name: 'Llanta Frontal Izquierda' },
    { id: 'llanta_frontal_der', name: 'Llanta Frontal Derecha' },
    { id: 'llanta_trasera_izq', name: 'Llanta Trasera Izquierda' },
    { id: 'llanta_trasera_der', name: 'Llanta Trasera Derecha' },
    { id: 'paragolpes_frontal', name: 'Paragolpes Frontal' },
    { id: 'paragolpes_trasero', name: 'Paragolpes Trasero' },
    { id: 'guardafango_izq', name: 'Guardafango Izquierdo' },
    { id: 'guardafango_der', name: 'Guardafango Derecho' },
    { id: 'interior_general', name: 'Interior General' },
    { id: 'tablero', name: 'Tablero' },
];

export const formatCurrency = (amount) => {
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        minimumFractionDigits: 0,
    }).format(amount || 0);
};

export const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
};

export const formatDateTime = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-CO', {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
};

export const formatTime = (minutes) => {
    if (!minutes) return '';
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
};
