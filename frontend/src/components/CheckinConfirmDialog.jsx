import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { CHECKIN_NOTICES, formatCurrency } from '../lib/utils';
import { SignaturePad } from './SignaturePad';
import { AlertTriangle, CheckCircle2, Pen } from 'lucide-react';

const PAYMENT_LABELS = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', sin_pago: 'Sin pago' };

/**
 * Antes de aprobar el ingreso muestra la orden y los avisos para confirmarlos con
 * el cliente. Pregunta dos veces; en el segundo paso el cliente firma.
 * Props: open, onOpenChange(bool), order, services [{ serviceName, category, price, no_charge }],
 *        breakdown { extras, discountAmount, iva, total }, paymentMethod, requiresInvoice, onConfirm(signatureDataUrl)
 */
export const CheckinConfirmDialog = ({
    open, onOpenChange, order, services = [], breakdown = {}, paymentMethod, requiresInvoice, onConfirm,
}) => {
    const [step, setStep] = useState(1);
    const [accepted, setAccepted] = useState(false);
    const [signature, setSignature] = useState(null);

    useEffect(() => {
        if (open) {
            setStep(1);
            setAccepted(false);
            setSignature(null);
        }
    }, [open]);

    if (!order) return null;

    const noticesBlock = (
        <div className="rounded-lg border-2 border-red-500/60 bg-red-500/10 p-3 space-y-2" data-testid="checkin-notices">
            <p className="flex items-center gap-2 font-bold text-red-500 text-sm">
                <AlertTriangle className="w-4 h-4" />
                AVISOS IMPORTANTES PARA EL CLIENTE
            </p>
            <ol className="list-decimal pl-5 space-y-1.5 text-sm text-red-500 font-medium">
                {CHECKIN_NOTICES.map(n => <li key={n}>{n}</li>)}
            </ol>
        </div>
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid={`checkin-confirm-step-${step}`}>
                {step === 1 ? (
                    <>
                        <DialogHeader>
                            <DialogTitle className="font-heading text-xl">Confirme la orden con el cliente</DialogTitle>
                            <DialogDescription>Lea la orden y los avisos al cliente antes de aprobar el ingreso.</DialogDescription>
                        </DialogHeader>

                        <div className="space-y-3">
                            <div className="rounded-lg border p-3 text-sm space-y-1">
                                <div className="flex justify-between"><span className="text-muted-foreground">Orden</span><span className="font-mono">{order.order_code}</span></div>
                                <div className="flex justify-between"><span className="text-muted-foreground">Cliente</span><span>{order.client_name}</span></div>
                                <div className="flex justify-between"><span className="text-muted-foreground">Vehículo</span><span>{order.plate} · {order.brand} {order.model}</span></div>
                                {paymentMethod && (
                                    <div className="flex justify-between"><span className="text-muted-foreground">Forma de pago</span><span>{PAYMENT_LABELS[paymentMethod] || paymentMethod}</span></div>
                                )}
                            </div>

                            <div className="rounded-lg border p-3 text-sm space-y-1">
                                <p className="font-heading text-primary mb-1">Servicios</p>
                                {services.map((s, idx) => (
                                    <div key={`${s.serviceId}-${idx}`} className="flex justify-between gap-3">
                                        <span className="truncate">{s.serviceName}</span>
                                        <span className="font-mono shrink-0">{s.no_charge ? 'Sin pago' : formatCurrency(s.price || 0)}</span>
                                    </div>
                                ))}
                                {(breakdown.extras || []).map(e => (
                                    <div key={e.id} className="flex justify-between gap-3 text-muted-foreground">
                                        <span className="truncate">+ {e.nombre}</span>
                                        <span className="font-mono shrink-0">{formatCurrency(e.price || 0)}</span>
                                    </div>
                                ))}
                                {breakdown.discountAmount > 0 && (
                                    <div className="flex justify-between text-green-500"><span>Descuento</span><span className="font-mono">-{formatCurrency(breakdown.discountAmount)}</span></div>
                                )}
                                {requiresInvoice && (
                                    <div className="flex justify-between text-muted-foreground"><span>IVA 19%</span><span className="font-mono">{formatCurrency(breakdown.iva || 0)}</span></div>
                                )}
                                <div className="flex justify-between font-bold pt-1 border-t mt-1">
                                    <span>Total</span><span className="font-mono text-primary">{formatCurrency(breakdown.total || 0)}</span>
                                </div>
                            </div>

                            {noticesBlock}

                            <label className="flex items-start gap-2 text-sm cursor-pointer p-2 rounded border">
                                <input
                                    type="checkbox"
                                    checked={accepted}
                                    onChange={(e) => setAccepted(e.target.checked)}
                                    className="w-4 h-4 mt-0.5 accent-primary"
                                    data-testid="checkin-confirm-accept"
                                />
                                Le leí la orden y los avisos al cliente y está de acuerdo.
                            </label>
                        </div>

                        <div className="flex flex-col-reverse sm:flex-row gap-2">
                            <Button type="button" variant="outline" className="sm:flex-1" onClick={() => onOpenChange(false)}>
                                No, corregir
                            </Button>
                            <Button type="button" className="sm:flex-1" disabled={!accepted} onClick={() => setStep(2)} data-testid="checkin-confirm-next">
                                Sí, el cliente confirma
                            </Button>
                        </div>
                    </>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle className="font-heading text-xl">Confirme de nuevo</DialogTitle>
                            <DialogDescription>
                                ¿Está seguro de aprobar el ingreso de {order.plate} por {formatCurrency(breakdown.total || 0)}?
                                El cliente acepta los siguientes avisos:
                            </DialogDescription>
                        </DialogHeader>

                        {noticesBlock}

                        <div className="space-y-2" data-testid="checkin-confirm-signature">
                            <p className="text-sm font-medium flex items-center gap-1.5">
                                <Pen className="w-4 h-4 text-primary" />
                                Firma del cliente *
                            </p>
                            <SignaturePad onSave={setSignature} height={160} />
                            {!signature && (
                                <p className="text-xs text-muted-foreground">El cliente debe firmar para aprobar el ingreso.</p>
                            )}
                        </div>

                        <div className="flex flex-col-reverse sm:flex-row gap-2">
                            <Button type="button" variant="outline" className="sm:flex-1" onClick={() => setStep(1)}>
                                Volver
                            </Button>
                            <Button
                                type="button"
                                className="sm:flex-1 brand-glow"
                                disabled={!signature}
                                onClick={() => { onOpenChange(false); onConfirm(signature); }}
                                data-testid="checkin-confirm-final"
                            >
                                <CheckCircle2 className="w-4 h-4 mr-2" />
                                Sí, aprobar ingreso
                            </Button>
                        </div>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default CheckinConfirmDialog;
