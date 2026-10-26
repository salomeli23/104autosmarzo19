import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { toast } from 'sonner';
import { Timer, CheckCircle2 } from 'lucide-react';

const SECONDS = 60;

/**
 * Pide confirmar la cita mostrando todos sus datos. Hay 60 segundos para
 * confirmar; si el reloj llega a 0 el modal se cierra sin agendar.
 * Props:
 *   open, onOpenChange(bool)
 *   sections: [{ title, rows: [{ label, value, highlight? }] }]
 *   onConfirm(): Promise
 *   submitting: bool
 */
export const AppointmentConfirmDialog = ({ open, onOpenChange, sections = [], onConfirm, submitting }) => {
    const [secondsLeft, setSecondsLeft] = useState(SECONDS);

    useEffect(() => {
        if (!open) return undefined;
        setSecondsLeft(SECONDS);
        const startedAt = Date.now();
        const id = setInterval(() => {
            const left = SECONDS - Math.floor((Date.now() - startedAt) / 1000);
            setSecondsLeft(Math.max(left, 0));
        }, 250);
        return () => clearInterval(id);
    }, [open]);

    useEffect(() => {
        if (open && secondsLeft === 0 && !submitting) {
            onOpenChange(false);
            toast.error('Se acabó el tiempo. Revise los datos y vuelva a agendar.');
        }
    }, [open, secondsLeft, submitting, onOpenChange]);

    const progress = (secondsLeft / SECONDS) * 100;
    const urgent = secondsLeft <= 10;

    return (
        <Dialog open={open} onOpenChange={(v) => !submitting && onOpenChange(v)}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="appointment-confirm-dialog">
                <DialogHeader>
                    <DialogTitle className="font-heading text-xl">¿Está seguro de agendar esta cita?</DialogTitle>
                    <DialogDescription>Revise cada campo antes de confirmar.</DialogDescription>
                </DialogHeader>

                <div className="space-y-1.5">
                    <div className={`flex items-center justify-between text-sm ${urgent ? 'text-red-500' : 'text-muted-foreground'}`}>
                        <span className="flex items-center gap-1.5">
                            <Timer className="w-4 h-4" />
                            Tiempo para confirmar
                        </span>
                        <span className="font-mono font-bold text-lg" data-testid="appointment-confirm-timer">
                            0:{String(secondsLeft).padStart(2, '0')}
                        </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                            className={`h-full transition-[width] duration-300 ${urgent ? 'bg-red-500' : 'bg-primary'}`}
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>

                <div className="space-y-4">
                    {sections.map((section) => (
                        <div key={section.title} className="rounded-lg border p-3">
                            <p className="font-heading text-sm text-primary mb-2">{section.title}</p>
                            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-sm">
                                {section.rows.filter(r => r.value !== undefined && r.value !== null && r.value !== '').map((row, idx) => (
                                    <React.Fragment key={`${row.label}-${idx}`}>
                                        <dt className="text-muted-foreground">{row.label}</dt>
                                        <dd className={`text-right break-words ${row.highlight ? 'font-bold' : ''}`}>{row.value}</dd>
                                    </React.Fragment>
                                ))}
                            </dl>
                        </div>
                    ))}
                </div>

                <div className="flex flex-col-reverse sm:flex-row gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        className="sm:flex-1"
                        onClick={() => onOpenChange(false)}
                        disabled={submitting}
                        data-testid="appointment-confirm-cancel"
                    >
                        No, corregir datos
                    </Button>
                    <Button
                        type="button"
                        className="sm:flex-1 brand-glow"
                        onClick={onConfirm}
                        disabled={submitting || secondsLeft === 0}
                        data-testid="appointment-confirm-yes"
                    >
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        {submitting ? 'Agendando...' : 'Sí, confirmar cita'}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default AppointmentConfirmDialog;
