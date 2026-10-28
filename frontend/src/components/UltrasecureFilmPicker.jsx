import React from 'react';
import { formatCurrency } from '../lib/utils';
import { cn } from '../lib/utils';

/**
 * Elige la película de polarizado del Ultrasecure; cada opción trae su precio de la tabla.
 * Props: service (del catálogo, con film_prices), films [{id,label}], value (film id),
 *        onPick({ film, film_label, price }), price (valor actual), className
 */
export const UltrasecureFilmPicker = ({ service, films = [], value, onPick, price, className }) => {
    if (!service?.film_prices) return null;
    const listPrice = value ? service.film_prices[value] : null;
    const edited = listPrice != null && price != null && price !== '' && Number(price) !== Number(listPrice);
    return (
        <div className={cn('space-y-1.5', className)} onClick={(e) => e.stopPropagation()} data-testid={`film-picker-${service.id}`}>
            <p className="text-xs text-muted-foreground">Polarizado que lleva el Ultrasecure (precio sugerido):</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {films.filter(f => service.film_prices[f.id] != null).map(f => (
                    <button
                        key={f.id}
                        type="button"
                        onClick={() => onPick({ film: f.id, film_label: f.label, price: service.film_prices[f.id] })}
                        className={cn(
                            'px-2 py-1.5 rounded-md border text-left transition-colors',
                            value === f.id ? 'border-emerald-500 bg-emerald-500/15' : 'border-border hover:border-emerald-500/50',
                        )}
                        data-testid={`film-${service.id}-${f.id}`}
                    >
                        <span className="block text-xs font-medium">{f.label}</span>
                        <span className="block text-[11px] font-mono text-muted-foreground">{formatCurrency(service.film_prices[f.id])}</span>
                    </button>
                ))}
            </div>
            {!value && <p className="text-[11px] text-amber-500">Elige el polarizado para cargar el precio.</p>}
            {edited && (
                <p className="text-[11px] text-sky-400">Precio modificado · tabla: {formatCurrency(listPrice)}</p>
            )}
        </div>
    );
};

/** Aviso de precio sugerido y mínimo (Detailing) */
export const SuggestedPriceHint = ({ service, price }) => {
    if (!service?.default_price) return null;
    const below = service.min_price && price !== '' && price != null && Number(price) < service.min_price;
    return (
        <p className={cn('text-[11px]', below ? 'text-red-500' : 'text-muted-foreground')} data-testid={`price-hint-${service.id}`}>
            Sugerido {formatCurrency(service.default_price)}
            {service.min_price ? ` · mínimo ${formatCurrency(service.min_price)}` : ''}
            {below ? ' · está por debajo del mínimo' : ''}
        </p>
    );
};

export default UltrasecureFilmPicker;
