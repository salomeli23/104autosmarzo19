import React, { useCallback, useEffect, useState } from 'react';
import { callbellAPI } from '../lib/api';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { formatDateTime, formatCurrency, ORDER_STATUS_LABELS } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';
import { Bot, RefreshCw, CalendarPlus, X, ExternalLink, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react';

const PAY_LABELS = {
    efectivo: 'Efectivo', breb: 'Bre-B', nequi: 'Nequi', daviplata: 'Daviplata', bancolombia: 'Bancolombia',
    tarjeta_debito: 'Tarjeta débito', tarjeta_credito: 'Tarjeta crédito', transferencia: 'Transferencia', tarjeta: 'Tarjeta',
};
export const payLabel = (code) => PAY_LABELS[code] || code;

/**
 * Agendamiento: leads de Callbell por ingresar (contactos del equipo con la etiqueta de agendado), con los datos
 * que el cliente escribió en el chat. El asesor o el coordinador los agenda. Props: onSchedule(lead), refreshKey
 */
export const CallbellLeadsPanel = ({ onSchedule, refreshKey, onSynced }) => {
    const [leads, setLeads] = useState([]);
    const [scheduled, setScheduled] = useState([]);
    const [tab, setTab] = useState('pendiente');
    const [syncing, setSyncing] = useState(false);
    const { user } = useAuth();
    const isAdvisor = user?.role === 'asesor';

    const load = useCallback(() => {
        callbellAPI.leads('pendiente').then(res => setLeads(res.data || [])).catch(() => setLeads([]));
        callbellAPI.leads('agendado').then(res => setScheduled(res.data || [])).catch(() => setScheduled([]));
    }, []);

    useEffect(() => { load(); }, [load, refreshKey]);

    const sync = async () => {
        setSyncing(true);
        try {
            const { data } = await callbellAPI.sync();
            toast.success(data.message || 'Sincronizando con Callbell');
            // La sincronización corre en el servidor: se recargan los leads mientras termina
            [15000, 45000, 90000].forEach(ms => setTimeout(() => { load(); onSynced?.(); }, ms));
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo sincronizar con Callbell');
        } finally {
            setSyncing(false);
        }
    };

    const discard = async (lead) => {
        await callbellAPI.discard(lead.uuid).catch(() => {});
        toast.success('Lead descartado');
        load();
    };

    return (
        <Card className="border-emerald-500/30" data-testid="callbell-leads">
            <CardContent className="pt-5 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                        <p className="font-heading text-lg flex items-center gap-2"><Bot className="w-5 h-5 text-emerald-400" /> Leads de Callbell</p>
                        <p className="text-xs text-muted-foreground">
                            Clientes del equipo de Callbell con el formulario de agendamiento diligenciado en el chat. Revisa y toca Agendar para crear la cita.
                        </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={sync} disabled={syncing} data-testid="callbell-sync">
                        {syncing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />} Sincronizar
                    </Button>
                </div>
                <div className="flex gap-1 border-b">
                    {[['pendiente', `Por ingresar (${leads.length})`], ['agendado', `${isAdvisor ? 'Mis citas agendadas' : 'Agendados'} (${scheduled.length})`]].map(([k, label]) => (
                        <button key={k} type="button" onClick={() => setTab(k)} data-testid={`callbell-tab-${k}`}
                            className={`px-3 py-1.5 text-sm -mb-px border-b-2 ${tab === k ? 'border-emerald-400 text-emerald-300' : 'border-transparent text-muted-foreground'}`}>
                            {label}
                        </button>
                    ))}
                </div>
                {tab === 'agendado' ? (
                    scheduled.length === 0 ? <p className="text-sm text-muted-foreground">Aún no hay citas del bot{isAdvisor ? ' a tu nombre' : ''}.</p> : (
                        <div className="space-y-2 max-h-96 overflow-y-auto">
                            {scheduled.map(l => (
                                <div key={l.uuid} className="rounded-md border p-2.5 flex items-center justify-between gap-2 text-sm" data-testid={`callbell-done-${l.uuid}`}>
                                    <div className="min-w-0">
                                        <p className="font-medium truncate">{l.name || l.phone} <span className="text-muted-foreground font-normal">· {l.order_plate || l.fields?.placa}</span></p>
                                        <p className="text-xs text-muted-foreground">
                                            {l.order_date} {l.order_time} · Orden {l.order_code}
                                            {!isAdvisor && <> · <span className="text-purple-400">{l.advisor_name || 'Sin asesor'}</span></>}
                                        </p>
                                    </div>
                                    <span className="text-xs px-2 py-0.5 rounded bg-muted shrink-0">{ORDER_STATUS_LABELS[l.order_status] || l.order_status || '—'}</span>
                                </div>
                            ))}
                        </div>
                    )
                ) : leads.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No hay leads por ingresar.</p>
                ) : leads.map(l => (
                    <div key={l.uuid} className="rounded-md border p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2" data-testid={`callbell-lead-${l.uuid}`}>
                        <div className="min-w-0 text-sm">
                            <p className="font-medium">{l.name || 'Sin nombre'} <span className="text-muted-foreground font-normal">· {l.phone}</span></p>
                            <p className="text-xs text-muted-foreground break-words">
                                {[l.fields?.placa, [l.fields?.marca, l.fields?.modelo].filter(Boolean).join(' '), l.fields?.servicio_nombre || l.fields?.servicio,
                                    l.fields?.valor && formatCurrency(l.fields.valor), l.fields?.pago && `Pago: ${payLabel(l.fields.pago)}`,
                                    l.fields?.email, l.fields?.fecha && `Fecha: ${l.fields.fecha}`, l.fields?.hora && `Hora: ${l.fields.hora}`].filter(Boolean).join(' · ') || 'Sin datos en el chat'}
                            </p>
                            {l.problem
                                ? <p className="text-xs text-amber-400 flex items-center gap-1 mt-0.5"><AlertTriangle className="w-3 h-3" /> {l.problem}</p>
                                : <p className="text-xs text-emerald-400 flex items-center gap-1 mt-0.5"><CheckCircle2 className="w-3 h-3" /> Listo para agendar</p>}
                            {l.team_name && <p className="text-[11px] text-muted-foreground">Equipo: {l.team_name}</p>}
                            <p className="text-xs text-purple-400">{l.advisor_name ? `Asesor: ${l.advisor_name}` : 'Sin asesor en Callbell: lo toma quien lo agende'}</p>
                            <p className="text-[11px] text-muted-foreground">{formatDateTime(l.updated_at)}</p>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                            {l.conversation_href && (
                                <Button size="sm" variant="ghost" asChild>
                                    <a href={l.conversation_href} target="_blank" rel="noreferrer" title="Abrir chat en Callbell"><ExternalLink className="w-4 h-4" /></a>
                                </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => discard(l)} title="Descartar"><X className="w-4 h-4" /></Button>
                            <Button size="sm" onClick={() => onSchedule?.(l)} data-testid={`callbell-schedule-${l.uuid}`}>
                                <CalendarPlus className="w-4 h-4 mr-1" /> Agendar
                            </Button>
                        </div>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
};

export default CallbellLeadsPanel;
