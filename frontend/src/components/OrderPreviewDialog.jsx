import React, { useEffect, useState } from 'react';
import { ordersAPI } from '../lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { PlateBadge } from './PlateBadge';
import { formatCurrency } from '../lib/utils';
import { toast } from 'sonner';
import { FileText, Loader2, ClipboardCheck, PencilLine } from 'lucide-react';

const fmt = (iso) => (iso ? new Date(iso).toLocaleString('es-CO') : '-');
const Row = ({ label, value, className = '', testId }) => (
    <div className={`flex justify-between gap-3 ${className}`}>
        <span>{label}</span>
        <span className="font-mono whitespace-nowrap" data-testid={testId}>{value}</span>
    </div>
);

/**
 * Previsualización de la orden tal como quedó en el check-in (o en su última actualización):
 * servicios con su valor, descuento, IVA y total; más las retenciones que se están aplicando.
 * Props: orderId, retention { reteica, retefuente } (opcional), onClose
 */
export const OrderPreviewDialog = ({ orderId, retention, onClose }) => {
    const [order, setOrder] = useState(null);
    const [openingPdf, setOpeningPdf] = useState(false);

    useEffect(() => {
        ordersAPI.getById(orderId)
            .then(({ data }) => setOrder(data))
            .catch((e) => {
                toast.error(e.response?.data?.detail || 'No se pudo cargar la orden');
                onClose();
            });
    }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps

    const openSignedPdf = async () => {
        setOpeningPdf(true);
        try {
            const { data } = await ordersAPI.getSignedOrderPdf(orderId);
            window.open(URL.createObjectURL(new Blob([data], { type: 'application/pdf' })), '_blank');
        } catch (e) {
            toast.error('Esta orden no tiene PDF firmado');
        } finally {
            setOpeningPdf(false);
        }
    };

    let body = <div className="flex justify-center py-10"><Loader2 className="w-7 h-7 animate-spin" /></div>;
    if (order) {
        const services = order.services || [];
        const base = services.reduce((sum, s) => sum + (s.price || 0)
            + (s.extras || []).reduce((t, e) => t + (e?.price || 0), 0), 0);
        const total = order.final_value ?? order.negotiated_value ?? 0;
        const discount = order.discount_amount || 0;
        // Lo que queda entre la base (menos descuento) y el total es el IVA de la factura
        const tax = Math.round((total - Math.max(base - discount, 0)) * 100) / 100;
        const ret = (retention?.reteica || 0) + (retention?.retefuente || 0);

        body = (
            <div className="space-y-4 text-sm">
                <div className="flex flex-wrap gap-2" data-testid="order-preview-origin">
                    <Badge variant="outline" className="gap-1">
                        <ClipboardCheck className="w-3 h-3" /> Check-in {fmt(order.ingreso_at)}{order.checkin_by_name ? ` · ${order.checkin_by_name}` : ''}
                    </Badge>
                    {order.last_updated_at && (
                        <Badge className="gap-1 bg-amber-500/15 text-amber-400 border-amber-500/40">
                            <PencilLine className="w-3 h-3" /> Actualizada {fmt(order.last_updated_at)}{order.last_updated_by_name ? ` · ${order.last_updated_by_name}` : ''}
                        </Badge>
                    )}
                </div>

                <div className="rounded-lg border border-border divide-y divide-border" data-testid="order-preview-services">
                    {services.map((s, i) => (
                        <div key={i} className="p-2.5 space-y-1">
                            <Row label={<span className="font-medium">{s.description || s.service}</span>}
                                value={s.no_charge ? 'Sin pago' : formatCurrency(s.price || 0)} />
                            {(s.parts?.length > 0 || s.ppf_parts_description) && (
                                <p className="text-xs text-muted-foreground">{s.ppf_parts_description || s.parts.join(', ')}</p>
                            )}
                            {(s.extras || []).map((e, j) => (
                                <Row key={j} label={<span className="text-xs text-muted-foreground">+ {e.nombre || e.id}</span>}
                                    value={formatCurrency(e.price || 0)} className="text-xs text-muted-foreground" />
                            ))}
                        </div>
                    ))}
                </div>

                <div className="p-3 rounded-lg bg-muted/60 space-y-1" data-testid="order-preview-totals">
                    <Row label="Subtotal servicios" value={formatCurrency(base)} testId="order-preview-base" />
                    {discount > 0 && (
                        <Row label={`Descuento${order.discount_code ? ` (${order.discount_code})` : ''}`}
                            value={`-${formatCurrency(discount)}`} className="text-emerald-400" />
                    )}
                    {order.requires_invoice ? (
                        <Row label="IVA 19% (factura electrónica)" value={formatCurrency(tax)} testId="order-preview-iva" />
                    ) : Math.abs(tax) >= 1 && (
                        <Row label="Ajustes" value={formatCurrency(tax)} />
                    )}
                    <Row label="Total orden" value={formatCurrency(total)} className="font-bold border-t border-border pt-1" testId="order-preview-total" />
                    {retention?.reteica > 0 && <Row label="− Reteica" value={`-${formatCurrency(retention.reteica)}`} className="text-red-400" />}
                    {retention?.retefuente > 0 && <Row label="− Retefuente" value={`-${formatCurrency(retention.retefuente)}`} className="text-red-400" />}
                    {ret > 0 && (
                        <Row label="Neto a pagar" value={formatCurrency(total - ret)} className="font-bold text-green-400 border-t border-border pt-1" testId="order-preview-net" />
                    )}
                    {(order.amount_paid || 0) > 0 && <Row label="Abonado" value={formatCurrency(order.amount_paid)} className="text-muted-foreground" />}
                </div>

                {order.signed_order_pdf_url && (
                    <Button variant="outline" className="w-full" onClick={openSignedPdf} disabled={openingPdf} data-testid="order-preview-pdf">
                        {openingPdf ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileText className="w-4 h-4 mr-2" />}
                        Ver orden firmada en el check-in (PDF)
                    </Button>
                )}
            </div>
        );
    }

    return (
        <Dialog open onOpenChange={(v) => !v && onClose()}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="order-preview-dialog">
                <DialogHeader>
                    <DialogTitle>Previsualizar orden</DialogTitle>
                    <DialogDescription asChild>
                        <div className="flex items-center gap-2 pt-1 flex-wrap">
                            {order && <PlateBadge plate={order.plate} size="md" />}
                            {order && <span className="text-sm">{order.client_name} · Orden {order.order_code}</span>}
                        </div>
                    </DialogDescription>
                </DialogHeader>
                {body}
            </DialogContent>
        </Dialog>
    );
};

export default OrderPreviewDialog;
