import React from 'react';

/**
 * Nombre de un servicio del catálogo con su detalle opcional
 * (tagline, descripción y nivel de protección, p. ej. Ultrasecure).
 */
export const ServiceCatalogLabel = ({ service }) => {
    if (!service) return null;
    const level = service.protection_level;

    return (
        <span className="block">
            <span className="flex items-center gap-2 flex-wrap">
                <span>{service.name}</span>
                {service.tagline && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {service.tagline}
                    </span>
                )}
            </span>
            {service.description && (
                <span className="block text-xs text-muted-foreground mt-0.5">{service.description}</span>
            )}
            {level != null && (
                <span className="flex items-center gap-2 mt-1" data-testid={`protection-level-${service.id}`}>
                    <span className="h-1.5 w-28 rounded-full bg-muted overflow-hidden">
                        <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${level}%` }} />
                    </span>
                    <span className="text-[11px] text-muted-foreground">Protección {level}%</span>
                </span>
            )}
        </span>
    );
};

export default ServiceCatalogLabel;
