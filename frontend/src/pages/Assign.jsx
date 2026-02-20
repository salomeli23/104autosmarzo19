import React, { useState, useEffect, useCallback } from 'react';
import { ordersAPI, usersAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { Label } from '../components/ui/label';
import { OrderStatusBadge } from '../components/OrderStatusBadge';
import { toast } from 'sonner';
import { Input } from '../components/ui/input';
import { Car, UserPlus, Wrench, User, Phone, Clock } from 'lucide-react';

export const Assign = () => {
    const [orders, setOrders] = useState([]);
    const [technicians, setTechnicians] = useState([]);
    const [loading, setLoading] = useState(true);
    const [assignDialogOpen, setAssignDialogOpen] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [selectedTechnician, setSelectedTechnician] = useState('');
    const [serviceTime, setServiceTime] = useState('60');

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const [ordersRes, techniciansRes] = await Promise.all([
                ordersAPI.getAll(),
                usersAPI.getTechnicians(),
            ]);
            // Filter orders that need assignment (en_revision status)
            const pendingOrders = ordersRes.data.filter(o => 
                o.status === 'en_revision'
            );
            setOrders(pendingOrders);
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
        }
    };

    const openAssignDialog = (order) => {
        setSelectedOrder(order);
        setSelectedTechnician('');
        setServiceTime('60');
        setAssignDialogOpen(true);
    };

    return (
        <div className="space-y-6" data-testid="assign-page">
            {/* Header */}
            <div>
                <h1 className="font-heading text-3xl md:text-4xl">Asignar Técnico</h1>
                <p className="text-muted-foreground">
                    Asigna técnicos a las órdenes en revisión
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
                            disabled={!selectedTechnician}
                            data-testid="confirm-assign-btn"
                        >
                            <UserPlus className="w-4 h-4 mr-2" />
                            Confirmar Asignación
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {loading ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
            ) : orders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <UserPlus className="w-16 h-16 mb-4 opacity-50" />
                    <p className="text-lg">No hay órdenes pendientes de asignación</p>
                    <p className="text-sm">Las órdenes aparecerán aquí después de completar la inspección 360°</p>
                </div>
            ) : (
                <div className="space-y-8">
                    <div>
                        <h2 className="font-heading text-xl mb-4 flex items-center gap-2">
                            <OrderStatusBadge status="en_revision" />
                            <span>Órdenes en Revisión</span>
                            <span className="text-sm text-muted-foreground">({orders.length})</span>
                        </h2>
                        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {orders.map(order => (
                                <Card key={order.id} className="card-hover border-indigo-500/30" data-testid={`order-${order.id}`}>
                                    <CardContent className="p-4">
                                        <div className="flex items-start justify-between mb-3">
                                            <div className="flex items-center gap-3">
                                                <div className="w-12 h-12 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                                                    <Car className="w-6 h-6 text-indigo-500" />
                                                </div>
                                                <div>
                                                    <p className="font-mono font-bold text-lg">{order.plate}</p>
                                                    <p className="text-sm text-muted-foreground">
                                                        {order.brand} {order.model}
                                                    </p>
                                                </div>
                                            </div>
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
                                        </div>
                                        <Button 
                                            className="w-full"
                                            onClick={() => openAssignDialog(order)}
                                            data-testid={`assign-btn-${order.id}`}
                                        >
                                            <UserPlus className="w-4 h-4 mr-2" />
                                            Asignar Técnico
                                        </Button>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
