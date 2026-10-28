// Precios sugeridos del catálogo (backend SERVICES_CATALOG): Ultrasecure por película y Detailing.
// Siempre son editables: el Ultrasecure incluye otros componentes y servicios.

/** Busca un servicio del catálogo por id → { service, category, categoryKey } */
export const findCatalogService = (catalog, serviceId) => {
    for (const [categoryKey, category] of Object.entries(catalog || {})) {
        const service = (category?.services || []).find(s => s.id === serviceId);
        if (service) return { service, category, categoryKey };
    }
    return { service: null, category: null, categoryKey: null };
};

export const hasFilmPrices = (service) => !!service?.film_prices;

/** Precio sugerido al seleccionar el servicio (Detailing con precio de lista) */
export const defaultServicePrice = (service) => service?.default_price ?? null;

/** Texto del servicio en la orden: "Ultrasecure - 300 Micras · Ceramic i3" */
export const serviceDescription = (category, name, filmLabel) => `${category} - ${name}${filmLabel ? ` · ${filmLabel}` : ''}`;

/** Quita la película del nombre guardado ("300 Micras · Ceramic i3" → "300 Micras") */
export const stripFilmFromName = (name, filmLabel) => (filmLabel && name?.endsWith(` · ${filmLabel}`)
    ? name.slice(0, -(` · ${filmLabel}`).length)
    : name);
