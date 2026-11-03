import { serviceArea } from './workflow';

// Retiro de película anterior: se cobra como un extra del servicio (polarizado, PPF o ultrasecure)
export const REMOVAL_EXTRA_ID = 'retiro';
export const REMOVAL_LABEL = 'Retiro de película';
const REMOVAL_AREAS = ['polarizado', 'ppf', 'ultrasecure'];

/** ¿El servicio admite costo de retiro? Acepta el formato de pantalla (serviceId/category/serviceName) o el de la orden */
export const allowsRemoval = (svc) => {
    if (!svc) return false;
    const id = svc.serviceId ?? svc.service ?? '';
    if (String(id).includes('sunroof')) return false;
    const description = [svc.category, svc.serviceName ?? svc.name, svc.description].filter(Boolean).join(' ');
    return REMOVAL_AREAS.includes(serviceArea({ service: id, description, ppf_scope: svc.ppf_scope }));
};

/** Costo de retiro guardado en los extras del servicio ('' si no tiene) */
export const removalFromExtras = (extras) => {
    const e = (extras || []).find(x => x?.id === REMOVAL_EXTRA_ID);
    return e ? String(e.price ?? '') : '';
};

export const removalAmount = (svc) => (allowsRemoval(svc) ? Math.max(parseFloat(svc.removal_cost) || 0, 0) : 0);

/** Extras del servicio con el costo de retiro actualizado (se quita si es 0) */
export const withRemovalExtra = (extras, cost) => {
    const rest = (extras || []).filter(x => x?.id !== REMOVAL_EXTRA_ID);
    const price = parseFloat(cost) || 0;
    return price > 0 ? [...rest, { id: REMOVAL_EXTRA_ID, nombre: REMOVAL_LABEL, price }] : rest;
};
