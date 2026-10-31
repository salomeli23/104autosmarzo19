import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { paymentsAPI } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { Badge } from '../components/ui/badge';
import { PlateBadge } from '../components/PlateBadge';
import { CarAvatar } from '../components/CarAvatar';
import { formatCurrency } from '../lib/utils';
import { toast } from 'sonner';
import { DollarSign, Search, Wallet, Receipt, User, Phone, Filter, Loader2, Mail, ShieldCheck, ShieldAlert, ShieldOff, ArrowRight, Paperclip, X, FileText } from 'lucide-react';
import { PaymentMethodPicker, PaymentMethodLogo, PAYMENT_METHODS, paymentMethodLabel } from '../components/PaymentMethodPicker';

const RECEIPT_MAX_MB = 8;
const readAsDataURL = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
});

const needsRetention = (o) => o?.requires_invoice && !o.retention_applied;

/**
 * El cliente pidió factura y aún no se registra la retención: se pregunta 2 veces.
 * Si aplica → Clientes por facturar para registrarla primero. Si no aplica → se marca "sin retención" y sigue el abono.
 */
const RetentionCheckDialog = ({ order, onClose, onNoRetention, onApply }) => {
    const [answer, setAnswer] = useState(null); // null (1ª pregunta) | 'aplica' | 'no_aplica'
    const [saving, setSaving] = useState(false);

    const confirmNo = async () => {
        setSaving(true);
        try {
            await onNoRetention(order);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open onOpenChange={(v) => !v && !saving && onClose()}>
            <DialogContent data-testid="retention-check-dialog">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldAlert className="w-5 h-5 text-amber-400" />
                        {answer ? 'Confirma otra vez' : 'El cliente solicitó factura'}
                    </DialogTitle>
                    <DialogDescription asChild>
                        <div className="pt-1 flex items-center gap-2 flex-wrap">
                            <PlateBadge plate={order.plate} size="md" />
                            <span className="text-sm">{order.client_name} · Total: <b>{formatCurrency(order.total)}</b></span>
                        </div>
                    </DialogDescription>
                </DialogHeader>
                {!answer && (
                    <div className="space-y-4" data-testid="retention-step-1">
                        <p className="text-sm">
                            Antes de registrar el abono: <b>¿a este cliente se le aplica retención</b> (Reteica / Retefuente)?
                        </p>
                        <div className="grid sm:grid-cols-2 gap-2">
                            <Button variant="outline" onClick={() => setAnswer('no_aplica')} data-testid="retention-no-btn">
                                <ShieldOff className="w-4 h-4 mr-2" /> No aplica retención
                            </Button>
                            <Button onClick={() => setAnswer('aplica')} data-testid="retention-yes-btn">
                                <ShieldCheck className="w-4 h-4 mr-2" /> Sí, aplicar retención
                            </Button>
                        </div>
                    </div>
                )}
                {answer === 'aplica' && (
                    <div className="space-y-4" data-testid="retention-step-2-aplica">
                        <p className="text-sm">
                            ¿Seguro que <b>sí se aplica retención</b>? Primero debes registrarla en <b>Clientes por facturar</b>;
                            al guardarla vuelves aquí para registrar el abono por el saldo con la retención descontada.
                        </p>
                        <div className="grid sm:grid-cols-2 gap-2">
                            <Button variant="outline" onClick={() => setAnswer(null)} data-testid="retention-back-btn">Volver</Button>
                            <Button onClick={() => onApply(order)} data-testid="retention-go-btn">
                                Registrar la retención <ArrowRight className="w-4 h-4 ml-2" />
                            </Button>
                        </div>
                    </div>
                )}
                {answer === 'no_aplica' && (
                    <div className="space-y-4" data-testid="retention-step-2-no">
                        <p className="text-sm">
                            ¿Seguro que <b>no se aplica retención</b>? La factura quedará marcada como &quot;sin retención&quot;
                            y el abono se registra por el valor completo.
                        </p>
                        <div className="grid sm:grid-cols-2 gap-2">
                            <Button variant="outline" onClick={() => setAnswer(null)} disabled={saving} data-testid="retention-back-btn">Volver</Button>
                            <Button onClick={confirmNo} disabled={saving} data-testid="retention-confirm-no-btn">
                                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldOff className="w-4 h-4 mr-2" />}
                                Sí, no aplica · registrar abono
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};

export const Pagos = () => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [retentionCheck, setRetentionCheck] = useState(null);
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState('');
    const [onlyPending, setOnlyPending] = useState(true);
    const [payments, setPayments] = useState([]);
    const [tab, setTab] = useState('orders'); // orders | history

    // Dialog register payment
    const [selected, setSelected] = useState(null);
    const [amount, setAmount] = useState('');
    const [method, setMethod] = useState('efectivo');
    const [reference, setReference] = useState('');
    const [notes, setNotes] = useState('');
    const [receipt, setReceipt] = useState(null); // { dataUrl, name, type }
    const [saving, setSaving] = useState(false);

    const fetchOrders = useCallback(async () => {
        try {
            const res = await paymentsAPI.ordersWithBalance({ q: q.trim() || undefined, only_pending: onlyPending });
            setOrders(res.data);
        } catch (e) {
            toast.error('Error al cargar órdenes');
        } finally {
            setLoading(false);
        }
    }, [q, onlyPending]);

    const fetchHistory = useCallback(async () => {
        try {
            const res = await paymentsAPI.list(q.trim() || undefined);
            setPayments(res.data);
        } catch (e) {
            toast.error('Error al cargar historial de pagos');
        }
    }, [q]);

    useEffect(() => {
        fetchOrders();
        fetchHistory();
    }, [fetchOrders, fetchHistory]);

    const openRegister = (o) => {
        if (needsRetention(o)) {
            setRetentionCheck(o);
            return;
        }
        setSelected(o);
        setAmount(String(o.balance || ''));
        // El método del check-in se propone solo si existe en la lista (p. ej. 'tarjeta' obliga a elegir débito o crédito)
        setMethod(PAYMENT_METHODS.some(m => m.v === o.payment_method) ? o.payment_method : (o.payment_method ? '' : 'efectivo'));
        setReference('');
        setNotes('');
        setReceipt(null);
    };

    const closeRegister = () => setSelected(null);

    const pickReceipt = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
            toast.error('El comprobante debe ser una foto o un PDF');
            return;
        }
        if (file.size > RECEIPT_MAX_MB * 1024 * 1024) {
            toast.error(`El comprobante pesa más de ${RECEIPT_MAX_MB} MB`);
            return;
        }
        try {
            setReceipt({ dataUrl: await readAsDataURL(file), name: file.name, type: file.type });
        } catch {
            toast.error('No se pudo leer el comprobante');
        }
    };

    const openReceipt = async (p) => {
        try {
            const res = await paymentsAPI.receipt(p.id);
            window.open(URL.createObjectURL(res.data), '_blank');
        } catch {
            toast.error('No se pudo abrir el comprobante');
        }
    };

    const markNoRetention = async (o) => {
        try {
            await paymentsAPI.applyRetention(o.id, { no_aplica: true });
            toast.success('Factura marcada sin retención');
            setRetentionCheck(null);
            const res = await paymentsAPI.ordersWithBalance({ q: o.plate });
            const fresh = res.data.find(x => x.id === o.id);
            fetchOrders();
            if (fresh) openRegister(fresh);
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo registrar que no aplica retención');
        }
    };

    const goApplyRetention = (o) => {
        setRetentionCheck(null);
        navigate(`/facturacion-electronica?retencion=${o.id}`);
    };

    // Vuelve de Clientes por facturar con la retención registrada: abrir el abono de esa orden
    useEffect(() => {
        const id = searchParams.get('abono');
        if (!id || loading) return;
        setSearchParams({}, { replace: true });
        const o = orders.find(x => x.id === id);
        if (o && o.balance > 0) openRegister(o);
    }, [orders, loading]); // eslint-disable-line react-hooks/exhaustive-deps

    const submitPayment = async () => {
        const amt = parseFloat(amount);
        if (!amt || amt <= 0) {
            toast.error('Ingrese un monto válido');
            return;
        }
        if (!method) {
            toast.error('Elige el método de pago');
            return;
        }
        setSaving(true);
        try {
            const res = await paymentsAPI.register({
                order_id: selected.id,
                amount: amt,
                method,
                reference: reference || null,
                notes: notes || null,
                receipt: receipt?.dataUrl || null,
                receipt_name: receipt?.name || null,
            });
            const b = res.data;
            toast.success(
                b.balance <= 0.01
                    ? `Pago registrado · Saldo saldado${b.email_sent ? ' · Email enviado' : ''}`
                    : `Pago registrado · Saldo pendiente: ${formatCurrency(b.balance)}`
            );
            closeRegister();
            fetchOrders();
            fetchHistory();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Error al registrar pago');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6" data-testid="pagos-page">
            <div>
                <h1 className="font-heading text-3xl md:text-4xl">Pagos</h1>
                <p className="text-muted-foreground">Registra abonos totales o parciales y consulta el historial.</p>
            </div>

            {/* Toggle tabs */}
            <div className="flex gap-2">
                <Button
                    variant={tab === 'orders' ? 'default' : 'outline'}
                    onClick={() => setTab('orders')}
                    data-testid="tab-orders-btn"
                >
                    <Wallet className="w-4 h-4 mr-2" /> Órdenes
                </Button>
                <Button
                    variant={tab === 'history' ? 'default' : 'outline'}
                    onClick={() => setTab('history')}
                    data-testid="tab-history-btn"
                >
                    <Receipt className="w-4 h-4 mr-2" /> Historial
                </Button>
            </div>

            {/* Search bar */}
            <Card>
                <CardContent className="p-4 flex flex-col md:flex-row gap-3 items-end">
                    <div className="flex-1 w-full">
                        <Label>Buscar por placa, cédula, cliente u orden</Label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                            <Input
                                value={q}
                                onChange={(e) => setQ(e.target.value)}
                                placeholder="ABC123, 1023456789, Carlos..."
                                className="pl-9"
                                data-testid="pagos-search-input"
                            />
                        </div>
                    </div>
                    {tab === 'orders' && (
                        <Button
                            variant={onlyPending ? 'default' : 'outline'}
                            onClick={() => setOnlyPending(!onlyPending)}
                            data-testid="filter-pending-btn"
                        >
                            <Filter className="w-4 h-4 mr-2" />
                            {onlyPending ? 'Solo pendientes' : 'Todos'}
                        </Button>
                    )}
                    <Button onClick={() => { fetchOrders(); fetchHistory(); }} data-testid="pagos-refresh-btn">
                        Actualizar
                    </Button>
                </CardContent>
            </Card>

            {tab === 'orders' && (
                loading ? (
                    <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin" /></div>
                ) : orders.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">Sin órdenes.</p>
                ) : (
                    <div className="grid gap-3">
                        {orders.map((o) => (
                            <Card key={o.id} className="card-hover" data-testid={`order-row-${o.id}`}>
                                <CardContent className="p-4 flex flex-col md:flex-row gap-4 items-start md:items-center">
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        <CarAvatar photoUrl={o.profile_photo_url} size={44} />
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <PlateBadge plate={o.plate} size="md" />
                                                {o.requires_invoice && (
                                                    <Badge className="bg-purple-500/20 text-purple-500 border-purple-500/40">Factura E.</Badge>
                                                )}
                                                {needsRetention(o) && (
                                                    <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/40" data-testid={`retention-pending-${o.id}`}>
                                                        <ShieldAlert className="w-3 h-3 mr-1" /> Retención por definir
                                                    </Badge>
                                                )}
                                                {o.retention > 0 && (
                                                    <Badge className="bg-cyan-500/15 text-cyan-400 border-cyan-500/40" data-testid={`retention-badge-${o.id}`}>
                                                        <ShieldCheck className="w-3 h-3 mr-1" /> Retención {formatCurrency(o.retention)}
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="text-sm mt-1 truncate">{o.brand} {o.model}</p>
                                            <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                                                <User className="w-3 h-3" /> {o.client_name} · <Phone className="w-3 h-3" /> {o.client_phone}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2 text-right text-sm" title={o.retention > 0 ? `Saldo = total − retención (${formatCurrency(o.retention)}) − abonado` : undefined}>
                                        <div>
                                            <p className="text-[10px] uppercase text-muted-foreground">Total</p>
                                            <p className="font-mono">{formatCurrency(o.total)}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] uppercase text-muted-foreground">Abonado</p>
                                            <p className="font-mono text-green-500">{formatCurrency(o.paid)}</p>
                                        </div>
                                        <div>
                                            <p className="text-[10px] uppercase text-muted-foreground">Saldo</p>
                                            <p className={`font-mono font-bold ${o.balance > 0 ? 'text-red-500' : 'text-green-500'}`} data-testid={`order-balance-${o.id}`}>
                                                {formatCurrency(o.balance)}
                                            </p>
                                        </div>
                                    </div>
                                    <Button
                                        onClick={() => openRegister(o)}
                                        disabled={o.balance <= 0}
                                        data-testid={`pay-btn-${o.id}`}
                                    >
                                        <DollarSign className="w-4 h-4 mr-2" />
                                        Registrar abono
                                    </Button>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )
            )}

            {tab === 'history' && (
                payments.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">Sin movimientos.</p>
                ) : (
                    <div className="grid gap-3">
                        {payments.map((p) => (
                            <Card key={p.id} data-testid={`payment-row-${p.id}`}>
                                <CardContent className="p-4 flex flex-col md:flex-row gap-3 items-start md:items-center">
                                    <PlateBadge plate={p.plate} size="md" />
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium truncate">{p.client_name}</p>
                                        <p className="text-xs text-muted-foreground truncate">
                                            {p.order_code} · {new Date(p.created_at).toLocaleString()} · {paymentMethodLabel(p.method)}
                                            {p.reference ? ` · ${p.reference}` : ''}
                                        </p>
                                    </div>
                                    <PaymentMethodLogo method={p.method} />
                                    {p.has_receipt && (
                                        <Button variant="outline" size="sm" onClick={() => openReceipt(p)} data-testid={`receipt-btn-${p.id}`}>
                                            <Paperclip className="w-3.5 h-3.5 mr-1" /> Comprobante
                                        </Button>
                                    )}
                                    <div className="text-right">
                                        <p className="font-mono font-bold text-green-500">{formatCurrency(p.amount)}</p>
                                        <p className="text-[10px] text-muted-foreground">{p.created_by_name}</p>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                )
            )}

            {retentionCheck && (
                <RetentionCheckDialog
                    key={retentionCheck.id}
                    order={retentionCheck}
                    onClose={() => setRetentionCheck(null)}
                    onNoRetention={markNoRetention}
                    onApply={goApplyRetention}
                />
            )}

            {/* Register payment dialog */}
            <Dialog open={!!selected} onOpenChange={(v) => !v && closeRegister()}>
                <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Registrar abono</DialogTitle>
                        <DialogDescription asChild>
                            {selected ? (
                                <div className="pt-1 flex items-center gap-2 flex-wrap">
                                    <PlateBadge plate={selected.plate} size="md" />
                                    <span className="text-sm">
                                        {selected.client_name} · Saldo: <b className="text-red-500">{formatCurrency(selected.balance)}</b>
                                        {selected.retention > 0 && <> · <span className="text-cyan-400">retención {formatCurrency(selected.retention)} descontada</span></>}
                                    </span>
                                </div>
                            ) : <span />}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div>
                            <Label>Monto *</Label>
                            <Input
                                type="number"
                                inputMode="decimal"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                data-testid="pay-amount-input"
                            />
                        </div>
                        <div className="space-y-1">
                            <Label>Método *</Label>
                            <PaymentMethodPicker value={method} onChange={setMethod} />
                        </div>
                        <div className="space-y-1">
                            <Label>Comprobante {method && method !== 'efectivo' ? '(recomendado)' : '(opcional)'}</Label>
                            {receipt ? (
                                <div className="flex items-center gap-3 p-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5" data-testid="pay-receipt-preview">
                                    {receipt.type === 'application/pdf'
                                        ? <FileText className="w-10 h-10 text-red-400 shrink-0" />
                                        : <img src={receipt.dataUrl} alt="Comprobante" className="w-12 h-12 object-cover rounded" />}
                                    <span className="flex-1 min-w-0 text-sm truncate">{receipt.name}</span>
                                    <Button type="button" variant="ghost" size="icon" onClick={() => setReceipt(null)} aria-label="Quitar comprobante">
                                        <X className="w-4 h-4" />
                                    </Button>
                                </div>
                            ) : (
                                <label className="flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-border hover:bg-muted/40 cursor-pointer text-sm text-muted-foreground">
                                    <Paperclip className="w-4 h-4" /> Adjuntar comprobante (foto o PDF)
                                    <input type="file" accept="image/*,application/pdf" className="hidden" onChange={pickReceipt} data-testid="pay-receipt-input" />
                                </label>
                            )}
                        </div>
                        <div>
                            <Label>Referencia (opcional)</Label>
                            <Input value={reference} onChange={(e) => setReference(e.target.value)} data-testid="pay-ref-input" />
                        </div>
                        <div>
                            <Label>Notas</Label>
                            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} data-testid="pay-notes-input" />
                        </div>
                        {selected?.client_email && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                                <Mail className="w-3 h-3" /> Se enviará el estado de cuenta a {selected.client_email}
                            </p>
                        )}
                        <Button onClick={submitPayment} disabled={saving} className="w-full" data-testid="confirm-pay-btn">
                            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <DollarSign className="w-4 h-4 mr-2" />}
                            Confirmar abono
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default Pagos;
