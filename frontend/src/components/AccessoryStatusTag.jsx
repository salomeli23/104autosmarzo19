import React from 'react';
import { Package } from 'lucide-react';
import { cn } from '../lib/utils';

const META = {
    pendiente: { label: 'Accesorios por despachar', className: 'bg-amber-500/15 text-amber-500 border-amber-500/40' },
    despachado: { label: 'Accesorios listos para entregar', className: 'bg-sky-500/15 text-sky-500 border-sky-500/40' },
    entregado: { label: 'Accesorios entregados', className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/40' },
};

/**
 * Estado del pedido de accesorios de la orden. No muestra nada si la orden no lleva accesorios.
 */
export const AccessoryStatusTag = ({ order, className }) => {
    const meta = META[order?.accessory_status];
    if (!meta) return null;

    return (
        <span
            className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border", meta.className, className)}
            data-testid={`accessory-status-${order.id}`}
        >
            <Package className="w-3 h-3" />
            {meta.label}
        </span>
    );
};

export default AccessoryStatusTag;
