import axios from 'axios';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API_BASE = `${BACKEND_URL}/api`;

const api = axios.create({
    baseURL: API_BASE,
    headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);

// Auth
export const authAPI = {
    login: (data) => api.post('/auth/login', data),
    register: (data) => api.post('/auth/register', data),
    me: () => api.get('/auth/me'),
};

// Users
export const usersAPI = {
    getAll: (role) => api.get('/users', { params: role ? { role } : {} }),
    getTechnicians: () => api.get('/users/technicians'),
    updateRole: (userId, role) => api.put(`/users/${userId}/role`, { role }),
    resetPassword: (userId, newPassword) => api.put(`/users/${userId}/password`, { new_password: newPassword }),
};

// Orders (nuevo flujo completo)
export const ordersAPI = {
    // Step 1: Create appointment
    create: (data) => api.post('/orders', data),
    getAll: (params) => api.get('/orders', { params }),
    // Actualizar orden (agregar/quitar servicios o cambiar valores) con contraseña
    updateServices: (orderId, data) => api.post(`/orders/${orderId}/update-services`, data),
    // Orden firmada por el cliente en el check-in (PDF)
    getSignedOrderPdf: (orderId) => api.get(`/orders/${orderId}/signed-order-pdf`, { responseType: 'blob' }),
    getById: (id) => api.get(`/orders/${id}`),
    getByCode: (code) => api.get(`/orders/code/${code}`),
    
    // Step 2: Ingreso
    checkin: (orderCode) => api.post('/orders/checkin', { order_code: orderCode }),
    approveIngreso: (data) => api.post('/orders/ingreso-approval', data),
    
    // Step 3: Inspection
    saveInspection: (data) => api.post('/orders/inspection', data),
    sendInspectionPhotos: (orderId, additionalRecipients = []) =>
        api.post(`/orders/${orderId}/send-inspection-photos`, { order_id: orderId, additional_recipients: additionalRecipients }),
    
    // Step 4: Assignment (Coordinator)
    assignTechnician: (data) => api.post('/orders/assign', data),
    // Técnico principal + técnico de apoyo → Corte (Polarizado/PPF/Ultrasecure) o Instalación
    assignTechnicians: (orderId, data) => api.post(`/orders/${orderId}/assign-technicians`, data),
    // Medidas sugeridas por el técnico antes de completar el corte
    saveTechMeasurements: (orderId, data) => api.put(`/orders/${orderId}/tech-measurements`, data),
    
    // Pre-asignación de técnico (Autos por Asignar - antes de Corte)
    getPendingTechAssignment: () => api.get('/tech-queue/pending'),
    getOrdersByTechnician: () => api.get('/tech-queue/by-technician'),
    preAssignTechnician: (data) => api.post('/tech-queue/pre-assign', data),
    clearPreAssignment: (orderId) => api.post(`/orders/${orderId}/clear-pre-assignment`),
    
    // Step 5: Service (Technician)
    startService: (orderId) => api.post(`/orders/${orderId}/start-service`),
    completeService: (data) => api.post('/orders/complete-service', data),
    
    // Step 6: Payment (Facturacion)
    processPayment: (data) => api.post('/orders/payment', data),
    
    // Step 7: Delivery
    confirmDelivery: (data) => api.post('/orders/delivery', data),
    
    // Desistimiento
    desistimiento: (orderId) => api.post(`/orders/${orderId}/desistimiento`),
    
    // Postventa / Garantía
    historyByPlate: (plate) => api.get(`/orders/history-by-plate/${encodeURIComponent(plate)}`),
    lookupExisting: ({ plate, document }) => api.get('/clients/lookup', { params: { plate: plate || undefined, document: document || undefined } }),
};

// Alerts
export const alertsAPI = {
    getAll: () => api.get('/alerts'),
    markRead: (id) => api.put(`/alerts/${id}/read`),
    getUnreadCount: () => api.get('/alerts/unread-count'),
};

// Notifications
export const notificationsAPI = {
    send: (data) => api.post('/notifications/send', data),
    getWhatsAppUrl: (orderId) => api.get(`/notifications/whatsapp-url/${orderId}`),
    // Sección Notificaciones de la Agenda
    appointments: (q) => api.get('/notifications/appointments', { params: q ? { q } : {} }),
    updateContact: (orderId, data) => api.patch(`/orders/${orderId}/client-contact`, data),
};

// Dashboard
export const dashboardAPI = {
    getStats: () => api.get('/dashboard/stats'),
};

// Services catalog
export const servicesAPI = {
    getCatalog: () => api.get('/services/catalog'),
    getCatalogFlat: () => api.get('/services/catalog/flat'),
};

// Time slots availability
export const slotsAPI = {
    getAvailability: (date) => api.get('/slots/availability', { params: { date } }),
};

// Bahias (Garage bays)
export const bahiasAPI = {
    getAll: () => api.get('/bahias'),
    assign: (bahiaId, orderId) => api.put(`/bahias/${bahiaId}/assign`, null, { params: { order_id: orderId } }),
    release: (bahiaId, body) => api.put(`/bahias/${bahiaId}/release`, body || { completed: false }),
};

// Billing (Facturación)
export const billingAPI = {
    listPending: () => api.get('/billing/pending'),
    processPayment: (data) => api.post('/orders/payment', data),
    confirmDelivery: (data) => api.post('/orders/delivery', data),
};

// Cutting module
export const cuttingAPI = {
    getPending: () => api.get('/cutting/pending'),
    start: (orderId) => api.put(`/cutting/${orderId}/start`),
    complete: (orderId, body) => api.put(`/cutting/${orderId}/complete`, body || {}),
    // Corte confirma que entregó el material al técnico → Por Instalar
    deliver: (orderId) => api.put(`/cutting/${orderId}/deliver`),
};

// Seed data
export const seedAPI = {
    users: () => api.post('/seed/users'),
    bahias: () => api.post('/seed/bahias'),
};

// Inventory
export const inventoryAPI = {
    list: (params) => api.get('/inventory', { params }),
    create: (data) => api.post('/inventory', data),
    update: (id, data) => api.put(`/inventory/${id}`, data),
    delete: (id) => api.delete(`/inventory/${id}`),
    alerts: () => api.get('/inventory/alerts'),
    deduct: (id, params) => api.post(`/inventory/${id}/deduct`, null, { params }),
    movements: (params) => api.get('/inventory/movements', { params }),
    restock: (id, data) => api.post(`/inventory/${id}/restock`, data),
    seedTestAccessories: () => api.post('/inventory/test-accessories'),
    removeTestAccessories: () => api.post('/inventory/test-accessories/remove'),
    resetCuttingRolls: () => api.post('/inventory/cutting-rolls/reset'),
};

// Solicitudes de accesorios: despacho desde inventario y entrega al técnico
export const accessoryRequestsAPI = {
    list: (params) => api.get('/accessory-requests', { params }),
    dispatch: (id, data) => api.post(`/accessory-requests/${id}/dispatch`, data),
    deliver: (id, data) => api.post(`/accessory-requests/${id}/deliver`, data),
};

// Settings (admin)
export const settingsAPI = {
    getBookingPin: () => api.get('/settings/booking-pin'),
    updateBookingPin: (pin) => api.put('/settings/booking-pin', { pin }),
    getCompletionPin: () => api.get('/settings/completion-pin'),
    updateCompletionPin: (pin) => api.put('/settings/completion-pin', { pin }),
};

// Legacy API aliases for backwards compatibility
export const appointmentsAPI = {
    getAll: (date) => api.get('/orders', { params: { date } }),
    create: (data) => api.post('/orders', data),
};

export const vehiclesAPI = {
    getAll: () => api.get('/orders'),
    assignTechnician: (orderId, technicianId, serviceTime = 60) => 
        api.post('/orders/assign', { order_id: orderId, technician_id: technicianId, service_time_minutes: serviceTime }),
    updateStatus: (orderId, status) => api.post(`/orders/${orderId}/start-service`),
};

export const serviceOrdersAPI = {
    getAll: () => api.get('/orders'),
};

// Legacy notifications alias - uses alertsAPI
export const legacyNotificationsAPI = {
    getUnreadCount: () => api.get('/alerts/unread-count'),
    getAll: () => api.get('/alerts'),
    markRead: (id) => api.put(`/alerts/${id}/read`),
};

export const inspectionsAPI = {
    create: (data) => api.post('/orders/inspection', {
        order_id: data.vehicle_id,
        photos: data.photos || [],
        video_url: data.video_url || null,
        notes: data.general_notes || ''
    }),
    uploadVideo: (orderId, blob) => {
        const form = new FormData();
        const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
        form.append('file', blob, `revision360.${ext}`);
        return api.post(`/orders/${orderId}/inspection-video`, form, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 120000,
        });
    },
    getVideo: (orderId) => api.get(`/orders/${orderId}/inspection-video`, { responseType: 'blob', timeout: 120000 }),
    getInspectedVehicles: () => api.get('/inspected-vehicles'),
};

export const technicianChargesAPI = {
    history: () => api.get('/technician/history'),
    create: (data) => api.post('/technician-charges', data),
    list: (status) => api.get('/technician-charges', { params: status ? { status } : {} }),
    review: (id, data) => api.put(`/technician-charges/${id}/review`, data),
    pay: (id, data) => api.put(`/technician-charges/${id}/pay`, data),
};

export const qualityAPI = {
    pending: () => api.get('/quality/pending'),
    submit: (orderId, data) => api.post(`/orders/${orderId}/quality`, data),
    uploadVideo: (orderId, blob) => {
        const form = new FormData();
        const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
        form.append('file', blob, `calidad.${ext}`);
        return api.post(`/orders/${orderId}/quality-video`, form, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 120000,
        });
    },
    getVideo: (orderId) => api.get(`/orders/${orderId}/quality-video`, { responseType: 'blob', timeout: 120000 }),
};

export const quotesAPI = {
    getAll: () => api.get('/orders'),
    create: (data) => api.post('/orders', data),
    approve: (id) => api.post(`/orders/${id}/start-service`),
};

// Sedes / Sucursales
export const sedesAPI = {
    list: () => api.get('/sedes'),
    create: (data) => api.post('/sedes', data),
    update: (id, data) => api.put(`/sedes/${id}`, data),
    delete: (id) => api.delete(`/sedes/${id}`),
};

// Car Series (Consejo de Corte)
export const carSeriesAPI = {
    list: () => api.get('/car-series'),
    create: (data) => api.post('/car-series', data),
    update: (id, data) => api.put(`/car-series/${id}`, data),
    delete: (id) => api.delete(`/car-series/${id}`),
    suggest: (brand, model) => api.get('/car-series/suggest', { params: { brand, model } }),
};

// Service Extras (Sunroof y otros costos adicionales)
export const serviceExtrasAPI = {
    list: () => api.get('/service-extras'),
    create: (data) => api.post('/service-extras', data),
    update: (id, data) => api.put(`/service-extras/${id}`, data),
    delete: (id) => api.delete(`/service-extras/${id}`),
};

// Service Routes (Hoja de Ruta - reglas)
export const serviceRoutesAPI = {
    list: () => api.get('/service-routes'),
    create: (data) => api.post('/service-routes', data),
    update: (id, data) => api.put(`/service-routes/${id}`, data),
    delete: (id) => api.delete(`/service-routes/${id}`),
};

// Hoja de Ruta por orden
export const orderRouteAPI = {
    init: (orderId) => api.post(`/orders/${orderId}/route/init`),
    assignSlot: (orderId, slotId, data) => api.post(`/orders/${orderId}/route/slots/${slotId}/assign`, data),
    startSlot: (orderId, slotId, body) => api.post(`/orders/${orderId}/route/slots/${slotId}/start`, body || {}),
    completeSlot: (orderId, slotId, body) => api.post(`/orders/${orderId}/route/slots/${slotId}/complete`, body || {}),
};

// Actualizar roles funcionales del técnico
export const userRolesAPI = {
    setTecnicoRoles: (userId, roles) => api.put(`/users/${userId}/tecnico-roles`, { tecnico_roles: roles }),
};

// Inventario: transferir entre sedes / asignar sede a usuario
export const sedeAssignmentAPI = {
    transferInventory: (itemId, data) => api.post(`/inventory/${itemId}/transfer-sede`, data),
    setUserSede: (userId, sedeId) => api.put(`/users/${userId}/sede`, { sede_id: sedeId }),
};

// Catálogo de corte
export const cuttingCatalogAPI = {
    getMaterials: () => api.get('/cutting/materials-catalog'),
    getCarAverage: (brand, model) => api.get('/cutting/car-average', { params: { brand, model } }),
    seedRolls: () => api.post('/seed/cutting-catalog'),
};

// Pagos
export const paymentsAPI = {
    register: (data) => api.post('/payments', data),
    list: (q) => api.get('/payments', { params: q ? { q } : {} }),
    forOrder: (orderId) => api.get(`/payments/order/${orderId}`),
    ordersWithBalance: (params) => api.get('/orders-with-balance', { params }),
    pendingRelease: () => api.get('/orders-pending-release'),
    authorizeRelease: (orderId) => api.post(`/orders/${orderId}/authorize-release`),
    issueExitCertificate: (orderId) => api.post(`/orders/${orderId}/exit-certificate`),
    downloadExitCertificate: (orderId) => api.get(`/orders/${orderId}/exit-certificate.pdf`, { responseType: 'blob' }),
    registerSecurityExit: (orderId) => api.post(`/orders/${orderId}/security-exit`),
    pendingInvoice: (includeSent = false) => api.get('/orders-pending-invoice', { params: { include_sent: includeSent } }),
    sendInvoiceEmail: (orderId) => api.post(`/orders/${orderId}/send-invoice-email`),
    downloadInvoicePdf: (orderId) => api.get(`/orders/${orderId}/invoice-pdf`, { responseType: 'blob' }),
    updateClientEmail: (orderId, email) => api.patch(`/orders/${orderId}/client-email`, { client_email: email }),
    reschedule: (orderId, data) => api.post(`/orders/${orderId}/reschedule`, data),
    applyRetention: (orderId, data) => api.post(`/orders/${orderId}/apply-retention`, data),
    listRetentions: (q) => api.get('/retentions', { params: q ? { q } : {} }),
    sendIngresoReceipt: (orderId) => api.post(`/orders/${orderId}/send-ingreso-receipt`),
    seedTestOrders: () => api.post('/seed/test-orders'),
};

// Códigos de descuento
export const discountCodesAPI = {
    verifyAdmin: (admin_password) => api.post('/discount-codes/admin/verify', { admin_password }),
    list: (include_inactive = true) => api.get('/discount-codes', { params: { include_inactive } }),
    create: (data) => api.post('/discount-codes', data),
    update: (id, data) => api.patch(`/discount-codes/${id}`, data),
    delete: (id, admin_password) => api.delete(`/discount-codes/${id}`, { params: { admin_password } }),
    validate: (code, subtotal) => api.get('/discount-codes/validate', { params: { code, subtotal } }),
};

export default api;
