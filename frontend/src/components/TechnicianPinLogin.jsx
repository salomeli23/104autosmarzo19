import React, { useCallback, useEffect, useState } from 'react';
import { Button } from './ui/button';
import { toast } from 'sonner';
import { ArrowLeft, Delete, Loader2, Wrench } from 'lucide-react';

const ID_LENGTH = 6;
const PIN_LENGTH = 4;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

/**
 * Ingreso de técnicos: ID de entrada (6 dígitos) y después PIN (4 dígitos), con el teclado en pantalla
 * o el teclado físico.
 * Props: onLogin(entryId, pin) → Promise, onBack()
 */
export const TechnicianPinLogin = ({ onLogin, onBack }) => {
    const [entryId, setEntryId] = useState('');
    const [pin, setPin] = useState('');
    const [step, setStep] = useState('id'); // id | pin
    const [busy, setBusy] = useState(false);

    const submit = useCallback(async (value) => {
        setBusy(true);
        try {
            await onLogin(entryId, value);
        } catch (e) {
            toast.error(e.response?.data?.detail || 'ID de entrada o PIN incorrecto');
            setPin('');
            setEntryId('');
            setStep('id');
        } finally {
            setBusy(false);
        }
    }, [onLogin, entryId]);

    const press = useCallback((k) => {
        if (busy) return;
        const isId = step === 'id';
        const value = isId ? entryId : pin;
        const setValue = isId ? setEntryId : setPin;
        if (k === 'del') {
            if (!value && !isId) { setStep('id'); return; }
            setValue(value.slice(0, -1));
            return;
        }
        const max = isId ? ID_LENGTH : PIN_LENGTH;
        if (!/^\d$/.test(k) || value.length >= max) return;
        const next = value + k;
        setValue(next);
        if (next.length === max) {
            if (isId) setStep('pin');
            else submit(next);
        }
    }, [busy, step, entryId, pin, submit]);

    // Teclado físico: números, Backspace y Escape
    useEffect(() => {
        const onKey = (e) => {
            if (/^\d$/.test(e.key)) press(e.key);
            else if (e.key === 'Backspace') press('del');
            else if (e.key === 'Escape') { setEntryId(''); setPin(''); setStep('id'); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [press]);

    const length = step === 'id' ? ID_LENGTH : PIN_LENGTH;
    const filled = (step === 'id' ? entryId : pin).length;

    return (
        <div className="space-y-5" data-testid="pin-pad">
            <div className="text-center space-y-1">
                <p className="text-sm text-muted-foreground flex items-center justify-center gap-1"><Wrench className="w-4 h-4" /> Técnico</p>
                <p className="font-heading text-xl" data-testid="pin-step-title">
                    {step === 'id' ? 'Marca tu ID de entrada' : 'Ahora tu PIN'}
                </p>
                {step === 'pin' && <p className="text-xs text-muted-foreground font-mono">ID {entryId}</p>}
            </div>
            <div className="flex justify-center gap-2.5" aria-label={step === 'id' ? 'ID de entrada' : 'PIN'}>
                {Array.from({ length }).map((_, i) => (
                    step === 'id' ? (
                        <span key={i} className={`w-8 h-10 rounded-md border-2 flex items-center justify-center font-mono text-lg ${i < filled ? 'border-primary' : 'border-muted-foreground/40'}`}>
                            {entryId[i] || ''}
                        </span>
                    ) : (
                        <span key={i} className={`w-4 h-4 rounded-full border-2 ${i < filled ? 'bg-primary border-primary' : 'border-muted-foreground/50'}`} />
                    )
                ))}
            </div>
            <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto">
                {KEYS.map((k, i) => (k === '' ? <span key={i} /> : (
                    <button key={i} type="button" disabled={busy} onClick={() => press(k)}
                        className="h-14 rounded-xl border text-xl font-semibold hover:bg-muted/60 active:bg-primary/20 disabled:opacity-50 flex items-center justify-center"
                        aria-label={k === 'del' ? 'Borrar' : k} data-testid={`pin-key-${k}`}>
                        {k === 'del' ? <Delete className="w-5 h-5" /> : k}
                    </button>
                )))}
            </div>
            {busy && <div className="flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>}
            <Button type="button" variant="ghost" className="w-full" onClick={onBack} disabled={busy}>
                <ArrowLeft className="w-4 h-4 mr-2" /> Ingresar con correo y contraseña
            </Button>
        </div>
    );
};

export default TechnicianPinLogin;
