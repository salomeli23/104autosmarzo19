import React from 'react';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';
import { BadgeCheck, Clock, Undo2, Star, MessageSquare } from 'lucide-react';

const META = {
    pendiente: { label: 'Calidad pendiente', icon: Clock, className: 'bg-violet-500/15 text-violet-300 border-violet-500/40' },
    aprobado: { label: 'Calidad aprobada', icon: BadgeCheck, className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40' },
    rechazado: { label: 'Devuelto por calidad', icon: Undo2, className: 'bg-red-500/15 text-red-400 border-red-500/40' },
    sin_revision: { label: 'Sin revisión de calidad', icon: Clock, className: 'bg-muted text-muted-foreground border-border' },
};

/** Estrellas de 1 a 5 (solo lectura, o editables con onChange) */
export const Stars = ({ value = 0, onChange, size = 'sm', testId }) => {
    const cls = size === 'lg' ? 'w-7 h-7' : 'w-3.5 h-3.5';
    return (
        <span className="inline-flex items-center gap-0.5" data-testid={testId}>
            {[1, 2, 3, 4, 5].map(n => {
                const icon = <Star className={cn(cls, n <= value ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/50')} />;
                return onChange ? (
                    <button key={n} type="button" onClick={() => onChange(n)} aria-label={`${n} estrellas`}
                        className="p-0.5 active:scale-90" data-testid={testId ? `${testId}-${n}` : undefined}>
                        {icon}
                    </button>
                ) : <React.Fragment key={n}>{icon}</React.Fragment>;
            })}
        </span>
    );
};

/** Etiqueta de calidad del servicio con su calificación */
export const QualityTag = ({ status, rating, className, testId }) => {
    const meta = META[status] || META.sin_revision;
    const Icon = meta.icon;
    return (
        <Badge className={cn('gap-1', meta.className, className)} data-testid={testId}>
            <Icon className="w-3 h-3" /> {meta.label}
            {status === 'aprobado' && rating ? <span className="ml-0.5 inline-flex items-center gap-0.5">· {rating}<Star className="w-3 h-3 fill-amber-400 text-amber-400" /></span> : null}
        </Badge>
    );
};

/** Comentarios de cada revisión de calidad con su calificación */
export const QualityComments = ({ reviews = [], fallbackNotes, testId }) => {
    const items = reviews.length ? reviews : (fallbackNotes ? [{ result: 'aprobado', notes: fallbackNotes }] : []);
    if (!items.length) return null;
    return (
        <div className="space-y-1.5" data-testid={testId}>
            {items.map((r, i) => (
                <div key={i} className={cn('text-xs p-2 rounded border',
                    r.result === 'rechazado' ? 'border-red-500/30 bg-red-500/5' : 'border-emerald-500/30 bg-emerald-500/5')}>
                    <div className="flex items-center gap-2 flex-wrap">
                        <MessageSquare className="w-3 h-3 text-muted-foreground" />
                        <span className="font-medium">{r.result === 'rechazado' ? 'Devuelto' : 'Aprobado'}</span>
                        {r.rating ? <Stars value={r.rating} /> : null}
                        {r.by_name && <span className="text-muted-foreground">· {r.by_name}</span>}
                        {r.at && <span className="text-muted-foreground">· {new Date(r.at).toLocaleString('es-CO')}</span>}
                    </div>
                    {(r.failed || []).map((f, j) => (
                        <p key={j} className="text-red-300 mt-0.5">• {f.label}{f.note ? ` — ${f.note}` : ''}</p>
                    ))}
                    {r.notes && <p className="mt-0.5 italic">“{r.notes}”</p>}
                </div>
            ))}
        </div>
    );
};

export default QualityTag;
