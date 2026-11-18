import React, { useMemo, useState } from 'react';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { PlateBadge } from './PlateBadge';
import { StatusBadge } from './StatusBadge';
import { CalendarDays, ChevronLeft, ChevronRight, CheckCircle2, Wrench, CalendarClock, AlertTriangle } from 'lucide-react';

const FINISHED = ['en_calidad', 'servicio_completado', 'terminado_falta_pago', 'terminado_pagado', 'entregado'];
const TO_DO = ['en_corte', 'asignado', 'en_proceso'];
const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// Fecha local en YYYY-MM-DD (las citas se guardan así)
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const isoDay = (iso) => (iso ? ymd(new Date(iso)) : null);
const mondayOf = (d) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
};
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const shortDate = (d) => d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
const hourOf = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' }) : '');
const servicesText = (o) => (o.services || []).filter(s => s && typeof s === 'object')
    .map(s => s.description || s.service).join(' · ');

const Tile = ({ icon: Icon, label, value, tone, testId }) => (
    <Card className={`border ${tone}`} data-testid={testId}>
        <CardContent className="p-3 flex items-center gap-3">
            <Icon className="w-5 h-5 shrink-0" />
            <div className="min-w-0">
                <p className="text-2xl font-bold leading-none">{value}</p>
                <p className="text-xs text-muted-foreground mt-1">{label}</p>
            </div>
        </CardContent>
    </Card>
);

const Row = ({ o, delivered }) => (
    <div className="flex items-start gap-2 rounded-md border bg-background/60 p-2" data-testid={`week-item-${o.plate}`}>
        <div className="w-14 shrink-0 text-xs font-mono text-muted-foreground pt-1">
            {delivered ? hourOf(delivered) : (o.scheduled_time || '—')}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
                <PlateBadge plate={o.plate} size="sm" />
                <span className="text-sm font-medium truncate">{[o.brand, o.model].filter(Boolean).join(' ')}</span>
            </div>
            {(o.installed_services?.length || servicesText(o)) && (
                <p className="text-xs text-muted-foreground break-words">
                    {o.installed_services?.length ? o.installed_services.join(' · ') : servicesText(o)}
                </p>
            )}
        </div>
        <div className="shrink-0">
            {delivered
                ? <span className="inline-flex items-center gap-1 text-xs text-emerald-400"><CheckCircle2 className="w-3.5 h-3.5" /> Entregado</span>
                : <StatusBadge status={o.status} />}
        </div>
    </div>
);

/**
 * Semana del técnico: lo programado por día, lo que entregó y lo que tiene por hacer.
 * Props: orders (sus vehículos), history (sus servicios terminados, /technician/history)
 */
export const TechnicianWeek = ({ orders = [], history = [] }) => {
    const [offset, setOffset] = useState(0);
    const today = ymd(new Date());
    const start = useMemo(() => addDays(mondayOf(new Date()), offset * 7), [offset]);
    const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(start, i)), [start]);
    const first = ymd(days[0]);
    const last = ymd(days[6]);
    const inWeek = (d) => d && d >= first && d <= last;

    const finishedIds = useMemo(() => new Set(history.map(h => h.id)), [history]);
    const scheduled = orders.filter(o => inWeek(o.date) && o.status !== 'cancelado');
    const delivered = history.filter(h => inWeek(isoDay(h.service_completed_at)));
    const toDo = orders.filter(o => TO_DO.includes(o.status));
    const overdue = offset === 0 ? toDo.filter(o => o.date && o.date < first) : [];

    const byDay = (d) => {
        const key = ymd(d);
        const prog = scheduled.filter(o => o.date === key)
            .sort((a, b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || ''))
            .map(o => {
                const h = history.find(x => x.id === o.id);
                const doneDay = isoDay(h?.service_completed_at);
                return { o: h ? { ...o, installed_services: h.installed_services } : o, delivered: doneDay === key ? h.service_completed_at : null };
            });
        const listed = new Set(prog.map(x => x.o.id));
        const extra = delivered.filter(h => isoDay(h.service_completed_at) === key && !listed.has(h.id))
            .map(h => ({ o: h, delivered: h.service_completed_at }));
        return [...prog, ...extra];
    };

    return (
        <div className="space-y-4" data-testid="technician-week">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-heading text-lg flex items-center gap-2">
                    <CalendarDays className="w-5 h-5 text-primary" />
                    Semana del {shortDate(days[0])} al {shortDate(days[6])}
                </p>
                <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setOffset(v => v - 1)} aria-label="Semana anterior" data-testid="week-prev">
                        <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button variant={offset === 0 ? 'secondary' : 'outline'} size="sm" className="h-8" onClick={() => setOffset(0)} data-testid="week-today">Esta semana</Button>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setOffset(v => v + 1)} aria-label="Semana siguiente" data-testid="week-next">
                        <ChevronRight className="w-4 h-4" />
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 min-[400px]:grid-cols-3 gap-2">
                <Tile icon={CalendarClock} label="Programados en la semana" value={scheduled.filter(o => !FINISHED.includes(o.status) && !finishedIds.has(o.id)).length}
                    tone="border-cyan-500/30 text-cyan-400" testId="week-scheduled" />
                <Tile icon={CheckCircle2} label="Entregados en la semana" value={delivered.length}
                    tone="border-emerald-500/30 text-emerald-400" testId="week-delivered" />
                <Tile icon={Wrench} label="Por hacer ahora" value={toDo.length}
                    tone="border-amber-500/30 text-amber-400" testId="week-todo" />
            </div>

            {overdue.length > 0 && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2" data-testid="week-overdue">
                    <p className="text-sm font-medium text-amber-400 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" /> Pendientes de días anteriores ({overdue.length})
                    </p>
                    {overdue.map(o => <Row key={o.id} o={o} />)}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 items-start">
                {days.map((d, i) => {
                    const key = ymd(d);
                    const items = byDay(d);
                    const isToday = key === today;
                    return (
                        <Card key={key} className={isToday ? 'border-primary/60' : ''} data-testid={`week-day-${key}`}>
                            <CardContent className="p-3 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                    <p className={`text-sm font-semibold ${isToday ? 'text-primary' : ''}`}>
                                        {DAY_NAMES[i]} <span className="font-normal text-muted-foreground">{shortDate(d)}</span>
                                    </p>
                                    {isToday && <span className="text-[10px] uppercase tracking-wide rounded-full bg-primary/15 text-primary px-2 py-0.5">Hoy</span>}
                                </div>
                                {items.length === 0
                                    ? <p className="text-xs text-muted-foreground">Sin servicios</p>
                                    : items.map(({ o, delivered: at }) => <Row key={`${o.id}-${at ? 'd' : 'p'}`} o={o} delivered={at} />)}
                            </CardContent>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
};

export default TechnicianWeek;
