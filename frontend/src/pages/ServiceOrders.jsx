import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { serviceOrdersAPI, vehiclesAPI, usersAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { StatusBadge } from '../components/StatusBadge';
import { OrderStatusBadge } from '../components/OrderStatusBadge';
import { ServiceBadge } from '../components/ServiceBadge';
import { ORDER_STATUS_LABELS as STATUS_LABELS, SERVICE_LABELS, formatDateTime } from '../lib/utils';
import { toast } from 'sonner';
import { Plus, Wrench, Car, User, Clock, ArrowRight, Play, CheckCircle2 } from 'lucide-react';

const SERVICES = Object.entries(SERVICE_LABELS).map(([value, label]) => ({ value, label }));
const STATUSES = [
    'agendado',
    'ingresado',
    'en_revision',
    'en_corte',
    'asignado',
    'en_proceso',
    'servicio_completado',
    'entregado',
];

export const ServiceOrders = () => {
    const { user, isAdmin, isAsesor, isTecnico } = useAuth();
    const [orders, setOrders] = useState([]);
    const [vehicles, setVehicles] = useState([]);
    const [technicians, setTechnicians] = useState([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('all');
    const [selectedVehicle, setSelectedVehicle] = useState(null);
    const [selectedTechnician, setSelectedTechnician] = useState('');
    const [selectedServices, setSelectedServices] = useState([]);
    const [estimatedHours, setEstimatedHours] = useState('');
    const [notes, setNotes] = useState('');

    const fetchData = async () => {
        try {
            const params = {};
            if (isTecnico) {
                params.technician_id = user.id;
            }
            if (activeTab !== 'all') {
                params.status = activeTab;
            }
            
            const [ordersRes, vehiclesRes, techniciansRes] = await Promise.all([
                serviceOrdersAPI.getAll(params),
                vehiclesAPI.getAll(),
                usersAPI.getTechnicians(),
            ]);
            setOrders(ordersRes.data);
            setVehicles(vehiclesRes.data);
            setTechnicians(techniciansRes.data);
        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab]);

    const handleServiceToggle = (service) => {
        setSelectedServices(prev =>
            prev.includes(service)
                ? prev.filter(s => s !== service)
                : [...prev, service]
        );
    };

    const handleSubmit = async () => {
        if (!selectedVehicle) {
            toast.error('Selecciona un vehículo');
            return;
        }
        if (selectedServices.length === 0) {
            toast.error('Selecciona al menos un servicio');
            return;
        }

        try {
            await serviceOrdersAPI.create({
                vehicle_id: selectedVehicle.id,
                services: selectedServices,
                assigned_technician_id: selectedTechnician || null,
                estimated_hours: estimatedHours ? parseFloat(estimatedHours) : null,
                notes,
            });
            toast.success('Orden de servicio creada exitosamente');
            setDialogOpen(false);
            resetForm();
            fetchData();
        } catch (error) {
            toast.error(error.response?.data?.detail || 'Error al crear orden');
        }
    };

    const handleStatusChange = async (orderId, newStatus) => {
        try {
            await serviceOrdersAPI.updateStatus(orderId, newStatus);
            toast.success('Estado actualizado');
            fetchData();
        } catch (error) {
            toast.error('Error al actualizar estado');
        }
    };

    const handleAssignTechnician = async (orderId, technicianId) => {
        try {
            await serviceOrdersAPI.assignTechnician(orderId, technicianId);
            toast.success('Técnico asignado');
            fetchData();
        } catch (error) {
            toast.error('Error al asignar técnico');
        }
    };

    const resetForm = () => {
        setSelectedVehicle(null);
        setSelectedTechnician('');
        setSelectedServices([]);
        setEstimatedHours('');
        setNotes('');
    };

    const getNextStatus = (current) => {
        const index = STATUSES.indexOf(current);
        return index < STATUSES.length - 1 ? STATUSES[index + 1] : null;
    };

    const ordersByStatus = STATUSES.reduce((acc, status) => {
        acc[status] = orders.filter(o => o.status === status);
        return acc;
    }, {});

    return (
        <div className="space-y-6" data-testid="service-orders-page">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="font-heading text-3xl md:text-4xl">Órdenes de Servicio</h1>
                    <p className="text-muted-foreground">
                        {isTecnico ? 'Tus órdenes asignadas' : 'Gestiona todas las órdenes del taller'}
                    </p>
                </div>
                {(isAdmin || isAsesor) && (
                    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                        <DialogTrigger asChild>
                            <Button className="brand-glow touch-target" data-testid="new-order-btn">
                                <Plus className="w-4 h-4 mr-2" />
                                Nueva Orden
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                            <DialogHeader>
                                <DialogTitle className="font-heading text-xl">Nueva Orden de Servicio</DialogTitle>
                                <DialogDescription>Configure los servicios y asigne un técnico para la orden</DialogDescription>
                            </DialogHeader>

                            <div className="space-y-4">
                                {/* Vehicle Selection */}
                                <div className="space-y-2">
                                    <Label>Vehículo *</Label>
                                    <Select
                                        value={selectedVehicle?.id}
                                        onValueChange={(value) => {
                                            const vehicle = vehicles.find(v => v.id === value);
                                            setSelectedVehicle(vehicle);
                                        }}
                                    >
                                        <SelectTrigger data-testid="order-vehicle-select">
                                            <SelectValue placeholder="Seleccionar vehículo..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {vehicles.map((vehicle) => (
                                                <SelectItem key={vehicle.id} value={vehicle.id}>
                                                    <span className="font-mono">{vehicle.plate}</span>
                                                    {' - '}{vehicle.brand} {vehicle.model}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Services */}
                                <div className="space-y-2">
                                    <Label>Servicios *</Label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {SERVICES.map((service) => (
                                            <div
                                                key={service.value}
                                                className="flex items-center space-x-2 p-2 rounded-lg bg-muted/50 cursor-pointer hover:bg-muted transition-colors"
                                                onClick={() => handleServiceToggle(service.value)}
                                            >
                                                <Checkbox
                                                    checked={selectedServices.includes(service.value)}
                                                    onCheckedChange={() => handleServiceToggle(service.value)}
                                                    data-testid={`order-service-${service.value}`}
                                                />
                                                <label className="text-sm cursor-pointer">{service.label}</label>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Technician */}
                                <div className="space-y-2">
                                    <Label>Asignar Técnico</Label>
                                    <Select
                                        value={selectedTechnician}
                                        onValueChange={setSelectedTechnician}
                                    >
                                        <SelectTrigger data-testid="order-technician-select">
                                            <SelectValue placeholder="Sin asignar" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {technicians.map((tech) => (
                                                <SelectItem key={tech.id} value={tech.id}>
                                                    {tech.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Estimated Hours */}
                                <div className="space-y-2">
                                    <Label>Horas Estimadas</Label>
                                    <Input
                                        type="number"
                                        step="0.5"
                                        value={estimatedHours}
                                        onChange={(e) => setEstimatedHours(e.target.value)}
                                        placeholder="Ej: 2.5"
                                        data-testid="order-estimated-hours"
                                    />
                                </div>

                                {/* Notes */}
                                <div className="space-y-2">
                                    <Label>Notas</Label>
                                    <Textarea
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        placeholder="Instrucciones especiales..."
                                        data-testid="order-notes"
                                    />
                                </div>

                                <Button
                                    onClick={handleSubmit}
                                    className="w-full brand-glow"
                                    disabled={!selectedVehicle || selectedServices.length === 0}
                                    data-testid="submit-order-btn"
                                >
                                    Crear Orden
                                </Button>
                            </div>
                        </DialogContent>
                    </Dialog>
                )}
            </div>

            {/* Kanban View */}
            <div className="overflow-x-auto pb-4 -mx-4 px-4">
                <div className="flex gap-4 min-w-max md:min-w-0 md:grid md:grid-cols-4 lg:grid-cols-8">
                    {STATUSES.map((status) => (
                        <div key={status} className="w-72 md:w-auto shrink-0">
                            <div className="flex items-center gap-2 mb-3">
                                <OrderStatusBadge status={status} />
                                <span className="text-sm text-muted-foreground">
                                    ({ordersByStatus[status].length})
                                </span>
                            </div>
                            <div className="space-y-3">
                                {loading ? (
                                    <Card className="bg-muted/30">
                                        <CardContent className="p-4">
                                            <div className="animate-pulse space-y-2">
                                                <div className="h-4 bg-muted rounded w-3/4"></div>
                                                <div className="h-3 bg-muted rounded w-1/2"></div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                ) : ordersByStatus[status].length === 0 ? (
                                    <div className="p-4 rounded-lg border border-dashed border-border text-center text-sm text-muted-foreground">
                                        Sin órdenes
                                    </div>
                                ) : (
                                    ordersByStatus[status].map((order) => (
                                        <Card 
                                            key={order.id} 
                                            className={`card-hover ${status === 'en_proceso' ? 'tracing-beam' : ''}`}
                                            data-testid={`order-card-${order.id}`}
                                        >
                                            <CardContent className="p-4 space-y-3">
                                                {/* Header */}
                                                <div className="flex items-start justify-between">
                                                    <div>
                                                        <p className="font-mono text-sm font-bold">
                                                            #{order.id.slice(0, 8).toUpperCase()}
                                                        </p>
                                                        <p className="text-xs text-muted-foreground">
                                                            {formatDateTime(order.created_at)}
                                                        </p>
                                                    </div>
                                                </div>

                                                {/* Vehicle */}
                                                {order.vehicle && (
                                                    <div className="flex items-center gap-2 p-2 rounded bg-muted/50">
                                                        <Car className="w-4 h-4 text-primary" />
                                                        <div className="text-sm">
                                                            <span className="font-mono">{order.vehicle.plate}</span>
                                                            <span className="text-muted-foreground">
                                                                {' - '}{order.vehicle.brand}
                                                            </span>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Services */}
                                                <div className="flex flex-wrap gap-1">
                                                    {order.services.map((s, idx) => (
                                                        <ServiceBadge key={idx} service={typeof s === 'string' ? s : s.service} />
                                                    ))}
                                                </div>

                                                {/* Asesor que agendó */}
                                                {order.created_by_name && (
                                                    <div className="flex items-center gap-1 text-xs text-purple-400">
                                                        <User className="w-3 h-3" />
                                                        <span>Agendó: {order.created_by_name}</span>
                                                    </div>
                                                )}

                                                {/* Technician */}
                                                {order.assigned_technician_name ? (
                                                    <div className="flex items-center gap-2 text-sm">
                                                        <User className="w-4 h-4 text-muted-foreground" />
                                                        <span>{order.assigned_technician_name}</span>
                                                    </div>
                                                ) : (isAdmin || isAsesor) && (
                                                    <Select
                                                        onValueChange={(techId) => handleAssignTechnician(order.id, techId)}
                                                    >
                                                        <SelectTrigger className="h-8 text-xs">
                                                            <SelectValue placeholder="Asignar técnico..." />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {technicians.map((tech) => (
                                                                <SelectItem key={tech.id} value={tech.id}>
                                                                    {tech.name}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                )}

                                                {/* Estimated time */}
                                                {order.estimated_hours && (
                                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                        <Clock className="w-4 h-4" />
                                                        <span>{order.estimated_hours}h estimadas</span>
                                                    </div>
                                                )}

                                                {/* Action Button */}
                                                {getNextStatus(order.status) && (
                                                    <Button
                                                        size="sm"
                                                        className="w-full"
                                                        onClick={() => handleStatusChange(order.id, getNextStatus(order.status))}
                                                        data-testid={`order-action-${order.id}`}
                                                    >
                                                        {order.status === 'agendado' && (
                                                            <>
                                                                <Play className="w-4 h-4 mr-1" />
                                                                Iniciar
                                                            </>
                                                        )}
                                                        {order.status === 'en_proceso' && (
                                                            <>
                                                                <ArrowRight className="w-4 h-4 mr-1" />
                                                                A Revisión
                                                            </>
                                                        )}
                                                        {order.status === 'en_revision' && (
                                                            <>
                                                                <CheckCircle2 className="w-4 h-4 mr-1" />
                                                                Finalizar
                                                            </>
                                                        )}
                                                    </Button>
                                                )}
                                            </CardContent>
                                        </Card>
                                    ))
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
