// Zonas de vidrio que mide el técnico antes del corte (mismas claves que backend MEASURE_ZONES)
export const MEASURE_ZONES = [
    { id: 'panoramico', n: 1, label: 'Panorámico', hint: 'Solo hay un material' },
    { id: 'trasero', n: 2, label: 'Trasero / Luneta' },
    { id: 'laterales_delanteros', n: 3, label: 'Laterales delanteros', hint: 'Vidrios de las puertas delanteras' },
    { id: 'laterales_traseros', n: 4, label: 'Laterales traseros', hint: 'Vidrios de las puertas traseras y custodias' },
    { id: 'sunroof', n: 5, label: 'Sunroof' },
];

// Laterales por lado (Modelo 2 · Corte A / Corte B). También sirven para mostrar medidas anteriores.
export const LEGACY_MEASURE_ZONES = [
    { id: 'laterales_derecho', n: 'A', label: 'Corte A · lado derecho', hint: 'Delantera, trasera y custodia derechas' },
    { id: 'laterales_izquierdo', n: 'B', label: 'Corte B · lado izquierdo', hint: 'Delantera, trasera y custodia izquierdas' },
];

// Modelos de corte (igual que CUT_MODELS en el backend)
export const CUT_MODELS = [
    { id: 'estandar', label: 'Modelo 1 · Estándar', short: 'Estándar', hint: 'Por zonas: panorámico, trasero, laterales delanteros y traseros' },
    { id: 'lados', label: 'Modelo 2 · Corte A / Corte B', short: 'Corte A / B', hint: 'Laterales por lado: A = derecho, B = izquierdo' },
    { id: 'ventanas', label: 'Modelo 3 · Vidrios independientes', short: 'Vidrios independientes', hint: 'Cada corte: mínimo 1 y máximo 2 ventanas' },
];
export const cutModelLabel = (id) => CUT_MODELS.find(m => m.id === (id || 'estandar'))?.label || id;

// Zonas que mide el técnico en cada modelo (el modelo 3 se mide por cortes de ventanas)
export const MODEL_MEASURE_ZONES = {
    estandar: MEASURE_ZONES,
    lados: [
        MEASURE_ZONES[0], MEASURE_ZONES[1],
        ...LEGACY_MEASURE_ZONES.map((z, i) => ({ ...z, n: 3 + i })),
        { ...MEASURE_ZONES[4], n: 5 },
    ],
};

// Ventanas del modelo 3 (igual que WINDOW_LABELS en el backend)
export const WINDOWS = [
    { id: 'panoramico', label: 'Panorámico' }, { id: 'luneta', label: 'Luneta' },
    { id: 'delantera_der', label: 'Delantera derecha' }, { id: 'delantera_izq', label: 'Delantera izquierda' },
    { id: 'trasera_der', label: 'Trasera derecha' }, { id: 'trasera_izq', label: 'Trasera izquierda' },
    { id: 'custodia_der', label: 'Custodia derecha' }, { id: 'custodia_izq', label: 'Custodia izquierda' },
    { id: 'sunroof', label: 'Sunroof' },
];
export const windowLabel = (id) => WINDOWS.find(w => w.id === id)?.label || id;

/** Zonas presentes en unas medidas del técnico (incluye los laterales por lado si los tiene) */
export const zonesInMeasurements = (tm) => [
    ...MEASURE_ZONES,
    ...LEGACY_MEASURE_ZONES.filter(z => tm?.[z.id]),
];
