import React, { useState, useEffect, useCallback } from 'react';
import { ordersAPI, usersAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { OrderStatusBadge } from '../components/OrderStatusBadge';
import { ServiceBadge } from '../components/ServiceBadge';
import { toast } from 'sonner';
import { 
    Car, UserPlus, Wrench, User, Phone, Clock, 
    XCircle, AlertTriangle, CheckCircle, Play
} from 'lucide-react';

export const Assign = () => {
    const [allOrders, setAllOrders] = useState([]);
    const [technicians, setTechnicians] = useState([]);
    const [loading, setLoading] = useState(true);
    const [assignDialogOpen, setAssignDialogOpen] = useState(false);
    const [desistDialogOpen, setDesistDialogOpen] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [selectedTechnician, setSelectedTechnician] = useState('');
    const [serviceTime, setServiceTime] = useState('60');
    const [processing, setProcessing] = useState(false);

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const [ordersRes, techniciansRes] = await Promise.all([
                ordersAPI.getAll(),
                usersAPI.getTechnicians(),
            ]);
            // Filter only active orders (exclude entregado and desistimiento)
            const activeOrders = ordersRes.data.filter(o => 
                !['entregado', 'desistimiento'].includes(o.status)
            );
            setAllOrders(activeOrders);
            setTechnicians(techniciansRes.data);
        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleAssignTechnician = async () => {
        if (!selectedOrder || !selectedTechnician) {
            toast.error('Selecciona un técnico');
            return;
        }
        setProcessing(true);
        try {
            await ordersAPI.assignTechnician({
                order_id: selectedOrder.id,
                technician_id: selectedTechnician,
                service_time_minutes: parseInt(serviceTime) || 60
            });
            toast.success('Técnico asignado correctamente');
            setAssignDialogOpen(false);
            setSelectedOrder(null);
            setSelectedTechnician('');
            setServiceTime('60');
            fetchData();
        } catch (error) {
            toast.error(error.response?.data?.detail || 'Error al asignar técnico');
        } finally {
            setProcessing(false);
        }
    };

    const handleDesistimiento = async () => {
        if (!selectedOrder) return;
        setProcessing(true);
        try {
            await ordersAPI.desistimiento(selectedOrder.id);
            toast.success('Desistimiento procesado correctamente');
            setDesistDialogOpen(false);
            setSelectedOrder(null);
            fetchData();
        } catch (error) {
            toast.error(error.response?.data?.detail || 'Error al procesar desistimiento');
        } finally {
            setProcessing(false);
        }
    };

    const openAssignDialog = (order) => {
        setSelectedOrder(order);
        setSelectedTechnician('');
        setServiceTime('60');
        setAssignDialogOpen(true);
    };

    const openDesistDialog = (order) => {
        setSelectedOrder(order);
        setDesistDialogOpen(true);
    };

    // Group orders by status
    const ordersByStatus = {
        en_revision: allOrders.filter(o => o.status === 'en_revision'),
        ingresado: allOrders.filter(o => o.status === 'ingresado'),
        asignado: allOrders.filter(o => o.status === 'asignado'),
        en_proceso: allOrders.filter(o => o.status === 'en_proceso'),
        servicio_completado: allOrders.filter(o => o.status === 'servicio_completado'),
        pendiente_pago: allOrders.filter(o => ['terminado_falta_pago', 'terminado_pagado'].includes(o.status)),
    };

    const renderOrderCard = (order, showAssign = false) => (
        <Card key={order.id} className="card-hover" data-testid={`order-${order.id}`}>
            <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center">
                            <Car className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                            <p className="font-mono font-bold text-lg">{order.plate}</p>
                            <p className="text-sm text-muted-foreground">
                                {order.brand} {order.model}
                            </p>
                        </div>
                    </div>
                    <OrderStatusBadge status={order.status} />
                </div>
                <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2 text-sm">
                        <User className="w-4 h-4 text-muted-foreground" />
                        <span>{order.client_name}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                        <Phone className="w-4 h-4 text-muted-foreground" />
                        <span>{order.client_phone}</span>
                    </div>
                    {order.assigned_technician_name && (
                        <div className="flex items-center gap-2 text-sm text-primary">
                            <Wrench className="w-4 h-4" />
                            <span>{order.assigned_technician_name}</span>
                        </div>
                    )}
                    <div className="flex flex-wrap gap-1 mt-2">
                        {order.services?.slice(0, 2).map((s, idx) => (
                            <ServiceBadge key={idx} service={typeof s === 'string' ? s : s.service} />
                        ))}
                    </div>
                </div>
                <div className="flex gap-2">
                    {showAssign && (
                        <Button 
                            className="flex-1 brand-glow"
                            onClick={() => openAssignDialog(order)}
                            data-testid={`assign-btn-${order.id}`}
                        >
                            <UserPlus className="w-4 h-4 mr-2" />
                            Asignar
                        </Button>
                    )}
                    <Button 
                        variant="outline"
                        className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                        onClick={() => openDesistDialog(order)}
                        data-testid={`desist-btn-${order.id}`}
                    >
                        <XCircle className="w-4 h-4 mr-1" />
                        Desistir
                    </Button>
                </div>
            </CardContent>
        </Card>
    );

    return (
        <div className="space-y-6" data-testid="assign-page">
            {/* Header */}
            <div>
                <h1 className="font-heading text-3xl md:text-4xl">Panel Coordinador</h1>
                <p className="text-muted-foreground">
                    Gestiona asignaciones y vehículos activos
                </p>
            </div>

            {/* Assign Dialog */}
            <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="font-heading text-xl">Asignar Técnico</DialogTitle>
                        <DialogDescription>
                            {selectedOrder && (
                                <span className="font-mono">{selectedOrder.plate}</span>
                            )}
                            {selectedOrder && ` - ${selectedOrder.brand} ${selectedOrder.model}`}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        {selectedOrder && (
                            <Card className="bg-muted/50">
                                <CardContent className="p-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                                            <Car className="w-5 h-5 text-primary" />
                                        </div>
                                        <div>
                                            <p className="font-medium">{selectedOrder.client_name}</p>
                                            <p className="text-sm text-muted-foreground">{selectedOrder.client_phone}</p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        )}
                        <div className="space-y-2">
                            <Label>Seleccionar Técnico *</Label>
                            <Select value={selectedTechnician} onValueChange={setSelectedTechnician}>
                                <SelectTrigger data-testid="assign-technician-select">
                                    <SelectValue placeholder="Seleccionar técnico..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {technicians.map(tech => (
                                        <SelectItem key={tech.id} value={tech.id}>
                                            <div className="flex items-center gap-2">
                                                <Wrench className="w-4 h-4" />
                                                {tech.name}
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="flex items-center gap-2">
                                <Clock className="w-4 h-4" />
                                Tiempo Estimado (minutos) *
                            </Label>
                            <Input
                                type="number"
                                min="15"
                                max="480"
                                value={serviceTime}
                                onChange={(e) => setServiceTime(e.target.value)}
                                placeholder="60"
                                data-testid="service-time-input"
                            />
                        </div>
                        <Button 
                            onClick={handleAssignTechnician} 
                            className="w-full brand-glow" 
                            disabled={!selectedTechnician || processing}
                            data-testid="confirm-assign-btn"
                        >
                            <UserPlus className="w-4 h-4 mr-2" />
                            {processing ? 'Procesando...' : 'Confirmar Asignación'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Desistimiento Dialog */}
            <Dialog open={desistDialogOpen} onOpenChange={setDesistDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="font-heading text-xl text-red-500 flex items-center gap-2">
                            <AlertTriangle className="w-6 h-6" />
                            Confirmar Desistimiento
                        </DialogTitle>
                        <DialogDescription>
                            Esta acción marcará la orden como desistida y no se podrá revertir.
                        </DialogDescription>
                    </DialogHeader>
                    {selectedOrder && (
                        <div className="py-4">
                            <Card className="bg-red-500/10 border-red-500/30">
                                <CardContent className="p-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-12 h-12 rounded-lg bg-red-500/20 flex items-center justify-center">
                                            <Car className="w-6 h-6 text-red-500" />
                                        </div>
                                        <div>
                                            <p className="font-mono font-bold">{selectedOrder.plate}</p>
                                            <p className="text-sm">{selectedOrder.client_name}</p>
                                            <p className="text-sm text-muted-foreground">
                                                {selectedOrder.brand} {selectedOrder.model}
                                            </p>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )}
                    <DialogFooter className="flex gap-2">
                        <Button 
                            variant="outline" 
                            onClick={() => setDesistDialogOpen(false)}
                        >
                            Cancelar
                        </Button>
                        <Button 
                            variant="destructive"
                            onClick={handleDesistimiento}
                            disabled={processing}
                            data-testid="confirm-desist-btn"
                        >
                            <XCircle className="w-4 h-4 mr-2" />
                            {processing ? 'Procesando...' : 'Confirmar Desistimiento'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {loading ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
            ) : allOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <CheckCircle className="w-16 h-16 mb-4 opacity-50" />
                    <p className="text-lg">No hay vehículos activos</p>
                    <p className="text-sm">Los vehículos aparecerán cuando se creen citas</p>
                </div>
            ) : (
                <Tabs defaultValue="pendientes" className="w-full">
                    <TabsList className="grid w-full grid-cols-4 lg:grid-cols-6">
                        <TabsTrigger value="pendientes" className="relative">
                            Pendientes
                            {ordersByStatus.en_revision.length > 0 && (
                                <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary rounded-full">
                                    {ordersByStatus.en_revision.length}
                                </span>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="ingresados">
                            Ingresados
                            {ordersByStatus.ingresado.length > 0 && (
                                <span className="ml-1 px-1.5 py-0.5 text-xs bg-purple-500 rounded-full">
                                    {ordersByStatus.ingresado.length}
                                </span>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="asignados">
                            Asignados
                            {ordersByStatus.asignado.length > 0 && (
                                <span className="ml-1 px-1.5 py-0.5 text-xs bg-orange-500 rounded-full">
                                    {ordersByStatus.asignado.length}
                                </span>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="proceso">
                            En Proceso
                            {ordersByStatus.en_proceso.length > 0 && (
                                <span className="ml-1 px-1.5 py-0.5 text-xs bg-yellow-500 rounded-full">
                                    {ordersByStatus.en_proceso.length}
                                </span>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="completados" className="hidden lg:flex">
                            Completados
                            {ordersByStatus.servicio_completado.length > 0 && (
                                <span className="ml-1 px-1.5 py-0.5 text-xs bg-teal-500 rounded-full">
                                    {ordersByStatus.servicio_completado.length}
                                </span>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="todos" className="hidden lg:flex">
                            Todos ({allOrders.length})
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="pendientes" className="mt-6">
                        <h2 className="font-heading text-xl mb-4 flex items-center gap-2">
                            <OrderStatusBadge status="en_revision" />
                            <span>Listos para Asignar</span>
                        </h2>
                        {ordersByStatus.en_revision.length === 0 ? (
                            <p className="text-muted-foreground text-center py-8">No hay órdenes pendientes de asignación</p>
                        ) : (
                            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {ordersByStatus.en_revision.map(order => renderOrderCard(order, true))}
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="ingresados" className="mt-6">
                        <h2 className="font-heading text-xl mb-4 flex items-center gap-2">
                            <OrderStatusBadge status="ingresado" />
                            <span>Vehículos Ingresados</span>
                        </h2>
                        {ordersByStatus.ingresado.length === 0 ? (
                            <p className="text-muted-foreground text-center py-8">No hay vehículos ingresados</p>
                        ) : (
                            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {ordersByStatus.ingresado.map(order => renderOrderCard(order, false))}
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="asignados" className="mt-6">
                        <h2 className="font-heading text-xl mb-4 flex items-center gap-2">
                            <OrderStatusBadge status="asignado" />
                            <span>Vehículos Asignados</span>
                        </h2>
                        {ordersByStatus.asignado.length === 0 ? (
                            <p className="text-muted-foreground text-center py-8">No hay vehículos asignados</p>
                        ) : (
                            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {ordersByStatus.asignado.map(order => renderOrderCard(order, false))}
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="proceso" className="mt-6">
                        <h2 className="font-heading text-xl mb-4 flex items-center gap-2">
                            <OrderStatusBadge status="en_proceso" />
                            <span>Vehículos en Proceso</span>
                        </h2>
                        {ordersByStatus.en_proceso.length === 0 ? (
                            <p className="text-muted-foreground text-center py-8">No hay vehículos en proceso</p>
                        ) : (
                            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {ordersByStatus.en_proceso.map(order => renderOrderCard(order, false))}
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="completados" className="mt-6">
                        <h2 className="font-heading text-xl mb-4 flex items-center gap-2">
                            <OrderStatusBadge status="servicio_completado" />
                            <span>Servicios Completados</span>
                        </h2>
                        {ordersByStatus.servicio_completado.length === 0 ? (
                            <p className="text-muted-foreground text-center py-8">No hay servicios completados</p>
                        ) : (
                            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {ordersByStatus.servicio_completado.map(order => renderOrderCard(order, false))}
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="todos" className="mt-6">
                        <h2 className="font-heading text-xl mb-4">Todos los Vehículos Activos</h2>
                        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {allOrders.map(order => renderOrderCard(order, order.status === 'en_revision'))}
                        </div>
                    </TabsContent>
                </Tabs>
            )}
        </div>
    );
};

export default Assign;
