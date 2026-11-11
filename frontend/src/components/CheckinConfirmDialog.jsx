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
 *        breakdown { extras, itemsDiscount, discountAmount, iva, total }, paymentMethod, requiresInvoice,
 *        onConfirm(signatureDataUrl, { vehicle_type, over_existing_film, over_existing_film_note })
 */
export const CheckinConfirmDialog = ({
    open, onOpenChange, order, services = [], breakdown = {}, paymentMethod, requiresInvoice, onConfirm,
}) => {
    const [step, setStep] = useState(1);
    const [accepted, setAccepted] = useState(false);
    const [signature, setSignature] = useState(null);
    // Preguntas antes de cerrar: tipo de vehículo y si el material va encima de otro material o color
    const [vehicleType, setVehicleType] = useState('');
    const [overFilm, setOverFilm] = useState(null);
    const [overFilmNote, setOverFilmNote] = useState('');

    useEffect(() => {
        if (open) {
            setStep(1);
            setAccepted(false);
            setSignature(null);
            setVehicleType('');
            setOverFilm(null);
            setOverFilmNote('');
        }
    }, [open]);
    const questionsDone = !!vehicleType && overFilm !== null && (!overFilm || overFilmNote.trim().length >= 3);

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
                                        <span className="truncate">{s.serviceName}{s.film_label ? ` · ${s.film_label}` : ''}</span>
                                        <span className="font-mono shrink-0">{s.no_charge ? 'Sin pago' : formatCurrency(s.price || 0)}</span>
                                    </div>
                                ))}
                                {(breakdown.extras || []).map(e => (
                                    <div key={e.id} className="flex justify-between gap-3 text-muted-foreground">
                                        <span className="truncate">+ {e.nombre}</span>
                                        <span className="font-mono shrink-0">{formatCurrency(e.price || 0)}</span>
                                    </div>
                                ))}
                                {breakdown.itemsDiscount > 0 && (
                                    <div className="flex justify-between text-green-500"><span>Descuentos por ítem</span><span className="font-mono">-{formatCurrency(breakdown.itemsDiscount)}</span></div>
                                )}
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

                            <div className="rounded-lg border border-cyan-500/40 bg-cyan-500/5 p-3 space-y-3" data-testid="checkin-vehicle-questions">
                                <div className="space-y-1.5">
                                    <p className="text-sm font-medium">¿Es auto o camioneta? *</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {[['auto', 'Auto'], ['camioneta', 'Camioneta']].map(([k, label]) => (
                                            <button key={k} type="button" onClick={() => setVehicleType(k)} data-testid={`checkin-vehicle-${k}`}
                                                className={`py-2 rounded-md border text-sm ${vehicleType === k ? 'border-cyan-500 bg-cyan-500/20 text-cyan-200 font-semibold' : 'border-border hover:border-cyan-500/50'}`}>
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="space-y-1.5">
                                    <p className="text-sm font-medium">¿El material se va a colocar encima de un vidrio que ya tiene material o es de otro color? *</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {[[true, 'Sí'], [false, 'No']].map(([v, label]) => (
                                            <button key={label} type="button" onClick={() => setOverFilm(v)} data-testid={`checkin-overfilm-${v ? 'si' : 'no'}`}
                                                className={`py-2 rounded-md border text-sm ${overFilm === v ? (v ? 'border-amber-500 bg-amber-500/20 text-amber-200 font-semibold' : 'border-cyan-500 bg-cyan-500/20 text-cyan-200 font-semibold') : 'border-border hover:border-cyan-500/50'}`}>
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                    {overFilm && (
                                        <textarea value={overFilmNote} onChange={(e) => setOverFilmNote(e.target.value)} rows={2}
                                            placeholder="¿En qué vidrios y qué material o color tienen? (ej. panorámico con película azul)"
                                            className="w-full rounded-md border border-amber-500/50 bg-background px-3 py-2 text-sm" data-testid="checkin-overfilm-note" />
                                    )}
                                    {overFilm && <p className="text-xs text-amber-400">Se avisará al técnico y a corte con alerta.</p>}
                                </div>
                            </div>

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
                            <Button type="button" className="sm:flex-1" disabled={!accepted || !questionsDone} onClick={() => setStep(2)} data-testid="checkin-confirm-next">
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
                                onClick={() => {
                                    onOpenChange(false);
                                    onConfirm(signature, { vehicle_type: vehicleType, over_existing_film: overFilm, over_existing_film_note: overFilm ? overFilmNote.trim() : null });
                                }}
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
