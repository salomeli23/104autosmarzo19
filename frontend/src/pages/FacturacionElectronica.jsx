import React, { useState, useEffect, useCallback } from 'react';
import { paymentsAPI } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { PlateBadge } from '../components/PlateBadge';
import { formatCurrency } from '../lib/utils';
import { toast } from 'sonner';
import { FileText, Mail, Loader2, User, Phone, CheckCircle2 } from 'lucide-react';

export const FacturacionElectronica = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(null);
    const [emailOverride, setEmailOverride] = useState({}); // per order

    const load = useCallback(async () => {
        try {
            const res = await paymentsAPI.pendingInvoice();
            setOrders(res.data);
        } catch (e) {
            toast.error('Error al cargar clientes por facturar');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const sendInvoice = async (o) => {
        if (!o.client_email && !emailOverride[o.id]) {
            toast.error('El cliente no tiene correo. Agrégalo primero.');
            return;
        }
        setSending(o.id);
        try {
            const res = await paymentsAPI.sendInvoiceEmail(o.id);
            toast.success(`Factura MOCK enviada · ${res.data.invoice_number}`);
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Error al enviar factura');
        } finally {
            setSending(null);
        }
    };

    return (
        <div className="space-y-6" data-testid="facturacion-page">
            <div>
                <h1 className="font-heading text-3xl md:text-4xl">Clientes por Facturar</h1>
                <p className="text-muted-foreground">
                    Clientes que solicitaron factura electrónica al ingreso. Envío como PDF <b>MOCK</b> hasta conectar con Siigo.
                </p>
            </div>

            <Card className="border-purple-500/40 bg-purple-500/5">
                <CardContent className="p-4 flex items-start gap-3 text-sm">
                    <FileText className="w-5 h-5 text-purple-500 shrink-0 mt-0.5" />
                    <div>
                        <p className="font-medium text-purple-500">Modo MOCK activo</p>
                        <p className="text-muted-foreground">
                            La factura enviada es un PDF de prueba con numeración simulada. No tiene validez fiscal.
                            Al conectar Siigo real, este mismo botón enviará la factura oficial.
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
                        <Card key={o.id} data-testid={`invoice-row-${o.id}`}>
                            <CardContent className="p-4 flex flex-col md:flex-row gap-3 items-start md:items-center">
                                <PlateBadge plate={o.plate} size="md" />
                                <div className="flex-1 min-w-0">
                                    <div className="font-medium truncate flex items-center gap-2">
                                        <User className="w-4 h-4" /> {o.client_name}
                                        <Badge variant="outline" className="text-xs">{o.client_cedula || 'sin cédula'}</Badge>
                                    </div>
                                    <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                                        <Phone className="w-3 h-3" /> {o.client_phone} · {o.order_code}
                                    </p>
                                    {!o.client_email && (
                                        <div className="mt-2 flex gap-2 items-center">
                                            <Input
                                                type="email"
                                                placeholder="correo del cliente"
                                                value={emailOverride[o.id] || ''}
                                                onChange={(e) => setEmailOverride(prev => ({ ...prev, [o.id]: e.target.value }))}
                                                className="max-w-xs"
                                                data-testid={`invoice-email-input-${o.id}`}
                                            />
                                        </div>
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
                                <Button
                                    onClick={() => sendInvoice(o)}
                                    disabled={sending === o.id || (!o.client_email && !emailOverride[o.id])}
                                    data-testid={`send-invoice-btn-${o.id}`}
                                >
                                    {sending === o.id
                                        ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Enviando...</>
                                        : <><Mail className="w-4 h-4 mr-2" /> Enviar Factura (MOCK)</>
                                    }
                                </Button>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            <Card className="border-green-500/30">
                <CardContent className="p-4 flex items-center gap-3 text-sm text-muted-foreground">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    Las facturas ya enviadas salen de esta lista y quedan marcadas con <code>invoice_sent_at</code> en la orden.
                </CardContent>
            </Card>
        </div>
    );
};

export default FacturacionElectronica;
