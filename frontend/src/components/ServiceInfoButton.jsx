import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { ordersAPI } from '../lib/api';
import { formatCurrency, formatDateTime, ORDER_STATUS_LABELS } from '../lib/utils';
import { Eye, Loader2, UserCog, Wrench, CheckCircle2, Circle, Scissors } from 'lucide-react';

/** Botón "Ver servicio": muestra el asesor y los técnicos que atendieron la orden, y quién hizo cada etapa */
export const ServiceInfoButton = ({ orderId, className = '', size = 'sm' }) => {
    const [open, setOpen] = useState(false);
    const [info, setInfo] = useState(null);
    const [error, setError] = useState(null);

    const show = (e) => {
        e?.stopPropagation();
        setOpen(true);
        setInfo(null);
        setError(null);
        ordersAPI.serviceInfo(orderId)
            .then(res => setInfo(res.data))
            .catch(err => setError(err.response?.data?.detail || 'No se pudo cargar el servicio'));
    };

    return (
        <>
            <Button size={size} variant="outline" onClick={show} className={className} data-testid={`view-service-${orderId}`}>
                <Eye className="w-3.5 h-3.5 mr-1" /> Ver servicio
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="service-info-dialog">
                    <DialogHeader>
                        <DialogTitle>Servicio {info?.order_code || ''}</DialogTitle>
                        <DialogDescription>
                            {info ? `${info.plate} · ${info.brand} ${info.model} · ${info.client_name}` : 'Quién atendió este servicio'}
                        </DialogDescription>
                    </DialogHeader>
                    {error ? <p className="text-sm text-red-500">{error}</p> : !info ? (
                        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin" /></div>
                    ) : (
                        <div className="space-y-4 text-sm">
                            <div className="flex items-center justify-between gap-2">
                                <Badge variant="outline">{ORDER_STATUS_LABELS[info.status] || info.status}</Badge>
                                {info.total != null && <span className="font-mono font-semibold">{formatCurrency(info.total)}</span>}
                            </div>

                            <div className="rounded-lg border border-purple-500/40 bg-purple-500/5 p-3 space-y-1" data-testid="service-info-asesor">
                                <p className="font-medium flex items-center gap-2 text-purple-300"><UserCog className="w-4 h-4" /> Asesor</p>
                                <p>Agendó: <b>{info.asesor || 'Sin registro'}</b></p>
                                {info.asesor_checkin && <p>Check-in: <b>{info.asesor_checkin}</b></p>}
                            </div>

                            <div className="rounded-lg border border-cyan-500/40 bg-cyan-500/5 p-3 space-y-1.5" data-testid="service-info-techs">
                                <p className="font-medium flex items-center gap-2 text-cyan-300">
                                    <Wrench className="w-4 h-4" /> Técnicos
                                    {info.service_time_minutes ? <span className="text-xs text-muted-foreground font-normal">· {info.service_time_minutes} min asignados</span> : null}
                                </p>
                                {info.technicians.length === 0 ? <p className="text-muted-foreground">Aún no se han asignado técnicos.</p> : info.technicians.map(t => (
                                    <div key={t.id} className="flex items-center justify-between gap-2">
                                        <b>{t.name}</b>
                                        <span className="text-xs text-muted-foreground text-right">{t.services.length ? t.services.join(' · ') : 'Sin servicio específico'}</span>
                                    </div>
                                ))}
                            </div>

                            <div className="rounded-lg border p-3 space-y-1">
                                <p className="font-medium mb-1">Servicios</p>
                                {info.services.map((s, i) => (
                                    <div key={i} className="flex justify-between gap-2">
                                        <span className="truncate">{s.description}</span>
                                        <span className="font-mono shrink-0">
                                            {s.no_charge ? 'Sin pago' : formatCurrency(s.price || 0)}
                                            {s.discount > 0 && <span className="text-emerald-400"> (-{formatCurrency(s.discount)})</span>}
                                        </span>
                                    </div>
                                ))}
                            </div>

                            <div className="rounded-lg border p-3" data-testid="service-info-stages">
                                <p className="font-medium mb-2">Recorrido del servicio</p>
                                <ol className="space-y-2">
                                    {info.stages.map((st, i) => (
                                        <li key={i} className="flex items-start gap-2">
                                            {st.at ? <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> : <Circle className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />}
                                            <div>
                                                <p>{st.label}{st.name ? <>: <b>{st.name}</b></> : null}</p>
                                                {st.at && <p className="text-xs text-muted-foreground">{formatDateTime(st.at)}</p>}
                                            </div>
                                        </li>
                                    ))}
                                </ol>
                            </div>

                            {info.extra_ppf_cuts.length > 0 && (
                                <div className="rounded-lg border border-purple-500/40 p-3 space-y-1">
                                    <p className="font-medium flex items-center gap-2"><Scissors className="w-4 h-4 text-purple-400" /> Cortes de PPF adicionales</p>
                                    {info.extra_ppf_cuts.map((c, i) => (
                                        <p key={i} className="text-xs">
                                            {c.lines.join(', ')} · {c.reason} · <b>{c.by}</b> · {formatDateTime(c.at)}
                                        </p>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
};

export default ServiceInfoButton;
