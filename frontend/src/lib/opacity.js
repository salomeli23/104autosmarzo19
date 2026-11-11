import { VEHICLE_PARTS } from './utils';

// Opacidad (%) que el cliente elige por vidrio en el Check-in (service.part_percentages)
const PART_LABELS = Object.fromEntries(VEHICLE_PARTS.map(p => [p.id, p.name]));
PART_LABELS.trasero = PART_LABELS.trasero || 'Trasero';

export const partLabel = (partId) => PART_LABELS[partId] || String(partId).replace(/_/g, ' ');

/** "Panorámico 5% · Luneta 20%" para un servicio */
export const partsWithOpacity = (svc) => (svc?.parts || [])
    .map(p => `${partLabel(p)}${svc.part_percentages?.[p] ? ` ${svc.part_percentages[p]}` : ''}`);

// Vidrios que corresponden a cada zona de medidas/corte
const ZONE_PARTS = {
    panoramico: ['panoramico'],
    trasero: ['luneta', 'trasero', 'vidrio_trasero'],
    laterales_delanteros: ['vidrio_piloto', 'vidrio_copiloto'],
    laterales_traseros: ['vidrio_trasero_piloto', 'vidrio_trasero_copiloto', 'custodias'],
    // Zonas anteriores (por lado)
    laterales_izquierdo: ['vidrio_piloto', 'vidrio_trasero_piloto', 'custodias'],
    laterales_derecho: ['vidrio_copiloto', 'vidrio_trasero_copiloto', 'custodias'],
    sunroof: ['sunroof'],
};
// Modelo 3 (vidrios independientes): ventana → vidrio del check-in
const WINDOW_PARTS = {
    panoramico: ['panoramico'], luneta: ['luneta', 'trasero', 'vidrio_trasero'], sunroof: ['sunroof'],
    delantera_der: ['vidrio_copiloto'], delantera_izq: ['vidrio_piloto'],
    trasera_der: ['vidrio_trasero_copiloto'], trasera_izq: ['vidrio_trasero_piloto'],
    custodia_der: ['custodias'], custodia_izq: ['custodias'],
};
const partsForZone = (zone) => (String(zone).startsWith('ventanas:')
    ? String(zone).slice(9).split(',').flatMap(w => WINDOW_PARTS[w] || [])
    : ZONE_PARTS[zone] || []);

/** Opacidades de una zona en toda la orden: [{ part, label, pct }] */
export const zoneOpacity = (order, zone) => {
    const out = [];
    (order?.services || []).forEach(svc => {
        if (!svc || typeof svc !== 'object') return;
        Object.entries(svc.part_percentages || {}).forEach(([part, pct]) => {
            if (pct && partsForZone(zone).includes(part) && !out.some(o => o.part === part)) {
                out.push({ part, label: partLabel(part), pct });
            }
        });
    });
    return out;
};

/** Texto corto de la zona: "5%" si es uno solo, o "Vidrio Piloto 5% · Vidrio Trasero Piloto 20%" */
export const zoneOpacityText = (order, zone) => {
    const list = zoneOpacity(order, zone);
    if (list.length === 0) return null;
    const unique = [...new Set(list.map(o => o.pct))];
    return unique.length === 1 && list.length === 1 ? list[0].pct
        : unique.length === 1 ? `${unique[0]} (${list.map(o => o.label).join(', ')})`
            : list.map(o => `${o.label} ${o.pct}`).join(' · ');
};
