import React, { useState, useEffect, useCallback } from 'react';
import { ordersAPI, usersAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { OrderStatusBadge } from '../components/OrderStatusBadge';
import { ServiceBadge } from '../components/ServiceBadge';
import { PlateBadge } from '../components/PlateBadge';
import { CarAvatar } from '../components/CarAvatar';
import { LiveTimer } from '../components/LiveTimer';
import { toast } from 'sonner';
import {
    DndContext, closestCenter, PointerSensor, KeyboardSensor,
    useSensor, useSensors, DragOverlay, useDroppable,
} from '@dnd-kit/core';
import {
    SortableContext, useSortable, sortableKeyboardCoordinates,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { User, Clock, GripVertical, Timer, RefreshCw, XCircle } from 'lucide-react';

// ---- Draggable order card ----
const DraggableOrder = ({ order, onClear }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: order.id });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
    };
    return (
        <div
            ref={setNodeRef}
            style={style}
            className="bg-card border border-border rounded-lg p-3 hover:border-primary/50 transition-colors"
            data-testid={`autoasignar-order-${order.id}`}
        >
            <div className="flex items-start gap-2">
                <button
                    {...attributes}
                    {...listeners}
                    className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground p-1 -ml-1"
                    aria-label="Arrastrar"
                >
                    <GripVertical className="w-4 h-4" />
                </button>
                <CarAvatar photoUrl={order.profile_photo_url} size={44} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                        <PlateBadge plate={order.plate} size="md" />
                        <OrderStatusBadge status={order.status} />
                    </div>
                    <p className="text-sm font-medium truncate">{order.client_name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                        {order.brand} {order.model} {order.color ? `· ${order.color}` : ''}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                        {(order.services || []).slice(0, 3).map((s, i) => (
                            <ServiceBadge key={i} service={typeof s === 'string' ? s : s.service} />
                        ))}
                    </div>
                    {order.ingreso_at && (
                        <div className="flex items-center gap-1 mt-1.5 text-[11px] text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            <span>Ingresó hace</span>
                            <LiveTimer startTime={order.ingreso_at} />
                        </div>
                    )}
                    {onClear && order.pre_assigned_at && (
                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
                            <span className="text-[11px] text-cyan-400 flex items-center gap-1">
                                <Timer className="w-3 h-3" />
                                Asignado hace <LiveTimer startTime={order.pre_assigned_at} />
                                {order.service_time_minutes ? ` · ${order.service_time_minutes} min est.` : ''}
                            </span>
                            <button
                                onClick={(e) => { e.stopPropagation(); onClear(order.id); }}
                                className="text-[11px] text-red-400 hover:text-red-500 flex items-center gap-0.5"
                                data-testid={`unassign-tech-${order.id}`}
                            >
                                <XCircle className="w-3 h-3" /> Quitar
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// ---- Droppable column for a técnico ----
const TechnicianColumn = ({ tech, orders, onClear }) => {
    const { setNodeRef, isOver } = useDroppable({ id: `tech-${tech.id}` });
    return (
        <Card
            ref={setNodeRef}
            className={`flex flex-col h-full transition-colors ${isOver ? 'border-cyan-400 bg-cyan-500/5' : ''}`}
            data-testid={`tech-column-${tech.id}`}
        >
            <CardHeader className="pb-3">
                <CardTitle className="text-base font-heading flex items-center gap-2">
                    <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center">
                        <User className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="truncate">{tech.name}</p>
                        <p className="text-xs text-muted-foreground font-normal">{orders.length} asignados</p>
                    </div>
                </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 space-y-2 min-h-[120px]">
                <SortableContext items={orders.map(o => o.id)} strategy={verticalListSortingStrategy}>
                    {orders.length === 0 ? (
                        <div className="text-center py-6 text-xs text-muted-foreground border-2 border-dashed border-border rounded-lg">
                            Suelta autos aquí
                        </div>
                    ) : orders.map(o => (
                        <DraggableOrder key={o.id} order={o} onClear={onClear} />
                    ))}
                </SortableContext>
            </CardContent>
        </Card>
    );
};

// ---- Droppable backlog (unassigned queue) ----
const QueueColumn = ({ orders }) => {
    const { setNodeRef, isOver } = useDroppable({ id: 'queue-unassigned' });
    return (
        <Card
            ref={setNodeRef}
            className={`flex flex-col h-full transition-colors ${isOver ? 'border-purple-400 bg-purple-500/5' : ''}`}
            data-testid="queue-column"
        >
            <CardHeader className="pb-3">
                <CardTitle className="text-base font-heading flex items-center gap-2">
                    <div className="w-9 h-9 rounded-full bg-purple-500/20 flex items-center justify-center">
                        <RefreshCw className="w-4 h-4 text-purple-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p>Cola sin asignar</p>
                        <p className="text-xs text-muted-foreground font-normal">{orders.length} autos esperando</p>
                    </div>
                </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 space-y-2 min-h-[200px]">
                <SortableContext items={orders.map(o => o.id)} strategy={verticalListSortingStrategy}>
                    {orders.length === 0 ? (
                        <div className="text-center py-8 text-sm text-muted-foreground">
                            No hay autos pendientes
                        </div>
                    ) : orders.map(o => <DraggableOrder key={o.id} order={o} />)}
                </SortableContext>
            </CardContent>
        </Card>
    );
};

// ===========================================================
//   Page
// ===========================================================
export const AutoAsignar = () => {
    const [technicians, setTechnicians] = useState([]);
    const [unassigned, setUnassigned] = useState([]);
    const [assignedByTech, setAssignedByTech] = useState({});
    const [loading, setLoading] = useState(true);
    const [activeId, setActiveId] = useState(null);
    const [pendingAssignment, setPendingAssignment] = useState(null); // { order, technician }
    const [serviceMinutes, setServiceMinutes] = useState(60);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const fetchAll = useCallback(async () => {
        try {
            const [techRes, queueRes, byTechRes] = await Promise.all([
                usersAPI.getTechnicians(),
                ordersAPI.getPendingTechAssignment(),
                ordersAPI.getOrdersByTechnician(),
            ]);
            setTechnicians(techRes.data || []);
            setUnassigned(queueRes.data || []);
            const grouped = {};
            (byTechRes.data || []).forEach(o => {
                const tid = o.pre_assigned_technician_id;
                if (!tid) return;
                grouped[tid] = grouped[tid] || [];
                grouped[tid].push(o);
            });
            setAssignedByTech(grouped);
        } catch (err) {
            console.error(err);
            toast.error('Error al cargar autos por asignar');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAll();
        const i = setInterval(fetchAll, 30000);
        return () => clearInterval(i);
    }, [fetchAll]);

    const findOrder = (id) => {
        const inQ = unassigned.find(o => o.id === id);
        if (inQ) return inQ;
        for (const tid of Object.keys(assignedByTech)) {
            const f = assignedByTech[tid].find(o => o.id === id);
            if (f) return f;
        }
        return null;
    };

    const handleDragEnd = async (event) => {
        const { active, over } = event;
        setActiveId(null);
        if (!over) return;
        const orderId = active.id;
        const targetId = over.id;
        const order = findOrder(orderId);
        if (!order) return;

        if (targetId === 'queue-unassigned') {
            // un-assign
            if (!order.pre_assigned_technician_id) return;
            try {
                await ordersAPI.clearPreAssignment(orderId);
                toast.success('Auto devuelto a la cola');
                fetchAll();
            } catch (err) {
                toast.error(err.response?.data?.detail || 'Error al quitar asignación');
            }
            return;
        }

        if (String(targetId).startsWith('tech-')) {
            const techId = String(targetId).replace('tech-', '');
            const tech = technicians.find(t => t.id === techId);
            if (!tech) return;
            setPendingAssignment({ order, technician: tech });
            setServiceMinutes(order.service_time_minutes || 60);
        }
    };

    const confirmAssign = async () => {
        if (!pendingAssignment) return;
        const { order, technician } = pendingAssignment;
        if (!serviceMinutes || serviceMinutes < 1) {
            toast.error('Define el tiempo promedio en minutos');
            return;
        }
        try {
            await ordersAPI.preAssignTechnician({
                order_id: order.id,
                technician_id: technician.id,
                service_time_minutes: parseInt(serviceMinutes, 10),
            });
            toast.success(`${order.plate} → ${technician.name} (${serviceMinutes} min)`);
            setPendingAssignment(null);
            fetchAll();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Error al asignar técnico');
        }
    };

    const handleClear = async (orderId) => {
        try {
            await ordersAPI.clearPreAssignment(orderId);
            toast.success('Pre-asignación removida');
            fetchAll();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Error');
        }
    };

    const activeOrder = activeId ? findOrder(activeId) : null;

    return (
        <div className="space-y-6" data-testid="auto-asignar-page">
            <div className="flex items-start justify-between gap-4 flex-col sm:flex-row">
                <div>
                    <h1 className="font-heading text-3xl md:text-4xl">Autos por Asignar</h1>
                    <p className="text-muted-foreground">
                        Arrastra cada auto al técnico responsable y define su tiempo promedio.
                        Una orden no puede ir a Corte sin técnico asignado.
                    </p>
                </div>
                <Button variant="outline" onClick={fetchAll} data-testid="refresh-auto-asignar-btn">
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Refrescar
                </Button>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
            ) : (
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={(e) => setActiveId(e.active.id)}
                    onDragEnd={handleDragEnd}
                    onDragCancel={() => setActiveId(null)}
                >
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                        <div className="lg:col-span-1">
                            <QueueColumn orders={unassigned} />
                        </div>
                        <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                            {technicians.length === 0 ? (
                                <Card className="md:col-span-2 xl:col-span-3">
                                    <CardContent className="p-8 text-center text-muted-foreground">
                                        No hay técnicos registrados
                                    </CardContent>
                                </Card>
                            ) : technicians.map(t => (
                                <TechnicianColumn
                                    key={t.id}
                                    tech={t}
                                    orders={assignedByTech[t.id] || []}
                                    onClear={handleClear}
                                />
                            ))}
                        </div>
                    </div>

                    <DragOverlay>
                        {activeOrder && (
                            <div className="bg-card border-2 border-cyan-400 rounded-lg p-3 shadow-2xl w-72">
                                <div className="flex items-center gap-2">
                                    <CarAvatar photoUrl={activeOrder.profile_photo_url} size={40} />
                                    <div className="flex-1 min-w-0">
                                        <PlateBadge plate={activeOrder.plate} size="md" />
                                        <p className="text-xs text-muted-foreground truncate mt-1">
                                            {activeOrder.brand} {activeOrder.model}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </DragOverlay>
                </DndContext>
            )}

            {/* Confirm assignment dialog */}
            <Dialog open={!!pendingAssignment} onOpenChange={(o) => !o && setPendingAssignment(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="font-heading text-xl">Asignar técnico</DialogTitle>
                        <DialogDescription>
                            Define el tiempo promedio estimado para este servicio.
                        </DialogDescription>
                    </DialogHeader>
                    {pendingAssignment && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                                <CarAvatar photoUrl={pendingAssignment.order.profile_photo_url} size={48} />
                                <div className="flex-1 min-w-0">
                                    <PlateBadge plate={pendingAssignment.order.plate} size="md" />
                                    <p className="text-sm mt-1 truncate">{pendingAssignment.order.client_name}</p>
                                    <p className="text-xs text-muted-foreground truncate">
                                        {pendingAssignment.order.brand} {pendingAssignment.order.model}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/10 border border-primary/30">
                                <User className="w-5 h-5 text-primary" />
                                <span className="font-medium">{pendingAssignment.technician.name}</span>
                            </div>
                            <div className="space-y-2">
                                <Label>Tiempo promedio (minutos) *</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    step={5}
                                    value={serviceMinutes}
                                    onChange={(e) => setServiceMinutes(e.target.value)}
                                    data-testid="service-minutes-input"
                                />
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPendingAssignment(null)}>
                            Cancelar
                        </Button>
                        <Button onClick={confirmAssign} data-testid="confirm-pre-assign-btn">
                            <Timer className="w-4 h-4 mr-2" />
                            Asignar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default AutoAsignar;
