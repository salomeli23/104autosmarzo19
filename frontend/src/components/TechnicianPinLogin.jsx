import React, { useCallback, useEffect, useState } from 'react';
import { authAPI } from '../lib/api';
import { Button } from './ui/button';
import { toast } from 'sonner';
import { ArrowLeft, Delete, Loader2, Wrench } from 'lucide-react';

const PIN_LENGTH = 4;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];

/**
 * Ingreso de técnicos: se escoge el técnico y se marca su PIN de 4 dígitos (también con el teclado físico).
 * Props: onLogin(userId, pin) → Promise, onBack()
 */
export const TechnicianPinLogin = ({ onLogin, onBack }) => {
    const [techs, setTechs] = useState(null);
    const [tech, setTech] = useState(null);
    const [pin, setPin] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        authAPI.pinUsers().then(res => setTechs(res.data || [])).catch(() => setTechs([]));
    }, []);

    const submit = useCallback(async (value) => {
        setBusy(true);
        try {
            await onLogin(tech.id, value);
        } catch (e) {
            toast.error(e.response?.data?.detail || 'PIN incorrecto');
            setPin('');
        } finally {
            setBusy(false);
        }
    }, [onLogin, tech]);

    const press = useCallback((k) => {
        if (busy) return;
        if (k === 'del') { setPin(p => p.slice(0, -1)); return; }
        if (!/^\d$/.test(k) || pin.length >= PIN_LENGTH) return;
        const next = pin + k;
        setPin(next);
        if (next.length === PIN_LENGTH) submit(next);
    }, [busy, pin, submit]);

    // Teclado físico: números, Backspace y Escape
    useEffect(() => {
        if (!tech) return undefined;
        const onKey = (e) => {
            if (/^\d$/.test(e.key)) press(e.key);
            else if (e.key === 'Backspace') press('del');
            else if (e.key === 'Escape') { setTech(null); setPin(''); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [tech, press]);

    if (!tech) {
        return (
            <div className="space-y-4" data-testid="pin-tech-list">
                <p className="text-sm text-muted-foreground text-center">¿Quién eres?</p>
                {techs === null ? (
                    <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin" /></div>
                ) : techs.length === 0 ? (
                    <p className="text-sm text-center text-muted-foreground py-4">Aún no hay técnicos con PIN. El administrador lo asigna en Configuración.</p>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {techs.map(t => (
                            <button key={t.id} type="button" onClick={() => { setTech(t); setPin(''); }}
                                className="flex flex-col items-center gap-1 p-3 rounded-xl border hover:bg-primary/10 hover:border-primary transition-colors"
                                data-testid={`pin-tech-${t.name}`}>
                                <span className="w-10 h-10 rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold">
                                    {t.name.slice(0, 1).toUpperCase()}{(t.name.match(/\d+$/) || [''])[0]}
                                </span>
                                <span className="text-sm font-medium text-center leading-tight">{t.name}</span>
                            </button>
                        ))}
                    </div>
                )}
                <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
                    <ArrowLeft className="w-4 h-4 mr-2" /> Ingresar con correo y contraseña
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-5" data-testid="pin-pad">
            <div className="text-center">
                <p className="text-sm text-muted-foreground flex items-center justify-center gap-1"><Wrench className="w-4 h-4" /> Técnico</p>
                <p className="font-heading text-2xl">{tech.name}</p>
            </div>
            <div className="flex justify-center gap-3" aria-label="PIN">
                {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                    <span key={i} className={`w-4 h-4 rounded-full border-2 ${i < pin.length ? 'bg-primary border-primary' : 'border-muted-foreground/50'}`} />
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
            <Button type="button" variant="ghost" className="w-full" onClick={() => { setTech(null); setPin(''); }} disabled={busy}>
                <ArrowLeft className="w-4 h-4 mr-2" /> Cambiar de técnico
            </Button>
        </div>
    );
};

export default TechnicianPinLogin;
