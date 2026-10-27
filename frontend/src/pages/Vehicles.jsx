import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { vehiclesAPI, usersAPI } from '../lib/api';
import { AssignTechniciansDialog } from '../components/AssignTechniciansDialog';
import { orderTechnicians } from '../lib/workflow';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs';
import { VehicleStatusBadge } from '../components/VehicleStatusBadge';
import { InspectedVehiclesView } from '../components/InspectedVehiclesView';
import { toast } from 'sonner';
import { Plus, Car, Search, User, Phone, Mail, UserPlus, Wrench, ClipboardCheck, AlertTriangle } from 'lucide-react';
import { PostventaBadge } from '../components/PostventaBadge';
import { AccessoryStatusTag } from '../components/AccessoryStatusTag';
import { CheckinByTag } from '../components/CheckinByTag';
import { OrderTimers } from '../components/OrderTimers';
import { UpdateOrderButton } from '../components/UpdateOrderButton';

// Lista de marcas y modelos
const CAR_BRANDS = [
    'Chevrolet', 'Renault', 'Mazda', 'Kia', 'Nissan', 'Toyota', 'Hyundai', 'Ford',
    'Volkswagen', 'Suzuki', 'Honda', 'BMW', 'Mercedes-Benz', 'Audi', 'Jeep',
    'Mitsubishi', 'Peugeot', 'Citroën', 'Fiat', 'Otro'
];

const CAR_MODELS = {
    'Chevrolet': ['Spark', 'Sail', 'Onix', 'Tracker', 'Captiva', 'Equinox', 'Blazer', 'Tahoe', 'Trailblazer', 'N300', 'N400', 'Otro'],
    'Renault': ['Kwid', 'Sandero', 'Stepway', 'Logan', 'Duster', 'Koleos', 'Captur', 'Oroch', 'Kangoo', 'Master', 'Otro'],
    'Mazda': ['Mazda 2', 'Mazda 3', 'Mazda 6', 'CX-3', 'CX-30', 'CX-5', 'CX-9', 'MX-5', 'BT-50', 'Otro'],
    'Kia': ['Picanto', 'Rio', 'Cerato', 'K5', 'Soul', 'Seltos', 'Sportage', 'Sorento', 'Carnival', 'Stinger', 'Otro'],
    'Nissan': ['March', 'Versa', 'Sentra', 'Kicks', 'Qashqai', 'X-Trail', 'Pathfinder', 'Frontier', 'NP300', 'Otro'],
    'Toyota': ['Yaris', 'Corolla', 'Camry', 'Prius', 'C-HR', 'RAV4', 'Fortuner', 'Land Cruiser', 'Hilux', '4Runner', 'Otro'],
    'Hyundai': ['Grand i10', 'Accent', 'Elantra', 'Sonata', 'Venue', 'Kona', 'Tucson', 'Santa Fe', 'Palisade', 'Creta', 'Otro'],
    'Ford': ['Fiesta', 'Focus', 'Fusion', 'Mustang', 'EcoSport', 'Escape', 'Explorer', 'Expedition', 'Ranger', 'F-150', 'Otro'],
    'Volkswagen': ['Gol', 'Polo', 'Virtus', 'Jetta', 'Passat', 'T-Cross', 'Taos', 'Tiguan', 'Touareg', 'Amarok', 'Otro'],
    'Suzuki': ['Alto', 'Swift', 'Baleno', 'Ciaz', 'S-Presso', 'Vitara', 'Grand Vitara', 'Jimny', 'XL7', 'Otro'],
    'Honda': ['Brio', 'City', 'Civic', 'Accord', 'HR-V', 'CR-V', 'Pilot', 'Passport', 'Odyssey', 'Otro'],
    'BMW': ['Serie 1', 'Serie 2', 'Serie 3', 'Serie 4', 'Serie 5', 'Serie 7', 'X1', 'X3', 'X5', 'X7', 'Otro'],
    'Mercedes-Benz': ['Clase A', 'Clase C', 'Clase E', 'Clase S', 'GLA', 'GLC', 'GLE', 'GLS', 'Sprinter', 'Otro'],
    'Audi': ['A1', 'A3', 'A4', 'A6', 'A8', 'Q2', 'Q3', 'Q5', 'Q7', 'Q8', 'Otro'],
    'Jeep': ['Renegade', 'Compass', 'Cherokee', 'Grand Cherokee', 'Wrangler', 'Gladiator', 'Otro'],
    'Mitsubishi': ['Mirage', 'Lancer', 'ASX', 'Outlander', 'Eclipse Cross', 'Montero', 'L200', 'Otro'],
    'Peugeot': ['208', '301', '308', '408', '508', '2008', '3008', '5008', 'Partner', 'Otro'],
    'Citroën': ['C3', 'C4', 'C5 Aircross', 'Berlingo', 'Jumpy', 'Otro'],
    'Fiat': ['Mobi', 'Argo', 'Cronos', 'Tipo', '500', 'Toro', 'Ducato', 'Otro'],
    'Otro': ['Especificar en notas']
};

const COLORS = ['Blanco', 'Negro', 'Gris', 'Plata', 'Rojo', 'Azul', 'Verde', 'Amarillo', 'Naranja', 'Café', 'Beige', 'Otro'];
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 30 }, (_, i) => CURRENT_YEAR - i);

const STATUS_FILTERS = [
    { value: 'all', label: 'Todos' },
    { value: 'agendado', label: 'Agendados' },
    { value: 'ingresado', label: 'Ingresados' },
    { value: 'con_tecnico', label: 'Con Técnico' },
    { value: 'en_proceso', label: 'En Proceso' },
    { value: 'finalizado', label: 'Finalizados' },
];

const FINISHED_STATUSES = ['servicio_completado', 'terminado_falta_pago', 'terminado_pagado', 'entregado', 'desistimiento'];

// Qué le falta al vehículo: Revisión 360° o técnico asignado
const getPendingAlert = (vehicle) => {
    if (vehicle.status === 'ingresado' && !vehicle.inspection_at) {
        return { label: 'Falta Revisión 360°', className: 'bg-amber-500/10 text-amber-500 border-amber-500/30', testId: 'missing-360' };
    }
    const hasTechnician = vehicle.assigned_technician_id || vehicle.pre_assigned_technician_id || (vehicle.route_slots || []).length > 0;
    if (vehicle.inspection_at && !hasTechnician && !FINISHED_STATUSES.includes(vehicle.status)) {
        return { label: 'Revisión 360° lista · Falta asignar técnico', className: 'bg-orange-500/10 text-orange-500 border-orange-500/30', testId: 'missing-technician' };
    }
    return null;
};

export const Vehicles = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    // Solo admin y asesor pueden guardar la Revisión 360°
    const canDoInspection = ['admin', 'asesor'].includes(user?.role);
    const [view, setView] = useState('gestion'); // 'gestion' | 'ingresados'
    const [vehicles, setVehicles] = useState([]);
    const [technicians, setTechnicians] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [assigningVehicle, setAssigningVehicle] = useState(null);
    // Asignar técnicos: admin y coordinador
    const canAssign = ['admin', 'coordinador'].includes(user?.role);
    const [availableModels, setAvailableModels] = useState([]);
    const [formData, setFormData] = useState({
        plate: '', brand: '', model: '', year: CURRENT_YEAR.toString(),
        color: '', vin: '', client_name: '', client_phone: '', client_email: '', client_cedula: '',
    });

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const statusParam = statusFilter !== 'all' ? statusFilter : null;
            const [vehiclesRes, techniciansRes] = await Promise.all([
                vehiclesAPI.getAll(statusParam),
                usersAPI.getTechnicians(),
            ]);
            setVehicles(vehiclesRes.data);
            setTechnicians(techniciansRes.data);
        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        if (formData.brand && CAR_MODELS[formData.brand]) {
            setAvailableModels(CAR_MODELS[formData.brand]);
        } else {
            setAvailableModels([]);
        }
    }, [formData.brand]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.brand || !formData.model || !formData.color) {
            toast.error('Completa todos los campos del vehículo');
            return;
        }
        try {
            await vehiclesAPI.create({
                ...formData,
                plate: formData.plate.toUpperCase(),
                year: parseInt(formData.year),
            });
            toast.success('Vehículo registrado exitosamente');
            setDialogOpen(false);
            fetchData();
            setFormData({
                plate: '', brand: '', model: '', year: CURRENT_YEAR.toString(),
                color: '', vin: '', client_name: '', client_phone: '', client_email: '', client_cedula: '',
            });
        } catch (error) {
            toast.error(error.response?.data?.detail || 'Error al registrar vehículo');
        }
    };

    const filteredVehicles = vehicles.filter(v => 
        v.plate.toLowerCase().includes(searchTerm.toLowerCase()) ||
        v.client_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        v.brand.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="space-y-6" data-testid="vehicles-page">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="font-heading text-3xl md:text-4xl">Vehículos</h1>
                    <p className="text-muted-foreground">
                        Gestión de vehículos y asignación de técnicos
                    </p>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                        <Button className="brand-glow touch-target" data-testid="new-vehicle-btn">
                            <Plus className="w-4 h-4 mr-2" />
                            Nuevo Vehículo
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle className="font-heading text-xl">Registrar Vehículo</DialogTitle>
                            <DialogDescription>Ingrese los datos del vehículo y cliente</DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-4">
                                <h3 className="font-heading text-lg flex items-center gap-2">
                                    <Car className="w-4 h-4" /> Datos del Vehículo
                                </h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Placa *</Label>
                                        <Input value={formData.plate} onChange={(e) => setFormData(prev => ({ ...prev, plate: e.target.value.toUpperCase() }))} required className="font-mono" placeholder="ABC123" data-testid="vehicle-plate" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Año *</Label>
                                        <Select value={formData.year} onValueChange={(v) => setFormData(prev => ({ ...prev, year: v }))}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent>{YEARS.map(y => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Marca *</Label>
                                        <Select value={formData.brand} onValueChange={(v) => setFormData(prev => ({ ...prev, brand: v, model: '' }))}>
                                            <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                                            <SelectContent>{CAR_BRANDS.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Modelo *</Label>
                                        <Select value={formData.model} onValueChange={(v) => setFormData(prev => ({ ...prev, model: v }))} disabled={!formData.brand}>
                                            <SelectTrigger><SelectValue placeholder={formData.brand ? "Seleccionar" : "Primero marca"} /></SelectTrigger>
                                            <SelectContent>{availableModels.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Color *</Label>
                                        <Select value={formData.color} onValueChange={(v) => setFormData(prev => ({ ...prev, color: v }))}>
                                            <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                                            <SelectContent>{COLORS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>VIN</Label>
                                        <Input value={formData.vin} onChange={(e) => setFormData(prev => ({ ...prev, vin: e.target.value.toUpperCase() }))} className="font-mono" placeholder="Opcional" />
                                    </div>
                                </div>
                            </div>
                            <div className="space-y-4">
                                <h3 className="font-heading text-lg flex items-center gap-2">
                                    <User className="w-4 h-4" /> Datos del Cliente
                                </h3>
                                <div className="space-y-2">
                                    <Label>Nombre *</Label>
                                    <Input value={formData.client_name} onChange={(e) => setFormData(prev => ({ ...prev, client_name: e.target.value }))} required />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Teléfono *</Label>
                                        <Input value={formData.client_phone} onChange={(e) => setFormData(prev => ({ ...prev, client_phone: e.target.value }))} required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Cédula</Label>
                                        <Input value={formData.client_cedula} onChange={(e) => setFormData(prev => ({ ...prev, client_cedula: e.target.value }))} />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>Email</Label>
                                    <Input type="email" value={formData.client_email} onChange={(e) => setFormData(prev => ({ ...prev, client_email: e.target.value }))} />
                                </div>
                            </div>
                            <Button type="submit" className="w-full brand-glow">Registrar Vehículo</Button>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>

            <Tabs value={view} onValueChange={setView}>
                <TabsList className="grid grid-cols-2 w-full sm:w-auto sm:inline-grid">
                    <TabsTrigger value="gestion" data-testid="vehicles-tab-gestion">
                        <Car className="w-4 h-4 mr-2" />
                        Gestión
                    </TabsTrigger>
                    <TabsTrigger value="ingresados" data-testid="vehicles-tab-ingresados">
                        <ClipboardCheck className="w-4 h-4 mr-2" />
                        Ingresados (Revisión 360°)
                    </TabsTrigger>
                </TabsList>
            </Tabs>

            {view === 'ingresados' && <InspectedVehiclesView />}

            {view === 'gestion' && (<>
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-4">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input placeholder="Buscar por placa, cliente o marca..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" />
                </div>
                <Tabs value={statusFilter} onValueChange={setStatusFilter} className="w-full sm:w-auto">
                    <TabsList className="grid grid-cols-3 sm:grid-cols-6 h-auto">
                        {STATUS_FILTERS.map(f => (
                            <TabsTrigger key={f.value} value={f.value} className="text-xs px-2 py-1.5">
                                {f.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>
            </div>

            <AssignTechniciansDialog
                order={assigningVehicle}
                technicians={technicians}
                onClose={() => setAssigningVehicle(null)}
                onAssigned={fetchData}
            />

            {/* Vehicles Grid */}
            {loading ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
            ) : filteredVehicles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Car className="w-16 h-16 mb-4 opacity-50" />
                    <p className="text-lg">No hay vehículos {statusFilter !== 'all' ? 'con este estado' : 'registrados'}</p>
                </div>
            ) : (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredVehicles.map((vehicle) => (
                        <Card key={vehicle.id} className="card-hover" data-testid={`vehicle-card-${vehicle.id}`}>
                            <CardContent className="p-4">
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center">
                                            <Car className="w-6 h-6 text-primary" />
                                        </div>
                                        <div>
                                            <p className="font-mono font-bold text-lg">{vehicle.plate}</p>
                                            <p className="text-sm text-muted-foreground">
                                                {vehicle.brand} {vehicle.model} {vehicle.year}
                                            </p>
                                            <PostventaBadge order={vehicle} className="mt-1" />
                                            <CheckinByTag order={vehicle} className="mt-1" />
                                            <OrderTimers order={vehicle} className="mt-1" />
                                            <AccessoryStatusTag order={vehicle} className="mt-1" />
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        <span className="px-2 py-0.5 rounded bg-muted text-xs">{vehicle.color}</span>
                                        {vehicle.status && <VehicleStatusBadge status={vehicle.status} />}
                                    </div>
                                </div>
                                
                                {getPendingAlert(vehicle) && (
                                    <div
                                        className={`mb-3 flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium ${getPendingAlert(vehicle).className}`}
                                        data-testid={`${getPendingAlert(vehicle).testId}-${vehicle.id}`}
                                    >
                                        <AlertTriangle className="w-4 h-4 shrink-0" />
                                        {getPendingAlert(vehicle).label}
                                    </div>
                                )}
                                {getPendingAlert(vehicle)?.testId === 'missing-360' && canDoInspection && (
                                    <Button
                                        size="sm"
                                        className="w-full mb-3 bg-amber-500 text-black hover:bg-amber-400"
                                        onClick={() => navigate(`/inspections?order=${vehicle.id}`)}
                                        data-testid={`do-360-btn-${vehicle.id}`}
                                    >
                                        <ClipboardCheck className="w-4 h-4 mr-2" />
                                        Hacer Revisión 360°
                                    </Button>
                                )}

                                <div className="space-y-2 pt-3 border-t">
                                    <div className="flex items-center gap-2 text-sm">
                                        <User className="w-4 h-4 text-muted-foreground" />
                                        <span>{vehicle.client_name}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm">
                                        <Phone className="w-4 h-4 text-muted-foreground" />
                                        <span>{vehicle.client_phone}</span>
                                    </div>
                                    {vehicle.client_email && (
                                        <div className="flex items-center gap-2 text-sm">
                                            <Mail className="w-4 h-4 text-muted-foreground" />
                                            <span className="truncate">{vehicle.client_email}</span>
                                        </div>
                                    )}
                                    {orderTechnicians(vehicle).map(t => (
                                        <div key={t.id} className="flex items-center gap-2 text-sm text-primary">
                                            <Wrench className="w-4 h-4" />
                                            <span>{t.name} <span className="text-xs text-muted-foreground">· {t.role}</span></span>
                                        </div>
                                    ))}
                                </div>

                                <UpdateOrderButton order={vehicle} onUpdated={fetchData} className="w-full mt-3" />

                                {/* Action buttons */}
                                {canAssign && ['en_revision', 'en_corte', 'asignado'].includes(vehicle.status) && (
                                    <div className="mt-3 pt-3 border-t">
                                        <Button 
                                            size="sm" 
                                            variant={vehicle.assigned_technician_id ? 'outline' : 'default'}
                                            className="w-full"
                                            onClick={() => setAssigningVehicle(vehicle)}
                                            data-testid={`assign-btn-${vehicle.id}`}
                                        >
                                            <UserPlus className="w-4 h-4 mr-2" />
                                            {vehicle.assigned_technician_id ? 'Cambiar técnicos' : 'Asignar 2 técnicos'}
                                        </Button>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
            </>)}
        </div>
    );
};
