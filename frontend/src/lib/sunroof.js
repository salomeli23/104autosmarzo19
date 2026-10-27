// El sunroof nunca va dentro de un servicio: es un adicional con valor personalizable.
// Se guarda como una línea propia de la orden ("Adicional - Sunroof").
export const SUNROOF_ID = 'sunroof_adicional';

export const isSunroofExtra = (e) => String(e?.trigger_part || '').toLowerCase() === 'sunroof'
    || String(e?.nombre || '').toLowerCase().includes('sunroof')
    || String(e?.id || '').toLowerCase().includes('sunroof');

export const isSunroofLine = (s) => s?.service === SUNROOF_ID || String(s?.service || '').toLowerCase() === 'sunroof';

/** Busca el sunroof en los servicios de una orden (línea propia, parte o extra de un servicio). */
export const findSunroof = (services = []) => {
    let found = null;
    services.forEach(s => {
        if (!s || typeof s !== 'object') return;
        if (isSunroofLine(s)) {
            found = { price: s.price, percentage: s.part_percentages?.sunroof };
            return;
        }
        const ex = (s.extras || []).find(isSunroofExtra);
        if (ex || (s.parts || []).includes('sunroof')) {
            found = {
                price: ex?.price ?? found?.price,
                percentage: s.part_percentages?.sunroof || found?.percentage,
            };
        }
    });
    return found;
};

/** Quita el sunroof de un servicio (partes, % y extras). */
export const stripSunroof = (s) => {
    const pct = { ...(s.part_percentages || {}) };
    delete pct.sunroof;
    return {
        ...s,
        parts: (s.parts || []).filter(p => p !== 'sunroof'),
        part_percentages: pct,
        extras: (s.extras || []).filter(e => !isSunroofExtra(e)),
    };
};

export const buildSunroofLine = (price, percentage) => ({
    service: SUNROOF_ID,
    price: parseFloat(price) || 0,
    no_charge: null,
    description: 'Adicional - Sunroof',
    parts: ['sunroof'],
    part_percentages: percentage ? { sunroof: percentage } : {},
    extras: null,
});
