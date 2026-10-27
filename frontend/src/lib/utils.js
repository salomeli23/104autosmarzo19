import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
    return twMerge(clsx(inputs));
}

// Festivos de Colombia 2025-2027
// Los festivos se desplazan al lunes siguiente si caen en otro día (Ley Emiliani)
export const COLOMBIA_HOLIDAYS = [
    // 2025
    '2025-01-01', // Año Nuevo
    '2025-01-06', // Día de los Reyes Magos
    '2025-03-24', // Día de San José
    '2025-04-17', // Jueves Santo
    '2025-04-18', // Viernes Santo
    '2025-05-01', // Día del Trabajo
    '2025-06-02', // Día de la Ascensión
    '2025-06-23', // Corpus Christi
    '2025-06-30', // Sagrado Corazón
    '2025-07-20', // Día de la Independencia
    '2025-08-07', // Batalla de Boyacá
    '2025-08-18', // Asunción de la Virgen
    '2025-10-13', // Día de la Raza
    '2025-11-03', // Todos los Santos
    '2025-11-17', // Independencia de Cartagena
    '2025-12-08', // Día de la Inmaculada Concepción
    '2025-12-25', // Navidad
    // 2026
    '2026-01-01', // Año Nuevo
    '2026-01-12', // Día de los Reyes Magos
    '2026-03-23', // Día de San José
    '2026-04-02', // Jueves Santo
    '2026-04-03', // Viernes Santo
    '2026-05-01', // Día del Trabajo
    '2026-05-18', // Día de la Ascensión
    '2026-06-08', // Corpus Christi
    '2026-06-15', // Sagrado Corazón
    '2026-06-29', // San Pedro y San Pablo
    '2026-07-20', // Día de la Independencia
    '2026-08-07', // Batalla de Boyacá
    '2026-08-17', // Asunción de la Virgen
    '2026-10-12', // Día de la Raza
    '2026-11-02', // Todos los Santos
    '2026-11-16', // Independencia de Cartagena
    '2026-12-08', // Día de la Inmaculada Concepción
    '2026-12-25', // Navidad
    // 2027
    '2027-01-01', // Año Nuevo
    '2027-01-11', // Día de los Reyes Magos
    '2027-03-22', // Día de San José
    '2027-03-25', // Jueves Santo
    '2027-03-26', // Viernes Santo
    '2027-05-01', // Día del Trabajo
    '2027-05-10', // Día de la Ascensión
    '2027-05-31', // Corpus Christi
    '2027-06-07', // Sagrado Corazón
    '2027-07-05', // San Pedro y San Pablo
    '2027-07-20', // Día de la Independencia
    '2027-08-07', // Batalla de Boyacá
    '2027-08-16', // Asunción de la Virgen
    '2027-10-18', // Día de la Raza
    '2027-11-01', // Todos los Santos
    '2027-11-15', // Independencia de Cartagena
    '2027-12-08', // Día de la Inmaculada Concepción
    '2027-12-25', // Navidad
];

// Helper para verificar si una fecha es festivo
export const isHoliday = (date) => {
    const dateStr = date.toISOString().split('T')[0];
    return COLOMBIA_HOLIDAYS.includes(dateStr);
};

// Helper para verificar si un día está disponible (no domingo, no festivo)
export const isDayAvailable = (date) => {
    const dayOfWeek = date.getDay();
    return dayOfWeek !== 0 && !isHoliday(date); // No domingo y no festivo
};

export const SERVICE_LABELS = {
    polarizado: 'Polarizado',
    nanoceramica: 'Nanocerámica',
    autobahn_black: 'Autobahn Black CE',
    ultrasecure: 'Ultrasecure',
};

export const ORDER_STATUS_LABELS = {
    agendado: 'Agendado',
    ingresado: 'Ingresado',
    en_revision: 'Técnico por Asignar',
    en_corte: 'En Corte',
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
    en_corte: 'bg-pink-500/10 text-pink-500 border-pink-500/20',
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

// Sistema de franjas horarias con cupos
// Lunes-Viernes: 8:30 AM - 6:00 PM (registro hasta 4:00 PM)
// Sábados: 7:30 AM - 6:00 PM (registro hasta 3:30 PM)
// Domingos: Cerrado

export const TIME_SLOTS_CONFIG = {
    weekday: { // Lunes a Viernes
        operatingHours: { start: '08:30', end: '18:00' },
        lastRegistration: '16:00',
        slots: [
            { id: 'franja_1', name: 'Franja 1', start: '08:30', end: '11:30', capacity: 20 },
            { id: 'franja_2', name: 'Franja 2', start: '11:30', end: '14:30', capacity: 10 },
            { id: 'franja_3', name: 'Franja 3', start: '14:30', end: '16:00', capacity: 10 },
        ]
    },
    saturday: { // Sábados
        operatingHours: { start: '07:30', end: '18:00' },
        lastRegistration: '15:30',
        slots: [
            { id: 'franja_1', name: 'Franja 1', start: '07:30', end: '11:00', capacity: 20 },
            { id: 'franja_2', name: 'Franja 2', start: '11:00', end: '14:00', capacity: 12 },
            { id: 'franja_3', name: 'Franja 3', start: '14:00', end: '15:30', capacity: 8 },
        ]
    },
    sunday: null // Cerrado
};

// Helper para obtener las franjas según el día
export const getTimeSlotsForDate = (date) => {
    const dayOfWeek = date.getDay(); // 0 = Domingo, 6 = Sábado
    if (dayOfWeek === 0) return null; // Domingo cerrado
    if (dayOfWeek === 6) return TIME_SLOTS_CONFIG.saturday;
    return TIME_SLOTS_CONFIG.weekday;
};

// Helper para formatear el rango de horas
export const formatTimeSlot = (slot) => {
    return `${slot.start} - ${slot.end}`;
};

// Legacy TIME_SLOTS para compatibilidad (se usará el nuevo sistema)
export const TIME_SLOTS = [
    'Franja 1 (08:30 - 11:30)',
    'Franja 2 (11:30 - 14:30)',
    'Franja 3 (14:30 - 16:00)',
];

export const CAR_BRANDS = [
    'Chevrolet', 'Renault', 'Mazda', 'Kia', 'Nissan', 'Toyota', 'Hyundai', 'Ford',
    'Volkswagen', 'Suzuki', 'Honda', 'BMW', 'Mercedes-Benz', 'Audi', 'Jeep',
    'Mitsubishi', 'Peugeot', 'Citroën', 'Fiat',
    // Marcas eléctricas / híbridas populares en Colombia
    'Tesla', 'Deepal', 'BYD', 'MG', 'Zeekr', 'NIO', 'XPeng', 'Volvo', 'Polestar',
    'Porsche', 'Dongfeng', 'Changan', 'JAC', 'GWM', 'Jetour', 'Chery', 'JMC', 'Maxus',
    'Otro'
];

export const CAR_MODELS = {
    'Chevrolet': ['Spark', 'Sail', 'Onix', 'Tracker', 'Captiva', 'Equinox', 'Blazer', 'Tahoe', 'Trailblazer', 'N300', 'N400', 'Bolt EV', 'Bolt EUV', 'Otro'],
    'Renault': ['Kwid', 'Kwid E-Tech', 'Sandero', 'Stepway', 'Logan', 'Duster', 'Koleos', 'Captur', 'Oroch', 'Kangoo', 'Kangoo E-Tech', 'Megane E-Tech', 'Master', 'Zoe', 'Otro'],
    'Mazda': ['Mazda 2', 'Mazda 3', 'Mazda 6', 'CX-3', 'CX-30', 'CX-5', 'CX-9', 'CX-60', 'CX-90', 'MX-5', 'MX-30', 'BT-50', 'Otro'],
    'Kia': ['Picanto', 'Rio', 'Cerato', 'K5', 'Soul', 'Soul EV', 'Seltos', 'Sportage', 'Sorento', 'Carnival', 'Stinger', 'EV6', 'EV9', 'Niro EV', 'Otro'],
    'Nissan': ['March', 'Versa', 'Sentra', 'Kicks', 'Qashqai', 'X-Trail', 'Pathfinder', 'Frontier', 'NP300', 'Leaf', 'Ariya', 'Otro'],
    'Toyota': ['Yaris', 'Corolla', 'Corolla Cross', 'Camry', 'Prius', 'C-HR', 'RAV4', 'bZ4X', 'Fortuner', 'Land Cruiser', 'Hilux', '4Runner', 'Otro'],
    'Hyundai': ['Grand i10', 'Accent', 'Elantra', 'Sonata', 'Venue', 'Kona', 'Kona Electric', 'Tucson', 'Santa Fe', 'Palisade', 'Creta', 'Ioniq 5', 'Ioniq 6', 'Otro'],
    'Ford': ['Fiesta', 'Focus', 'Fusion', 'Mustang', 'Mustang Mach-E', 'EcoSport', 'Escape', 'Explorer', 'Expedition', 'Ranger', 'F-150', 'F-150 Lightning', 'Otro'],
    'Volkswagen': ['Gol', 'Polo', 'Virtus', 'Jetta', 'Passat', 'T-Cross', 'Taos', 'Tiguan', 'Touareg', 'Amarok', 'ID.3', 'ID.4', 'ID.5', 'ID.Buzz', 'Otro'],
    'Suzuki': ['Alto', 'Swift', 'Baleno', 'Ciaz', 'S-Presso', 'Vitara', 'Grand Vitara', 'Jimny', 'XL7', 'Otro'],
    'Honda': ['Brio', 'City', 'Civic', 'Accord', 'HR-V', 'CR-V', 'Pilot', 'Passport', 'Odyssey', 'e:Ny1', 'Otro'],
    'BMW': ['Serie 1', 'Serie 2', 'Serie 3', 'Serie 4', 'Serie 5', 'Serie 7', 'X1', 'X3', 'X5', 'X7', 'iX', 'iX3', 'i4', 'i5', 'i7', 'Otro'],
    'Mercedes-Benz': ['Clase A', 'Clase C', 'Clase E', 'Clase S', 'GLA', 'GLC', 'GLE', 'GLS', 'EQA', 'EQB', 'EQC', 'EQE', 'EQS', 'Sprinter', 'Otro'],
    'Audi': ['A1', 'A3', 'A4', 'A6', 'A8', 'Q2', 'Q3', 'Q5', 'Q7', 'Q8', 'Q4 e-tron', 'Q6 e-tron', 'Q8 e-tron', 'e-tron GT', 'Otro'],
    'Jeep': ['Renegade', 'Compass', 'Cherokee', 'Grand Cherokee', 'Wrangler', 'Wrangler 4xe', 'Gladiator', 'Avenger', 'Otro'],
    'Mitsubishi': ['Mirage', 'Lancer', 'ASX', 'Outlander', 'Outlander PHEV', 'Eclipse Cross', 'Montero', 'L200', 'Otro'],
    'Peugeot': ['208', 'e-208', '301', '308', '408', '508', '2008', 'e-2008', '3008', '5008', 'Partner', 'Otro'],
    'Citroën': ['C3', 'C4', 'ë-C4', 'C5 Aircross', 'Berlingo', 'ë-Berlingo', 'Jumpy', 'Otro'],
    'Fiat': ['Mobi', 'Argo', 'Cronos', 'Tipo', '500', '500e', 'Toro', 'Ducato', 'Otro'],
    // ===== Marcas eléctricas / híbridas =====
    'Tesla': ['Model 3', 'Model Y', 'Model S', 'Model X', 'Cybertruck', 'Roadster', 'Otro'],
    'Deepal': ['S07', 'S05', 'L07', 'E07', 'Otro'],
    'BYD': ['Yuan Plus (Atto 3)', 'Dolphin', 'Dolphin Mini', 'Seal', 'Seal U', 'Han', 'Tang', 'Song Plus', 'Song Pro', 'Shark', 'Otro'],
    'MG': ['MG3', 'MG4', 'MG5', 'MG ZS', 'MG ZS EV', 'MG HS', 'MG RX5', 'Marvel R', 'Cyberster', 'Otro'],
    'Zeekr': ['001', '007', '009', 'X', 'Otro'],
    'NIO': ['ET5', 'ET7', 'ES6', 'ES7', 'ES8', 'EC6', 'EC7', 'Otro'],
    'XPeng': ['G6', 'G9', 'P5', 'P7', 'X9', 'Otro'],
    'Volvo': ['XC40', 'XC40 Recharge', 'XC60', 'XC90', 'C40 Recharge', 'EX30', 'EX90', 'S60', 'S90', 'Otro'],
    'Polestar': ['Polestar 2', 'Polestar 3', 'Polestar 4', 'Otro'],
    'Porsche': ['911', 'Panamera', 'Macan', 'Macan Electric', 'Cayenne', 'Taycan', 'Otro'],
    'Dongfeng': ['Rich 6', 'AX7', 'E70', 'Nano Box', 'Box', 'Otro'],
    'Changan': ['CS35 Plus', 'CS55 Plus', 'CS75 Plus', 'Eado', 'Hunter', 'Lumin', 'Otro'],
    'JAC': ['S3', 'S4', 'S7', 'JS4', 'E10X', 'E40X', 'E-JS4', 'T6', 'T8', 'Otro'],
    'GWM': ['Haval H6', 'Haval Jolion', 'Haval H6 HEV', 'Ora Good Cat', 'Ora 03', 'Poer', 'Tank 300', 'Tank 500', 'Otro'],
    'Jetour': ['X70', 'X70 Plus', 'X90', 'Dashing', 'T2', 'Otro'],
    'Chery': ['Tiggo 2', 'Tiggo 4', 'Tiggo 7', 'Tiggo 8', 'Arrizo 5', 'Omoda 5', 'Otro'],
    'JMC': ['Vigus', 'Grand Avenue', 'E-Vigus', 'Otro'],
    'Maxus': ['T60', 'T90', 'D60', 'D90', 'G10', 'eDeliver 3', 'eDeliver 9', 'Mifa 9', 'Otro'],
    'Otro': ['Otro']
};

export const COLORS = ['Blanco', 'Negro', 'Gris', 'Plata', 'Rojo', 'Azul', 'Verde', 'Amarillo', 'Naranja', 'Café', 'Beige', 'Otro'];

// Legacy status labels for backwards compatibility
export const STATUS_LABELS = {
    agendado: 'Agendado',
    en_proceso: 'En Proceso',
    en_revision: 'Técnico por Asignar',
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


// VEHICLE_PARTS: piezas estándar usadas en Check-in, Corte y Consejo de Corte (Series).
// Single source of truth para garantizar que las series creadas en /settings
// se vinculen correctamente con los inputs del cortador.
export const VEHICLE_PARTS = [
    { id: 'panoramico', label: 'Panorámico', name: 'Panorámico' },
    { id: 'vidrio_copiloto', label: 'Vidrio Copiloto', name: 'Vidrio Copiloto' },
    { id: 'vidrio_piloto', label: 'Vidrio Piloto', name: 'Vidrio Piloto' },
    { id: 'vidrio_trasero_piloto', label: 'Vidrio Trasero Piloto', name: 'Vidrio Trasero Piloto' },
    { id: 'vidrio_trasero_copiloto', label: 'Vidrio Trasero Copiloto', name: 'Vidrio Trasero Copiloto' },
    { id: 'vidrio_trasero', label: 'Vidrio Trasero (Panorámico Trasero)', name: 'Vidrio Trasero (Panorámico Trasero)' },
    { id: 'luneta', label: 'Luneta / Trasero', name: 'Luneta / Trasero' },
    { id: 'sunroof', label: 'Sunroof', name: 'Sunroof' },
    { id: 'custodias', label: 'Custodias', name: 'Custodias' },
];

// PPF: partes disponibles para el plan por piezas (selector predictivo en Check-in)
export const PPF_PARTS = [
    'Bomper', 'Capot', 'Guardafangos', 'Espejos', 'Farolas', 'Boceles',
    'Parales', 'Triángulos', 'Spoiler', 'Techo', 'Difusores', 'Tacómetro',
];

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

// Avisos que se confirman con el cliente en el check-in (modal, correo y PDF de la orden).
// Mantener igual a CHECKIN_NOTICES en backend/email_templates.py
export const CHECKIN_NOTICES = [
    'Dentro de la Garantía no aplica cambio de porcentaje.',
    'El cliente acepta el porcentaje de opacidad, bajo su responsabilidad y la garantía no cubre cambio de opacidad.',
    'El cliente autoriza la movilidad del auto y dejar su llave para el proceso de instalación y servicios.',
    'No se entrega su auto si el cliente no ha realizado el pago del servicio.',
];
