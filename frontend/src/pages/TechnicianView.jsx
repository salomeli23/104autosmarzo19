import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ordersAPI, orderRouteAPI, technicianChargesAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { ServiceBadge } from '../components/ServiceBadge';
import { PlateBadge } from '../components/PlateBadge';
import { CarAvatar } from '../components/CarAvatar';
import { toast } from 'sonner';
import { PostventaBadge } from '../components/PostventaBadge';
import { AccessoryStatusTag } from '../components/AccessoryStatusTag';
import { WorkflowSteps } from '../components/WorkflowSteps';
import { TechMeasurementsDialog, TechMeasurementsSummary } from '../components/TechMeasurements';
import { orderTechnicians } from '../lib/workflow';
import { CameraCapture } from '../components/CameraCapture';
import { ConfirmTwiceDialog } from '../components/ConfirmTwiceDialog';
import { TechnicianHistory } from '../components/TechnicianHistory';
import {
    Wrench, Play, CheckCircle, Clock, User, Phone,
    AlertTriangle, Timer, FileText, Scissors, Sparkles,
    Package, PaintBucket, Hammer, LogIn, Users, Route as RouteIcon, Ruler, History, CheckSquare, Square,
} from 'lucide-react';

const MIN_FINISH_PHOTOS = 5;
const MAX_FINISH_PHOTOS = 10;
const serviceLabel = (s) => (typeof s === 'object' ? (s.description || s.service) : s);

const PART_LABELS = {
    panoramico: 'Panorámico', vidrio_copiloto: 'Vidrio Copiloto', vidrio_piloto: 'Vidrio Piloto',
    vidrio_trasero_piloto: 'Vidrio Trasero Piloto', vidrio_trasero_copiloto: 'Vidrio Trasero Copiloto',
    vidrio_trasero: 'Vidrio Trasero', trasero: 'Trasero', luneta: 'Luneta', sunroof: 'Sunroof', custodias: 'Custodias',
};

// Pestañas del flujo nuevo: Corte → Por instalar → En instalación
const STAGES = [
    { id: 'asignado', label: 'Por instalar', icon: Wrench },
    { id: 'en_proceso', label: 'En instalación', icon: Play },
    { id: 'en_corte', label: 'En corte · medidas', icon: Scissors },
];

// ============================================================
// Sección → roles de slot que agrupa (matches por role o por label)
// ============================================================
const SECTIONS = [
    { id: 'corte', label: 'Corte', icon: Scissors, roles: ['corte', 'corte_piezas'], labelKeywords: ['corte'] },
    { id: 'instalacion', label: 'Instalación', icon: Wrench, roles: ['polarizado', 'ppf', 'ultrasecure', 'instalacion'], labelKeywords: ['instalación', 'instalacion', 'polariz', 'ppf'] },
    { id: 'lavado', label: 'Lavado', icon: Sparkles, roles: ['lavado'], labelKeywords: ['lavado'] },
    { id: 'accesorios', label: 'Accesorios', icon: Package, roles: ['accesorios'], labelKeywords: ['accesorio'] },
    { id: 'detailing', label: 'Detailing', icon: Sparkles, roles: ['detailing', 'ceramico'], labelKeywords: ['detailing', 'cerámico', 'ceramico'] },
    { id: 'latoneria', label: 'Latonería y Pintura', icon: PaintBucket, roles: ['latoneria_pintura', 'latoneria', 'pintura'], labelKeywords: ['latonería', 'latoneria', 'pintura'] },
];

const slotSectionId = (slot) => {
    const role = (slot?.role || '').toLowerCase();
    const label = (slot?.label || '').toLowerCase();
    // 1) Prioridad al LABEL (permite reglas custom donde el label indica la sección real)
    let sec = SECTIONS.find(s => (s.labelKeywords || []).some(k => label.includes(k)));
    if (sec) return sec.id;
    // 2) Fallback: match por role explícito
    sec = SECTIONS.find(s => s.roles.includes(role));
    return sec ? sec.id : null;
};

// ============================================================
// Helpers
// ============================================================
const fmtElapsed = (isoStart, isoEnd = null) => {
    if (!isoStart) return null;
    const diffMs = (isoEnd ? new Date(isoEnd).getTime() : Date.now()) - new Date(isoStart).getTime();
    if (diffMs < 0) return '0m';
    const mins = Math.floor(diffMs / 60000);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
};

const fmtTime = (iso) => {
    if (!iso) return '-';
    try {
        return new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
        return '-';
    }
};

const getRemainingMinutes = (slot) => {
    if (!slot.started_at || !slot.service_time_minutes) return null;
    const start = new Date(slot.started_at).getTime();
    const end = start + slot.service_time_minutes * 60000;
    return Math.round((end - Date.now()) / 60000);
};

// ============================================================
// Slot Card
// ============================================================
const SlotCard = ({ slot, order, onStart, onFinish, processing }) => {
    const isPending = slot.status === 'pendiente';
    const isInProgress = slot.status === 'en_proceso';
    const isDone = slot.status === 'completado';
    const remaining = isInProgress ? getRemainingMinutes(slot) : null;
    const expired = remaining !== null && remaining < 0;

    const borderColor = isDone
        ? 'border-green-500/40'
        : expired
        ? 'border-red-500/50'
        : isInProgress
        ? 'border-yellow-500/40'
        : 'border-cyan-500/40';

    return (
        <Card className={`card-hover ${borderColor}`} data-testid={`slot-card-${slot.id}`}>
            <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                        <CarAvatar photoUrl={order.profile_photo_url} size={44} />
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <PlateBadge plate={order.plate} size="md" />
                                <PostventaBadge order={order} />
                                <AccessoryStatusTag order={order} />
                                <Badge variant="outline" className="text-xs">{slot.label}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1 truncate">
                                {order.brand} {order.model} · {order.client_name}
                            </p>
                        </div>
                    </div>
                    {isInProgress && remaining !== null && (
                        <Badge
                            className={expired
                                ? 'bg-red-500/20 text-red-500 border-red-500/40'
                                : remaining <= 5
                                ? 'bg-orange-500/20 text-orange-500 border-orange-500/40'
                                : 'bg-yellow-500/20 text-yellow-500 border-yellow-500/40'
                            }
                            data-testid={`slot-timer-${slot.id}`}
                        >
                            {expired ? <AlertTriangle className="w-3 h-3 mr-1" /> : <Timer className="w-3 h-3 mr-1" />}
                            {expired ? `+${Math.abs(remaining)}m excedido` : `${remaining}m restantes`}
                        </Badge>
                    )}
                    {isDone && (
                        <Badge className="bg-green-500/20 text-green-500 border-green-500/40">
                            <CheckCircle className="w-3 h-3 mr-1" /> Completado
                        </Badge>
                    )}
                </div>

                <div className="flex flex-wrap gap-1">
                    {(order.services || []).slice(0, 4).map((s, i) => (
                        <ServiceBadge key={i} service={typeof s === 'string' ? s : s.service} />
                    ))}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs bg-muted/40 rounded-md p-2 border border-muted">
                    <div className="flex items-center gap-1 text-blue-400">
                        <LogIn className="w-3 h-3" /> Ingreso: <span className="font-mono">{fmtTime(order.ingreso_at)}</span>
                    </div>
                    <div className="flex items-center gap-1 text-cyan-400">
                        <Clock className="w-3 h-3" /> Programada: <span className="font-mono">{order.scheduled_time || '-'}</span>
                    </div>
                    {isInProgress && (
                        <>
                            <div className="flex items-center gap-1 text-yellow-400">
                                <Play className="w-3 h-3" /> Inicio: <span className="font-mono">{fmtTime(slot.started_at)}</span>
                            </div>
                            <div className="flex items-center gap-1 text-yellow-400">
                                <Timer className="w-3 h-3" /> Transcurrido: <span className="font-mono">{fmtElapsed(slot.started_at)}</span>
                            </div>
                        </>
                    )}
                    {isDone && (
                        <div className="col-span-2 flex items-center gap-1 text-green-400">
                            <CheckCircle className="w-3 h-3" /> Terminado: <span className="font-mono">{fmtTime(slot.completed_at)}</span>
                            {slot.started_at && <> · duración <span className="font-mono">{fmtElapsed(slot.started_at, slot.completed_at)}</span></>}
                        </div>
                    )}
                </div>

                {!isDone && (
                    isPending ? (
                        <Button
                            className="w-full"
                            onClick={() => onStart(order.id, slot.id)}
                            disabled={processing}
                            data-testid={`start-slot-${slot.id}`}
                        >
                            <Play className="w-4 h-4 mr-2" /> Iniciar servicio
                        </Button>
                    ) : (
                        <Button
                            className="w-full brand-glow"
                            variant={expired ? 'destructive' : 'default'}
                            onClick={() => onFinish(order, slot)}
                            disabled={processing}
                            data-testid={`finish-slot-${slot.id}`}
                        >
                            <CheckCircle className="w-4 h-4 mr-2" /> Finalizar y enviar reporte
                        </Button>
                    )
                )}
                {isDone && slot.completion_photos && slot.completion_photos.length > 0 && (
                    <div className="flex gap-1 flex-wrap">
                        {slot.completion_photos.slice(0, 4).map((p, i) => (
                            <img key={i} src={p} alt="" className="w-14 h-14 rounded object-cover border border-green-500/30" />
                        ))}
                        {slot.completion_photos.length > 4 && (
                            <div className="w-14 h-14 rounded border border-green-500/30 bg-muted/50 flex items-center justify-center text-xs">
                                +{slot.completion_photos.length - 4}
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

// ============================================================
// Order Card (flujo con 2 técnicos)
// ============================================================
const InstallCard = ({ order, userId, onStart, onFinish, onMeasure, processing }) => {
    const partner = orderTechnicians(order).find(t => t.id !== userId);
    const inProgress = order.status === 'en_proceso';
    const remaining = inProgress && order.service_started_at && order.service_time_minutes
        ? Math.round((new Date(order.service_started_at).getTime() + order.service_time_minutes * 60000 - Date.now()) / 60000)
        : null;
    const expired = remaining !== null && remaining < 0;
    return (
        <Card className={`card-hover ${expired ? 'border-red-500/50' : inProgress ? 'border-yellow-500/40' : order.status === 'en_corte' ? 'border-pink-500/30' : 'border-cyan-500/40'}`} data-testid={`install-card-${order.id}`}>
            <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                        <CarAvatar photoUrl={order.profile_photo_url} size={44} />
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <PlateBadge plate={order.plate} size="md" />
                                <PostventaBadge order={order} />
                                <AccessoryStatusTag order={order} />
                            </div>
                            <p className="text-sm text-muted-foreground mt-1 truncate">{order.brand} {order.model} · {order.client_name}</p>
                        </div>
                    </div>
                    {remaining !== null && (
                        <Badge className={expired ? 'bg-red-500/20 text-red-500 border-red-500/40' : 'bg-yellow-500/20 text-yellow-500 border-yellow-500/40'}>
                            {expired ? <AlertTriangle className="w-3 h-3 mr-1" /> : <Timer className="w-3 h-3 mr-1" />}
                            {expired ? `+${Math.abs(remaining)}m excedido` : `${remaining}m restantes`}
                        </Badge>
                    )}
                </div>

                <WorkflowSteps order={order} />

                {inProgress && order.quality_status === 'rechazado' && (
                    <div className="text-xs p-2 rounded border border-red-500/40 bg-red-500/10 text-red-300 space-y-1" data-testid={`quality-rework-${order.id}`}>
                        <p className="font-semibold flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Calidad devolvió el vehículo · corregir:</p>
                        {(order.quality_answers || []).filter(a => a.result === 'no_ok').map(a => (
                            <p key={a.id}>• {a.label}{a.note ? ` — ${a.note}` : ''}</p>
                        ))}
                        {order.quality_notes && <p className="italic">{order.quality_notes}</p>}
                    </div>
                )}

                <div className="space-y-1">
                    {(order.services || []).filter(s => typeof s === 'object').map((s, i) => (
                        <div key={i} className="text-xs p-2 rounded bg-muted/40 space-y-1">
                            <p className="font-medium">{s.description || s.service}</p>
                            {(s.parts || []).length > 0 && (
                                <div className="flex flex-wrap gap-1" data-testid={`tech-parts-${order.id}-${i}`}>
                                    {s.parts.map(p => (
                                        <span key={p} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-background/60 border border-border">
                                            {PART_LABELS[p] || p}
                                            {s.part_percentages?.[p] && (
                                                <b className="text-yellow-400">{s.part_percentages[p]}</b>
                                            )}
                                        </span>
                                    ))}
                                </div>
                            )}
                            {(s.ppf_parts || []).length > 0 && <p className="text-muted-foreground">PPF: {s.ppf_parts.join(', ')}</p>}
                        </div>
                    ))}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs bg-muted/40 rounded-md p-2 border border-muted">
                    <div className="flex items-center gap-1 text-blue-400">
                        <LogIn className="w-3 h-3" /> Ingreso: <span className="font-mono">{fmtTime(order.ingreso_at)}</span>
                    </div>
                    <div className="flex items-center gap-1 text-cyan-400">
                        <Users className="w-3 h-3" /> Con: <span className="truncate">{partner ? partner.name : 'solo'}</span>
                    </div>
                    {inProgress && (
                        <>
                            <div className="flex items-center gap-1 text-yellow-400">
                                <Play className="w-3 h-3" /> Inicio: <span className="font-mono">{fmtTime(order.service_started_at)}</span>
                            </div>
                            <div className="flex items-center gap-1 text-yellow-400">
                                <Timer className="w-3 h-3" /> Transcurrido: <span className="font-mono">{fmtElapsed(order.service_started_at)}</span>
                            </div>
                        </>
                    )}
                </div>

                {order.status === 'en_corte' && (
                    <div className="space-y-2">
                        <TechMeasurementsSummary order={order} compact />
                        {order.cutting_status === 'completado' ? (
                            <p className="text-xs text-emerald-400 flex items-center gap-1">
                                <Scissors className="w-3.5 h-3.5" /> Material cortado. Corte te lo entregará para instalar.
                            </p>
                        ) : (
                            <Button
                                className="w-full"
                                variant={order.tech_measurements?.confirmed_at ? 'outline' : 'default'}
                                onClick={() => onMeasure(order)}
                                disabled={processing}
                                data-testid={`measure-btn-${order.id}`}
                            >
                                <Ruler className="w-4 h-4 mr-2" />
                                {order.tech_measurements?.confirmed_at ? 'Editar medidas' : 'Colocar medidas'}
                            </Button>
                        )}
                    </div>
                )}
                {order.status === 'asignado' && (
                    <Button className="w-full" onClick={() => onStart(order)} disabled={processing} data-testid={`start-install-${order.id}`}>
                        <Play className="w-4 h-4 mr-2" /> Iniciar instalación
                    </Button>
                )}
                {inProgress && (
                    <Button className="w-full brand-glow" variant={expired ? 'destructive' : 'default'} onClick={() => onFinish(order)} disabled={processing} data-testid={`finish-install-${order.id}`}>
                        <CheckCircle className="w-4 h-4 mr-2" /> Finalizar y enviar reporte
                    </Button>
                )}
            </CardContent>
        </Card>
    );
};

// ============================================================
// Main View
// ============================================================
export const TechnicianView = () => {
    const { user } = useAuth();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [, setTick] = useState(0);

    // Finish dialog state
    const [finishing, setFinishing] = useState(null); // { order, slot }
    const [finishNotes, setFinishNotes] = useState('');
    const [finishPhotos, setFinishPhotos] = useState([]);
    const [finishServices, setFinishServices] = useState([]); // posiciones de order.services instaladas
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [measuring, setMeasuring] = useState(null);
    const [history, setHistory] = useState([]);

    const fetchHistory = useCallback(async () => {
        try {
            const res = await technicianChargesAPI.history();
            setHistory(res.data || []);
        } catch (e) {
            console.error('fetch history error', e);
        }
    }, []);

    const fetchOrders = useCallback(async () => {
        try {
            const res = await ordersAPI.getAll();
            const uid = user?.id;
            const mine = (res.data || []).filter(o =>
                orderTechnicians(o).some(t => t.id === uid) ||
                (Array.isArray(o.route_slots) && o.route_slots.some(s => s.technician_id === uid))
            );
            setOrders(mine);
        } catch (e) {
            console.error('fetch orders error', e);
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        fetchOrders();
        fetchHistory();
        const t = setInterval(() => { fetchOrders(); fetchHistory(); }, 30000);
        return () => clearInterval(t);
    }, [fetchOrders, fetchHistory]);

    // tick for live timers every 30s
    useEffect(() => {
        const t = setInterval(() => setTick(v => v + 1), 30000);
        return () => clearInterval(t);
    }, []);

    // Group my slots by section
    const bySection = useMemo(() => {
        const map = {};
        SECTIONS.forEach(s => { map[s.id] = []; });
        const uid = user?.id;
        (orders || []).forEach(o => {
            (o.route_slots || []).forEach(slot => {
                if (slot.technician_id !== uid) return;
                const secId = slotSectionId(slot);
                if (!secId) return;
                map[secId].push({ order: o, slot });
            });
        });
        // sort: en_proceso first, pendiente second, completado last
        const order = { en_proceso: 0, pendiente: 1, completado: 2 };
        Object.keys(map).forEach(k => {
            map[k].sort((a, b) => (order[a.slot.status] ?? 99) - (order[b.slot.status] ?? 99));
        });
        return map;
    }, [orders, user]);

    // Flujo nuevo: órdenes donde soy técnico principal o de apoyo
    const byStage = useMemo(() => {
        const uid = user?.id;
        const map = {};
        STAGES.forEach(st => { map[st.id] = []; });
        (orders || []).forEach(o => {
            if (orderTechnicians(o).some(t => t.id === uid) && map[o.status]) {
                map[o.status].push(o);
            }
        });
        return map;
    }, [orders, user]);
    const legacyPending = SECTIONS.reduce((acc, s) => acc + bySection[s.id].filter(x => x.slot.status !== 'completado').length, 0);

    const alertsBySection = useMemo(() => {
        const counts = {};
        SECTIONS.forEach(s => {
            counts[s.id] = bySection[s.id].filter(x => x.slot.status !== 'completado').length;
        });
        return counts;
    }, [bySection]);

    const totalPending = byStage.asignado.length + byStage.en_proceso.length + legacyPending
        + byStage.en_corte.filter(o => !o.tech_measurements?.confirmed_at).length;

    const handleStart = async (orderId, slotId) => {
        setProcessing(true);
        try {
            await orderRouteAPI.startSlot(orderId, slotId, {});
            toast.success('Servicio iniciado · Cronómetro corriendo');
            fetchOrders();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Error al iniciar');
        } finally {
            setProcessing(false);
        }
    };

    const handleStartInstall = async (order) => {
        setProcessing(true);
        try {
            await ordersAPI.startService(order.id);
            toast.success('Instalación iniciada · Cronómetro corriendo');
            fetchOrders();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Error al iniciar');
        } finally {
            setProcessing(false);
        }
    };

    const openFinish = (order, slot = null) => {
        setFinishing({ order, slot });
        setFinishNotes('');
        setFinishPhotos([]);
        setFinishServices([]);
    };

    const closeFinish = () => setFinishing(null);

    const handlePhotoInput = (e) => {
        const files = Array.from(e.target.files || []);
        if (finishPhotos.length + files.length > MAX_FINISH_PHOTOS) {
            toast.error(`Máximo ${MAX_FINISH_PHOTOS} fotos`);
            return;
        }
        files.forEach(f => {
            const reader = new FileReader();
            reader.onload = (ev) => setFinishPhotos(prev => [...prev, ev.target.result]);
            reader.readAsDataURL(f);
        });
    };

    const finishServiceList = finishing && !finishing.slot ? (finishing.order.services || []) : [];
    const toggleFinishService = (i) => setFinishServices(prev => (prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]));
    const finishMissing = [
        !finishNotes.trim() && 'Escribe el reporte del servicio',
        finishPhotos.length < MIN_FINISH_PHOTOS && `Adjunta mínimo ${MIN_FINISH_PHOTOS} fotos (${finishPhotos.length}/${MIN_FINISH_PHOTOS})`,
        finishServiceList.length > 0 && finishServices.length === 0 && 'Marca qué servicios instalaste',
    ].filter(Boolean);

    // Primero valida; luego pregunta dos veces antes de enviar
    const submitFinish = () => {
        if (finishMissing.length) {
            toast.error(finishMissing[0]);
            return;
        }
        setConfirmOpen(true);
    };

    const doFinish = async () => {
        setProcessing(true);
        try {
            if (finishing.slot) {
                const res = await orderRouteAPI.completeSlot(finishing.order.id, finishing.slot.id, {
                    notes: finishNotes.trim(),
                    completion_photos: finishPhotos,
                });
                toast.success(res.data?.all_done
                    ? 'Servicio finalizado · Auto listo para entrega'
                    : 'Servicio finalizado');
            } else {
                await ordersAPI.completeService({
                    order_id: finishing.order.id,
                    notes: finishNotes.trim(),
                    completion_photos: finishPhotos,
                    installed_services: [...finishServices].sort((a, b) => a - b),
                });
                toast.success('Instalación finalizada · enviada a control de calidad');
            }
            closeFinish();
            fetchOrders();
            fetchHistory();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Error al finalizar');
        } finally {
            setProcessing(false);
        }
    };

    const hasLegacy = SECTIONS.some(s => bySection[s.id].length > 0);
    const needsMeasures = byStage.en_corte.some(o => !o.tech_measurements?.confirmed_at);
    const defaultTab = byStage.en_proceso.length ? 'en_proceso' : needsMeasures ? 'en_corte' : byStage.asignado.length ? 'asignado'
        : byStage.en_corte.length ? 'en_corte' : hasLegacy ? 'legacy' : 'asignado';

    return (
        <div className="space-y-6" data-testid="technician-page">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="font-heading text-3xl md:text-4xl">Mis Servicios</h1>
                    <p className="text-muted-foreground">
                        Vehículos donde eres técnico principal o de apoyo · Corte → Instalación
                    </p>
                </div>
                {totalPending > 0 && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500" data-testid="global-alerts">
                        <AlertTriangle className="w-4 h-4" />
                        <span className="text-sm font-medium">{totalPending} servicio(s) pendiente(s)</span>
                    </div>
                )}
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
            ) : orders.length === 0 && history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <Wrench className="w-16 h-16 mb-4 opacity-50" />
                    <p className="text-lg">No tienes servicios asignados</p>
                    <p className="text-sm">Los servicios aparecerán cuando el coordinador te asigne en Autos por Asignar</p>
                </div>
            ) : (
                <Tabs defaultValue={defaultTab} className="w-full">
                    <TabsList className="flex flex-wrap gap-1 h-auto p-1">
                        {STAGES.map(st => {
                            const Icon = st.icon;
                            const count = byStage[st.id].length;
                            return (
                                <TabsTrigger key={st.id} value={st.id} className="flex items-center gap-1.5 py-2" data-testid={`tab-${st.id}`}>
                                    <Icon className="w-4 h-4" />
                                    <span className="text-xs md:text-sm">{st.label}</span>
                                    {count > 0 && (
                                        <Badge className="ml-1 bg-amber-500 text-black h-5 min-w-5 px-1 text-[10px]">{count}</Badge>
                                    )}
                                </TabsTrigger>
                            );
                        })}
                        <TabsTrigger value="terminados" className="flex items-center gap-1.5 py-2" data-testid="tab-terminados">
                            <History className="w-4 h-4" />
                            <span className="text-xs md:text-sm">Terminados</span>
                            {history.length > 0 && <Badge variant="outline" className="ml-1 h-5 px-1 text-[10px]">{history.length}</Badge>}
                        </TabsTrigger>
                        {hasLegacy && (
                            <TabsTrigger value="legacy" className="flex items-center gap-1.5 py-2" data-testid="tab-legacy">
                                <RouteIcon className="w-4 h-4" />
                                <span className="text-xs md:text-sm">Hoja de ruta (anterior)</span>
                                {legacyPending > 0 && (
                                    <Badge className="ml-1 bg-amber-500 text-black h-5 min-w-5 px-1 text-[10px]">{legacyPending}</Badge>
                                )}
                            </TabsTrigger>
                        )}
                    </TabsList>

                    {STAGES.map(st => (
                        <TabsContent key={st.id} value={st.id} className="mt-4" data-testid={`panel-${st.id}`}>
                            {byStage[st.id].length === 0 ? (
                                <div className="text-center py-12 text-muted-foreground text-sm">
                                    Sin vehículos en <b>{st.label}</b>
                                </div>
                            ) : (
                                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {byStage[st.id].map(o => (
                                        <InstallCard
                                            key={o.id}
                                            order={o}
                                            userId={user?.id}
                                            onStart={handleStartInstall}
                                            onFinish={openFinish}
                                            onMeasure={setMeasuring}
                                            processing={processing}
                                        />
                                    ))}
                                </div>
                            )}
                        </TabsContent>
                    ))}

                    <TabsContent value="terminados" className="mt-4" data-testid="panel-terminados">
                        <TechnicianHistory items={history} onChanged={fetchHistory} />
                    </TabsContent>

                    {hasLegacy && (
                        <TabsContent value="legacy" className="mt-4 space-y-6" data-testid="panel-legacy">
                            {SECTIONS.filter(sec => bySection[sec.id].length > 0).map(sec => (
                                <div key={sec.id} className="space-y-2">
                                    <h3 className="text-sm font-medium flex items-center gap-2"><sec.icon className="w-4 h-4" /> {sec.label}</h3>
                                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {bySection[sec.id].map(({ order, slot }) => (
                                            <SlotCard
                                                key={slot.id}
                                                slot={slot}
                                                order={order}
                                                onStart={handleStart}
                                                onFinish={openFinish}
                                                processing={processing}
                                            />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </TabsContent>
                    )}
                </Tabs>
            )}

            <TechMeasurementsDialog order={measuring} onClose={() => setMeasuring(null)} onSaved={fetchOrders} />

            {/* Finish Dialog */}
            <Dialog open={!!finishing} onOpenChange={(v) => !v && closeFinish()}>
                <DialogContent className="max-h-[92vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Finalizar Servicio</DialogTitle>
                        <DialogDescription asChild>
                            {finishing ? (
                                <div className="pt-1 flex items-center gap-2 flex-wrap">
                                    <PlateBadge plate={finishing.order.plate} size="md" />
                                    <Badge variant="outline">{finishing.slot ? finishing.slot.label : 'Instalación'}</Badge>
                                </div>
                            ) : <span />}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        {finishing && (
                            <Card className="bg-muted/40">
                                <CardContent className="p-3 flex items-center gap-3">
                                    <CarAvatar photoUrl={finishing.order.profile_photo_url} size={40} />
                                    <div className="text-sm">
                                        <p className="font-medium">{finishing.order.client_name}</p>
                                        <p className="text-muted-foreground text-xs flex items-center gap-1">
                                            <Phone className="w-3 h-3" /> {finishing.order.client_phone}
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>
                        )}
                        {finishServiceList.length > 0 && (
                            <div className="space-y-2" data-testid="finish-services">
                                <label className="text-sm font-medium flex items-center gap-2">
                                    <CheckSquare className="w-4 h-4" /> ¿Qué servicios instalaste? *
                                </label>
                                <div className="space-y-1.5">
                                    {finishServiceList.map((s, i) => {
                                        const on = finishServices.includes(i);
                                        return (
                                            <button
                                                key={i}
                                                type="button"
                                                onClick={() => toggleFinishService(i)}
                                                className={`w-full flex items-center gap-2 p-2.5 rounded-lg border text-left text-sm transition-colors ${on ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-input hover:bg-muted/50'}`}
                                                data-testid={`finish-service-${i}`}
                                            >
                                                {on ? <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0" /> : <Square className="w-4 h-4 text-muted-foreground shrink-0" />}
                                                {serviceLabel(s)}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                        <div className="space-y-2">
                            <label className="text-sm font-medium flex items-center gap-2">
                                <FileText className="w-4 h-4" /> Reporte del servicio *
                            </label>
                            <Textarea
                                value={finishNotes}
                                onChange={(e) => setFinishNotes(e.target.value)}
                                placeholder="Describe el trabajo realizado, materiales usados, observaciones..."
                                rows={4}
                                data-testid="finish-notes-input"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium flex items-center gap-2">
                                <FileText className="w-4 h-4" /> Fotos del servicio terminado * (mínimo {MIN_FINISH_PHOTOS})
                                <span className={`ml-auto text-xs ${finishPhotos.length >= MIN_FINISH_PHOTOS ? 'text-emerald-400' : 'text-amber-400'}`} data-testid="finish-photos-count">
                                    {finishPhotos.length}/{MIN_FINISH_PHOTOS}
                                </span>
                            </label>
                            <CameraCapture photos={finishPhotos} onPhotosChange={setFinishPhotos} maxPhotos={MAX_FINISH_PHOTOS} />
                            <label className="block text-xs text-muted-foreground">
                                o súbelas desde la galería:
                                <input
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    onChange={handlePhotoInput}
                                    disabled={finishPhotos.length >= MAX_FINISH_PHOTOS}
                                    className="w-full text-sm mt-1"
                                    data-testid="finish-photos-input"
                                />
                            </label>
                            <p className="text-xs text-muted-foreground">
                                Al confirmar, el vehículo pasa a control de calidad.
                            </p>
                        </div>
                        {finishMissing.length > 0 && (
                            <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5" data-testid="finish-missing">
                                {finishMissing.map(m => <li key={m}>{m}</li>)}
                            </ul>
                        )}
                        <Button
                            onClick={submitFinish}
                            className="w-full brand-glow"
                            disabled={processing || finishMissing.length > 0}
                            data-testid="confirm-finish-btn"
                        >
                            <CheckCircle className="w-4 h-4 mr-2" />
                            {processing ? 'Enviando...' : 'Confirmar Finalización'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <ConfirmTwiceDialog
                open={confirmOpen}
                onOpenChange={setConfirmOpen}
                onConfirm={doFinish}
                cancelLabel="No, seguir trabajando"
                steps={[
                    {
                        title: '¿El servicio está terminado?',
                        description: (
                            <div className="space-y-2 text-sm text-muted-foreground">
                                <p>Confirma que terminaste {finishing?.order?.plate ? <b>{finishing.order.plate}</b> : 'el vehículo'} con estos servicios instalados:</p>
                                <ul className="list-disc pl-5">
                                    {(finishServiceList.length
                                        ? [...finishServices].sort((a, b) => a - b).map(i => serviceLabel(finishServiceList[i]))
                                        : [finishing?.slot?.label || 'Instalación']
                                    ).map(n => <li key={n}>{n}</li>)}
                                </ul>
                                <p>{finishPhotos.length} fotos adjuntas.</p>
                            </div>
                        ),
                        confirm: 'Sí, está terminado',
                    },
                    {
                        title: 'Confirma de nuevo',
                        description: '¿Seguro que el servicio quedó terminado? El vehículo pasará a control de calidad y ya no podrás editar el reporte.',
                        confirm: 'Sí, entregar servicio',
                    },
                ]}
            />
        </div>
    );
};

export default TechnicianView;
