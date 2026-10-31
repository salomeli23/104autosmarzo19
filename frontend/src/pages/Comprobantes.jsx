import React, { useCallback, useEffect, useState } from 'react';
import { paymentsAPI } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { PlateBadge } from '../components/PlateBadge';
import { PaymentMethodLogo, PAYMENT_METHODS, paymentMethodLabel } from '../components/PaymentMethodPicker';
import { formatCurrency } from '../lib/utils';
import { toast } from 'sonner';
import { FileCheck2, Loader2, Search, Paperclip, CheckCircle2, XCircle, RotateCcw, FileText, Clock } from 'lucide-react';

const STATUS = {
    pendiente: { label: 'Por revisar', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/40', icon: Clock },
    confirmado: { label: 'Confirmado', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40', icon: CheckCircle2 },
    rechazado: { label: 'Rechazado', cls: 'bg-red-500/15 text-red-400 border-red-500/40', icon: XCircle },
};
const TABS = [['pendiente', 'Por revisar'], ['confirmado', 'Confirmados'], ['rechazado', 'Rechazados'], ['', 'Todos']];

const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const today = () => iso(new Date());
const monthStart = () => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); };
const selectClass = 'h-9 rounded-md border border-input bg-background px-2 text-sm';

const StatusBadge = ({ status }) => {
    const st = STATUS[status] || STATUS.pendiente;
    const Icon = st.icon;
    return <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${st.cls}`}><Icon className="w-3 h-3" />{st.label}</span>;
};

/** Gerencia: todos los pagos registrados para revisar y confirmar sus comprobantes */
export const Comprobantes = () => {
    const [status, setStatus] = useState('pendiente');
    const [from, setFrom] = useState(monthStart());
    const [to, setTo] = useState(today());
    const [method, setMethod] = useState('');
    const [q, setQ] = useState('');
    const [data, setData] = useState(null);
    const [viewer, setViewer] = useState(null); // { payment, url, type }
    const [reject, setReject] = useState(null); // payment
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await paymentsAPI.reviewList({
                status: status || undefined, date_from: from || undefined, date_to: to || undefined,
                method: method || undefined, q: q.trim() || undefined,
            });
            setData(res.data);
        } catch (e) {
            setData({ items: [], counts: {} });
            toast.error(e.response?.data?.detail || 'No se pudieron cargar los pagos');
        }
    }, [status, from, to, method, q]);

    useEffect(() => { load(); }, [load]);

    const openReceipt = async (p) => {
        try {
            const res = await paymentsAPI.receipt(p.id);
            setViewer({ payment: p, url: URL.createObjectURL(res.data), type: res.data.type });
        } catch {
            toast.error('No se pudo abrir el comprobante');
        }
    };
    const closeViewer = () => {
        if (viewer?.url) URL.revokeObjectURL(viewer.url);
        setViewer(null);
    };

    const act = async (p, action, reason) => {
        setBusy(true);
        try {
            await paymentsAPI.review(p.id, { action, note: reason || null });
            toast.success(action === 'confirmar' ? `Comprobante de ${p.plate} confirmado`
                : action === 'rechazar' ? `Comprobante de ${p.plate} rechazado · se avisó a ${p.created_by_name || 'quien lo registró'}`
                    : 'Pago devuelto a "Por revisar"');
            setReject(null);
            setNote('');
            closeViewer();
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo guardar la revisión');
        } finally {
            setBusy(false);
        }
    };

    const counts = data?.counts || {};
    const items = data?.items || [];

    const Actions = ({ p }) => (p.review_status || 'pendiente') === 'pendiente' ? (
        <div className="flex gap-2">
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" disabled={busy} onClick={() => act(p, 'confirmar')} data-testid={`review-confirm-${p.id}`}>
                <CheckCircle2 className="w-4 h-4 mr-1" /> Confirmar
            </Button>
            <Button size="sm" variant="outline" className="text-red-400 border-red-500/40" disabled={busy} onClick={() => { setReject(p); setNote(''); }} data-testid={`review-reject-${p.id}`}>
                <XCircle className="w-4 h-4 mr-1" /> Rechazar
            </Button>
        </div>
    ) : (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(p, 'reabrir')} data-testid={`review-reopen-${p.id}`}>
            <RotateCcw className="w-4 h-4 mr-1" /> Volver a revisar
        </Button>
    );

    return (
        <div className="space-y-6" data-testid="comprobantes-page">
            <div>
                <h1 className="font-heading text-3xl md:text-4xl flex items-center gap-2"><FileCheck2 className="w-8 h-8 text-primary" /> Comprobantes</h1>
                <p className="text-muted-foreground">Pagos › Todos los pagos registrados: revisa el comprobante y confírmalo o recházalo.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {['pendiente', 'confirmado', 'rechazado'].map(st => (
                    <button key={st} type="button" onClick={() => setStatus(st)}
                        className={`text-left rounded-xl border p-4 transition-colors ${status === st ? 'ring-1 ring-primary border-primary' : 'border-border hover:bg-muted/40'}`}
                        data-testid={`review-count-${st}`}>
                        <StatusBadge status={st} />
                        <p className="text-2xl font-bold mt-2">{counts[st]?.count ?? 0}</p>
                        <p className="text-sm text-muted-foreground font-mono">{formatCurrency(counts[st]?.amount || 0)}</p>
                    </button>
                ))}
            </div>

            <Card>
                <CardContent className="p-4 space-y-3">
                    <div className="flex gap-1 flex-wrap">
                        {TABS.map(([v, l]) => (
                            <Button key={l} size="sm" variant={status === v ? 'default' : 'outline'} onClick={() => setStatus(v)} data-testid={`review-tab-${v || 'todos'}`}>{l}</Button>
                        ))}
                    </div>
                    <div className="flex gap-3 flex-wrap items-end">
                        <div className="space-y-1">
                            <Label className="text-xs">Desde</Label>
                            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Hasta</Label>
                            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
                        </div>
                        <div className="space-y-1">
                            <Label className="text-xs">Método</Label>
                            <select value={method} onChange={(e) => setMethod(e.target.value)} className={selectClass} data-testid="review-method-filter">
                                <option value="">Todos</option>
                                {PAYMENT_METHODS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
                            </select>
                        </div>
                        <div className="space-y-1 flex-1 min-w-[200px]">
                            <Label className="text-xs">Buscar</Label>
                            <div className="relative">
                                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Placa, cliente, orden o referencia" className="pl-8" />
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {!data ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin" /></div>
            ) : items.length === 0 ? (
                <p className="text-center py-12 text-muted-foreground text-sm">No hay pagos con estos filtros.</p>
            ) : (
                <div className="grid gap-3">
                    {items.map(p => (
                        <Card key={p.id} data-testid={`review-row-${p.id}`}>
                            <CardContent className="p-4 flex flex-col xl:flex-row gap-3 xl:items-center">
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <PaymentMethodLogo method={p.method} />
                                    <PlateBadge plate={p.plate} size="md" />
                                    <div className="min-w-0">
                                        <p className="font-medium truncate">{p.client_name}</p>
                                        <p className="text-xs text-muted-foreground truncate">
                                            {p.order_code} · {new Date(p.created_at).toLocaleString()} · {paymentMethodLabel(p.method)}
                                            {p.reference ? ` · Ref. ${p.reference}` : ''}
                                        </p>
                                        <p className="text-xs text-muted-foreground truncate">Registró: {p.created_by_name || '—'}{p.notes ? ` · ${p.notes}` : ''}</p>
                                        {p.reviewed_by_name && (
                                            <p className="text-xs truncate">
                                                <StatusBadge status={p.review_status} /> <span className="text-muted-foreground">por {p.reviewed_by_name}{p.review_note ? `: ${p.review_note}` : ''}</span>
                                            </p>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 flex-wrap xl:justify-end">
                                    <p className="font-mono font-bold text-green-500 text-lg">{formatCurrency(p.amount)}</p>
                                    {p.has_receipt ? (
                                        <Button size="sm" variant="outline" onClick={() => openReceipt(p)} data-testid={`review-view-${p.id}`}>
                                            <Paperclip className="w-4 h-4 mr-1" /> Ver comprobante
                                        </Button>
                                    ) : (
                                        <span className="text-xs text-muted-foreground italic">Sin comprobante</span>
                                    )}
                                    {!p.reviewed_by_name && <StatusBadge status={p.review_status} />}
                                    <Actions p={p} />
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Ver el comprobante y decidir desde ahí */}
            <Dialog open={!!viewer} onOpenChange={(v) => !v && closeViewer()}>
                <DialogContent className="max-w-3xl max-h-[94vh] overflow-y-auto" data-testid="receipt-viewer">
                    {viewer && (
                        <>
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2"><PaymentMethodLogo method={viewer.payment.method} /> Comprobante · {viewer.payment.plate}</DialogTitle>
                                <DialogDescription>
                                    {viewer.payment.client_name} · <b className="text-green-500">{formatCurrency(viewer.payment.amount)}</b> · {paymentMethodLabel(viewer.payment.method)}
                                    {viewer.payment.reference ? ` · Ref. ${viewer.payment.reference}` : ''} · {new Date(viewer.payment.created_at).toLocaleString()}
                                </DialogDescription>
                            </DialogHeader>
                            {viewer.type === 'application/pdf' ? (
                                <div className="space-y-2">
                                    <iframe title="Comprobante PDF" src={viewer.url} className="w-full h-[60vh] rounded border" />
                                    <a href={viewer.url} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center gap-1"><FileText className="w-3 h-3" /> Abrir PDF en otra pestaña</a>
                                </div>
                            ) : (
                                <img src={viewer.url} alt="Comprobante" className="w-full max-h-[65vh] object-contain rounded border bg-black/30" />
                            )}
                            <DialogFooter className="gap-2">
                                <StatusBadge status={viewer.payment.review_status} />
                                <span className="flex-1" />
                                <Actions p={viewer.payment} />
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {/* Rechazo con motivo: se avisa a quien registró el pago */}
            <Dialog open={!!reject} onOpenChange={(v) => !v && !busy && setReject(null)}>
                <DialogContent data-testid="reject-dialog">
                    <DialogHeader>
                        <DialogTitle>Rechazar comprobante</DialogTitle>
                        <DialogDescription>
                            {reject && <>{reject.plate} · {formatCurrency(reject.amount)} · {paymentMethodLabel(reject.method)}. Se le avisará a {reject.created_by_name || 'quien registró el pago'}.</>}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1">
                        <Label>Motivo *</Label>
                        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Ej: el valor del comprobante no coincide, no se ve la referencia…" data-testid="reject-note" />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setReject(null)} disabled={busy}>Cancelar</Button>
                        <Button className="bg-red-600 hover:bg-red-700" disabled={busy || !note.trim()} onClick={() => act(reject, 'rechazar', note.trim())} data-testid="reject-confirm">
                            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <XCircle className="w-4 h-4 mr-2" />} Rechazar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default Comprobantes;
