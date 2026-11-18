import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { technicianChargesAPI } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { PlateBadge } from '../components/PlateBadge';
import { CarAvatar } from '../components/CarAvatar';
import { ChargeBadge } from '../components/TechnicianHistory';
import { formatCurrency } from '../lib/utils';
import { toast } from 'sonner';
import { Wallet, Loader2, RefreshCw, HandCoins, Send, CheckCircle, XCircle, Clock, AlertTriangle, CalendarCheck } from 'lucide-react';

const fmt = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const dayKey = (iso) => {
    const t = iso ? new Date(iso).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
    return t.charAt(0).toUpperCase() + t.slice(1);
};
const valueOf = (c) => (c.status === 'aprobado' || c.status === 'pagado' ? c.approved_amount ?? c.amount : c.amount) || 0;

const FILTERS = [
    { id: 'todos', label: 'Todos' },
    { id: 'pendiente', label: 'En revisión' },
    { id: 'aprobado', label: 'Aprobados por pagar' },
    { id: 'pagado', label: 'Pagados' },
    { id: 'rechazado', label: 'Rechazados' },
];

/** Paso del recorrido de un cobro: enviado → revisado → pagado */
const Step = ({ icon: Icon, tone, title, when, children }) => (
    <li className="flex gap-2">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${tone}`} />
        <div className="min-w-0">
            <p className="text-xs"><b>{title}</b>{when && <span className="text-muted-foreground"> · {when}</span>}</p>
            {children && <div className="text-xs text-muted-foreground break-words">{children}</div>}
        </div>
    </li>
);

const ChargeCard = ({ c }) => {
    const changed = c.approved_amount != null && Math.round(c.approved_amount) !== Math.round(c.amount);
    return (
        <Card data-testid={`mp-card-${c.id}`}>
            <CardContent className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                    <CarAvatar photoUrl={c.profile_photo_url} size={40} />
                    <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <PlateBadge plate={c.plate} size="sm" />
                            <ChargeBadge charge={c} />
                        </div>
                        <p className="text-xs text-muted-foreground">{[c.brand, c.model].filter(Boolean).join(' ')} · orden {c.order_code}</p>
                        {c.services?.length > 0 && <p className="text-xs text-muted-foreground break-words">{c.services.join(' · ')}</p>}
                    </div>
                    <div className="text-right shrink-0">
                        <p className="text-[10px] uppercase text-muted-foreground">{c.status === 'pagado' ? 'Pagado' : c.status === 'aprobado' ? 'Aprobado' : 'Cobrado'}</p>
                        <p className="font-mono font-bold">{formatCurrency(valueOf(c))}</p>
                        {changed && <p className="text-[10px] text-muted-foreground line-through">{formatCurrency(c.amount)}</p>}
                    </div>
                </div>
                <ol className="space-y-1.5 border-l border-border pl-3" data-testid={`mp-steps-${c.id}`}>
                    <Step icon={Send} tone="text-cyan-400" title={`Cobro enviado por ${formatCurrency(c.amount)}`} when={fmt(c.created_at)}>
                        {c.notes && <>Tu nota: “{c.notes}”</>}
                    </Step>
                    {c.status === 'pendiente' && (
                        <Step icon={Clock} tone="text-amber-400" title="Esperando revisión de Liquidaciones" />
                    )}
                    {c.reviewed_at && c.status !== 'rechazado' && (
                        <Step icon={CheckCircle} tone="text-sky-400" title={`Aprobado por ${formatCurrency(c.approved_amount)}`}
                            when={`${fmt(c.reviewed_at)}${c.reviewed_by_name ? ` · ${c.reviewed_by_name}` : ''}`}>
                            {c.review_notes && <>“{c.review_notes}”</>}
                        </Step>
                    )}
                    {c.status === 'rechazado' && (
                        <Step icon={XCircle} tone="text-red-400" title="Rechazado"
                            when={`${fmt(c.reviewed_at)}${c.reviewed_by_name ? ` · ${c.reviewed_by_name}` : ''}`}>
                            {c.review_notes && <span className="text-red-300">Motivo: {c.review_notes}. </span>}
                            Puedes cobrarlo de nuevo en Mis Servicios → Mis entregas.
                        </Step>
                    )}
                    {c.status === 'aprobado' && (
                        <Step icon={Clock} tone="text-sky-400" title="Pendiente de pago" />
                    )}
                    {c.status === 'pagado' && (
                        <Step icon={Wallet} tone="text-emerald-400" title={`Pagado ${formatCurrency(c.approved_amount)}`}
                            when={`${fmt(c.paid_at)}${c.paid_by_name ? ` · ${c.paid_by_name}` : ''}`}>
                            {c.payment_reference && <>Referencia: {c.payment_reference}</>}
                        </Step>
                    )}
                </ol>
            </CardContent>
        </Card>
    );
};

/** El técnico ve sus cobros, en qué estado van y el historial de lo que le ha pagado Liquidaciones */
export const MisPagos = () => {
    const [charges, setCharges] = useState([]);
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('todos');

    const load = useCallback(async () => {
        try {
            const [c, h] = await Promise.all([technicianChargesAPI.list(), technicianChargesAPI.history()]);
            setCharges(c.data || []);
            setHistory(h.data || []);
        } catch (e) {
            toast.error('No se pudieron cargar tus pagos');
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    const totals = useMemo(() => charges.reduce((acc, c) => {
        if (c.status === 'pendiente') acc.review += c.amount || 0;
        else if (c.status === 'aprobado') acc.approved += valueOf(c);
        else if (c.status === 'pagado') acc.paid += valueOf(c);
        else if (c.status === 'rechazado') acc.rejected += 1;
        return acc;
    }, { review: 0, approved: 0, paid: 0, rejected: 0 }), [charges]);
    const counts = useMemo(() => Object.fromEntries(FILTERS.map(f => [f.id, f.id === 'todos' ? charges.length : charges.filter(c => c.status === f.id).length])), [charges]);
    const uncharged = history.filter(h => !h.charge || h.charge.status === 'rechazado').length;
    const shown = filter === 'todos' ? charges : charges.filter(c => c.status === filter);

    // Historial de pagos: lo pagado agrupado por día de pago
    const payments = useMemo(() => {
        const groups = {};
        charges.filter(c => c.status === 'pagado' && c.paid_at)
            .sort((a, b) => b.paid_at.localeCompare(a.paid_at))
            .forEach(c => { const k = dayKey(c.paid_at); (groups[k] = groups[k] || []).push(c); });
        return Object.entries(groups);
    }, [charges]);

    return (
        <div className="space-y-6" data-testid="mis-pagos-page">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="font-heading text-3xl md:text-4xl flex items-center gap-2"><Wallet className="w-8 h-8 text-emerald-400" /> Mis pagos</h1>
                    <p className="text-muted-foreground">Tus cobros, en qué estado van y lo que te ha pagado Liquidaciones.</p>
                </div>
                <Button variant="outline" onClick={load}><RefreshCw className="w-4 h-4 mr-2" /> Actualizar</Button>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="mp-totals">
                {[['En revisión', formatCurrency(totals.review), 'text-amber-400'],
                    ['Aprobado por pagar', formatCurrency(totals.approved), 'text-sky-400'],
                    ['Pagado', formatCurrency(totals.paid), 'text-emerald-400'],
                    ['Rechazados', totals.rejected, 'text-red-400']].map(([l, v, c]) => (
                    <Card key={l}><CardContent className="p-3">
                        <p className="text-[10px] uppercase text-muted-foreground">{l}</p>
                        <p className={`font-mono text-lg font-bold ${c}`}>{v}</p>
                    </CardContent></Card>
                ))}
            </div>

            {uncharged > 0 && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 flex flex-wrap items-center justify-between gap-2" data-testid="mp-uncharged">
                    <p className="text-sm text-amber-300 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4" /> Tienes {uncharged} servicio(s) entregado(s) sin cobrar.
                    </p>
                    <Button asChild size="sm" variant="outline"><Link to="/technician"><HandCoins className="w-4 h-4 mr-1" /> Cobrar en Mis entregas</Link></Button>
                </div>
            )}

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin" /></div>
            ) : (
                <>
                    <section className="space-y-3">
                        <h2 className="font-heading text-xl">Mis cobros</h2>
                        <div className="flex flex-wrap gap-1.5" data-testid="mp-filters">
                            {FILTERS.map(f => (
                                <button key={f.id} type="button" onClick={() => setFilter(f.id)} data-testid={`mp-filter-${f.id}`}
                                    className={`px-3 py-1 rounded-full border text-xs transition-colors ${filter === f.id ? 'border-primary bg-primary/15 text-primary' : 'border-border hover:border-primary/50'}`}>
                                    {f.label} ({counts[f.id]})
                                </button>
                            ))}
                        </div>
                        {shown.length === 0 ? (
                            <p className="text-center py-8 text-muted-foreground text-sm">
                                {charges.length === 0 ? 'Aún no has enviado cobros. Cobra tus servicios en Mis Servicios → Mis entregas.' : 'No hay cobros en este estado.'}
                            </p>
                        ) : (
                            <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3">
                                {shown.map(c => <ChargeCard key={c.id} c={c} />)}
                            </div>
                        )}
                    </section>

                    <section className="space-y-3" data-testid="mp-payments">
                        <h2 className="font-heading text-xl flex items-center gap-2"><CalendarCheck className="w-5 h-5 text-emerald-400" /> Historial de pagos</h2>
                        {payments.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Todavía no tienes pagos registrados.</p>
                        ) : payments.map(([day, list]) => (
                            <Card key={day}>
                                <CardContent className="p-3 space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="text-sm font-semibold">{day}</p>
                                        <p className="font-mono font-bold text-emerald-400">{formatCurrency(list.reduce((s, c) => s + valueOf(c), 0))}</p>
                                    </div>
                                    {list.map(c => (
                                        <div key={c.id} className="flex items-center justify-between gap-2 text-xs border-t border-border pt-2">
                                            <div className="min-w-0 flex items-center gap-2 flex-wrap">
                                                <PlateBadge plate={c.plate} size="sm" />
                                                <span className="text-muted-foreground">
                                                    {new Date(c.paid_at).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}
                                                    {c.paid_by_name ? ` · ${c.paid_by_name}` : ''}{c.payment_reference ? ` · Ref. ${c.payment_reference}` : ''}
                                                </span>
                                            </div>
                                            <span className="font-mono shrink-0">{formatCurrency(valueOf(c))}</span>
                                        </div>
                                    ))}
                                </CardContent>
                            </Card>
                        ))}
                    </section>
                </>
            )}
        </div>
    );
};

export default MisPagos;
