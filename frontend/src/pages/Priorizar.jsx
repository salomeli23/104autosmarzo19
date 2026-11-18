import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { coordinatorQueuesAPI } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { PlateBadge } from '../components/PlateBadge';
import { toast } from 'sonner';
import {
    ListOrdered, RefreshCw, Loader2, ArrowUp, ArrowDown, ChevronsUp, Scissors, Wrench, Play,
    ArrowRight, Clock, Users, Star, Undo2,
} from 'lucide-react';

// Etapas del flujo del técnico, en orden
const STAGES = [
    { id: 'en_corte', label: 'Corte · medidas', icon: Scissors, tone: 'text-pink-400 border-pink-500/40' },
    { id: 'asignado', label: 'Por instalar', icon: Wrench, tone: 'text-cyan-400 border-cyan-500/40' },
    { id: 'en_proceso', label: 'En instalación', icon: Play, tone: 'text-yellow-400 border-yellow-500/40' },
];
const arrivalText = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');

const QueueCard = ({ o, pos, total, onMove, onTop, busy }) => (
    <div className="rounded-lg border bg-background/70 p-2.5 space-y-1.5" data-testid={`queue-card-${o.plate}`}>
        <div className="flex items-start gap-2">
            <span className="w-7 h-7 shrink-0 rounded-full bg-primary/15 text-primary text-sm font-bold flex items-center justify-center">{pos}</span>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                    <PlateBadge plate={o.plate} size="sm" />
                    {o.is_priority && <span className="text-[10px] px-1.5 rounded bg-amber-500/20 text-amber-300 flex items-center gap-0.5"><Star className="w-3 h-3" />Prioritario</span>}
                    {o.is_test && <span className="text-[10px] px-1.5 rounded bg-red-500/20 text-red-300">PRUEBA</span>}
                    {o.status === 'en_corte' && !o.measured && <span className="text-[10px] px-1.5 rounded bg-pink-500/15 text-pink-300">Sin medidas</span>}
                </div>
                <p className="text-xs font-medium truncate mt-0.5">{[o.brand, o.model].filter(Boolean).join(' ')}</p>
                {o.services?.length > 0 && <p className="text-[11px] text-muted-foreground break-words">{o.services.join(' · ')}</p>}
                <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" /> Llegó {arrivalText(o.arrival)}</p>
                {o.partners?.length > 0 && <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" /> Con {o.partners.join(', ')}</p>}
            </div>
            <div className="flex flex-col gap-1 shrink-0">
                <Button size="icon" variant="outline" className="h-7 w-7" disabled={busy || pos === 1} onClick={() => onMove(-1)} aria-label="Subir" data-testid={`queue-up-${o.plate}`}>
                    <ArrowUp className="w-3.5 h-3.5" />
                </Button>
                <Button size="icon" variant="outline" className="h-7 w-7" disabled={busy || pos === total} onClick={() => onMove(1)} aria-label="Bajar" data-testid={`queue-down-${o.plate}`}>
                    <ArrowDown className="w-3.5 h-3.5" />
                </Button>
            </div>
        </div>
        {pos > 1 && (
            <button type="button" disabled={busy} onClick={onTop} className="text-[11px] text-primary hover:underline flex items-center gap-1" data-testid={`queue-top-${o.plate}`}>
                <ChevronsUp className="w-3.5 h-3.5" /> Pasar al primero
            </button>
        )}
    </div>
);

/** Coordinador: ordena la cola de cada técnico (prioridad) o la deja por orden de llegada */
export const Priorizar = () => {
    const [techs, setTechs] = useState([]);
    const [selected, setSelected] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            const { data } = await coordinatorQueuesAPI.list();
            setTechs(data || []);
            setSelected(prev => prev && data.some(t => t.id === prev) ? prev : (data.find(t => t.orders.length)?.id || data[0]?.id || null));
        } catch (e) {
            toast.error('No se pudieron cargar las colas de los técnicos');
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    const tech = techs.find(t => t.id === selected);
    const columns = useMemo(() => Object.fromEntries(STAGES.map(s => [s.id, (tech?.orders || []).filter(o => o.status === s.id)])), [tech]);

    const save = async (cols) => {
        const ids = STAGES.flatMap(s => cols[s.id].map(o => o.id));
        setBusy(true);
        try {
            const { data } = await coordinatorQueuesAPI.save(tech.id, ids);
            toast.success(data.message);
            await load();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo guardar el orden');
            load();
        } finally {
            setBusy(false);
        }
    };
    const move = (stage, index, delta) => {
        const list = [...columns[stage]];
        const j = index + delta;
        if (j < 0 || j >= list.length) return;
        [list[index], list[j]] = [list[j], list[index]];
        save({ ...columns, [stage]: list });
    };
    const toTop = (stage, index) => {
        const list = [...columns[stage]];
        const [item] = list.splice(index, 1);
        save({ ...columns, [stage]: [item, ...list] });
    };
    const setMode = async (mode) => {
        if (!tech || mode === tech.mode) return;
        if (mode === 'prioridad') { save(columns); return; }
        setBusy(true);
        try {
            const { data } = await coordinatorQueuesAPI.reset(tech.id);
            toast.success(data.message);
            await load();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo cambiar');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-6" data-testid="priorizar-page">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="font-heading text-3xl md:text-4xl flex items-center gap-2"><ListOrdered className="w-8 h-8 text-primary" /> Priorizar</h1>
                    <p className="text-muted-foreground">Elige el técnico y define en qué orden atiende sus vehículos, o déjalo por orden de llegada. El técnico ve su cola en ese orden.</p>
                </div>
                <Button variant="outline" onClick={load} disabled={busy}><RefreshCw className="w-4 h-4 mr-2" /> Actualizar</Button>
            </div>

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin" /></div>
            ) : techs.length === 0 ? (
                <p className="text-center py-12 text-muted-foreground">No hay técnicos activos.</p>
            ) : (
                <>
                    <div className="flex flex-wrap gap-2" data-testid="priorizar-techs">
                        {techs.map(t => (
                            <button key={t.id} type="button" onClick={() => setSelected(t.id)} data-testid={`priorizar-tech-${t.id}`}
                                className={`px-3 py-1.5 rounded-full border text-sm transition-colors flex items-center gap-2 ${selected === t.id ? 'border-primary bg-primary/15 text-primary' : 'border-border hover:border-primary/50'} ${t.orders.length ? '' : 'opacity-60'}`}>
                                {t.name}
                                <span className="text-xs rounded-full bg-muted px-1.5">{t.orders.length}</span>
                                {t.mode === 'prioridad' && <ListOrdered className="w-3.5 h-3.5" aria-label="Priorizado" />}
                            </button>
                        ))}
                    </div>

                    {tech && (
                        <Card>
                            <CardContent className="p-4 space-y-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                        <p className="font-heading text-xl">{tech.name}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {tech.mode === 'prioridad' ? 'Atiende en el orden que definiste' : 'Atiende por orden de llegada (el primero que llegó va primero)'}
                                        </p>
                                    </div>
                                    <div className="inline-flex rounded-lg border p-1 gap-1" data-testid="priorizar-mode">
                                        <Button size="sm" variant={tech.mode === 'llegada' ? 'default' : 'ghost'} disabled={busy} onClick={() => setMode('llegada')} data-testid="mode-llegada">
                                            <Undo2 className="w-4 h-4 mr-1" /> Orden de llegada
                                        </Button>
                                        <Button size="sm" variant={tech.mode === 'prioridad' ? 'default' : 'ghost'} disabled={busy || !tech.orders.length} onClick={() => setMode('prioridad')} data-testid="mode-prioridad">
                                            <ListOrdered className="w-4 h-4 mr-1" /> Priorizar
                                        </Button>
                                    </div>
                                </div>

                                {tech.orders.length === 0 ? (
                                    <p className="text-center py-8 text-sm text-muted-foreground">{tech.name} no tiene vehículos en cola.</p>
                                ) : (
                                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr_auto_1fr] gap-3 items-start" data-testid="priorizar-flow">
                                        {STAGES.map((st, si) => {
                                            const Icon = st.icon;
                                            const list = columns[st.id];
                                            return (
                                                <React.Fragment key={st.id}>
                                                    {si > 0 && (
                                                        <div className="flex justify-center lg:pt-3 text-muted-foreground" aria-hidden>
                                                            <ArrowRight className="w-5 h-5 rotate-90 lg:rotate-0" />
                                                        </div>
                                                    )}
                                                    <div className={`rounded-xl border ${st.tone.split(' ')[1]} p-3 space-y-2 bg-muted/20`} data-testid={`priorizar-stage-${st.id}`}>
                                                        <p className={`text-sm font-semibold flex items-center gap-2 ${st.tone.split(' ')[0]}`}>
                                                            <span className="w-5 h-5 rounded-full border text-[11px] flex items-center justify-center">{si + 1}</span>
                                                            <Icon className="w-4 h-4" /> {st.label}
                                                            <span className="ml-auto text-xs text-muted-foreground">{list.length}</span>
                                                        </p>
                                                        {list.length === 0
                                                            ? <p className="text-xs text-muted-foreground py-2">Sin vehículos</p>
                                                            : list.map((o, i) => (
                                                                <QueueCard key={o.id} o={o} pos={i + 1} total={list.length} busy={busy}
                                                                    onMove={(d) => move(st.id, i, d)} onTop={() => toTop(st.id, i)} />
                                                            ))}
                                                    </div>
                                                </React.Fragment>
                                            );
                                        })}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </>
            )}
        </div>
    );
};

export default Priorizar;
