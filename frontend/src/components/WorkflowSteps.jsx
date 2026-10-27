import React from 'react';
import { ScanSearch, Users, Scissors, Wrench, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import { orderNeedsCutting } from '../lib/workflow';

const ORDER = ['en_revision', 'en_corte', 'asignado', 'en_proceso', 'servicio_completado'];

/**
 * Pasos del taller: 360° → Técnicos → Corte (si aplica) → Instalación.
 */
export const WorkflowSteps = ({ order, className }) => {
    const needsCutting = orderNeedsCutting(order);
    const idx = ORDER.indexOf(order?.status);
    const hasTechs = !!order?.assigned_technician_id;
    const steps = [
        { key: '360', label: '360°', icon: ScanSearch, done: !!order?.inspection_at, current: false },
        { key: 'tech', label: 'Técnicos', icon: Users, done: hasTechs, current: order?.status === 'en_revision' },
        ...(needsCutting ? [{
            key: 'corte', label: 'Corte', icon: Scissors,
            done: idx > ORDER.indexOf('en_corte'), current: order?.status === 'en_corte',
        }] : []),
        {
            key: 'inst', label: 'Instalación', icon: Wrench,
            done: idx >= ORDER.indexOf('servicio_completado') || (idx === -1 && !!order?.service_completed_at),
            current: ['asignado', 'en_proceso'].includes(order?.status),
        },
    ];
    return (
        <div className={cn('flex items-center gap-1 flex-wrap', className)} data-testid={`workflow-${order?.id}`}>
            {steps.map((s, i) => {
                const Icon = s.done ? Check : s.icon;
                return (
                    <React.Fragment key={s.key}>
                        {i > 0 && <span className={cn('h-px w-3', s.done || s.current ? 'bg-cyan-500/60' : 'bg-border')} />}
                        <span className={cn(
                            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border',
                            s.done ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                : s.current ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/50 font-medium'
                                    : 'text-muted-foreground border-border',
                        )}>
                            <Icon className="w-3 h-3" />
                            {s.label}
                        </span>
                    </React.Fragment>
                );
            })}
        </div>
    );
};

export default WorkflowSteps;
