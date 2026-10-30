import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { paymentsAPI } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { PlateBadge } from '../components/PlateBadge';
import { formatCurrency } from '../lib/utils';
import { toast } from 'sonner';
import { Landmark, Search, Loader2, FileDown, User, IdCard, MapPin, Filter, RefreshCw, Car } from 'lucide-react';

const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('es-CO') : '-');
const reteicaRate = (r) => (r.reteica_unit === 'por_mil' ? `${r.reteica_rate}/1000` : `${r.reteica_rate}%`);

const downloadBlob = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
};

const Stat = ({ label, value, className = '' }) => (
    <Card>
        <CardContent className="p-3">
            <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
            <p className={`font-mono text-lg font-bold ${className}`}>{value}</p>
        </CardContent>
    </Card>
);

const RetentionRow = ({ r, onCertificate, busy }) => (
    <div className="p-3 rounded-lg border border-border space-y-3" data-testid={`ret-row-${r.id}`}>
        <div className="flex items-start gap-3 flex-wrap">
            <PlateBadge plate={r.plate} size="md" />
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{[r.brand, r.model, r.color].filter(Boolean).join(' ') || 'Vehículo'}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                    Orden {r.order_code} · {fmt(r.applied_at)}
                    {r.city && <><MapPin className="w-3 h-3" /> {r.city}</>}
                    {r.invoice_number && <> · Factura {r.invoice_number}</>}
                </p>
                <div className="flex gap-1 flex-wrap mt-1">
                    {r.certificate_number && <Badge variant="outline" className="text-[10px] whitespace-nowrap" data-testid={`ret-cert-number-${r.id}`}>{r.certificate_number}</Badge>}
                    {r.times_modified > 0 && <Badge variant="outline" className="text-[10px] whitespace-nowrap text-amber-400 border-amber-500/40">Modificada {r.times_modified} {r.times_modified === 1 ? 'vez' : 'veces'}</Badge>}
                    {r.no_aplica && <Badge variant="outline" className="text-[10px]">Sin retención</Badge>}
                </div>
            </div>
            {!r.no_aplica && (
                <Button size="sm" variant="outline" onClick={() => onCertificate(r)} disabled={busy} data-testid={`ret-cert-btn-${r.id}`}>
                    {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <FileDown className="w-4 h-4 mr-1.5" />}
                    Certificado PDF
                </Button>
            )}
        </div>
        {!r.no_aplica && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs rounded-md bg-muted/40 p-2">
                <div>
                    <p className="text-[10px] text-muted-foreground">Base (sin IVA)</p>
                    <p className="font-mono">{formatCurrency(r.retention_base)}</p>
                </div>
                <div>
                    <p className="text-[10px] text-muted-foreground">Retefuente {r.retefuente_applied ? `${r.retefuente_rate}%` : ''}</p>
                    <p className="font-mono text-cyan-400">{formatCurrency(r.retefuente_amount || 0)}</p>
                </div>
                <div>
                    <p className="text-[10px] text-muted-foreground">ICA {r.reteica_applied ? reteicaRate(r) : ''}</p>
                    <p className="font-mono text-cyan-400">{formatCurrency(r.reteica_amount || 0)}</p>
                </div>
                <div>
                    <p className="text-[10px] text-muted-foreground">Total retenido</p>
                    <p className="font-mono font-bold text-amber-400">{formatCurrency(r.total_retention || 0)}</p>
                </div>
            </div>
        )}
    </div>
);

/** Retenciones registradas por cliente y por auto, con su certificado en PDF */
export const Retenciones = () => {
    const [items, setItems] = useState([]);
    const [summary, setSummary] = useState({});
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState('');
    const [onlyWithRetention, setOnlyWithRetention] = useState(true);
    const [busy, setBusy] = useState(null);

    const load = useCallback(async () => {
        try {
            const { data } = await paymentsAPI.retentionsRegistry(q.trim() || undefined);
            setItems(data.items || []);
            setSummary(data.summary || {});
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Error al cargar las retenciones');
        } finally {
            setLoading(false);
        }
    }, [q]);

    useEffect(() => {
        const t = setTimeout(load, 300);
        return () => clearTimeout(t);
    }, [load]);

    // Agrupar por cliente (NIT/cédula o nombre) y dentro por auto
    const clients = useMemo(() => {
        const map = new Map();
        items.filter(r => !onlyWithRetention || !r.no_aplica).forEach(r => {
            const key = (r.client_cedula || r.client_name || '').trim().toLowerCase();
            if (!map.has(key)) map.set(key, { key, name: r.client_name, cedula: r.client_cedula, razon: r.client_razon_social, rows: [], total: 0 });
            const c = map.get(key);
            c.rows.push(r);
            c.total += r.no_aplica ? 0 : (r.total_retention || 0);
        });
        return [...map.values()].map(c => ({
            ...c,
            vehicles: [...new Set(c.rows.map(r => r.plate))],
            rows: c.rows.sort((a, b) => (a.plate || '').localeCompare(b.plate || '') || (b.applied_at || '').localeCompare(a.applied_at || '')),
        })).sort((a, b) => b.total - a.total);
    }, [items, onlyWithRetention]);

    const downloadCertificate = async (r) => {
        setBusy(r.id);
        try {
            const res = await paymentsAPI.retentionCertificate(r.id);
            const name = (res.headers?.['content-disposition'] || '').match(/filename="([^"]+)"/)?.[1] || `certificado_retencion_${r.plate}.pdf`;
            downloadBlob(res.data, name);
            if (!r.certificate_number) load();
        } catch (e) {
            toast.error('No se pudo generar el certificado');
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="space-y-6" data-testid="retenciones-page">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="font-heading text-3xl md:text-4xl flex items-center gap-2"><Landmark className="w-8 h-8 text-cyan-400" /> Retenciones</h1>
                    <p className="text-muted-foreground">Retenciones registradas por cliente y por auto, con su certificado en PDF.</p>
                </div>
                <Button variant="outline" onClick={load}><RefreshCw className="w-4 h-4 mr-2" /> Actualizar</Button>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="ret-summary">
                <Stat label="Clientes" value={summary.clients || 0} />
                <Stat label="Retefuente" value={formatCurrency(summary.total_retefuente || 0)} className="text-cyan-400" />
                <Stat label="ICA" value={formatCurrency(summary.total_reteica || 0)} className="text-cyan-400" />
                <Stat label="Total retenido" value={formatCurrency(summary.total_retention || 0)} className="text-amber-400" />
            </div>

            <Card>
                <CardContent className="p-4 flex flex-col md:flex-row gap-3 md:items-center">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input value={q} onChange={(e) => setQ(e.target.value)} className="pl-9"
                            placeholder="Buscar por cliente, NIT/cédula, placa, orden o certificado" data-testid="ret-search" />
                    </div>
                    <Button variant={onlyWithRetention ? 'default' : 'outline'} onClick={() => setOnlyWithRetention(v => !v)} data-testid="ret-filter">
                        <Filter className="w-4 h-4 mr-2" /> {onlyWithRetention ? 'Solo con retención' : 'Incluye sin retención'}
                    </Button>
                </CardContent>
            </Card>

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin" /></div>
            ) : clients.length === 0 ? (
                <p className="text-center py-12 text-muted-foreground text-sm">Sin retenciones registradas.</p>
            ) : (
                <div className="space-y-4">
                    {clients.map(c => (
                        <Card key={c.key} data-testid={`ret-client-${c.cedula || c.name}`}>
                            <CardContent className="p-4 space-y-3">
                                <div className="flex items-start justify-between gap-3 flex-wrap">
                                    <div className="min-w-0">
                                        <p className="font-medium flex items-center gap-2"><User className="w-4 h-4" /> {c.name}</p>
                                        <p className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                                            <IdCard className="w-3 h-3" /> {c.cedula || 'sin NIT/cédula'}
                                            {c.razon && <> · {c.razon}</>}
                                            <> · <Car className="w-3 h-3" /> {c.vehicles.length} {c.vehicles.length === 1 ? 'auto' : 'autos'}</>
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-[10px] uppercase text-muted-foreground">Total retenido</p>
                                        <p className="font-mono font-bold text-amber-400">{formatCurrency(c.total)}</p>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    {c.rows.map(r => <RetentionRow key={r.id} r={r} onCertificate={downloadCertificate} busy={busy === r.id} />)}
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
};

export default Retenciones;
