import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ordersAPI, orderRouteAPI } from '../lib/api';
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
import {
    Wrench, Play, CheckCircle, Clock, User, Phone,
    AlertTriangle, Timer, FileText, Scissors, Sparkles,
    Package, PaintBucket, Hammer, LogIn,
} from 'lucide-react';

// ============================================================
// Sección → roles de slot que agrupa
// ============================================================
const SECTIONS = [
    { id: 'corte', label: 'Corte', icon: Scissors, roles: ['corte', 'corte_piezas'] },
    { id: 'instalacion', label: 'Instalación', icon: Wrench, roles: ['polarizado', 'ppf', 'ultrasecure', 'instalacion'] },
    { id: 'lavado', label: 'Lavado', icon: Sparkles, roles: ['lavado'] },
    { id: 'accesorios', label: 'Accesorios', icon: Package, roles: ['accesorios'] },
    { id: 'detailing', label: 'Detailing', icon: Sparkles, roles: ['detailing', 'ceramico'] },
    { id: 'latoneria', label: 'Latonería y Pintura', icon: PaintBucket, roles: ['latoneria_pintura', 'latoneria', 'pintura'] },
];

const roleToSectionId = (role) => {
    const r = (role || '').toLowerCase();
    const found = SECTIONS.find(s => s.roles.includes(r));
    return found ? found.id : null;
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

    const fetchOrders = useCallback(async () => {
        try {
            const res = await ordersAPI.getAll();
            const uid = user?.id;
            const mine = (res.data || []).filter(o =>
                Array.isArray(o.route_slots) &&
                o.route_slots.some(s => s.technician_id === uid)
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
        const t = setInterval(fetchOrders, 30000);
        return () => clearInterval(t);
    }, [fetchOrders]);

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
                const secId = roleToSectionId(slot.role);
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

    const alertsBySection = useMemo(() => {
        const counts = {};
        SECTIONS.forEach(s => {
            counts[s.id] = bySection[s.id].filter(x => x.slot.status !== 'completado').length;
        });
        return counts;
    }, [bySection]);

    const totalPending = SECTIONS.reduce((acc, s) => acc + alertsBySection[s.id], 0);

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

    const openFinish = (order, slot) => {
        setFinishing({ order, slot });
        setFinishNotes('');
        setFinishPhotos([]);
    };

    const closeFinish = () => setFinishing(null);

    const handlePhotoInput = (e) => {
        const files = Array.from(e.target.files || []);
        if (finishPhotos.length + files.length > 10) {
            toast.error('Máximo 10 fotos');
            return;
        }
        files.forEach(f => {
            const reader = new FileReader();
            reader.onload = (ev) => setFinishPhotos(prev => [...prev, ev.target.result]);
            reader.readAsDataURL(f);
        });
    };

    const submitFinish = async () => {
        if (!finishNotes.trim()) {
            toast.error('Agrega el reporte del servicio');
            return;
        }
        if (finishPhotos.length === 0) {
            toast.error('Sube al menos una foto del servicio terminado');
            return;
        }
        setProcessing(true);
        try {
            const res = await orderRouteAPI.completeSlot(finishing.order.id, finishing.slot.id, {
                notes: finishNotes.trim(),
                completion_photos: finishPhotos,
            });
            toast.success(res.data?.all_done
                ? 'Servicio finalizado · Auto listo para entrega'
                : 'Servicio finalizado');
            closeFinish();
            fetchOrders();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Error al finalizar');
        } finally {
            setProcessing(false);
        }
    };

    // pick a default tab: first section with pendings, else first section
    const defaultTab = SECTIONS.find(s => alertsBySection[s.id] > 0)?.id || SECTIONS[0].id;

    return (
        <div className="space-y-6" data-testid="technician-page">
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="font-heading text-3xl md:text-4xl">Mis Servicios</h1>
                    <p className="text-muted-foreground">
                        Servicios asignados desde la Hoja de Ruta
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
            ) : orders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                    <Wrench className="w-16 h-16 mb-4 opacity-50" />
                    <p className="text-lg">No tienes servicios asignados</p>
                    <p className="text-sm">Los servicios aparecerán cuando el coordinador te asigne en la Hoja de Ruta</p>
                </div>
            ) : (
                <Tabs defaultValue={defaultTab} className="w-full">
                    <TabsList className="grid grid-cols-3 md:grid-cols-6 gap-1 h-auto p-1">
                        {SECTIONS.map(sec => {
                            const Icon = sec.icon;
                            const count = alertsBySection[sec.id];
                            return (
                                <TabsTrigger
                                    key={sec.id}
                                    value={sec.id}
                                    className="relative flex items-center gap-1.5 py-2"
                                    data-testid={`tab-${sec.id}`}
                                >
                                    <Icon className="w-4 h-4" />
                                    <span className="text-xs md:text-sm">{sec.label}</span>
                                    {count > 0 && (
                                        <Badge className="ml-1 bg-amber-500 text-black h-5 min-w-5 px-1 text-[10px]" data-testid={`alert-${sec.id}`}>
                                            {count}
                                        </Badge>
                                    )}
                                </TabsTrigger>
                            );
                        })}
                    </TabsList>

                    {SECTIONS.map(sec => (
                        <TabsContent key={sec.id} value={sec.id} className="mt-4" data-testid={`panel-${sec.id}`}>
                            {bySection[sec.id].length === 0 ? (
                                <div className="text-center py-12 text-muted-foreground text-sm">
                                    Sin servicios asignados en <b>{sec.label}</b>
                                </div>
                            ) : (
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
                            )}
                        </TabsContent>
                    ))}
                </Tabs>
            )}

            {/* Finish Dialog */}
            <Dialog open={!!finishing} onOpenChange={(v) => !v && closeFinish()}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Finalizar Servicio</DialogTitle>
                        <DialogDescription asChild>
                            {finishing ? (
                                <div className="pt-1 flex items-center gap-2 flex-wrap">
                                    <PlateBadge plate={finishing.order.plate} size="md" />
                                    <Badge variant="outline">{finishing.slot.label}</Badge>
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
                                <FileText className="w-4 h-4" /> Fotos del servicio terminado * ({finishPhotos.length}/10)
                            </label>
                            <input
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={handlePhotoInput}
                                disabled={finishPhotos.length >= 10}
                                className="w-full text-sm"
                                data-testid="finish-photos-input"
                            />
                            {finishPhotos.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {finishPhotos.map((p, i) => (
                                        <div key={i} className="relative w-16 h-16 rounded overflow-hidden border">
                                            <img src={p} alt="" className="w-full h-full object-cover" />
                                            <button
                                                type="button"
                                                onClick={() => setFinishPhotos(prev => prev.filter((_, idx) => idx !== i))}
                                                className="absolute top-0 right-0 bg-red-500 text-white text-xs w-5 h-5 flex items-center justify-center rounded-bl"
                                                data-testid={`remove-photo-${i}`}
                                            >×</button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <p className="text-xs text-muted-foreground">
                                Al confirmar, el servicio queda listo para entrega y aparece en Autorizar Salida.
                            </p>
                        </div>
                        <Button
                            onClick={submitFinish}
                            className="w-full brand-glow"
                            disabled={processing || !finishNotes.trim() || finishPhotos.length === 0}
                            data-testid="confirm-finish-btn"
                        >
                            <CheckCircle className="w-4 h-4 mr-2" />
                            {processing ? 'Enviando...' : 'Confirmar Finalización'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default TechnicianView;
