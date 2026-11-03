import React, { useEffect, useState } from 'react';
import { settingsAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { formatDateTime } from '../lib/utils';
import { toast } from 'sonner';
import { ShieldCheck } from 'lucide-react';

/** PIN de coordinador: aprueba los cortes de PPF adicionales durante el servicio. Se guarda cifrado y no se muestra. */
export const CoordinatorPinCard = () => {
    const [status, setStatus] = useState(null);
    const [pin, setPin] = useState('');
    const [confirm, setConfirm] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        settingsAPI.getCoordinatorPin().then(res => setStatus(res.data)).catch(() => setStatus(null));
    }, []);

    const save = async () => {
        if (!/^\d{4,10}$/.test(pin)) { toast.error('El PIN debe ser numérico de 4 a 10 dígitos'); return; }
        if (pin !== confirm) { toast.error('Los PIN no coinciden'); return; }
        setSaving(true);
        try {
            await settingsAPI.updateCoordinatorPin(pin);
            toast.success('PIN de coordinador actualizado');
            setPin('');
            setConfirm('');
            const res = await settingsAPI.getCoordinatorPin();
            setStatus(res.data);
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo guardar el PIN');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card className="card-hover" data-testid="coordinator-pin-card">
            <CardHeader>
                <CardTitle className="font-heading text-xl flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-primary" /> PIN de coordinador
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                    Aprueba los cortes de PPF adicionales durante el servicio. Solo lo deben conocer los coordinadores; se guarda cifrado.
                </p>
                <p className={`text-sm ${status?.configured ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {status?.configured
                        ? `Configurado${status.updated_by_name ? ` por ${status.updated_by_name}` : ''}${status.updated_at ? ` · ${formatDateTime(status.updated_at)}` : ''}`
                        : 'Sin configurar: no se pueden aprobar cortes adicionales hasta crearlo.'}
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                        <Label>{status?.configured ? 'Nuevo PIN' : 'PIN'} (4-10 dígitos)</Label>
                        <Input type="password" inputMode="numeric" autoComplete="new-password" maxLength={10} value={pin}
                            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className="font-mono" data-testid="coord-pin-new" />
                    </div>
                    <div className="space-y-1">
                        <Label>Confirmar PIN</Label>
                        <Input type="password" inputMode="numeric" autoComplete="new-password" maxLength={10} value={confirm}
                            onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))} className="font-mono" data-testid="coord-pin-confirm" />
                    </div>
                </div>
                <Button onClick={save} disabled={saving || pin.length < 4} data-testid="coord-pin-save">
                    {saving ? 'Guardando...' : status?.configured ? 'Cambiar PIN' : 'Crear PIN'}
                </Button>
            </CardContent>
        </Card>
    );
};

export default CoordinatorPinCard;
