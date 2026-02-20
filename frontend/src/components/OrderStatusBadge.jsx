import React from 'react';
import { cn, ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from '../lib/utils';

export const OrderStatusBadge = ({ status, className }) => {
    if (!status) return null;
    
    const label = ORDER_STATUS_LABELS[status] || status;
    const colorClass = ORDER_STATUS_COLORS[status] || 'bg-gray-500/10 text-gray-500 border-gray-500/20';

    return (
        <span
            className={cn(
                "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border",
                colorClass,
                className
            )}
            data-testid={`order-status-${status}`}
        >
            <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5" />
            {label}
        </span>
    );
};
