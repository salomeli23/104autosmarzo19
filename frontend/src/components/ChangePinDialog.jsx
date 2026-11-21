import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { authAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';
import { KeyRound, Loader2 } from 'lucide-react';

const pinInput = (value, onChange, testId, autoFocus = false) => (
    <Input type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={value} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
        className="font-mono text-xl tracking-[0.5em] text-center h-12" data-testid={testId} />
);

/**
 * El usuario cambia su propio PIN (pide el PIN actual).
 * Coordinadores y asesores sin PIN lo crean confirmando su contraseña: con él autorizan reagendar citas.
 */
export const ChangePinDialog = ({ open, onOpenChange }) => {
    const { user, refreshUser } = useAuth();
    const creating = !user?.has_pin && ['coordinador', 'asesor'].includes(user?.role);
    const [password, setPassword] = useState('');
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [busy, setBusy] = useState(false);

    const reset = () => { setPassword(''); setCurrent(''); setNext(''); setConfirm(''); };
    const close = (v) => { if (busy) return; if (!v) reset(); onOpenChange(v); };

    const submit = async () => {
        if (creating && !password) { toast.error('Escribe tu contraseña'); return; }
        if (!creating && current.length !== 4) { toast.error('Escribe tu PIN actual'); return; }
        if (next.length !== 4) { toast.error('El PIN nuevo debe tener 4 dígitos'); return; }
        if (next !== confirm) { toast.error('El PIN nuevo y la confirmación no coinciden'); return; }
        setBusy(true);
        try {
            const { data } = await authAPI.changePin(creating ? { password, new_pin: next } : { current_pin: current, new_pin: next });
            toast.success(data.message);
            if (creating) refreshUser().catch(() => {});
            reset();
            onOpenChange(false);
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo cambiar el PIN');
            setCurrent('');
            setPassword('');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent className="max-w-sm" data-testid="change-pin-dialog">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><KeyRound className="w-5 h-5 text-primary" /> {creating ? 'Crear mi PIN' : 'Cambiar mi PIN'}</DialogTitle>
                    <DialogDescription>
                        {creating ? 'Con tu PIN autorizas reagendar citas en Agendamiento.'
                            : user?.role === 'tecnico' ? 'Tu ID de entrada sigue igual. El PIN nuevo sirve desde tu próximo ingreso.'
                            : 'Con tu PIN autorizas reagendar citas en Agendamiento.'}
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    {creating ? (
                        <div className="space-y-1">
                            <Label>Tu contraseña de ingreso</Label>
                            <Input type="password" autoComplete="current-password" value={password} autoFocus
                                onChange={(e) => setPassword(e.target.value)} data-testid="change-pin-password" />
                        </div>
                    ) : (
                        <div className="space-y-1">
                            <Label>PIN actual</Label>
                            {pinInput(current, setCurrent, 'change-pin-current', true)}
                        </div>
                    )}
                    <div className="space-y-1">
                        <Label>PIN nuevo (4 dígitos)</Label>
                        {pinInput(next, setNext, 'change-pin-new')}
                    </div>
                    <div className="space-y-1">
                        <Label>Repite el PIN nuevo</Label>
                        {pinInput(confirm, setConfirm, 'change-pin-confirm')}
                    </div>
                    <p className="text-xs text-muted-foreground">No uses números repetidos (1111) ni consecutivos (1234). No compartas tu PIN.</p>
                </div>
                <DialogFooter className="gap-2">
                    <Button variant="ghost" onClick={() => close(false)} disabled={busy}>Cancelar</Button>
                    <Button onClick={submit} disabled={busy || (creating ? !password : current.length < 4) || next.length < 4 || confirm.length < 4} data-testid="change-pin-save">
                        {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <KeyRound className="w-4 h-4 mr-1" />} {creating ? 'Crear PIN' : 'Cambiar PIN'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default ChangePinDialog;
