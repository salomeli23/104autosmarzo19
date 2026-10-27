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

export const orderTechnicians = (order) => [
    order?.assigned_technician_id && { id: order.assigned_technician_id, name: order.assigned_technician_name, role: 'Principal' },
    order?.assigned_technician_2_id && { id: order.assigned_technician_2_id, name: order.assigned_technician_2_name, role: 'Apoyo' },
].filter(Boolean);
