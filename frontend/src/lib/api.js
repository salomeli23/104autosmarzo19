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
};

// Orders (nuevo flujo completo)
export const ordersAPI = {
    // Step 1: Create appointment
    create: (data) => api.post('/orders', data),
    getAll: (params) => api.get('/orders', { params }),
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
};

export const quotesAPI = {
    getAll: () => api.get('/orders'),
    create: (data) => api.post('/orders', data),
    approve: (id) => api.post(`/orders/${id}/start-service`),
};

export default api;
