import React, { useEffect, useState } from 'react';
import { Timer, ScanSearch } from 'lucide-react';
import { cn } from '../lib/utils';

// Estados en los que el vehículo ya salió del taller: el tiempo deja de correr
const STOPPED_STATUSES = ['entregado', 'desistimiento'];

export const formatElapsed = (fromIso, now = Date.now()) => {
    const from = fromIso ? new Date(fromIso).getTime() : NaN;
    if (Number.isNaN(from)) return null;
    const mins = Math.max(0, Math.floor((now - from) / 60000));
    if (mins < 60) return `${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} h ${mins % 60} min`;
    const days = Math.floor(hours / 24);
    return `${days} d ${hours % 24} h`;
};

// Un solo reloj para todas las etiquetas de la página
const listeners = new Set();
let timerId = null;
const useNow = () => {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        listeners.add(setNow);
        if (!timerId) timerId = setInterval(() => listeners.forEach(fn => fn(Date.now())), 60000);
        return () => {
            listeners.delete(setNow);
            if (listeners.size === 0 && timerId) { clearInterval(timerId); timerId = null; }
        };
    }, []);
    return now;
};

/**
 * Tiempo transcurrido desde el check-in (ingreso_at) y desde la Revisión 360° (inspection_at).
 * Se actualiza cada minuto; no muestra nada si la orden no tiene check-in.
 */
export const OrderTimers = ({ order, className }) => {
    const now = useNow();
    if (!order?.ingreso_at || STOPPED_STATUSES.includes(order.status)) return null;
    const sinceCheckin = formatElapsed(order.ingreso_at, now);
    const since360 = order.inspection_at ? formatElapsed(order.inspection_at, now) : null;

    return (
        <span className={cn('inline-flex flex-wrap items-center gap-1', className)} data-testid={`order-timers-${order.id}`}>
            <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-violet-500/10 text-violet-400 border-violet-500/30"
                title={`Check-in: ${new Date(order.ingreso_at).toLocaleString('es-CO')}`}
            >
                <Timer className="w-3 h-3" />
                Check-in hace {sinceCheckin}
            </span>
            {since360 ? (
                <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-teal-500/10 text-teal-400 border-teal-500/30"
                    title={`Revisión 360°: ${new Date(order.inspection_at).toLocaleString('es-CO')}`}
                >
                    <ScanSearch className="w-3 h-3" />
                    360° hace {since360}
                </span>
            ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-amber-500/10 text-amber-500 border-amber-500/30">
                    <ScanSearch className="w-3 h-3" />
                    360° pendiente
                </span>
            )}
        </span>
    );
};

export default OrderTimers;
