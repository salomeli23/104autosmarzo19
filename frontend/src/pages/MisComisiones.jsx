import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { advisorCommissionsAPI } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { PlateBadge } from '../components/PlateBadge';
import { CarAvatar } from '../components/CarAvatar';
import { ChargeBadge } from '../components/TechnicianHistory';
import { ConfirmTwiceDialog } from '../components/ConfirmTwiceDialog';
import { InstallerRatesTable } from '../components/InstallerRatesTable';
import { formatCurrency } from '../lib/utils';
import { toast } from 'sonner';
import { BadgeDollarSign, HandCoins, Loader2, RefreshCw, Table2 } from 'lucide-react';

const fmt = (iso) => (iso ? new Date(iso).toLocaleString('es-CO') : '-');
const PAYMENT_LABEL = { paid: 'Cliente pagó', partial: 'Abono parcial', pending: 'Cliente sin pagar' };

/** El asesor ve la comisión de cada check-in que hizo y la cobra a Liquidaciones */
export const MisComisiones = () => {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [confirm, setConfirm] = useState(null);
    const [busy, setBusy] = useState(null);
    const [showRates, setShowRates] = useState(false);

    const load = useCallback(async () => {
        try {
            const { data } = await advisorCommissionsAPI.mine();
            setRows(data);
        } catch (e) {
            toast.error('Error al cargar tus comisiones');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const totals = useMemo(() => rows.reduce((acc, r) => {
        if (r.status === 'por_cobrar' || r.status === 'rechazado') acc.toCharge += r.amount;
        else if (r.status === 'pendiente') acc.review += r.amount;
        else if (r.status === 'aprobado') acc.approved += r.approved_amount || 0;
        else if (r.status === 'pagado') acc.paid += r.approved_amount || 0;
        return acc;
    }, { toCharge: 0, review: 0, approved: 0, paid: 0 }), [rows]);

    const request = async (r) => {
        setBusy(r.id);
        try {
            const { data } = await advisorCommissionsAPI.request(r.id);
            toast.success(`${data.message} · ${formatCurrency(data.amount)}`);
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo cobrar la comisión');
        } finally {
            setBusy(null);
            setConfirm(null);
        }
    };

    return (
        <div className="space-y-6" data-testid="mis-comisiones-page">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="font-heading text-3xl md:text-4xl flex items-center gap-2"><BadgeDollarSign className="w-8 h-8 text-emerald-400" /> Mis Comisiones</h1>
                    <p className="text-muted-foreground">La comisión de cada check-in que hiciste, según la tabla de pago a asesores. Cóbrala y Liquidaciones la revisa.</p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setShowRates(v => !v)} data-testid="mc-rates-btn"><Table2 className="w-4 h-4 mr-2" /> {showRates ? 'Ocultar tarifas' : 'Ver tarifas'}</Button>
                    <Button variant="outline" onClick={load}><RefreshCw className="w-4 h-4 mr-2" /> Actualizar</Button>
                </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="mc-totals">
                {[['Por cobrar', totals.toCharge, 'text-foreground'], ['En revisión', totals.review, 'text-amber-400'],
                    ['Aprobado', totals.approved, 'text-sky-400'], ['Pagado', totals.paid, 'text-emerald-400']].map(([l, v, c]) => (
                    <Card key={l}><CardContent className="p-3">
                        <p className="text-[10px] uppercase text-muted-foreground">{l}</p>
                        <p className={`font-mono text-lg font-bold ${c}`}>{formatCurrency(v)}</p>
                    </CardContent></Card>
                ))}
            </div>

            {showRates && <InstallerRatesTable kind="advisors" />}

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin" /></div>
            ) : rows.length === 0 ? (
                <p className="text-center py-12 text-muted-foreground text-sm">Aún no tienes check-in con comisión.</p>
            ) : (
                <div className="grid gap-3 2xl:grid-cols-2">
                    {rows.map(r => {
                        const canCharge = (r.status === 'por_cobrar' || r.status === 'rechazado') && r.amount > 0;
                        return (
                            <Card key={r.id} data-testid={`mc-card-${r.id}`}>
                                <CardContent className="p-4 space-y-3">
                                    <div className="flex items-start gap-3">
                                        <CarAvatar photoUrl={r.profile_photo_url} size={40} />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <PlateBadge plate={r.plate} size="sm" />
                                                {r.status === 'por_cobrar'
                                                    ? <Badge variant="outline" className="text-[10px]">Sin cobrar</Badge>
                                                    : <ChargeBadge charge={r} noun="Comisión" />}
                                                <Badge variant="outline" className="text-[10px]">{PAYMENT_LABEL[r.payment_status] || r.payment_status}</Badge>
                                            </div>
                                            <p className="text-xs text-muted-foreground mt-1">{r.brand} {r.model} · {r.client_name} · orden {r.order_code}</p>
                                            <p className="text-xs text-muted-foreground">Check-in {fmt(r.ingreso_at)} · venta {formatCurrency(r.order_total)}</p>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <p className="text-[10px] uppercase text-muted-foreground">Comisión</p>
                                            <p className="font-mono font-bold">{formatCurrency(r.approved_amount ?? r.amount)}</p>
                                        </div>
                                    </div>
                                    <div className="rounded-md bg-muted/40 p-2 space-y-0.5 text-xs">
                                        {r.commission.lines.map((l, i) => (
                                            <div key={i} className="flex justify-between gap-3"><span>{l.concept}</span><span className="font-mono">{formatCurrency(l.amount)}</span></div>
                                        ))}
                                        {!r.commission.lines.length && <p className="text-muted-foreground">Ningún servicio de esta venta tiene tarifa de asesor.</p>}
                                        {r.commission.without_rate.length > 0 && <p className="text-amber-400">Sin tarifa: {r.commission.without_rate.join(', ')}</p>}
                                    </div>
                                    {r.status === 'rechazado' && r.review_notes && <p className="text-xs text-red-300">Rechazada: {r.review_notes}</p>}
                                    {r.status !== 'rechazado' && r.review_notes && <p className="text-xs text-muted-foreground">Liquidaciones: {r.review_notes}</p>}
                                    {r.status === 'pagado' && <p className="text-xs text-emerald-400">Pagado {fmt(r.paid_at)}{r.payment_reference ? ` · ${r.payment_reference}` : ''}</p>}
                                    {canCharge && (
                                        <div className="flex justify-end">
                                            <Button size="sm" onClick={() => setConfirm(r)} disabled={busy === r.id} data-testid={`mc-charge-${r.id}`}>
                                                {busy === r.id ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <HandCoins className="w-4 h-4 mr-1.5" />}
                                                {r.status === 'rechazado' ? 'Cobrar de nuevo' : 'Cobrar comisión'}
                                            </Button>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            )}

            {confirm && (
                <ConfirmTwiceDialog
                    open
                    onOpenChange={(v) => !v && setConfirm(null)}
                    onConfirm={() => request(confirm)}
                    cancelLabel="Cancelar"
                    steps={[{
                        title: 'Cobrar comisión',
                        description: <>Vas a cobrar <b>{formatCurrency(confirm.amount)}</b> por {confirm.plate}. Liquidaciones la revisa y te avisa.</>,
                        confirm: 'Sí, cobrar',
                    }]}
                />
            )}
        </div>
    );
};

export default MisComisiones;
