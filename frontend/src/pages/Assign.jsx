import React, { useState, useEffect, useCallback } from 'react';
import { ordersAPI, usersAPI, bahiasAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { ScrollArea } from '../components/ui/scroll-area';
import { OrderStatusBadge } from '../components/OrderStatusBadge';
import { ServiceBadge } from '../components/ServiceBadge';
import { toast } from 'sonner';
import { 
    Car, UserPlus, Wrench, User, Clock, 
    XCircle, AlertTriangle, CheckCircle, Play,
    Warehouse, GripVertical, ArrowRight, Timer,
    Scissors, Package
} from 'lucide-react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay,
    useDroppable,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { LiveTimer } from '../components/LiveTimer';

// Draggable Order Card Component
const DraggableOrderCard = ({ order, onAssign, onDesist }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: order.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    const getStatusColor = () => {
        switch (order.status) {
            case 'ingresado': return 'border-blue-500/50 bg-blue-500/5';
            case 'en_corte': return 'border-yellow-500/50 bg-yellow-500/5';
            case 'asignado': return 'border-purple-500/50 bg-purple-500/5';
            case 'en_proceso': return 'border-orange-500/50 bg-orange-500/5';
            default: return 'border-border';
        }
    };

    const hasCuttingService = order.cutting_status === 'completado' || 
        (order.services || []).some(s => {
            const desc = (s.description || '').toLowerCase();
            return desc.includes('polarizado') || desc.includes('ppf') || desc.includes('ultrasecure');
        });

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`p-3 rounded-lg border-2 ${getStatusColor()} cursor-move hover:shadow-md transition-shadow`}
        >
            <div className="flex items-start gap-3">
                <div
                    {...attributes}
                    {...listeners}
                    className="mt-1 cursor-grab active:cursor-grabbing"
                >
                    <GripVertical className="w-5 h-5 text-muted-foreground" />
                </div>
                
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-lg">{order.plate}</span>
                        <OrderStatusBadge status={order.status} />
                        {hasCuttingService && order.cutting_status === 'completado' && (
                            <Badge className="bg-green-500/20 text-green-400 text-xs">
                                <Scissors className="w-3 h-3 mr-1" />
                                Corte Listo
                            </Badge>
                        )}
                    </div>
                    <p className="text-sm text-muted-foreground">{order.brand} {order.model}</p>
                    <p className="text-xs text-muted-foreground truncate">Cliente: {order.client_name}</p>
                    
                    {/* Services */}
                    <div className="flex flex-wrap gap-1 mt-2">
                        {(order.services || []).slice(0, 2).map((svc, idx) => (
                            <Badge key={idx} variant="outline" className="text-xs">
                                {svc.description?.split(' - ')[1] || svc.service}
                            </Badge>
                        ))}
                        {(order.services || []).length > 2 && (
                            <Badge variant="outline" className="text-xs">
                                +{order.services.length - 2} más
                            </Badge>
                        )}
                    </div>

                    {/* Bahia info if assigned */}
                    {order.bahia_name && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-cyan-400">
                            <Warehouse className="w-3 h-3" />
                            {order.bahia_name}
                        </div>
                    )}

                    {/* Live timers */}
                    <div className="mt-2 flex flex-wrap gap-3">
                        {order.ingreso_at && (
                            <LiveTimer
                                startTime={order.ingreso_at}
                                label="En taller"
                                colorClass="text-blue-400"
                                testId={`timer-ingreso-${order.id}`}
                            />
                        )}
                        {order.cutting_started_at && (
                            <LiveTimer
                                startTime={order.cutting_started_at}
                                endTime={order.cutting_status === 'completado' ? order.cutting_completed_at : null}
                                label="Corte"
                                colorClass="text-yellow-400"
                                testId={`timer-corte-${order.id}`}
                            />
                        )}
                        {order.assigned_at && (
                            <LiveTimer
                                startTime={order.assigned_at}
                                endTime={order.service_completed_at || null}
                                label="Técnico"
                                colorClass="text-purple-400"
                                testId={`timer-tecnico-${order.id}`}
                            />
                        )}
                    </div>
                </div>

                <div className="flex flex-col gap-1">
                    <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-primary/50 text-primary hover:bg-primary/10"
                        onClick={() => onAssign(order)}
                    >
                        <UserPlus className="w-3 h-3 mr-1" />
                        Asignar
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-500/10"
                        onClick={() => onDesist(order)}
                    >
                        <XCircle className="w-3 h-3 mr-1" />
                        Desistir
                    </Button>
                </div>
            </div>
        </div>
    );
};

// Bahia Drop Zone Component
const BahiaDropZone = ({ bahia, onRelease }) => {
    const hasOrder = bahia.current_order !== null;
    const { isOver, setNodeRef } = useDroppable({ id: bahia.id, disabled: hasOrder });
    
    return (
        <div
            ref={setNodeRef}
            data-testid={`bahia-drop-${bahia.id}`}
            className={`p-3 rounded-lg border-2 transition-all ${
                hasOrder 
                    ? 'border-cyan-500/50 bg-cyan-500/5' 
                    : isOver
                        ? 'border-primary bg-primary/10 scale-[1.02]'
                        : 'border-dashed border-muted-foreground/30 bg-muted/20 hover:border-muted-foreground/50'
            }`}>
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <Warehouse className="w-4 h-4 text-cyan-400" />
                    <span className="font-bold text-sm">{bahia.name}</span>
                </div>
                {hasOrder && (
                    <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs text-red-500 hover:bg-red-500/10"
                        onClick={() => onRelease(bahia.id)}
                        data-testid={`release-bahia-${bahia.id}`}
                    >
                        Liberar
                    </Button>
                )}
            </div>
            <p className="text-xs text-muted-foreground mb-2">{bahia.description}</p>
            
            {hasOrder ? (
                <div className="p-2 rounded bg-background/50">
                    <div className="flex items-center gap-2">
                        <Car className="w-4 h-4 text-cyan-400" />
                        <span className="font-bold">{bahia.current_order.plate}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {bahia.current_order.brand} {bahia.current_order.model}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        {bahia.current_order.client_name}
                    </p>
                    {bahia.current_order.ingreso_at && (
                        <div className="mt-1">
                            <LiveTimer
                                startTime={bahia.current_order.ingreso_at}
                                label="En taller"
                                colorClass="text-blue-400"
                                testId={`bahia-timer-${bahia.id}`}
                            />
                        </div>
                    )}
                </div>
            ) : (
                <div className="h-16 flex items-center justify-center text-muted-foreground text-xs">
                    Arrastra una orden aquí
                </div>
            )}
        </div>
    );
};

export const Assign = () => {
    const [orders, setOrders] = useState([]);
    const [bahias, setBahias] = useState([]);
    const [technicians, setTechnicians] = useState([]);
    const [loading, setLoading] = useState(true);
    const [assignDialogOpen, setAssignDialogOpen] = useState(false);
    const [desistDialogOpen, setDesistDialogOpen] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [selectedTechnician, setSelectedTechnician] = useState('');
    const [selectedBahia, setSelectedBahia] = useState('');
    const [serviceTime, setServiceTime] = useState('60');
    const [processing, setProcessing] = useState(false);
    const [activeId, setActiveId] = useState(null);
    const [priorityList, setPriorityList] = useState([]);

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const [ordersRes, techniciansRes, bahiasRes] = await Promise.all([
                ordersAPI.getAll(),
                usersAPI.getTechnicians(),
                bahiasAPI.getAll(),
            ]);
            
            // Filter active orders ready for assignment
            const activeOrders = ordersRes.data.filter(o => 
                ['ingresado', 'en_corte', 'asignado', 'en_proceso'].includes(o.status) &&
                o.status !== 'desistimiento'
            );
            
            // Sort by cutting status (completed first) and then by date
            activeOrders.sort((a, b) => {
                if (a.cutting_status === 'completado' && b.cutting_status !== 'completado') return -1;
                if (b.cutting_status === 'completado' && a.cutting_status !== 'completado') return 1;
                return new Date(a.created_at) - new Date(b.created_at);
            });
            
            setOrders(activeOrders);
            setPriorityList(activeOrders.map(o => o.id));
            setTechnicians(techniciansRes.data);
            setBahias(bahiasRes.data);
        } catch (error) {
            console.error('Error fetching data:', error);
            toast.error('Error al cargar datos');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, [fetchData]);

    const handleDragStart = (event) => {
        setActiveId(event.active.id);
    };

    const handleDragEnd = (event) => {
        const { active, over } = event;
        setActiveId(null);

        if (!over) return;

        // Check if dropped on a bahia
        if (over.id.toString().startsWith('bahia_')) {
            const orderId = active.id;
            const bahiaId = over.id;
            handleAssignToBahia(orderId, bahiaId);
            return;
        }

        // Reorder priority list
        if (active.id !== over.id) {
            setPriorityList((items) => {
                const oldIndex = items.indexOf(active.id);
                const newIndex = items.indexOf(over.id);
                return arrayMove(items, oldIndex, newIndex);
            });
            toast.success('Prioridad actualizada');
        }
    };

    const handleAssignToBahia = async (orderId, bahiaId) => {
        try {
            await bahiasAPI.assign(bahiaId, orderId);
            toast.success('Orden asignada a bahía');
            fetchData();
        } catch (error) {
            toast.error('Error al asignar a bahía');
        }
    };

    const handleReleaseBahia = async (bahiaId) => {
        try {
            await bahiasAPI.release(bahiaId);
            toast.success('Bahía liberada');
            fetchData();
        } catch (error) {
            toast.error('Error al liberar bahía');
        }
    };

    const handleAssign = async () => {
        if (!selectedOrder || !selectedTechnician) {
            toast.error('Selecciona un técnico');
            return;
        }

        setProcessing(true);
        try {
            await ordersAPI.assignTechnician({
                order_id: selectedOrder.id,
                technician_id: selectedTechnician,
                estimated_time: parseInt(serviceTime) || 60
            });
            
            // If bahia selected, assign to bahia too
            if (selectedBahia) {
                await bahiasAPI.assign(selectedBahia, selectedOrder.id);
            }
            
            toast.success('Servicio asignado correctamente');
            setAssignDialogOpen(false);
            setSelectedOrder(null);
            setSelectedTechnician('');
            setSelectedBahia('');
            setServiceTime('60');
            fetchData();
        } catch (error) {
            toast.error('Error al asignar servicio');
        } finally {
            setProcessing(false);
        }
    };

    const handleDesist = async () => {
        if (!selectedOrder) return;

        setProcessing(true);
        try {
            await ordersAPI.withdrawOrder(selectedOrder.id);
            toast.success('Orden marcada como desistida');
            setDesistDialogOpen(false);
            setSelectedOrder(null);
            fetchData();
        } catch (error) {
            toast.error('Error al procesar desistimiento');
        } finally {
            setProcessing(false);
        }
    };

    const openAssignDialog = (order) => {
        setSelectedOrder(order);
        setAssignDialogOpen(true);
    };

    const openDesistDialog = (order) => {
        setSelectedOrder(order);
        setDesistDialogOpen(true);
    };

    // Get orders in priority order
    const sortedOrders = priorityList
        .map(id => orders.find(o => o.id === id))
        .filter(Boolean);

    // Stats
    const stats = {
        pending: orders.filter(o => o.status === 'ingresado' || o.status === 'en_corte').length,
        assigned: orders.filter(o => o.status === 'asignado').length,
        inProgress: orders.filter(o => o.status === 'en_proceso').length,
        cuttingReady: orders.filter(o => o.cutting_status === 'completado').length,
    };

    const activeOrder = activeId ? orders.find(o => o.id === activeId) : null;

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6" data-testid="assign-page">
            {/* Header */}
            <div>
                <h1 className="font-heading text-2xl md:text-3xl flex items-center gap-3">
                    <UserPlus className="w-8 h-8 text-primary" />
                    Asignación y Priorización
                </h1>
                <p className="text-muted-foreground mt-1">
                    Arrastra las órdenes para cambiar prioridad o asignar a una bahía
                </p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="border-blue-500/30">
                    <CardContent className="pt-4 pb-4">
                        <div className="flex items-center gap-3">
                            <Package className="w-5 h-5 text-blue-400" />
                            <div>
                                <p className="text-xl font-bold">{stats.pending}</p>
                                <p className="text-xs text-muted-foreground">Pendientes</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-green-500/30">
                    <CardContent className="pt-4 pb-4">
                        <div className="flex items-center gap-3">
                            <Scissors className="w-5 h-5 text-green-400" />
                            <div>
                                <p className="text-xl font-bold">{stats.cuttingReady}</p>
                                <p className="text-xs text-muted-foreground">Corte Listo</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-purple-500/30">
                    <CardContent className="pt-4 pb-4">
                        <div className="flex items-center gap-3">
                            <UserPlus className="w-5 h-5 text-purple-400" />
                            <div>
                                <p className="text-xl font-bold">{stats.assigned}</p>
                                <p className="text-xs text-muted-foreground">Asignados</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-orange-500/30">
                    <CardContent className="pt-4 pb-4">
                        <div className="flex items-center gap-3">
                            <Wrench className="w-5 h-5 text-orange-400" />
                            <div>
                                <p className="text-xl font-bold">{stats.inProgress}</p>
                                <p className="text-xs text-muted-foreground">En Proceso</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
            >
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Priority Queue */}
                    <div className="lg:col-span-2">
                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    <GripVertical className="w-5 h-5" />
                                    Cola de Prioridad
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {sortedOrders.length > 0 ? (
                                    <SortableContext
                                        items={priorityList}
                                        strategy={verticalListSortingStrategy}
                                    >
                                        <div className="space-y-2">
                                            {sortedOrders.map((order, index) => (
                                                <div key={order.id} className="flex items-center gap-2">
                                                    <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center font-bold">
                                                        {index + 1}
                                                    </span>
                                                    <div className="flex-1">
                                                        <DraggableOrderCard
                                                            order={order}
                                                            onAssign={openAssignDialog}
                                                            onDesist={openDesistDialog}
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </SortableContext>
                                ) : (
                                    <div className="text-center py-8 text-muted-foreground">
                                        <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                                        <p>No hay órdenes pendientes de asignación</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Bahias */}
                    <div>
                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    <Warehouse className="w-5 h-5 text-cyan-400" />
                                    Bahías
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ScrollArea className="h-[600px] pr-4">
                                    <div className="space-y-3">
                                        {bahias.map((bahia) => (
                                            <BahiaDropZone
                                                key={bahia.id}
                                                bahia={bahia}
                                                onRelease={handleReleaseBahia}
                                            />
                                        ))}
                                    </div>
                                </ScrollArea>
                            </CardContent>
                        </Card>
                    </div>
                </div>

                <DragOverlay>
                    {activeOrder && (
                        <div className="p-3 rounded-lg border-2 border-primary bg-background shadow-lg">
                            <div className="flex items-center gap-2">
                                <Car className="w-5 h-5 text-primary" />
                                <span className="font-bold">{activeOrder.plate}</span>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                {activeOrder.brand} {activeOrder.model}
                            </p>
                        </div>
                    )}
                </DragOverlay>
            </DndContext>

            {/* Assign Dialog */}
            <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <UserPlus className="w-5 h-5 text-primary" />
                            Asignar Servicio
                        </DialogTitle>
                        <DialogDescription>
                            Asigna un técnico y bahía para este vehículo
                        </DialogDescription>
                    </DialogHeader>
                    
                    {selectedOrder && (
                        <div className="space-y-4">
                            <div className="p-4 rounded-lg bg-muted/50">
                                <div className="flex items-center gap-2">
                                    <Car className="w-5 h-5 text-primary" />
                                    <span className="font-bold text-lg">{selectedOrder.plate}</span>
                                </div>
                                <p className="text-muted-foreground">{selectedOrder.brand} {selectedOrder.model}</p>
                                <p className="text-sm text-muted-foreground">Cliente: {selectedOrder.client_name}</p>
                            </div>

                            <div className="space-y-2">
                                <Label>Técnico *</Label>
                                <Select value={selectedTechnician} onValueChange={setSelectedTechnician}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecciona un técnico" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {technicians.map((tech) => (
                                            <SelectItem key={tech.id} value={tech.id}>
                                                <div className="flex items-center gap-2">
                                                    <User className="w-4 h-4" />
                                                    {tech.name}
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label>Bahía (Opcional)</Label>
                                <Select value={selectedBahia} onValueChange={setSelectedBahia}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecciona una bahía" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {bahias.filter(b => !b.current_order_id).map((bahia) => (
                                            <SelectItem key={bahia.id} value={bahia.id}>
                                                <div className="flex items-center gap-2">
                                                    <Warehouse className="w-4 h-4" />
                                                    {bahia.name} - {bahia.description}
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label className="flex items-center gap-2">
                                    <Timer className="w-4 h-4" />
                                    Tiempo Estimado (minutos)
                                </Label>
                                <Input
                                    type="number"
                                    min="15"
                                    value={serviceTime}
                                    onChange={(e) => setServiceTime(e.target.value)}
                                    placeholder="60"
                                />
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={handleAssign} disabled={processing || !selectedTechnician}>
                            {processing ? 'Asignando...' : 'Asignar'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Desist Dialog */}
            <Dialog open={desistDialogOpen} onOpenChange={setDesistDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-red-500">
                            <XCircle className="w-5 h-5" />
                            Desistimiento de Servicio
                        </DialogTitle>
                        <DialogDescription>
                            ¿Estás seguro de marcar esta orden como desistida?
                        </DialogDescription>
                    </DialogHeader>
                    
                    {selectedOrder && (
                        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30">
                            <div className="flex items-center gap-2">
                                <Car className="w-5 h-5 text-red-500" />
                                <span className="font-bold">{selectedOrder.plate}</span>
                            </div>
                            <p className="text-muted-foreground">{selectedOrder.brand} {selectedOrder.model}</p>
                            <p className="text-sm text-muted-foreground">Cliente: {selectedOrder.client_name}</p>
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDesistDialogOpen(false)}>
                            Cancelar
                        </Button>
                        <Button 
                            variant="destructive" 
                            onClick={handleDesist} 
                            disabled={processing}
                        >
                            {processing ? 'Procesando...' : 'Confirmar Desistimiento'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default Assign;
