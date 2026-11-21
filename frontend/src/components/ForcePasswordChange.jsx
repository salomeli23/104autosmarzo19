import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { authAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';
import { KeyRound, Loader2, LogOut } from 'lucide-react';

/** Cuenta creada con contraseña temporal: el usuario debe cambiarla antes de usar la app. */
export const ForcePasswordChange = () => {
    const { user, refreshUser, logout } = useAuth();
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [busy, setBusy] = useState(false);
    if (!user?.must_change_password) return null;

    const submit = async () => {
        if (next.length < 8) { toast.error('La contraseña nueva debe tener al menos 8 caracteres'); return; }
        if (next !== confirm) { toast.error('La contraseña nueva y la confirmación no coinciden'); return; }
        setBusy(true);
        try {
            const { data } = await authAPI.changePassword({ current_password: current, new_password: next });
            toast.success(data.message);
            await refreshUser();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo cambiar la contraseña');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open>
            <DialogContent className="max-w-sm [&>button]:hidden" onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}
                data-testid="force-password-dialog">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><KeyRound className="w-5 h-5 text-primary" /> Crea tu contraseña</DialogTitle>
                    <DialogDescription>Hola {user.name}. Entraste con una contraseña temporal: cámbiala para seguir.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <div className="space-y-1">
                        <Label>Contraseña temporal</Label>
                        <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus data-testid="force-pw-current" />
                    </div>
                    <div className="space-y-1">
                        <Label>Contraseña nueva (mínimo 8 caracteres)</Label>
                        <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} data-testid="force-pw-new" />
                    </div>
                    <div className="space-y-1">
                        <Label>Repite la contraseña nueva</Label>
                        <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="force-pw-confirm" />
                    </div>
                    <div className="flex gap-2 pt-1">
                        <Button variant="ghost" onClick={logout} disabled={busy}><LogOut className="w-4 h-4 mr-1" /> Salir</Button>
                        <Button className="flex-1" onClick={submit} disabled={busy || !current || next.length < 8 || !confirm} data-testid="force-pw-save">
                            {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <KeyRound className="w-4 h-4 mr-1" />} Guardar contraseña
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default ForcePasswordChange;
