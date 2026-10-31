// Flujo de taller: Revisión 360° → 2 técnicos → Corte (Polarizado/PPF/Ultrasecure) → Instalación.
// Mantener igual a CUTTING_KEYWORDS en backend/server.py
const CUTTING_KEYWORDS = ['polarizado', 'ppf', 'ultrasecure', 'nanooptik', 'huperoptik', 'black_ceramic',
    'ultraoptik', 'ceramic_i3', 'mixto', 'micras', 'sunroof', 'matte', 'brillante', 'wrap'];

export const orderNeedsCutting = (order) => (order?.services || []).some(s => {
    if (!s || typeof s !== 'object') return false;
    const id = String(s.service || '').toLowerCase().replace(/ /g, '_');
    const desc = String(s.description || '').toLowerCase();
    return CUTTING_KEYWORDS.some(k => id.includes(k) || desc.includes(k));
});

// Servicios a los que se asigna cada técnico (igual que TECH_SERVICE_AREAS en el backend)
export const TECH_SERVICE_AREAS = [
    { id: 'polarizado', label: 'Polarizado' },
    { id: 'ppf', label: 'PPF' },
    { id: 'ultrasecure', label: 'Ultrasecure' },
    { id: 'accesorios', label: 'Accesorios' },
    { id: 'detailing', label: 'Detailing' },
];
export const MAX_TECHNICIANS = 6;
export const techAreaLabel = (id) => TECH_SERVICE_AREAS.find(a => a.id === id)?.label || id;

/** Áreas que compró el cliente según los servicios de la orden */
export const orderServiceAreas = (order) => {
    const areas = new Set();
    (order?.services || []).forEach(s => {
        if (!s || typeof s !== 'object') return;
        const t = `${s.service || ''} ${s.description || ''}`.toLowerCase();
        if (s.ppf_scope || t.includes('ppf')) areas.add('ppf');
        else if (t.includes('ultrasecure') || t.includes('seguridad') || t.includes('micras')) areas.add('ultrasecure');
        else if (t.includes('accesorio')) areas.add('accesorios');
        else if (t.includes('detailing') || t.includes('lavado') || t.includes('ceramico') || t.includes('cerámico')) areas.add('detailing');
        else if (CUTTING_KEYWORDS.some(k => t.includes(k)) || t.includes('ceramic') || t.includes('nano')) areas.add('polarizado');
    });
    return TECH_SERVICE_AREAS.map(a => a.id).filter(id => areas.has(id));
};

/** Técnicos de la orden (hasta 6 con su servicio, o principal y apoyo en órdenes anteriores) */
export const orderTechnicians = (order) => {
    if (order?.assigned_technicians?.length) {
        return order.assigned_technicians.map((t, i) => ({
            id: t.id, name: t.name, services: t.services || [],
            role: (t.services || []).length ? t.services.map(techAreaLabel).join(' · ') : (i === 0 ? 'Principal' : 'Apoyo'),
        }));
    }
    return [
        order?.assigned_technician_id && { id: order.assigned_technician_id, name: order.assigned_technician_name, role: 'Principal', services: [] },
        order?.assigned_technician_2_id && { id: order.assigned_technician_2_id, name: order.assigned_technician_2_name, role: 'Apoyo', services: [] },
    ].filter(Boolean);
};
