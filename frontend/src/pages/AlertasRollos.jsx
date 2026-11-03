import React, { useCallback, useEffect, useState } from 'react';
import { alertsAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { formatDateTime } from '../lib/utils';
import { toast } from 'sonner';
import { BellRing, AlertTriangle, PackageX, Ruler, CheckCheck, Check, RefreshCw, Loader2 } from 'lucide-react';

const fmtM = (m) => `${Number(m || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 })} m`;

const SEVERITY = {
    critical: 'bg-red-500/15 text-red-400 border-red-500/40',
    high: 'bg-orange-500/15 text-orange-400 border-orange-500/40',
    warning: 'bg-amber-500/15 text-amber-400 border-amber-500/40',
};
const ALERT_ICON = { rollo_bajo: Ruler, rollo_agotado: PackageX, rollo_faltante: AlertTriangle };

const Stat = ({ icon: Icon, label, value, tone, testId }) => (
    <Card>
        <CardContent className="p-4 flex items-center gap-3" data-testid={testId}>
            <div className={`w-10 h-10 rounded-full flex items-center justify-center border ${tone}`}><Icon className="w-5 h-5" /></div>
            <div>
                <p className="text-2xl font-bold leading-none">{value}</p>
                <p className="text-xs text-muted-foreground mt-1">{label}</p>
            </div>
        </CardContent>
    </Card>
);

/** Módulo de alertas de rollos para corte y coordinadores: 5 m, 3 m, agotados (dados de baja) y referencias que faltan */
export const AlertasRollos = () => {
    const [status, setStatus] = useState(null);
    const [alerts, setAlerts] = useState([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        try {
            const [st, al] = await Promise.all([alertsAPI.rollStatus(), alertsAPI.getAll({ category: 'rollos' })]);
            setStatus(st.data);
            setAlerts(al.data);
        } catch (e) {
            toast.error('No se pudieron cargar las alertas de rollos');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        const t = setInterval(load, 60000);
        return () => clearInterval(t);
    }, [load]);

    const markRead = async (id) => {
        await alertsAPI.markRead(id).catch(() => {});
        setAlerts(prev => prev.map(a => (a.id === id ? { ...a, read: true } : a)));
    };
    const markAll = async () => {
        await alertsAPI.markAllRead({ category: 'rollos' }).catch(() => {});
        setAlerts(prev => prev.map(a => ({ ...a, read: true })));
    };

    if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin" /></div>;

    const low = status?.low || [];
    const retired = status?.retired || [];
    const missing = status?.missing || [];
    const [t5, t3] = status?.thresholds || [5, 3];
    const unread = alerts.filter(a => !a.read).length;

    return (
        <div className="space-y-6" data-testid="roll-alerts-page">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                    <h1 className="font-heading text-3xl md:text-4xl flex items-center gap-2"><BellRing className="w-8 h-8 text-primary" /> Alertas de rollos</h1>
                    <p className="text-muted-foreground text-sm">
                        Avisos a corte y coordinadores cuando a un rollo le quedan {t5} m o {t3} m, cuando se acaba y cuando falta una referencia.
                        Cada rollo admite 1 corte extradimensional (puede quedar en negativo); después se da de baja.
                    </p>
                </div>
                <Button variant="outline" onClick={load}><RefreshCw className="w-4 h-4 mr-2" /> Actualizar</Button>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Stat icon={Ruler} label={`Rollos entre ${t3} y ${t5} m`} value={low.filter(r => r.metros_restantes > t3).length} tone={SEVERITY.warning} testId="stat-low5" />
                <Stat icon={Ruler} label={`Rollos con ${t3} m o menos`} value={low.filter(r => r.metros_restantes <= t3).length} tone={SEVERITY.high} testId="stat-low3" />
                <Stat icon={PackageX} label="Dados de baja (30 días)" value={retired.length} tone={SEVERITY.critical} testId="stat-retired" />
                <Stat icon={AlertTriangle} label="Referencias que faltan en corte" value={missing.length} tone={SEVERITY.critical} testId="stat-missing" />
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-lg">Rollos por agotarse</CardTitle></CardHeader>
                    <CardContent className="space-y-2" data-testid="low-rolls">
                        {low.length === 0 ? <p className="text-sm text-muted-foreground">Ningún rollo tiene {t5} m o menos.</p> : low.map(r => (
                            <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                                <div className="min-w-0">
                                    <p className="font-medium truncate">{r.nombre || r.tipo_rollo}</p>
                                    <p className="text-xs text-muted-foreground">{r.codigo} · {r.en_stock_corte === false ? 'Bodega' : 'Stock de corte'}</p>
                                </div>
                                <Badge variant="outline" className={r.metros_restantes <= t3 ? SEVERITY.high : SEVERITY.warning}>{fmtM(r.metros_restantes)}</Badge>
                            </div>
                        ))}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-lg">Referencias que faltan en corte</CardTitle></CardHeader>
                    <CardContent className="space-y-2 max-h-80 overflow-y-auto" data-testid="missing-refs">
                        {missing.length === 0 ? <p className="text-sm text-muted-foreground">Todas las referencias tienen rollo en el stock de corte.</p> : missing.map(m => (
                            <div key={m.tipo_rollo} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                                <div className="min-w-0">
                                    <p className="font-medium truncate">{m.tipo_rollo}</p>
                                    <p className="text-xs text-muted-foreground">{m.grupo}</p>
                                </div>
                                <Badge variant="outline" className={SEVERITY[m.severity]}>
                                    {m.en_bodega ? `${m.en_bodega} en bodega` : 'Sin rollos: comprar'}
                                </Badge>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader className="pb-2"><CardTitle className="text-lg">Rollos dados de baja (últimos 30 días)</CardTitle></CardHeader>
                <CardContent className="space-y-2" data-testid="retired-rolls">
                    {retired.length === 0 ? <p className="text-sm text-muted-foreground">No se ha dado de baja ningún rollo.</p> : retired.map(r => (
                        <div key={r.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 rounded-md border p-2 text-sm">
                            <div className="min-w-0">
                                <p className="font-medium truncate">{r.codigo} · {r.nombre || r.tipo_rollo}</p>
                                <p className="text-xs text-muted-foreground">
                                    {formatDateTime(r.dado_de_baja_at)}
                                    {r.extra_cut_used ? ` · Corte extradimensional de ${fmtM(r.extra_cut_metros)} de más${r.extra_cut_order_code ? ` (orden ${r.extra_cut_order_code})` : ''}` : ''}
                                </p>
                            </div>
                            <Badge variant="outline" className={SEVERITY.critical}>Final: {r.metros_restantes < 0 ? `-${fmtM(-r.metros_restantes)}` : fmtM(r.metros_restantes)}</Badge>
                        </div>
                    ))}
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
                    <CardTitle className="text-lg">Notificaciones {unread > 0 && <Badge className="ml-2">{unread} sin leer</Badge>}</CardTitle>
                    {unread > 0 && <Button size="sm" variant="ghost" onClick={markAll}><CheckCheck className="w-4 h-4 mr-1" /> Marcar todas</Button>}
                </CardHeader>
                <CardContent className="space-y-2" data-testid="roll-notifications">
                    {alerts.length === 0 ? <p className="text-sm text-muted-foreground">Sin notificaciones de rollos.</p> : alerts.map(a => {
                        const Icon = ALERT_ICON[a.alert_type] || BellRing;
                        return (
                            <div key={a.id} className={`flex items-start gap-3 rounded-md border p-3 ${a.read ? 'opacity-70' : 'border-primary/40 bg-primary/5'}`}>
                                <div className={`w-9 h-9 rounded-full flex items-center justify-center border shrink-0 ${SEVERITY[a.severity] || SEVERITY.warning}`}><Icon className="w-4 h-4" /></div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-sm">{a.title}</p>
                                    <p className="text-sm text-muted-foreground">{a.message}</p>
                                    <p className="text-xs text-muted-foreground mt-1">{formatDateTime(a.created_at)}</p>
                                </div>
                                {!a.read && (
                                    <Button size="sm" variant="ghost" onClick={() => markRead(a.id)} aria-label="Marcar como leída"><Check className="w-4 h-4" /></Button>
                                )}
                            </div>
                        );
                    })}
                </CardContent>
            </Card>
        </div>
    );
};

export default AlertasRollos;
