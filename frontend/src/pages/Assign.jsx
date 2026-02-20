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
                    Asigna técnicos a los vehículos pendientes
                </p>
            </div>

            {/* Assign Dialog */}
            <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="font-heading text-xl">Asignar Técnico</DialogTitle>
                        <DialogDescription>
                            {selectedVehicle && (
                                <span className="font-mono">{selectedVehicle.plate}</span>
                            )}
                            {selectedVehicle && ` - ${selectedVehicle.brand} ${selectedVehicle.model}`}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        {selectedVehicle && (
                            <Card className="bg-muted/50">
                                <CardContent className="p-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                                            <Car className="w-5 h-5 text-primary" />
                                        </div>
                                        <div>
                                            <p className="font-medium">{selectedVehicle.client_name}</p>
                                            <p className="text-sm text-muted-foreground">{selectedVehicle.client_phone}</p>
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
            ) : vehicles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <UserPlus className="w-16 h-16 mb-4 opacity-50" />
                    <p className="text-lg">No hay vehículos pendientes de asignación</p>
                    <p className="text-sm">Los vehículos aparecerán aquí cuando estén agendados o ingresados</p>
                </div>
            ) : (
                <div className="space-y-8">
                    {/* Ingresados - Priority */}
                    {vehiclesByStatus.ingresado.length > 0 && (
                        <div>
                            <h2 className="font-heading text-xl mb-4 flex items-center gap-2">
                                <VehicleStatusBadge status="ingresado" />
                                <span>Vehículos Ingresados</span>
                                <span className="text-sm text-muted-foreground">({vehiclesByStatus.ingresado.length})</span>
                            </h2>
                            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {vehiclesByStatus.ingresado.map(vehicle => (
                                    <Card key={vehicle.id} className="card-hover border-purple-500/30" data-testid={`vehicle-${vehicle.id}`}>
                                        <CardContent className="p-4">
                                            <div className="flex items-start justify-between mb-3">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-12 h-12 rounded-lg bg-purple-500/20 flex items-center justify-center">
                                                        <Car className="w-6 h-6 text-purple-500" />
                                                    </div>
                                                    <div>
                                                        <p className="font-mono font-bold text-lg">{vehicle.plate}</p>
                                                        <p className="text-sm text-muted-foreground">
                                                            {vehicle.brand} {vehicle.model}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="space-y-2 mb-4">
                                                <div className="flex items-center gap-2 text-sm">
                                                    <User className="w-4 h-4 text-muted-foreground" />
                                                    <span>{vehicle.client_name}</span>
                                                </div>
                                                <div className="flex items-center gap-2 text-sm">
                                                    <Phone className="w-4 h-4 text-muted-foreground" />
                                                    <span>{vehicle.client_phone}</span>
                                                </div>
                                                {vehicle.assigned_technician_name && (
                                                    <div className="flex items-center gap-2 text-sm text-primary">
                                                        <Wrench className="w-4 h-4" />
                                                        <span>{vehicle.assigned_technician_name}</span>
                                                    </div>
                                                )}
                                            </div>
                                            <Button 
                                                className="w-full"
                                                onClick={() => openAssignDialog(vehicle)}
                                                data-testid={`assign-btn-${vehicle.id}`}
                                            >
                                                <UserPlus className="w-4 h-4 mr-2" />
                                                Asignar Técnico
                                            </Button>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Agendados */}
                    {vehiclesByStatus.agendado.length > 0 && (
                        <div>
                            <h2 className="font-heading text-xl mb-4 flex items-center gap-2">
                                <VehicleStatusBadge status="agendado" />
                                <span>Vehículos Agendados</span>
                                <span className="text-sm text-muted-foreground">({vehiclesByStatus.agendado.length})</span>
                            </h2>
                            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {vehiclesByStatus.agendado.map(vehicle => (
                                    <Card key={vehicle.id} className="card-hover border-blue-500/30" data-testid={`vehicle-${vehicle.id}`}>
                                        <CardContent className="p-4">
                                            <div className="flex items-start justify-between mb-3">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-12 h-12 rounded-lg bg-blue-500/20 flex items-center justify-center">
                                                        <Car className="w-6 h-6 text-blue-500" />
                                                    </div>
                                                    <div>
                                                        <p className="font-mono font-bold text-lg">{vehicle.plate}</p>
                                                        <p className="text-sm text-muted-foreground">
                                                            {vehicle.brand} {vehicle.model}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="space-y-2 mb-4">
                                                <div className="flex items-center gap-2 text-sm">
                                                    <User className="w-4 h-4 text-muted-foreground" />
                                                    <span>{vehicle.client_name}</span>
                                                </div>
                                                <div className="flex items-center gap-2 text-sm">
                                                    <Phone className="w-4 h-4 text-muted-foreground" />
                                                    <span>{vehicle.client_phone}</span>
                                                </div>
                                            </div>
                                            <p className="text-xs text-muted-foreground mb-2">
                                                Primero realiza la Revisión 360° para ingresar el vehículo
                                            </p>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
