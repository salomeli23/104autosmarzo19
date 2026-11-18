import React, { useCallback, useEffect, useState } from 'react';
import { cuttingAPI } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { PpfApprovalQueue } from '../components/PpfApprovalQueue';
import { PlateBadge } from '../components/PlateBadge';
import { formatDateTime } from '../lib/utils';
import { ShieldCheck, RefreshCw, History, CheckCircle, XCircle } from 'lucide-react';

const fmtM = (m) => `${(Math.round((m || 0) * 100) / 100).toFixed(2).replace('.', ',')} m`;
const STATUS = {
    aprobado: { label: 'Aprobado', icon: CheckCircle, cls: 'text-emerald-400' },
    ejecutado: { label: 'Aprobado y descontado', icon: CheckCircle, cls: 'text-emerald-400' },
    rechazado: { label: 'Rechazado', icon: XCircle, cls: 'text-red-400' },
};

/** Coordinador: aprueba o rechaza los cortes de PPF antes de que Corte los corte, y ve lo ya revisado */
export const AprobacionCortes = () => {
    const [refreshKey, setRefreshKey] = useState(0);
    const [history, setHistory] = useState([]);

    const loadHistory = useCallback(() => {
        cuttingAPI.ppfRequests('todas')
            .then(res => setHistory((res.data || []).filter(r => r.status !== 'pendiente').slice(0, 30)))
            .catch(() => setHistory([]));
    }, []);
    useEffect(() => { loadHistory(); }, [loadHistory, refreshKey]);

    return (
        <div className="space-y-6" data-testid="aprobacion-cortes-page">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="font-heading text-3xl md:text-4xl flex items-center gap-2">
                        <ShieldCheck className="w-8 h-8 text-amber-400" /> Aprobación de cortes
                    </h1>
                    <p className="text-muted-foreground">Cortes de PPF que pide Corte. Sin tu aprobación no se pueden cortar.</p>
                </div>
                <Button variant="outline" onClick={() => setRefreshKey(k => k + 1)}><RefreshCw className="w-4 h-4 mr-2" /> Actualizar</Button>
            </div>

            <PpfApprovalQueue canReview showEmpty refreshKey={refreshKey} onChanged={() => setRefreshKey(k => k + 1)} />

            <section className="space-y-3" data-testid="ppf-approval-history">
                <h2 className="font-heading text-xl flex items-center gap-2"><History className="w-5 h-5 text-muted-foreground" /> Revisados recientemente</h2>
                {history.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Todavía no hay cortes revisados.</p>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                        {history.map(r => {
                            const st = STATUS[r.status] || { label: r.status, icon: CheckCircle, cls: '' };
                            const Icon = st.icon;
                            return (
                                <Card key={r.id}>
                                    <CardContent className="p-3 space-y-1 text-xs">
                                        <div className="flex items-center justify-between gap-2 flex-wrap">
                                            <div className="flex items-center gap-2">
                                                <PlateBadge plate={r.plate} size="sm" />
                                                <span className="text-muted-foreground">{r.kind === 'adicional' ? 'PPF adicional' : 'Corte de PPF'} · {fmtM(r.total_metros)}</span>
                                            </div>
                                            <span className={`flex items-center gap-1 font-medium ${st.cls}`}><Icon className="w-3.5 h-3.5" /> {st.label}</span>
                                        </div>
                                        <p className="text-muted-foreground">
                                            Pidió {r.requested_by_name} · revisó {r.reviewed_by_name || '—'} · {formatDateTime(r.reviewed_at || r.created_at)}
                                        </p>
                                        {r.review_note && <p className="text-red-300">Motivo: {r.review_note}</p>}
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                )}
            </section>
        </div>
    );
};

export default AprobacionCortes;
