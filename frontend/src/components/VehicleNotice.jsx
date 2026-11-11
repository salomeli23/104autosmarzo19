import React from 'react';
import { AlertTriangle, Car, Truck } from 'lucide-react';
import { partsWithOpacity } from '../lib/opacity';

/** Tipo de vehículo (auto / camioneta) y alerta si el material va encima de otro material o color (check-in) */
export const VehicleNotice = ({ order, compact = false, className = '' }) => {
    if (!order || (!order.vehicle_type && !order.over_existing_film)) return null;
    const Icon = order.vehicle_type === 'camioneta' ? Truck : Car;
    return (
        <div className={`space-y-1.5 ${className}`} data-testid={`vehicle-notice-${order.id}`}>
            {order.vehicle_type && (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-cyan-500/40 bg-cyan-500/10 text-cyan-300">
                    <Icon className="w-3.5 h-3.5" /> {order.vehicle_type === 'camioneta' ? 'Camioneta' : 'Auto'}
                </span>
            )}
            {order.over_existing_film && (
                <div className={`rounded-md border-2 border-amber-500/70 bg-amber-500/15 text-amber-200 ${compact ? 'p-2 text-xs' : 'p-3 text-sm'}`}>
                    <p className="font-bold flex items-center gap-1.5 text-amber-300">
                        <AlertTriangle className="w-4 h-4 shrink-0" /> ATENCIÓN: material encima de otro
                    </p>
                    <p>El material va encima de un vidrio que ya tiene material o es de otro color.</p>
                    {order.over_existing_film_note && <p className="mt-0.5 font-medium">{order.over_existing_film_note}</p>}
                </div>
            )}
        </div>
    );
};

/** Porcentajes (opacidad) que pidió el cliente por vidrio, por cada servicio de polarizado / ultrasecure */
export const OrderPercentages = ({ order, className = '' }) => {
    const rows = (order?.services || [])
        .filter(s => s && typeof s === 'object' && Object.keys(s.part_percentages || {}).length > 0 && (s.parts || []).length > 0)
        .map(s => ({ name: s.description || s.service, parts: partsWithOpacity(s) }));
    if (!rows.length) return null;
    return (
        <div className={`rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs space-y-0.5 ${className}`} data-testid={`order-percentages-${order.id}`}>
            <p className="font-semibold text-yellow-300">Porcentajes del cliente</p>
            {rows.map((r, i) => (
                <p key={i}><span className="text-muted-foreground">{r.name}:</span> <b className="text-yellow-200">{r.parts.join(' · ')}</b></p>
            ))}
        </div>
    );
};

export default VehicleNotice;
