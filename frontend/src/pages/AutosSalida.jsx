import React, { useState, useEffect, useCallback } from 'react';
import { paymentsAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { PlateBadge } from '../components/PlateBadge';
import { CarAvatar } from '../components/CarAvatar';
import { PostventaBadge } from '../components/PostventaBadge';
import { formatCurrency } from '../lib/utils';
import { toast } from 'sonner';
import {
    CheckCircle, AlertTriangle, Loader2, Clock, DollarSign, FileBadge, Download, ShieldCheck, BadgeCheck, DoorOpen,
} from 'lucide-react';

const CERTIFICATE_ROLES = ['admin', 'facturacion', 'coordinador', 'calidad'];
const EXIT_ROLES = ['admin', 'seguridad', 'coordinador'];

const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : '-');

const downloadBlob = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
};

export const AutosSalida = () => {
    const { user } = useAuth();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(null);
    const canCertify = CERTIFICATE_ROLES.includes(user?.role);
    const canExit = EXIT_ROLES.includes(user?.role);
    const isSecurity = user?.role === 'seguridad';

    const load = useCallback(async () => {
        try {
            const res = await paymentsAPI.pendingRelease();
            setOrders(res.data);
        } catch (e) {
            toast.error('Error al cargar los vehículos listos para entrega');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        const t = setInterval(load, 30000);
        return () => clearInterval(t);
    }, [load]);

    const run = async (key, fn, ok) => {
        setBusy(key);
        try {
            const res = await fn();
            if (ok) toast.success(typeof ok === 'function' ? ok(res) : ok);
            load();
        } catch (e) {
            const detail = e.response?.data?.detail;
            toast.error(typeof detail === 'string' ? detail : 'No se pudo completar la acción');
        } finally {
            setBusy(null);
        }
    };

    const issue = (o) => run(`cert-${o.id}`, () => paymentsAPI.issueExitCertificate(o.id),
        (res) => `Certificado ${res.data.certificate.number} enviado al coordinador y al jefe de seguridad`);

    const download = (o) => run(`pdf-${o.id}`, async () => {
        const res = await paymentsAPI.downloadExitCertificate(o.id);
        downloadBlob(res.data, `certificado_salida_${o.exit_certificate?.number || o.plate}.pdf`);
    });

    const registerExit = (o) => run(`exit-${o.id}`, () => paymentsAPI.registerSecurityExit(o.id), 'Salida registrada en portería');

    const unpaid = orders.filter(o => !o.exit_certificate && o.balance > 0.01);
    const ready = orders.filter(o => !o.exit_certificate && o.balance <= 0.01);
    const certified = orders.filter(o => o.exit_certificate && !o.security_exit_at);
    const exited = orders.filter(o => o.exit_certificate && o.security_exit_at);

    const renderCard = (o) => {
        const hasBalance = o.balance > 0.01;
        const cert = o.exit_certificate;
        const blockers = o.certificate_blockers || [];
        return (
            <Card
                key={o.id}
                className={`card-hover ${hasBalance && !cert ? 'border-red-500/40' : cert ? 'border-green-500/40' : 'border-cyan-500/40'}`}
                data-testid={`salida-row-${o.id}`}
            >
                <CardContent className="p-4 space-y-3">
                    <div className="flex flex-col md:flex-row gap-3 items-start md:items-center">
                        <CarAvatar photoUrl={o.profile_photo_url} size={44} />
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <PlateBadge plate={o.plate} size="md" />
                                <PostventaBadge order={o} />
                                {o.quality_status === 'aprobado' && (
                                    <Badge className="bg-violet-500/20 text-violet-400 border-violet-500/40">
                                        <BadgeCheck className="w-3 h-3 mr-1" /> Calidad aprobada
                                    </Badge>
                                )}
                                {hasBalance && !cert && (
                                    <Badge className="bg-red-500/20 text-red-500 border-red-500/40" data-testid={`falta-pago-${o.id}`}>
                                        <AlertTriangle className="w-3 h-3 mr-1" /> {o.payment_status === 'partial' ? 'Pago parcial' : 'No ha pagado'}
                                    </Badge>
                                )}
                                {cert && (
                                    <Badge className="bg-green-500/20 text-green-500 border-green-500/40" data-testid={`cert-badge-${o.id}`}>
                                        <FileBadge className="w-3 h-3 mr-1" /> {cert.number}
                                    </Badge>
                                )}
                                {o.security_exit_at && (
                                    <Badge className="bg-sky-500/20 text-sky-400 border-sky-500/40">
                                        <DoorOpen className="w-3 h-3 mr-1" /> Salió
                                    </Badge>
                                )}
                            </div>
                            <p className="text-sm mt-1 truncate">{o.brand} {o.model} · {o.client_name}</p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                                <Clock className="w-3 h-3" />
                                {o.quality_checked_at
                                    ? `Calidad aprobada: ${fmt(o.quality_checked_at)}${o.quality_by_name ? ` · ${o.quality_by_name}` : ''}`
                                    : `Servicio completado: ${fmt(o.service_completed_at)}`}
                            </p>
                            {cert && (
                                <p className="text-xs text-green-500 mt-0.5">
                                    Certificado por {cert.issued_by_name} · {fmt(cert.issued_at)}
                                </p>
                            )}
                            {o.security_exit_at && (
                                <p className="text-xs text-sky-400 mt-0.5">
                                    Salida en portería: {fmt(o.security_exit_at)} · {o.security_exit_by_name}
                                </p>
                            )}
                        </div>
                        {!isSecurity && (
                            <div className="grid grid-cols-3 gap-2 text-right text-sm">
                                <div>
                                    <p className="text-[10px] uppercase text-muted-foreground">Total</p>
                                    <p className="font-mono">{formatCurrency(o.total)}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] uppercase text-muted-foreground">Abonado</p>
                                    <p className="font-mono text-green-500">{formatCurrency(o.paid)}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] uppercase text-muted-foreground">Saldo</p>
                                    <p className={`font-mono font-bold ${hasBalance ? 'text-red-500' : 'text-green-500'}`}>
                                        {formatCurrency(o.balance)}
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {!cert && blockers.length > 0 && (
                        <div className="text-xs p-2 rounded border border-red-500/40 bg-red-500/10 text-red-400 space-y-0.5" data-testid={`cert-blockers-${o.id}`}>
                            <p className="font-semibold">No se puede generar el certificado de salida:</p>
                            {blockers.map(b => <p key={b}>• {b}</p>)}
                        </div>
                    )}

                    <div className="flex flex-wrap gap-2 justify-end">
                        {!cert && canCertify && (
                            <Button
                                onClick={() => issue(o)}
                                disabled={blockers.length > 0 || busy === `cert-${o.id}`}
                                data-testid={`issue-cert-btn-${o.id}`}
                            >
                                {busy === `cert-${o.id}` ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    : hasBalance ? <DollarSign className="w-4 h-4 mr-2" /> : <FileBadge className="w-4 h-4 mr-2" />}
                                {hasBalance ? 'Bloqueado: falta pago' : 'Generar certificado de salida'}
                            </Button>
                        )}
                        {cert && (
                            <Button variant="outline" onClick={() => download(o)} disabled={busy === `pdf-${o.id}`} data-testid={`download-cert-btn-${o.id}`}>
                                {busy === `pdf-${o.id}` ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                                Certificado PDF
                            </Button>
                        )}
                        {cert && !o.security_exit_at && canExit && (
                            <Button onClick={() => registerExit(o)} disabled={busy === `exit-${o.id}`} data-testid={`security-exit-btn-${o.id}`}>
                                {busy === `exit-${o.id}` ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                                Registrar salida en portería
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>
        );
    };

    const Section = ({ title, items, empty, testId }) => (
        <div data-testid={testId}>
            <h2 className="font-heading text-xl mb-3 flex items-center gap-2">
                {title} <Badge variant="outline">{items.length}</Badge>
            </h2>
            {items.length === 0
                ? <p className="text-sm text-muted-foreground">{empty}</p>
                : <div className="grid gap-3">{items.map(renderCard)}</div>}
        </div>
    );

    return (
        <div className="space-y-6" data-testid="autos-salida-page">
            <div>
                <h1 className="font-heading text-3xl md:text-4xl">Listo para Entrega</h1>
                <p className="text-muted-foreground">
                    {isSecurity
                        ? 'Vehículos con certificado de salida. Solo pueden salir los que tienen certificado.'
                        : 'Vehículos con calidad aprobada. El certificado de salida solo se genera cuando el cliente pagó todo, y se envía al coordinador y al jefe de seguridad.'}
                </p>
            </div>

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin" /></div>
            ) : (
                <>
                    {!isSecurity && (
                        <>
                            <Section title="Listos para certificado" items={ready} empty="Sin vehículos pagados por certificar." testId="section-ready" />
                            <Section title="Falta pago" items={unpaid} empty="Ningún vehículo con saldo pendiente." testId="section-unpaid" />
                        </>
                    )}
                    <Section title="Con certificado · por salir" items={certified} empty="Sin vehículos con certificado pendientes de salir." testId="section-certified" />
                    {exited.length > 0 && (
                        <Section title={<><CheckCircle className="w-5 h-5 text-sky-400" /> Salieron por portería</>} items={exited} empty="" testId="section-exited" />
                    )}
                </>
            )}
        </div>
    );
};

export default AutosSalida;
