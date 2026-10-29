import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { technicianChargesAPI } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { PlateBadge } from '../components/PlateBadge';
import { CarAvatar } from '../components/CarAvatar';
import { QualityTag, QualityComments } from '../components/QualityTag';
import { ChargeBadge } from '../components/TechnicianHistory';
import { formatCurrency } from '../lib/utils';
import { toast } from 'sonner';
import { HandCoins, Loader2, CheckCircle, XCircle, Wallet, RefreshCw, User, AlertTriangle } from 'lucide-react';

const TABS = [
    { value: 'pendiente', label: 'Por revisar' },
    { value: 'aprobado', label: 'Por pagar' },
    { value: 'pagado', label: 'Pagados' },
    { value: 'rechazado', label: 'Rechazados' },
];

const digits = (v) => String(v || '').replace(/\D/g, '');
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('es-CO') : '-');

/** Acción sobre un cobro: aprobar (con valor editable), rechazar o pagar */
const ActionDialog = ({ action, onClose, onDone }) => {
    const { type, charge } = action;
    const [amount, setAmount] = useState(String(Math.round(charge.amount || 0)));
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const value = Number(digits(amount) || 0);

    const meta = {
        approve: { title: 'Aprobar cobro', icon: CheckCircle, button: 'Aprobar cobro' },
        reject: { title: 'Rechazar cobro', icon: XCircle, button: 'Rechazar cobro' },
        pay: { title: 'Marcar como pagado', icon: Wallet, button: 'Confirmar pago' },
    }[type];

    const save = async () => {
        setSaving(true);
        try {
            if (type === 'pay') await technicianChargesAPI.pay(charge.id, { reference: notes.trim() || null });
            else await technicianChargesAPI.review(charge.id, {
                approved: type === 'approve',
                amount: type === 'approve' ? value : null,
                notes: notes.trim() || null,
            });
            toast.success(type === 'approve' ? 'Cobro aprobado' : type === 'reject' ? 'Cobro rechazado' : 'Cobro pagado');
            onDone();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo guardar');
        } finally {
            setSaving(false);
        }
    };

    const Icon = meta.icon;
    const disabled = saving || (type === 'approve' && value <= 0) || (type === 'reject' && !notes.trim());
    return (
        <Dialog open onOpenChange={(v) => !v && onClose()}>
            <DialogContent data-testid={`liq-dialog-${type}`}>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><Icon className="w-5 h-5" /> {meta.title}</DialogTitle>
                    <DialogDescription>
                        {charge.technician_name} · {charge.plate} · solicitó {formatCurrency(charge.amount)}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                    {type === 'approve' && (
                        <div className="space-y-2">
                            <Label htmlFor="liq-amount">Valor aprobado</Label>
                            <Input id="liq-amount" inputMode="numeric" className="text-lg font-mono"
                                value={value ? `$ ${value.toLocaleString('es-CO')}` : ''}
                                onChange={(e) => setAmount(digits(e.target.value))} data-testid="liq-amount" />
                        </div>
                    )}
                    <div className="space-y-2">
                        <Label htmlFor="liq-notes">
                            {type === 'reject' ? 'Motivo del rechazo *' : type === 'pay' ? 'Referencia del pago (opcional)' : 'Nota para el técnico (opcional)'}
                        </Label>
                        {type === 'pay' ? (
                            <Input id="liq-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: transferencia 123456" data-testid="liq-notes" />
                        ) : (
                            <Textarea id="liq-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} data-testid="liq-notes" />
                        )}
                    </div>
                    <Button className="w-full" variant={type === 'reject' ? 'destructive' : 'default'} onClick={save} disabled={disabled} data-testid="liq-confirm">
                        {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Icon className="w-4 h-4 mr-2" />}
                        {meta.button}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

const ChargeCard = ({ c, onAction }) => (
    <Card className={c.quality_status === 'rechazado' ? 'border-red-500/40' : ''} data-testid={`liq-card-${c.id}`}>
        <CardContent className="p-4 space-y-3">
            <div className="flex items-start gap-3">
                <CarAvatar photoUrl={c.profile_photo_url} size={40} />
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <PlateBadge plate={c.plate} size="sm" />
                        <QualityTag status={c.quality_status} rating={c.quality_rating} testId={`liq-quality-${c.id}`} />
                        <ChargeBadge charge={c} />
                    </div>
                    <p className="text-sm mt-1 flex items-center gap-1"><User className="w-3.5 h-3.5" /> {c.technician_name} · técnico {c.technician_role}</p>
                    <p className="text-xs text-muted-foreground">{c.brand} {c.model} · {c.client_name} · orden {c.order_code}</p>
                    <p className="text-xs text-muted-foreground">Terminado {fmt(c.service_completed_at)} · cobro enviado {fmt(c.created_at)}</p>
                </div>
                <div className="text-right shrink-0">
                    <p className="text-[10px] uppercase text-muted-foreground">Solicitado</p>
                    <p className="font-mono font-bold">{formatCurrency(c.amount)}</p>
                    {c.approved_amount != null && c.approved_amount !== c.amount && (
                        <p className="text-xs font-mono text-sky-400">Aprobado {formatCurrency(c.approved_amount)}</p>
                    )}
                </div>
            </div>
            <div className="flex flex-wrap gap-1">
                {(c.services || []).map(s => <span key={s} className="text-xs px-2 py-0.5 rounded bg-muted/60">{s}</span>)}
            </div>
            {c.notes && <p className="text-xs"><b>Nota del técnico:</b> {c.notes}</p>}
            {c.status === 'pendiente' && c.quality_status !== 'aprobado' && (
                <p className="text-xs flex items-center gap-1 text-amber-400">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {c.quality_status === 'pendiente' ? 'Calidad aún no revisa este vehículo' : c.quality_status === 'rechazado' ? 'Calidad devolvió este vehículo' : 'Servicio sin revisión de calidad'}
                </p>
            )}
            <QualityComments reviews={c.quality_reviews} fallbackNotes={c.quality_notes} />
            {c.review_notes && <p className="text-xs text-muted-foreground">Revisión ({c.reviewed_by_name}): {c.review_notes}</p>}
            {c.status === 'pagado' && (
                <p className="text-xs text-emerald-400">Pagado {fmt(c.paid_at)} por {c.paid_by_name}{c.payment_reference ? ` · ${c.payment_reference}` : ''}</p>
            )}
            <div className="flex gap-2 justify-end flex-wrap">
                {c.status === 'pendiente' && (
                    <>
                        <Button size="sm" variant="outline" className="border-red-500/50 text-red-400" onClick={() => onAction({ type: 'reject', charge: c })} data-testid={`liq-reject-${c.id}`}>
                            <XCircle className="w-4 h-4 mr-1.5" /> Rechazar
                        </Button>
                        <Button size="sm" onClick={() => onAction({ type: 'approve', charge: c })} data-testid={`liq-approve-${c.id}`}>
                            <CheckCircle className="w-4 h-4 mr-1.5" /> Aprobar
                        </Button>
                    </>
                )}
                {c.status === 'aprobado' && (
                    <Button size="sm" onClick={() => onAction({ type: 'pay', charge: c })} data-testid={`liq-pay-${c.id}`}>
                        <Wallet className="w-4 h-4 mr-1.5" /> Marcar pagado
                    </Button>
                )}
            </div>
        </CardContent>
    </Card>
);

export const Liquidaciones = () => {
    const [charges, setCharges] = useState([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState('pendiente');
    const [action, setAction] = useState(null);

    const load = useCallback(async () => {
        try {
            const { data } = await technicianChargesAPI.list();
            setCharges(data);
        } catch (e) {
            toast.error('Error al cargar los cobros de técnicos');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        const t = setInterval(load, 30000);
        return () => clearInterval(t);
    }, [load]);

    const counts = useMemo(() => Object.fromEntries(TABS.map(t => [t.value, charges.filter(c => c.status === t.value).length])), [charges]);
    const visible = charges.filter(c => c.status === tab);

    // Por pagar, agrupado por técnico
    const toPay = useMemo(() => {
        const map = {};
        charges.filter(c => c.status === 'aprobado').forEach(c => {
            map[c.technician_name] = (map[c.technician_name] || 0) + (c.approved_amount || 0);
        });
        return Object.entries(map).sort((a, b) => b[1] - a[1]);
    }, [charges]);

    return (
        <div className="space-y-6" data-testid="liquidaciones-page">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="font-heading text-3xl md:text-4xl flex items-center gap-2"><HandCoins className="w-8 h-8 text-emerald-400" /> Liquidaciones</h1>
                    <p className="text-muted-foreground">Cobros que envían los técnicos por cada servicio terminado. Revisa la calidad, aprueba el valor y registra el pago.</p>
                </div>
                <Button variant="outline" onClick={load}><RefreshCw className="w-4 h-4 mr-2" /> Actualizar</Button>
            </div>

            {toPay.length > 0 && (
                <Card>
                    <CardContent className="p-4">
                        <p className="text-sm font-medium mb-2">Por pagar a cada técnico</p>
                        <div className="flex flex-wrap gap-2" data-testid="liq-to-pay">
                            {toPay.map(([name, total]) => (
                                <Badge key={name} variant="outline" className="text-sm py-1">{name}: <span className="font-mono ml-1 text-sky-400">{formatCurrency(total)}</span></Badge>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="flex flex-wrap h-auto">
                    {TABS.map(t => (
                        <TabsTrigger key={t.value} value={t.value} data-testid={`liq-tab-${t.value}`}>
                            {t.label} {counts[t.value] > 0 && <Badge className="ml-1.5 h-5 px-1.5 text-[10px]" variant="outline">{counts[t.value]}</Badge>}
                        </TabsTrigger>
                    ))}
                </TabsList>
            </Tabs>

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin" /></div>
            ) : visible.length === 0 ? (
                <p className="text-center py-12 text-muted-foreground text-sm">Sin cobros en esta sección.</p>
            ) : (
                <div className="grid gap-3 2xl:grid-cols-2">
                    {visible.map(c => <ChargeCard key={c.id} c={c} onAction={setAction} />)}
                </div>
            )}

            {action && <ActionDialog action={action} onClose={() => setAction(null)} onDone={() => { setAction(null); load(); }} />}
        </div>
    );
};

export default Liquidaciones;
