import React from 'react';
import { RotateCcw } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * Etiqueta "Postventa" para órdenes agendadas como postventa.
 * No muestra nada si la orden no es de postventa.
 */
export const PostventaBadge = ({ order, className }) => {
    if (!order?.is_postventa) return null;

    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide border bg-amber-500/15 text-amber-500 border-amber-500/40",
                className
            )}
            data-testid={`postventa-badge-${order.id}`}
        >
            <RotateCcw className="w-3 h-3" />
            Postventa
        </span>
    );
};

export default PostventaBadge;
