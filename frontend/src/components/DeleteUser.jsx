import React, { useEffect, useState } from 'react';
import { settingsAPI, usersAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { formatDateTime, ROLE_LABELS } from '../lib/utils';
import { toast } from 'sonner';
import { Trash2, UserX, Loader2 } from 'lucide-react';

/** Configuración: PIN que autoriza borrar usuarios. Se guarda cifrado y no se muestra. */
export const DeleteUserPinCard = () => {
    const [status, setStatus] = useState(null);
    const [pin, setPin] = useState('');
    const [confirm, setConfirm] = useState('');
    const [saving, setSaving] = useState(false);

    const load = () => settingsAPI.getDeleteUserPin().then(res => setStatus(res.data)).catch(() => setStatus(null));
    useEffect(() => { load(); }, []);

    const save = async () => {
        if (!/^\d{4,10}$/.test(pin)) { toast.error('El PIN debe ser numérico de 4 a 10 dígitos'); return; }
        if (pin !== confirm) { toast.error('Los PIN no coinciden'); return; }
        setSaving(true);
        try {
            await settingsAPI.updateDeleteUserPin(pin);
            toast.success('PIN para borrar usuarios guardado');
            setPin('');
            setConfirm('');
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo guardar el PIN');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card className="card-hover" data-testid="delete-user-pin-card">
            <CardHeader>
                <CardTitle className="font-heading text-xl flex items-center gap-2">
                    <UserX className="w-5 h-5 text-red-400" /> PIN para borrar usuarios
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                    Para borrar un usuario se pide este PIN. Se guarda cifrado; tras 5 intentos fallidos se bloquea 5 minutos.
                </p>
                <p className={`text-sm ${status?.configured ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {status?.configured
                        ? `Configurado${status.updated_by_name ? ` por ${status.updated_by_name}` : ''}${status.updated_at ? ` · ${formatDateTime(status.updated_at)}` : ''}`
                        : 'Sin configurar: no se pueden borrar usuarios hasta crearlo.'}
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                        <Label>{status?.configured ? 'Nuevo PIN' : 'PIN'} (4-10 dígitos)</Label>
                        <Input type="password" inputMode="numeric" autoComplete="new-password" maxLength={10} value={pin}
                            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className="font-mono" data-testid="delete-pin-new" />
                    </div>
                    <div className="space-y-1">
                        <Label>Confirmar PIN</Label>
                        <Input type="password" inputMode="numeric" autoComplete="new-password" maxLength={10} value={confirm}
                            onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))} className="font-mono" data-testid="delete-pin-confirm" />
                    </div>
                </div>
                <Button onClick={save} disabled={saving || pin.length < 4} data-testid="delete-pin-save">
                    {saving ? 'Guardando...' : status?.configured ? 'Cambiar PIN' : 'Crear PIN'}
                </Button>
            </CardContent>
        </Card>
    );
};

/** Botón "Borrar" de un usuario: pide el PIN de borrado y confirma. onDeleted(id) al terminar. */
export const DeleteUserButton = ({ target, onDeleted }) => {
    const [open, setOpen] = useState(false);
    const [pin, setPin] = useState('');
    const [busy, setBusy] = useState(false);

    const close = () => { if (!busy) { setOpen(false); setPin(''); } };
    const submit = async () => {
        if (!/^\d{4,10}$/.test(pin)) { toast.error('Escribe el PIN para borrar usuarios'); return; }
        setBusy(true);
        try {
            const { data } = await usersAPI.deleteUser(target.id, pin);
            toast.success(data.message);
            setOpen(false);
            setPin('');
            onDeleted?.(target.id);
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo borrar el usuario');
            setPin('');
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <Button variant="outline" size="sm" className="border-red-500/40 text-red-400 hover:bg-red-500/10"
                onClick={() => setOpen(true)} data-testid={`delete-user-btn-${target.id}`}>
                <Trash2 className="w-4 h-4 sm:mr-1" />
                <span className="hidden sm:inline">Borrar</span>
            </Button>
            <Dialog open={open} onOpenChange={(v) => !v && close()}>
                <DialogContent className="max-w-sm" data-testid="delete-user-dialog">
                    <DialogHeader>
                        <DialogTitle>Borrar a {target.name}</DialogTitle>
                        <DialogDescription>
                            {ROLE_LABELS[target.role] || target.role} · {target.email}. Ya no podrá entrar a la app. Sus servicios y
                            el historial conservan su nombre. Esto no se puede deshacer.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-1">
                        <Label>PIN para borrar usuarios</Label>
                        <Input type="password" inputMode="numeric" autoComplete="off" maxLength={10} value={pin} autoFocus
                            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                            onKeyDown={(e) => e.key === 'Enter' && submit()}
                            className="font-mono text-xl tracking-[0.3em] text-center" data-testid="delete-user-pin" />
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="ghost" onClick={close} disabled={busy}>Cancelar</Button>
                        <Button className="bg-red-600 hover:bg-red-700" onClick={submit} disabled={busy || pin.length < 4} data-testid="delete-user-confirm">
                            {busy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />} Borrar usuario
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default DeleteUserButton;
