import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { authAPI } from '../lib/api';
import { toast } from 'sonner';
import { KeyRound, Loader2 } from 'lucide-react';

const pinInput = (value, onChange, testId, autoFocus = false) => (
    <Input type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={value} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
        className="font-mono text-xl tracking-[0.5em] text-center h-12" data-testid={testId} />
);

/** El usuario cambia su propio PIN de ingreso (pide el PIN actual). */
export const ChangePinDialog = ({ open, onOpenChange }) => {
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [busy, setBusy] = useState(false);

    const reset = () => { setCurrent(''); setNext(''); setConfirm(''); };
    const close = (v) => { if (busy) return; if (!v) reset(); onOpenChange(v); };

    const submit = async () => {
        if (current.length !== 4) { toast.error('Escribe tu PIN actual'); return; }
        if (next.length !== 4) { toast.error('El PIN nuevo debe tener 4 dígitos'); return; }
        if (next !== confirm) { toast.error('El PIN nuevo y la confirmación no coinciden'); return; }
        setBusy(true);
        try {
            const { data } = await authAPI.changePin({ current_pin: current, new_pin: next });
            toast.success(data.message);
            reset();
            onOpenChange(false);
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo cambiar el PIN');
            setCurrent('');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={close}>
            <DialogContent className="max-w-sm" data-testid="change-pin-dialog">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><KeyRound className="w-5 h-5 text-primary" /> Cambiar mi PIN</DialogTitle>
                    <DialogDescription>Tu ID de entrada sigue igual. El PIN nuevo sirve desde tu próximo ingreso.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <div className="space-y-1">
                        <Label>PIN actual</Label>
                        {pinInput(current, setCurrent, 'change-pin-current', true)}
                    </div>
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
                    <Button onClick={submit} disabled={busy || current.length < 4 || next.length < 4 || confirm.length < 4} data-testid="change-pin-save">
                        {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <KeyRound className="w-4 h-4 mr-1" />} Cambiar PIN
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default ChangePinDialog;
