import React from 'react';
import { cn } from '../lib/utils';
import { VEHICLE_STATUS_LABELS, ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from '../lib/utils';

const statusStyles = {
    agendado: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    ingresado: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
    con_tecnico: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
    en_proceso: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    finalizado: 'bg-green-500/10 text-green-500 border-green-500/20',
};

export const VehicleStatusBadge = ({ status, className }) => {
    if (!status) return null;
    
    // Los vehículos traen el estado de su orden: usar esas etiquetas si no es un estado propio
    const label = VEHICLE_STATUS_LABELS[status] || ORDER_STATUS_LABELS[status] || status;
    const style = statusStyles[status] || ORDER_STATUS_COLORS[status] || 'bg-gray-500/10 text-gray-500 border-gray-500/20';

    return (
        <span
            className={cn(
                "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border",
                style,
                className
            )}
            data-testid={`vehicle-status-badge-${status}`}
        >
            <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5" />
            {label}
        </span>
    );
};
