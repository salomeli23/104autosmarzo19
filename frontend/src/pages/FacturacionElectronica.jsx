import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { paymentsAPI, discountCodesAPI } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { PlateBadge } from '../components/PlateBadge';
import { OrderPreviewDialog } from '../components/OrderPreviewDialog';
import { formatCurrency } from '../lib/utils';
import { toast } from 'sonner';
import {
    FileText, Mail, Loader2, User, Phone, CheckCircle2,
    Receipt, MapPin, Percent, IdCard, ShieldCheck, Search,
    Download, MailPlus, Edit3, Tag, Lock, Plus, Trash2, Calendar, Power, Eye,
} from 'lucide-react';

const RETEICA_PRESETS = [6.9, 11.4]; // por mil (‰): 6,9/1000
const RETEFUENTE_RATE = 2.5;
const RETEFUENTE_MIN_TOTAL = 524000; // Retefuente 2.5% solo si la base (sin IVA) > $524.000
// Las retenciones se liquidan sobre la base gravable (antes de IVA)
const retentionBase = (o) => o?.retention_base ?? o?.total ?? 0;
const reteicaLabel = (r) => (r.reteica_unit === 'por_mil' ? `${r.reteica_rate}/1000` : `${r.reteica_rate}%`);

export const FacturacionElectronica = () => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    // Viene de Pagos: registrar la retención de esta orden y luego volver a registrar el abono
    const [fromPayment, setFromPayment] = useState(searchParams.get('retencion'));
    const [tab, setTab] = useState('pendientes');
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(null);
    const [emailOverride, setEmailOverride] = useState({});

    // Retention dialog
    const [retentionOrder, setRetentionOrder] = useState(null);
    const [rCity, setRCity] = useState('Bogotá');
    const [rNoAplica, setRNoAplica] = useState(false);
    const [rApplyReteica, setRApplyReteica] = useState(true);
    const [rReteicaRate, setRReteicaRate] = useState(String(RETEICA_PRESETS[0]));
    const [rApplyRetefuente, setRApplyRetefuente] = useState(false);
    const [rRetefuenteRate, setRRetefuenteRate] = useState('2.5');
    const [rUpdateIdentity, setRUpdateIdentity] = useState(false);
    const [rNewCedula, setRNewCedula] = useState('');
    const [rNewRazonSocial, setRNewRazonSocial] = useState('');
    const [savingRet, setSavingRet] = useState(false);
    const [previewOrderId, setPreviewOrderId] = useState(null);

    // Impuestos tab
    const [retentions, setRetentions] = useState([]);
    const [retSummary, setRetSummary] = useState({ count: 0, total_reteica: 0, total_retefuente: 0, total_retention: 0 });
    const [retQ, setRetQ] = useState('');

    // ====== Códigos de descuento (admin, protegido por william123) ======
    const [discAuthed, setDiscAuthed] = useState(false);
    const [discPasswordInput, setDiscPasswordInput] = useState('');
    const [discVerifying, setDiscVerifying] = useState(false);
    const [discCodes, setDiscCodes] = useState([]);
    const [discLoading, setDiscLoading] = useState(false);
    // Dialog de crear
    const [showDiscCreate, setShowDiscCreate] = useState(false);
    const [dcCode, setDcCode] = useState('');
    const [dcType, setDcType] = useState('percentage');
    const [dcValue, setDcValue] = useState('');
    const [dcExpires, setDcExpires] = useState('');
    const [dcNotes, setDcNotes] = useState('');
    const [dcSaving, setDcSaving] = useState(false);

    const load = useCallback(async () => {
        try {
            const res = await paymentsAPI.pendingInvoice(true); // include sent
            setOrders(res.data);
        } catch (e) {
            toast.error('Error al cargar clientes por facturar');
        } finally {
            setLoading(false);
        }
    }, []);

    const loadRetentions = useCallback(async () => {
        try {
            const res = await paymentsAPI.listRetentions(retQ.trim() || undefined);
            setRetentions(res.data.items || []);
            setRetSummary(res.data.summary || {});
        } catch (e) {
            toast.error('Error al cargar retenciones');
        }
    }, [retQ]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        const id = searchParams.get('retencion');
        if (!id || loading) return;
        const o = orders.find(x => x.id === id);
        setSearchParams({}, { replace: true });
        if (o) {
            setTab('pendientes');
            openRetention(o);
        } else {
            setFromPayment(null);
            toast.error('No se encontró la orden en Clientes por facturar');
        }
    }, [orders, loading]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { if (tab === 'impuestos') loadRetentions(); }, [tab, loadRetentions]);

    // ====== Discount codes: funciones ======
    const loadDiscCodes = useCallback(async () => {
        setDiscLoading(true);
        try {
            const res = await discountCodesAPI.list(true);
            setDiscCodes(res.data || []);
        } catch (e) {
            toast.error('Error al cargar códigos de descuento');
        } finally {
            setDiscLoading(false);
        }
    }, []);

    useEffect(() => {
        if (tab === 'descuentos' && discAuthed) {
            loadDiscCodes();
        }
    }, [tab, discAuthed, loadDiscCodes]);

    const handleDiscAdminVerify = async () => {
        if (!discPasswordInput) {
            toast.error('Ingresa la contraseña de administración');
            return;
        }
        setDiscVerifying(true);
        try {
            await discountCodesAPI.verifyAdmin(discPasswordInput);
            setDiscAuthed(true);
            toast.success('Acceso autorizado');
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Contraseña inválida');
            setDiscAuthed(false);
        } finally {
            setDiscVerifying(false);
        }
    };

    const resetDiscCreate = () => {
        setDcCode('');
        setDcType('percentage');
        setDcValue('');
        setDcExpires('');
        setDcNotes('');
    };

    const handleCreateDiscount = async () => {
        if (!dcCode.trim()) { toast.error('Código requerido'); return; }
        if (!dcValue || parseFloat(dcValue) <= 0) { toast.error('Valor debe ser > 0'); return; }
        if (dcType === 'percentage' && parseFloat(dcValue) > 100) { toast.error('El porcentaje no puede ser mayor a 100'); return; }
        setDcSaving(true);
        try {
            await discountCodesAPI.create({
                code: dcCode.trim().toUpperCase(),
                discount_type: dcType,
                discount_value: parseFloat(dcValue),
                expires_at: dcExpires || null,
                active: true,
                notes: dcNotes || null,
                admin_password: discPasswordInput,
            });
            toast.success('Código creado');
            setShowDiscCreate(false);
            resetDiscCreate();
            loadDiscCodes();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Error al crear código');
        } finally {
            setDcSaving(false);
        }
    };

    const handleToggleDiscount = async (code) => {
        try {
            await discountCodesAPI.update(code.id, { active: !code.active, admin_password: discPasswordInput });
            toast.success(code.active ? 'Código desactivado' : 'Código activado');
            loadDiscCodes();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Error al actualizar');
        }
    };

    const handleDeleteDiscount = async (code) => {
        if (!window.confirm(`¿Eliminar código ${code.code}? Esta acción no se puede deshacer.`)) return;
        try {
            await discountCodesAPI.delete(code.id, discPasswordInput);
            toast.success('Código eliminado');
            loadDiscCodes();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Error al eliminar');
        }
    };

    const openRetention = (o) => {
        setRetentionOrder(o);
        setRCity('Bogotá');
        setRNoAplica(false);
        setRApplyReteica(true);
        setRReteicaRate(String(RETEICA_PRESETS[0]));
        setRApplyRetefuente(retentionBase(o) > RETEFUENTE_MIN_TOTAL);
        setRRetefuenteRate(String(RETEFUENTE_RATE));
        setRUpdateIdentity(false);
        setRNewCedula(o.client_cedula || '');
        setRNewRazonSocial(o.client_razon_social || '');
    };

    const closeRetention = () => setRetentionOrder(null);

    const isBogota = (c) => (c || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes('bogota');

    const computeRet = () => {
        const total = retentionOrder?.total || 0;
        const base = retentionBase(retentionOrder);
        const iva = total - base;
        if (rNoAplica) return { base, iva, total, reteica: 0, retefuente: 0, total_ret: 0, after: total };
        const reteica = rApplyReteica ? Math.round(base * (parseFloat(rReteicaRate) || 0) / 1000) : 0;
        const retefuente = rApplyRetefuente ? Math.round(base * (parseFloat(rRetefuenteRate) || 0) / 100) : 0;
        const total_ret = reteica + retefuente;
        return { base, iva, total, reteica, retefuente, total_ret, after: total - total_ret };
    };

    const submitRetention = async () => {
        setSavingRet(true);
        try {
            await paymentsAPI.applyRetention(retentionOrder.id, {
                city: rCity,
                apply_reteica: !rNoAplica && rApplyReteica,
                reteica_rate: !rNoAplica && rApplyReteica ? parseFloat(rReteicaRate) || 0 : null,
                apply_retefuente: !rNoAplica && rApplyRetefuente,
                retefuente_rate: !rNoAplica && rApplyRetefuente ? parseFloat(rRetefuenteRate) || 0 : null,
                update_identity: rUpdateIdentity,
                new_cedula: rUpdateIdentity ? (rNewCedula || null) : null,
                new_razon_social: rUpdateIdentity ? (rNewRazonSocial || null) : null,
                no_aplica: rNoAplica,
            });
            const orderId = retentionOrder.id;
            closeRetention();
            if (fromPayment === orderId) {
                toast.success(`${rNoAplica ? 'Marcado como sin retención' : 'Retención aplicada'} · ahora registra el abono`);
                navigate(`/pagos?abono=${orderId}`);
                return;
            }
            toast.success(rNoAplica ? 'Marcado como sin retención' : 'Retención aplicada');
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Error al aplicar retención');
        } finally {
            setSavingRet(false);
        }
    };

    const sendInvoice = async (o) => {
        setSending(o.id);
        try {
            const res = await paymentsAPI.sendInvoiceEmail(o.id);
            toast.success(`Factura enviada · ${res.data.invoice_number}`);
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Error al enviar factura');
        } finally {
            setSending(null);
        }
    };

    const downloadInvoice = async (o) => {
        try {
            const res = await paymentsAPI.downloadInvoicePdf(o.id);
            const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `factura_${o.invoice_number}.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Error al descargar factura');
        }
    };

    // Correo edit dialog
    const [emailEdit, setEmailEdit] = useState(null); // { order, value }
    const [savingEmail, setSavingEmail] = useState(false);
    const openEmailEdit = (o) => setEmailEdit({ order: o, value: o.client_email || '' });
    const closeEmailEdit = () => setEmailEdit(null);
    const submitEmail = async () => {
        if (!emailEdit?.value || !emailEdit.value.includes('@')) {
            toast.error('Correo inválido');
            return;
        }
        setSavingEmail(true);
        try {
            await paymentsAPI.updateClientEmail(emailEdit.order.id, emailEdit.value.trim());
            toast.success('Correo actualizado');
            closeEmailEdit();
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Error al actualizar correo');
        } finally {
            setSavingEmail(false);
        }
    };

    const preview = retentionOrder ? computeRet() : null;

    return (
        <div className="space-y-6" data-testid="facturacion-page">
            <div>
                <h1 className="font-heading text-3xl md:text-4xl">Facturación Electrónica</h1>
                <p className="text-muted-foreground">
                    Aplica retenciones y envía factura MOCK a clientes que la solicitaron. Reporte de impuestos disponible.
                </p>
            </div>

            <Tabs value={tab} onValueChange={setTab} className="w-full">
                <TabsList className="grid grid-cols-3 w-full max-w-xl">
                    <TabsTrigger value="pendientes" data-testid="tab-pendientes">
                        <FileText className="w-4 h-4 mr-2" /> Pendientes
                    </TabsTrigger>
                    <TabsTrigger value="impuestos" data-testid="tab-impuestos">
                        <Receipt className="w-4 h-4 mr-2" /> Impuestos
                    </TabsTrigger>
                    <TabsTrigger value="descuentos" data-testid="tab-descuentos">
                        <Tag className="w-4 h-4 mr-2" /> Descuentos
                    </TabsTrigger>
                </TabsList>

                {/* PENDIENTES TAB */}
                <TabsContent value="pendientes" className="mt-4 space-y-3">
                    <Card className="border-purple-500/40 bg-purple-500/5">
                        <CardContent className="p-4 flex items-start gap-3 text-sm">
                            <FileText className="w-5 h-5 text-purple-500 shrink-0 mt-0.5" />
                            <div>
                                <p className="font-medium text-purple-500">Flujo: Aplicar retención → Enviar factura</p>
                                <p className="text-muted-foreground">
                                    Primero aplica la retención (o márcala como &quot;no aplica&quot;). Luego se habilita el botón &quot;Enviar Factura&quot;.
                                </p>
                            </div>
                        </CardContent>
                    </Card>

                    {loading ? (
                        <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin" /></div>
                    ) : orders.length === 0 ? (
                        <p className="text-center text-muted-foreground py-8" data-testid="empty-invoice">
                            No hay clientes pendientes por facturar.
                        </p>
                    ) : (
                        <div className="grid gap-3">
                            {orders.map((o) => (
                                <Card key={o.id} data-testid={`invoice-row-${o.id}`} className={o.retention_applied ? 'border-green-500/40' : ''}>
                                    <CardContent className="p-4 flex flex-col md:flex-row gap-3 items-start md:items-center">
                                        <PlateBadge plate={o.plate} size="md" />
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium truncate flex items-center gap-2 flex-wrap">
                                                <User className="w-4 h-4" /> {o.client_name}
                                                <Badge variant="outline" className="text-xs">{o.client_cedula || 'sin cédula'}</Badge>
                                                {o.retention_applied && (
                                                    <Badge className="bg-green-500/20 text-green-500 border-green-500/40 text-xs" data-testid={`retention-applied-${o.id}`}>
                                                        <ShieldCheck className="w-3 h-3 mr-1" /> Retención aplicada
                                                    </Badge>
                                                )}
                                            </div>
                                            <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                                                <Phone className="w-3 h-3" /> {o.client_phone} · {o.order_code}
                                            </p>
                                            {o.retention_applied && o.retention_snapshot && (
                                                <p className="text-xs text-cyan-400 mt-1">
                                                    {o.retention_snapshot.no_aplica
                                                        ? 'Sin retención'
                                                        : `Reteica: ${formatCurrency(o.retention_snapshot.reteica_amount || 0)} · Retefuente: ${formatCurrency(o.retention_snapshot.retefuente_amount || 0)} · Total: ${formatCurrency(o.retention_snapshot.total_retention || 0)}`}
                                                </p>
                                            )}
                                            {!o.client_email && (
                                                <Input
                                                    type="email"
                                                    placeholder="correo del cliente"
                                                    value={emailOverride[o.id] || ''}
                                                    onChange={(e) => setEmailOverride(prev => ({ ...prev, [o.id]: e.target.value }))}
                                                    className="max-w-xs mt-2"
                                                    data-testid={`invoice-email-input-${o.id}`}
                                                />
                                            )}
                                            {o.client_email && (
                                                <p className="text-xs text-cyan-500 flex items-center gap-1 mt-1">
                                                    <Mail className="w-3 h-3" /> {o.client_email}
                                                </p>
                                            )}
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[10px] uppercase text-muted-foreground">Total</p>
                                            <p className="font-mono font-bold">{formatCurrency(o.total)}</p>
                                        </div>
                                        <div className="flex flex-col gap-2 min-w-[180px]">
                                            <Button
                                                variant={o.retention_applied ? 'outline' : 'default'}
                                                onClick={() => openRetention(o)}
                                                data-testid={`apply-retention-btn-${o.id}`}
                                            >
                                                <ShieldCheck className="w-4 h-4 mr-2" />
                                                {o.retention_applied ? 'Modificar retención' : 'Aplicar retención'}
                                            </Button>
                                            <Button
                                                variant="outline"
                                                onClick={() => openEmailEdit(o)}
                                                data-testid={`fix-email-btn-${o.id}`}
                                            >
                                                <Edit3 className="w-4 h-4 mr-2" />
                                                Corregir correo
                                            </Button>
                                            {o.invoice_sent_at ? (
                                                <>
                                                    <Button
                                                        variant="outline"
                                                        onClick={() => downloadInvoice(o)}
                                                        disabled={!o.invoice_number}
                                                        data-testid={`download-invoice-btn-${o.id}`}
                                                    >
                                                        <Download className="w-4 h-4 mr-2" />
                                                        Descargar factura
                                                    </Button>
                                                    <Button
                                                        onClick={() => sendInvoice(o)}
                                                        disabled={sending === o.id || (!o.client_email && !emailOverride[o.id])}
                                                        data-testid={`resend-invoice-btn-${o.id}`}
                                                    >
                                                        {sending === o.id
                                                            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Reenviando...</>
                                                            : <><MailPlus className="w-4 h-4 mr-2" /> Reenviar correo</>
                                                        }
                                                    </Button>
                                                </>
                                            ) : (
                                                <Button
                                                    onClick={() => sendInvoice(o)}
                                                    disabled={
                                                        sending === o.id ||
                                                        !o.retention_applied ||
                                                        (!o.client_email && !emailOverride[o.id])
                                                    }
                                                    data-testid={`send-invoice-btn-${o.id}`}
                                                >
                                                    {sending === o.id
                                                        ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Enviando...</>
                                                        : <><Mail className="w-4 h-4 mr-2" /> Enviar Factura</>
                                                    }
                                                </Button>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>

                {/* IMPUESTOS TAB */}
                <TabsContent value="impuestos" className="mt-4 space-y-3">
                    <Card>
                        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                            <div>
                                <p className="text-xs text-muted-foreground">Registros</p>
                                <p className="font-mono font-bold text-lg" data-testid="ret-count">{retSummary.count}</p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Reteica total</p>
                                <p className="font-mono font-bold text-lg text-cyan-400" data-testid="ret-total-reteica">{formatCurrency(retSummary.total_reteica || 0)}</p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Retefuente total</p>
                                <p className="font-mono font-bold text-lg text-cyan-400" data-testid="ret-total-retefuente">{formatCurrency(retSummary.total_retefuente || 0)}</p>
                            </div>
                            <div>
                                <p className="text-xs text-muted-foreground">Total retenido</p>
                                <p className="font-mono font-bold text-lg text-amber-400" data-testid="ret-total">{formatCurrency(retSummary.total_retention || 0)}</p>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardContent className="p-3 flex gap-2 items-end">
                            <div className="flex-1">
                                <Label className="text-xs">Buscar por placa, cédula, cliente, orden o ciudad</Label>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                    <Input
                                        value={retQ}
                                        onChange={(e) => setRetQ(e.target.value)}
                                        placeholder="..."
                                        className="pl-9"
                                        data-testid="ret-search"
                                    />
                                </div>
                            </div>
                            <Button onClick={loadRetentions} data-testid="ret-refresh">Actualizar</Button>
                        </CardContent>
                    </Card>

                    {retentions.length === 0 ? (
                        <p className="text-center text-muted-foreground py-8" data-testid="empty-retentions">
                            Sin retenciones registradas.
                        </p>
                    ) : (
                        <div className="grid gap-2">
                            {retentions.map(r => (
                                <Card key={r.id} data-testid={`retention-row-${r.id}`}>
                                    <CardContent className="p-3 flex flex-col md:flex-row gap-2 items-start md:items-center">
                                        <PlateBadge plate={r.plate} size="sm" />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">
                                                {r.client_name}
                                                {r.city && <span className="text-xs text-muted-foreground ml-2">· {r.city}</span>}
                                            </p>
                                            <p className="text-[11px] text-muted-foreground flex items-center gap-1 flex-wrap">
                                                {r.order_code} · {new Date(r.applied_at).toLocaleString()} · por {r.applied_by_name}
                                                {r.identity_updated && <Badge variant="outline" className="text-[10px]">ID actualizado</Badge>}
                                            </p>
                                        </div>
                                        <div className="grid grid-cols-3 gap-3 text-right text-xs">
                                            <div>
                                                <p className="text-[10px] text-muted-foreground">Reteica {r.reteica_rate ? `(${reteicaLabel(r)})` : ''}</p>
                                                <p className="font-mono text-cyan-400">{formatCurrency(r.reteica_amount || 0)}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-muted-foreground">Retefuente {r.retefuente_rate ? `(${r.retefuente_rate}%)` : ''}</p>
                                                <p className="font-mono text-cyan-400">{formatCurrency(r.retefuente_amount || 0)}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-muted-foreground">Total retenido</p>
                                                <p className="font-mono font-bold text-amber-400">{formatCurrency(r.total_retention || 0)}</p>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>

                {/* DESCUENTOS TAB */}
                <TabsContent value="descuentos" className="mt-4 space-y-3">
                    {!discAuthed ? (
                        <Card className="border-emerald-500/40 bg-emerald-500/5 max-w-md mx-auto">
                            <CardContent className="p-6 space-y-4">
                                <div className="flex items-center gap-3">
                                    <Lock className="w-6 h-6 text-emerald-400" />
                                    <div>
                                        <p className="font-medium text-emerald-300">Zona administrativa</p>
                                        <p className="text-sm text-muted-foreground">Ingresa la contraseña para administrar códigos de descuento</p>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="disc-admin-pwd">Contraseña</Label>
                                    <Input
                                        id="disc-admin-pwd"
                                        type="password"
                                        value={discPasswordInput}
                                        onChange={(e) => setDiscPasswordInput(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') handleDiscAdminVerify(); }}
                                        placeholder="Contraseña de administración"
                                        data-testid="disc-admin-password-input"
                                    />
                                </div>
                                <Button
                                    onClick={handleDiscAdminVerify}
                                    disabled={discVerifying || !discPasswordInput}
                                    className="w-full"
                                    data-testid="disc-admin-verify-btn"
                                >
                                    {discVerifying ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                                    Ingresar
                                </Button>
                            </CardContent>
                        </Card>
                    ) : (
                        <>
                            <Card className="border-emerald-500/40 bg-emerald-500/5">
                                <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
                                    <div className="flex items-start gap-3 text-sm">
                                        <Tag className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                                        <div>
                                            <p className="font-medium text-emerald-400">Códigos de descuento</p>
                                            <p className="text-muted-foreground">Crea códigos fijos o porcentuales. Se aplican en Agendamiento o Check-in.</p>
                                        </div>
                                    </div>
                                    <Button onClick={() => setShowDiscCreate(true)} data-testid="disc-create-btn">
                                        <Plus className="w-4 h-4 mr-2" /> Nuevo código
                                    </Button>
                                </CardContent>
                            </Card>

                            {discLoading ? (
                                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin" /></div>
                            ) : discCodes.length === 0 ? (
                                <Card>
                                    <CardContent className="p-8 text-center text-muted-foreground">
                                        No hay códigos de descuento. Crea el primero con el botón &quot;Nuevo código&quot;.
                                    </CardContent>
                                </Card>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {discCodes.map(c => {
                                        const expired = !!c.expired;
                                        const inactive = !c.active;
                                        return (
                                            <Card key={c.id} className={`${expired ? 'border-red-500/40' : inactive ? 'border-amber-500/40' : 'border-emerald-500/40'}`} data-testid={`disc-code-card-${c.code}`}>
                                                <CardContent className="p-4 space-y-2">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <div className="flex items-center gap-2">
                                                            <Tag className="w-5 h-5 text-emerald-400" />
                                                            <span className="font-mono text-lg font-bold">{c.code}</span>
                                                        </div>
                                                        <div className="flex gap-1">
                                                            {inactive && <Badge variant="outline" className="border-amber-500 text-amber-500">Inactivo</Badge>}
                                                            {expired && <Badge variant="outline" className="border-red-500 text-red-500">Vencido</Badge>}
                                                            {!inactive && !expired && <Badge variant="outline" className="border-emerald-500 text-emerald-500">Activo</Badge>}
                                                        </div>
                                                    </div>
                                                    <div className="text-sm">
                                                        <span className="text-muted-foreground">Descuento: </span>
                                                        <span className="font-bold text-emerald-300">
                                                            {c.discount_type === 'percentage' ? `${c.discount_value}%` : formatCurrency(c.discount_value)}
                                                        </span>
                                                    </div>
                                                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                                                        <Calendar className="w-3 h-3" />
                                                        Vence: {c.expires_at || 'sin vencimiento'}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground">Usos: {c.usage_count || 0}</div>
                                                    {c.notes && <div className="text-xs text-muted-foreground italic">{c.notes}</div>}
                                                    <div className="flex gap-2 pt-2">
                                                        <Button size="sm" variant="outline" onClick={() => handleToggleDiscount(c)} data-testid={`disc-toggle-${c.code}`}>
                                                            <Power className="w-3 h-3 mr-1" /> {c.active ? 'Desactivar' : 'Activar'}
                                                        </Button>
                                                        <Button size="sm" variant="outline" className="text-red-500" onClick={() => handleDeleteDiscount(c)} data-testid={`disc-delete-${c.code}`}>
                                                            <Trash2 className="w-3 h-3 mr-1" /> Eliminar
                                                        </Button>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        );
                                    })}
                                </div>
                            )}
                        </>
                    )}
                </TabsContent>
            </Tabs>

            {/* RETENTION DIALOG */}
            <Dialog open={!!retentionOrder} onOpenChange={(v) => !v && closeRetention()}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Aplicar Retención</DialogTitle>
                        <DialogDescription asChild>
                            {retentionOrder ? (
                                <div className="flex items-center gap-2 pt-1 flex-wrap">
                                    <PlateBadge plate={retentionOrder.plate} size="md" />
                                    <span className="text-sm">{retentionOrder.client_name} · Total: <b>{formatCurrency(retentionOrder.total)}</b></span>
                                </div>
                            ) : <span />}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        {/* No aplica */}
                        <label className="flex items-center gap-2 p-2 rounded border border-border cursor-pointer">
                            <input
                                type="checkbox"
                                checked={rNoAplica}
                                onChange={(e) => setRNoAplica(e.target.checked)}
                                data-testid="ret-no-aplica"
                                className="w-4 h-4 accent-amber-500"
                            />
                            <span className="text-sm">Este cliente <b>no aplica</b> retención</span>
                        </label>

                        {!rNoAplica && (
                            <>
                                <div>
                                    <Label className="flex items-center gap-1"><MapPin className="w-3 h-3" /> Ciudad *</Label>
                                    <Input
                                        value={rCity}
                                        onChange={(e) => {
                                            setRCity(e.target.value);
                                            const bog = isBogota(e.target.value);
                                            setRApplyReteica(bog);
                                            if (!bog) setRReteicaRate('0');
                                            else if (!parseFloat(rReteicaRate)) setRReteicaRate(String(RETEICA_PRESETS[0]));
                                        }}
                                        placeholder="Bogotá, Medellín..."
                                        data-testid="ret-city-input"
                                    />
                                    {!isBogota(rCity) && (
                                        <p className="text-[11px] text-amber-400 mt-1">Reteica desactivada · solo Bogotá</p>
                                    )}
                                </div>

                                <div className={`p-3 rounded-lg border ${isBogota(rCity) ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-muted bg-muted/20 opacity-60'}`}>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={rApplyReteica}
                                            onChange={(e) => setRApplyReteica(e.target.checked)}
                                            disabled={!isBogota(rCity)}
                                            className="w-4 h-4 accent-cyan-500"
                                            data-testid="ret-reteica-check"
                                        />
                                        <span className="text-sm font-medium">Aplicar Reteica (ICA por mil)</span>
                                    </label>
                                    {rApplyReteica && (
                                        <div className="mt-2 flex gap-2 items-center flex-wrap">
                                            <span className="text-xs text-muted-foreground">‰</span>
                                            <Input
                                                type="number"
                                                step="0.01"
                                                value={rReteicaRate}
                                                onChange={(e) => setRReteicaRate(e.target.value)}
                                                className="w-32"
                                                data-testid="ret-reteica-rate"
                                            />
                                            {RETEICA_PRESETS.map(p => (
                                                <Button
                                                    key={p}
                                                    type="button"
                                                    variant={String(p) === rReteicaRate ? 'default' : 'outline'}
                                                    size="sm"
                                                    onClick={() => setRReteicaRate(String(p))}
                                                    className="h-7 text-xs"
                                                    data-testid={`ret-preset-reteica-${p}`}
                                                >
                                                    {p}/1000
                                                </Button>
                                            ))}
                                        </div>
                                    )}
                                    {rApplyReteica && <p className="text-[11px] text-muted-foreground mt-1">ICA por mil sobre la base sin IVA (ej.: 6,9/1000)</p>}
                                </div>

                                <div className={`p-3 rounded-lg border ${retentionOrder && retentionBase(retentionOrder) > RETEFUENTE_MIN_TOTAL ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-muted bg-muted/20 opacity-60'}`}>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={rApplyRetefuente}
                                            onChange={(e) => setRApplyRetefuente(e.target.checked)}
                                            disabled={!retentionOrder || retentionBase(retentionOrder) <= RETEFUENTE_MIN_TOTAL}
                                            className="w-4 h-4 accent-cyan-500"
                                            data-testid="ret-retefuente-check"
                                        />
                                        <span className="text-sm font-medium">Aplicar Retefuente (2.5%)</span>
                                    </label>
                                    {rApplyRetefuente && (
                                        <div className="mt-2 flex gap-2 items-center flex-wrap">
                                            <Percent className="w-3 h-3" />
                                            <Input
                                                type="number"
                                                step="0.1"
                                                value={rRetefuenteRate}
                                                onChange={(e) => setRRetefuenteRate(e.target.value)}
                                                className="w-32"
                                                data-testid="ret-retefuente-rate"
                                            />
                                            <Button
                                                type="button"
                                                variant={rRetefuenteRate === '2.5' ? 'default' : 'outline'}
                                                size="sm"
                                                onClick={() => setRRetefuenteRate('2.5')}
                                                className="h-7 text-xs"
                                                data-testid="ret-preset-retefuente-2.5"
                                            >2.5%</Button>
                                        </div>
                                    )}
                                    {retentionOrder && retentionBase(retentionOrder) <= RETEFUENTE_MIN_TOTAL && (
                                        <p className="text-[11px] text-amber-400 mt-1">
                                            Retefuente 2.5% aplica solo cuando la base sin IVA supera {formatCurrency(RETEFUENTE_MIN_TOTAL)}.
                                        </p>
                                    )}
                                </div>
                            </>
                        )}

                        {/* Cambio de NIT/Cedula o Razon Social */}
                        <div className="p-3 rounded-lg border border-amber-500/40 bg-amber-500/5">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={rUpdateIdentity}
                                    onChange={(e) => setRUpdateIdentity(e.target.checked)}
                                    className="w-4 h-4 accent-amber-500"
                                    data-testid="ret-update-identity"
                                />
                                <span className="text-sm font-medium flex items-center gap-1"><IdCard className="w-4 h-4" /> Cambiar NIT/Cédula o Razón Social</span>
                            </label>
                            {rUpdateIdentity && (
                                <div className="mt-2 space-y-2">
                                    <div>
                                        <Label className="text-xs">NIT / Cédula</Label>
                                        <Input value={rNewCedula} onChange={(e) => setRNewCedula(e.target.value)} data-testid="ret-new-cedula" />
                                    </div>
                                    <div>
                                        <Label className="text-xs">Razón Social</Label>
                                        <Input value={rNewRazonSocial} onChange={(e) => setRNewRazonSocial(e.target.value)} data-testid="ret-new-razon" />
                                    </div>
                                    <p className="text-[11px] text-amber-400">
                                        Este cambio actualiza al cliente en todas sus órdenes históricas y futuras.
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Preview */}
                        {preview && !rNoAplica && (
                            <div className="p-3 rounded-lg bg-muted/60 space-y-1 text-sm" data-testid="ret-preview">
                                <div className="flex justify-between"><span>Base (sin IVA)</span><span className="font-mono" data-testid="ret-preview-base">{formatCurrency(preview.base)}</span></div>
                                {preview.iva > 0 && <div className="flex justify-between text-muted-foreground"><span>IVA 19%</span><span className="font-mono">{formatCurrency(preview.iva)}</span></div>}
                                <div className="flex justify-between"><span>Subtotal</span><span className="font-mono">{formatCurrency(preview.total)}</span></div>
                                {preview.retefuente > 0 && <div className="flex justify-between text-red-400"><span>− Retefuente {rRetefuenteRate}%</span><span className="font-mono" data-testid="ret-preview-retefuente">-{formatCurrency(preview.retefuente)}</span></div>}
                                {preview.reteica > 0 && <div className="flex justify-between text-red-400"><span>− ICA {rReteicaRate}/1000</span><span className="font-mono" data-testid="ret-preview-reteica">-{formatCurrency(preview.reteica)}</span></div>}
                                {preview.total_ret > 0 && <div className="flex justify-between text-red-400 font-medium"><span>Total retenciones practicadas</span><span className="font-mono">-{formatCurrency(preview.total_ret)}</span></div>}
                                <div className="flex justify-between font-bold border-t border-border pt-1"><span>Valor a pagar cliente</span><span className="font-mono text-green-400" data-testid="ret-preview-after">{formatCurrency(preview.after)}</span></div>
                            </div>
                        )}

                        <Button
                            variant="outline"
                            onClick={() => setPreviewOrderId(retentionOrder.id)}
                            className="w-full"
                            data-testid="ret-preview-order-btn"
                        >
                            <Eye className="w-4 h-4 mr-2" /> Previsualizar orden
                        </Button>
                        <Button
                            onClick={submitRetention}
                            disabled={savingRet}
                            className="w-full brand-glow"
                            data-testid="ret-confirm"
                        >
                            {savingRet ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                            {rNoAplica ? 'Guardar sin retención' : 'Aplicar retención'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
            {previewOrderId && (
                <OrderPreviewDialog
                    orderId={previewOrderId}
                    retention={preview && !rNoAplica ? { reteica: preview.reteica, retefuente: preview.retefuente } : null}
                    onClose={() => setPreviewOrderId(null)}
                />
            )}
            {/* Email Edit Dialog */}
            <Dialog open={!!emailEdit} onOpenChange={(v) => !v && closeEmailEdit()}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Corregir correo del cliente</DialogTitle>
                        <DialogDescription asChild>
                            {emailEdit ? (
                                <div className="pt-1 flex items-center gap-2 flex-wrap">
                                    <PlateBadge plate={emailEdit.order.plate} size="md" />
                                    <span className="text-sm">{emailEdit.order.client_name}</span>
                                </div>
                            ) : <span />}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div>
                            <Label className="text-xs">Correo actual</Label>
                            <p className="text-sm text-muted-foreground">
                                {emailEdit?.order?.client_email || <em>Sin correo registrado</em>}
                            </p>
                        </div>
                        <div>
                            <Label className="text-xs">Nuevo correo *</Label>
                            <Input
                                type="email"
                                value={emailEdit?.value || ''}
                                onChange={(e) => setEmailEdit(prev => ({ ...prev, value: e.target.value }))}
                                placeholder="cliente@ejemplo.com"
                                data-testid="fix-email-input"
                            />
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                            Este correo se actualiza también en todas las órdenes históricas del cliente.
                        </p>
                        <Button
                            onClick={submitEmail}
                            disabled={savingEmail}
                            className="w-full"
                            data-testid="fix-email-confirm"
                        >
                            {savingEmail ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}
                            Guardar correo
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* CREATE DISCOUNT DIALOG */}
            <Dialog open={showDiscCreate} onOpenChange={(v) => { if (!v) { setShowDiscCreate(false); resetDiscCreate(); } }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2"><Tag className="w-5 h-5 text-emerald-400" /> Nuevo código de descuento</DialogTitle>
                        <DialogDescription>Define el código, el tipo de descuento y una fecha opcional de vencimiento.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div>
                            <Label htmlFor="dc-code">Código *</Label>
                            <Input
                                id="dc-code"
                                value={dcCode}
                                onChange={(e) => setDcCode(e.target.value.toUpperCase())}
                                placeholder="Ej: PROMO10"
                                data-testid="dc-code-input"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <Label>Tipo *</Label>
                                <div className="flex gap-2 mt-1">
                                    <Button
                                        type="button"
                                        variant={dcType === 'percentage' ? 'default' : 'outline'}
                                        size="sm"
                                        onClick={() => setDcType('percentage')}
                                        data-testid="dc-type-percentage"
                                    >
                                        <Percent className="w-3 h-3 mr-1" /> Porcentaje
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={dcType === 'fixed' ? 'default' : 'outline'}
                                        size="sm"
                                        onClick={() => setDcType('fixed')}
                                        data-testid="dc-type-fixed"
                                    >
                                        $ Fijo
                                    </Button>
                                </div>
                            </div>
                            <div>
                                <Label htmlFor="dc-value">Valor *</Label>
                                <Input
                                    id="dc-value"
                                    type="number"
                                    value={dcValue}
                                    onChange={(e) => setDcValue(e.target.value)}
                                    placeholder={dcType === 'percentage' ? '10' : '50000'}
                                    data-testid="dc-value-input"
                                />
                            </div>
                        </div>
                        <div>
                            <Label htmlFor="dc-expires">Vencimiento *</Label>
                            <Input
                                id="dc-expires"
                                type="date"
                                value={dcExpires}
                                onChange={(e) => setDcExpires(e.target.value)}
                                data-testid="dc-expires-input"
                            />
                            <p className="text-xs text-muted-foreground mt-1">Después de esta fecha el código dejará de ser válido.</p>
                        </div>
                        <div>
                            <Label htmlFor="dc-notes">Notas (opcional)</Label>
                            <Input
                                id="dc-notes"
                                value={dcNotes}
                                onChange={(e) => setDcNotes(e.target.value)}
                                placeholder="Ej: Campaña enero"
                                data-testid="dc-notes-input"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setShowDiscCreate(false); resetDiscCreate(); }}>Cancelar</Button>
                        <Button onClick={handleCreateDiscount} disabled={dcSaving} data-testid="dc-save-btn">
                            {dcSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                            Crear código
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default FacturacionElectronica;
