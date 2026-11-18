import React, { useCallback, useEffect, useState } from 'react';
import { cuttingAPI } from '../lib/api';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { formatDateTime } from '../lib/utils';
import { toast } from 'sonner';
import { ShieldCheck, Check, X, Loader2 } from 'lucide-react';

const fmtM = (m) => `${(Math.round((m || 0) * 100) / 100).toFixed(2).replace('.', ',')} m`;

/**
 * Cortes de PPF por aprobar. Todo corte de PPF (el principal y los adicionales) lo aprueba un coordinador antes de cortar.
 * Props: canReview (coordinador/admin), refreshKey, onChanged(), showEmpty (muestra un aviso si no hay pendientes)
 */
export const PpfApprovalQueue = ({ canReview, refreshKey, onChanged, showEmpty = false }) => {
    const [items, setItems] = useState([]);
    const [busy, setBusy] = useState('');
    const [rejecting, setRejecting] = useState(null);
    const [note, setNote] = useState('');

    const load = useCallback(() => {
        cuttingAPI.ppfRequests('pendiente').then(res => setItems(res.data || [])).catch(() => setItems([]));
    }, []);
    useEffect(() => {
        load();
        const t = setInterval(load, 30000);
        return () => clearInterval(t);
    }, [load, refreshKey]);

    const review = async (req, action) => {
        if (action === 'rechazar' && note.trim().length < 3) { toast.error('Escribe por qué se rechaza'); return; }
        setBusy(req.id);
        try {
            const { data } = await cuttingAPI.reviewPpfRequest(req.id, { action, note: action === 'rechazar' ? note.trim() : null });
            toast.success(data.status === 'ejecutado' ? 'Corte adicional aprobado y descontado del inventario'
                : data.status === 'aprobado' ? 'Corte de PPF aprobado: corte ya puede cortarlo' : 'Corte de PPF rechazado');
            setRejecting(null);
            setNote('');
            load();
            onChanged?.();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo revisar');
        } finally {
            setBusy('');
        }
    };

    if (!items.length) {
        return showEmpty ? (
            <p className="text-center py-10 text-sm text-muted-foreground" data-testid="ppf-approval-empty">
                No hay cortes de PPF por aprobar. Cuando Corte envíe uno aparecerá aquí y te llegará una notificación.
            </p>
        ) : null;
    }
    return (
        <div className="space-y-3" data-testid="ppf-approval-queue">
            <h2 className="font-heading text-xl flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-amber-400" /> Cortes de PPF por aprobar
                <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40">{items.length}</Badge>
            </h2>
            {!canReview && <p className="text-sm text-muted-foreground">Esperando la aprobación de un coordinador. Sin aprobación no se puede cortar.</p>}
            <div className="grid gap-3 md:grid-cols-2">
                {items.map(r => (
                    <Card key={r.id} className="border-amber-500/40" data-testid={`ppf-request-${r.id}`}>
                        <CardContent className="pt-5 space-y-2 text-sm">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="font-heading text-lg">{r.plate}</p>
                                    <p className="text-muted-foreground truncate">{r.brand} {r.model} · {r.client_name}</p>
                                </div>
                                <Badge variant="outline" className={r.kind === 'adicional' ? 'border-purple-500/50 text-purple-300' : 'border-cyan-500/50 text-cyan-300'}>
                                    {r.kind === 'adicional' ? 'PPF adicional' : 'Corte de PPF'}
                                </Badge>
                            </div>
                            <div className="rounded-md border p-2 space-y-0.5 text-xs">
                                {r.lines.map((l, i) => (
                                    <p key={i} className="flex justify-between gap-2">
                                        <span><b>{l.part}</b> · {l.material}{l.reutilizable ? ' (reutilizable)' : ''}</span>
                                        <span className="font-mono shrink-0">{fmtM(l.metros)}</span>
                                    </p>
                                ))}
                                <p className="flex justify-between gap-2 border-t pt-1 font-semibold"><span>Total</span><span className="font-mono">{fmtM(r.total_metros)}</span></p>
                            </div>
                            {r.reason && <p className="text-xs"><span className="text-muted-foreground">Motivo:</span> {r.reason}</p>}
                            <p className="text-xs text-muted-foreground">Pidió {r.requested_by_name} · {formatDateTime(r.created_at)}</p>
                            {canReview && (rejecting === r.id ? (
                                <div className="space-y-2">
                                    <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="¿Por qué se rechaza?"
                                        className="w-full rounded-md border border-red-500/50 bg-background px-2 py-1 text-sm" />
                                    <div className="flex gap-2">
                                        <Button size="sm" variant="ghost" onClick={() => { setRejecting(null); setNote(''); }}>Cancelar</Button>
                                        <Button size="sm" className="bg-red-600 hover:bg-red-700" disabled={busy === r.id} onClick={() => review(r, 'rechazar')}>Rechazar</Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex gap-2">
                                    <Button size="sm" variant="outline" className="flex-1 border-red-500/40 text-red-400" onClick={() => setRejecting(r.id)} disabled={busy === r.id}>
                                        <X className="w-4 h-4 mr-1" /> Rechazar
                                    </Button>
                                    <Button size="sm" className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={() => review(r, 'aprobar')} disabled={busy === r.id} data-testid={`ppf-approve-${r.id}`}>
                                        {busy === r.id ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Check className="w-4 h-4 mr-1" />} Aprobar
                                    </Button>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    );
};

export default PpfApprovalQueue;
