import React from 'react';
import { cn } from '../lib/utils';
import { STATUS_LABELS, ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from '../lib/utils';

const statusStyles = {
    agendado: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    en_proceso: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
    en_revision: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
    terminado: 'bg-green-500/10 text-green-500 border-green-500/20',
    pending: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
    approved: 'bg-green-500/10 text-green-500 border-green-500/20',
};

export const StatusBadge = ({ status, className }) => {
    const label = STATUS_LABELS[status] || ORDER_STATUS_LABELS[status] || status;
    const style = statusStyles[status] || ORDER_STATUS_COLORS[status] || statusStyles.pending;

    return (
        <span
            className={cn(
                "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border",
                style,
                className
            )}
            data-testid={`status-badge-${status}`}
        >
            <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5" />
            {label}
        </span>
    );
};
