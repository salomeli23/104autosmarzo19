// Zonas de vidrio que mide el técnico antes del corte (mismas claves que backend MEASURE_ZONES)
export const MEASURE_ZONES = [
    { id: 'panoramico', n: 1, label: 'Panorámico', hint: 'Solo hay un material' },
    { id: 'trasero', n: 2, label: 'Trasero / Luneta' },
    { id: 'laterales_delanteros', n: 3, label: 'Laterales delanteros', hint: 'Vidrios de las puertas delanteras' },
    { id: 'laterales_traseros', n: 4, label: 'Laterales traseros', hint: 'Vidrios de las puertas traseras y custodias' },
    { id: 'sunroof', n: 5, label: 'Sunroof' },
];

// Zonas usadas antes (laterales por lado): solo para mostrar y cortar medidas ya tomadas
export const LEGACY_MEASURE_ZONES = [
    { id: 'laterales_izquierdo', n: 3, label: 'Laterales lado izquierdo' },
    { id: 'laterales_derecho', n: 4, label: 'Laterales lado derecho' },
];

/** Zonas presentes en unas medidas del técnico (incluye las anteriores si las tiene) */
export const zonesInMeasurements = (tm) => [
    ...MEASURE_ZONES,
    ...LEGACY_MEASURE_ZONES.filter(z => tm?.[z.id]),
];
