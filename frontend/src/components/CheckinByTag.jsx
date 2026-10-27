import React from 'react';
import { UserCheck } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * Etiqueta con el asesor que realizó el check-in de la orden.
 * No muestra nada si la orden aún no tiene check-in registrado.
 */
export const CheckinByTag = ({ order, className }) => {
    if (!order?.checkin_by_name) return null;

    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-sky-500/10 text-sky-400 border-sky-500/30",
                className
            )}
            data-testid={`checkin-by-tag-${order.id}`}
        >
            <UserCheck className="w-3 h-3" />
            Check-in: {order.checkin_by_name}
        </span>
    );
};

export default CheckinByTag;
