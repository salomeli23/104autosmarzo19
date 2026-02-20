import React, { useState, useEffect, useCallback } from 'react';
import { ordersAPI, inspectionsAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { CameraCapture } from '../components/CameraCapture';
import { OrderStatusBadge } from '../components/OrderStatusBadge';
import { INSPECTION_AREAS } from '../lib/utils';
import { toast } from 'sonner';
import { Plus, ClipboardCheck, Car, AlertTriangle, Check, Camera, Image } from 'lucide-react';

const CONDITIONS = [
    { value: 'excellent', label: 'Excelente', color: 'text-green-500' },
    { value: 'good', label: 'Bueno', color: 'text-blue-500' },
    { value: 'fair', label: 'Regular', color: 'text-yellow-500' },
    { value: 'poor', label: 'Malo', color: 'text-red-500' },
];

export const Inspections = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [step, setStep] = useState(1);
    const [photos, setPhotos] = useState([]);
    const [inspectionItems, setInspectionItems] = useState(
        INSPECTION_AREAS.map(area => ({
            area: area.id,
            areaName: area.name,
            condition: 'good',
            notes: '',
            has_damage: false,
        }))
    );
    const [generalNotes, setGeneralNotes] = useState('');

    const fetchOrders = useCallback(async () => {
        try {
            // Only get orders with status ingresado (ready to be inspected)
            const response = await ordersAPI.getAll({ status: 'ingresado' });
            setOrders(response.data);
        } catch (error) {
            console.error('Error fetching orders:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchOrders();
    }, [fetchOrders]);

    const handleItemChange = (index, field, value) => {
        setInspectionItems(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], [field]: value };
            return updated;
        });
    };

    const handleSubmit = async () => {
        if (!selectedOrder) {
            toast.error('Selecciona una orden');
            return;
        }

        try {
            await inspectionsAPI.create({
                vehicle_id: selectedOrder.id,
                items: inspectionItems.map(item => ({
                    area: item.area,
                    condition: item.condition,
                    notes: item.notes,
                    has_damage: item.has_damage,
                })),
                general_notes: generalNotes,
                photos: photos,
            });
            toast.success('Revisión 360° completada');
            setDialogOpen(false);
            resetForm();
            fetchOrders();
        } catch (error) {
            toast.error(error.response?.data?.detail || 'Error al guardar la revisión');
        }
    };

    const resetForm = () => {
        setSelectedOrder(null);
        setStep(1);
        setPhotos([]);
        setInspectionItems(
            INSPECTION_AREAS.map(area => ({
                area: area.id,
                areaName: area.name,
                condition: 'good',
                notes: '',
                has_damage: false,
            }))
        );
        setGeneralNotes('');
    };

    const damageCount = inspectionItems.filter(item => item.has_damage).length;

    return (
        <div className="space-y-6" data-testid="inspections-page">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="font-heading text-3xl md:text-4xl">Revisión 360°</h1>
                    <p className="text-muted-foreground">
                        Registro detallado del estado del vehículo al ingresar
                    </p>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                        <Button className="brand-glow touch-target" data-testid="new-inspection-btn">
                            <Plus className="w-4 h-4 mr-2" />
                            Nueva Revisión
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle className="font-heading text-xl">
                                Revisión 360° - Paso {step} de 3
                            </DialogTitle>
                            <DialogDescription>
                                {step === 1 && 'Seleccione el vehículo a inspeccionar'}
                                {step === 2 && 'Capture fotos del vehículo'}
                                {step === 3 && 'Registre el estado de cada área'}
                            </DialogDescription>
                        </DialogHeader>

                        {/* Step 1: Select Vehicle */}
                        {step === 1 && (
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Seleccionar Vehículo Agendado *</Label>
                                    <Select
                                        value={selectedVehicle?.id || ''}
                                        onValueChange={(value) => {
                                            const vehicle = vehicles.find(v => v.id === value);
                                            setSelectedVehicle(vehicle);
                                        }}
                                    >
                                        <SelectTrigger data-testid="inspection-vehicle-select">
                                            <SelectValue placeholder="Buscar vehículo por placa..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {vehicles.length === 0 ? (
                                                <div className="p-4 text-center text-muted-foreground">
                                                    No hay vehículos agendados
                                                </div>
                                            ) : (
                                                vehicles.map((vehicle) => (
                                                    <SelectItem key={vehicle.id} value={vehicle.id}>
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-mono">{vehicle.plate}</span>
                                                            <span className="text-muted-foreground">
                                                                - {vehicle.brand} {vehicle.model}
                                                            </span>
                                                        </div>
                                                    </SelectItem>
                                                ))
                                            )}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {selectedVehicle && (
                                    <Card className="bg-muted/50">
                                        <CardContent className="p-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center">
                                                    <Car className="w-6 h-6 text-primary" />
                                                </div>
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <p className="font-mono font-bold">{selectedVehicle.plate}</p>
                                                        {selectedVehicle.status && (
                                                            <VehicleStatusBadge status={selectedVehicle.status} />
                                                        )}
                                                    </div>
                                                    <p className="text-sm text-muted-foreground">
                                                        {selectedVehicle.brand} {selectedVehicle.model} {selectedVehicle.year} - {selectedVehicle.color}
                                                    </p>
                                                    <p className="text-sm">{selectedVehicle.client_name} • {selectedVehicle.client_phone}</p>
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                )}

                                <Button
                                    onClick={() => setStep(2)}
                                    disabled={!selectedVehicle}
                                    className="w-full"
                                    data-testid="inspection-next-btn"
                                >
                                    Continuar a Fotos
                                </Button>
                            </div>
                        )}

                        {/* Step 2: Camera / Photos */}
                        {step === 2 && (
                            <div className="space-y-4">
                                {/* Vehicle Summary */}
                                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                                    <div className="flex items-center gap-2">
                                        <Car className="w-5 h-5 text-primary" />
                                        <span className="font-mono">{selectedVehicle?.plate}</span>
                                        <span className="text-muted-foreground">
                                            {selectedVehicle?.brand} {selectedVehicle?.model}
                                        </span>
                                    </div>
                                </div>

                                {/* Instructions */}
                                <Card className="bg-primary/5 border-primary/20">
                                    <CardContent className="p-4">
                                        <div className="flex items-start gap-3">
                                            <Camera className="w-5 h-5 text-primary mt-0.5" />
                                            <div>
                                                <p className="font-medium">Captura fotográfica</p>
                                                <p className="text-sm text-muted-foreground">
                                                    Toma fotos del vehículo desde diferentes ángulos: frente, trasera, 
                                                    laterales, interior, y cualquier daño existente.
                                                </p>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>

                                {/* Camera Component */}
                                <CameraCapture 
                                    photos={photos}
                                    onPhotosChange={setPhotos}
                                    maxPhotos={10}
                                />

                                {/* Photo count */}
                                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                                    <Image className="w-4 h-4" />
                                    <span>{photos.length} foto(s) capturada(s)</span>
                                </div>

                                {/* Actions */}
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        onClick={() => setStep(1)}
                                        className="flex-1"
                                    >
                                        Atrás
                                    </Button>
                                    <Button
                                        onClick={() => setStep(3)}
                                        className="flex-1"
                                        data-testid="inspection-to-checklist-btn"
                                    >
                                        Continuar al Checklist
                                    </Button>
                                </div>
                            </div>
                        )}

                        {/* Step 3: Inspection Checklist */}
                        {step === 3 && (
                            <div className="space-y-4">
                                {/* Summary */}
                                <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                                    <div className="flex items-center gap-2">
                                        <Car className="w-5 h-5 text-primary" />
                                        <span className="font-mono">{selectedVehicle?.plate}</span>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {photos.length > 0 && (
                                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                                <Image className="w-4 h-4" />
                                                <span>{photos.length} fotos</span>
                                            </div>
                                        )}
                                        {damageCount > 0 && (
                                            <div className="flex items-center gap-1 text-yellow-500">
                                                <AlertTriangle className="w-4 h-4" />
                                                <span className="text-sm">{damageCount} daños</span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Inspection Checklist */}
                                <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2">
                                    {inspectionItems.map((item, index) => (
                                        <Card 
                                            key={item.area} 
                                            className={`${item.has_damage ? 'border-yellow-500/50' : ''}`}
                                            data-testid={`inspection-item-${item.area}`}
                                        >
                                            <CardContent className="p-3 space-y-2">
                                                <div className="flex items-center justify-between">
                                                    <span className="font-medium text-sm">{item.areaName}</span>
                                                    <div className="flex items-center gap-2">
                                                        <Checkbox
                                                            id={`damage-${item.area}`}
                                                            checked={item.has_damage}
                                                            onCheckedChange={(checked) => handleItemChange(index, 'has_damage', checked)}
                                                        />
                                                        <Label htmlFor={`damage-${item.area}`} className="text-xs text-yellow-500 cursor-pointer">
                                                            Daño
                                                        </Label>
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-4 gap-1">
                                                    {CONDITIONS.map((condition) => (
                                                        <Button
                                                            key={condition.value}
                                                            type="button"
                                                            size="sm"
                                                            variant={item.condition === condition.value ? 'default' : 'outline'}
                                                            className={`text-xs h-7 ${item.condition === condition.value ? '' : condition.color}`}
                                                            onClick={() => handleItemChange(index, 'condition', condition.value)}
                                                        >
                                                            {condition.label}
                                                        </Button>
                                                    ))}
                                                </div>
                                                {item.has_damage && (
                                                    <Input
                                                        placeholder="Describe el daño..."
                                                        value={item.notes}
                                                        onChange={(e) => handleItemChange(index, 'notes', e.target.value)}
                                                        className="text-sm h-8"
                                                    />
                                                )}
                                            </CardContent>
                                        </Card>
                                    ))}
                                </div>

                                {/* General Notes */}
                                <div className="space-y-2">
                                    <Label>Observaciones Generales</Label>
                                    <Textarea
                                        value={generalNotes}
                                        onChange={(e) => setGeneralNotes(e.target.value)}
                                        placeholder="Notas adicionales sobre el estado del vehículo..."
                                        className="h-20"
                                        data-testid="inspection-general-notes"
                                    />
                                </div>

                                {/* Actions */}
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        onClick={() => setStep(2)}
                                        className="flex-1"
                                    >
                                        Atrás
                                    </Button>
                                    <Button
                                        onClick={handleSubmit}
                                        className="flex-1 brand-glow"
                                        data-testid="inspection-submit-btn"
                                    >
                                        <Check className="w-4 h-4 mr-2" />
                                        Completar Ingreso
                                    </Button>
                                </div>
                            </div>
                        )}
                    </DialogContent>
                </Dialog>
            </div>

            {/* Info Card */}
            <Card className="card-hover bg-primary/5 border-primary/20">
                <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                        <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
                            <ClipboardCheck className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                            <h3 className="font-heading text-lg mb-1">Revisión 360° del Vehículo</h3>
                            <p className="text-sm text-muted-foreground">
                                Al completar la revisión, el vehículo cambiará de estado <strong>"Agendado"</strong> a <strong>"Ingresado"</strong>.
                                Documenta el estado completo con fotos y el checklist de {INSPECTION_AREAS.length} áreas.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Pending Vehicles */}
            <Card className="card-hover">
                <CardHeader>
                    <CardTitle className="font-heading text-lg flex items-center gap-2">
                        <Car className="w-5 h-5 text-primary" />
                        Vehículos Pendientes de Revisión
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                        </div>
                    ) : vehicles.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            <ClipboardCheck className="w-12 h-12 mx-auto mb-2 opacity-50" />
                            <p>No hay vehículos agendados pendientes de revisión</p>
                        </div>
                    ) : (
                        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {vehicles.map((vehicle) => (
                                <div
                                    key={vehicle.id}
                                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors cursor-pointer"
                                    onClick={() => {
                                        setSelectedVehicle(vehicle);
                                        setDialogOpen(true);
                                    }}
                                    data-testid={`vehicle-quick-${vehicle.id}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                                            <Car className="w-5 h-5 text-blue-500" />
                                        </div>
                                        <div>
                                            <p className="font-mono font-medium">{vehicle.plate}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {vehicle.brand} {vehicle.model} • {vehicle.client_name}
                                            </p>
                                        </div>
                                    </div>
                                    <ClipboardCheck className="w-5 h-5 text-muted-foreground" />
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};
