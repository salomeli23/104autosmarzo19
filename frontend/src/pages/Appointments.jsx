import React, { useState, useEffect, useCallback } from 'react';
import { ordersAPI, servicesAPI, slotsAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Calendar } from '../components/ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../components/ui/accordion';
import { OrderStatusBadge } from '../components/OrderStatusBadge';
import { ServiceBadge } from '../components/ServiceBadge';
import { QRDisplay } from '../components/QRDisplay';
import { CAR_BRANDS, CAR_MODELS, formatCurrency } from '../lib/utils';
import { toast } from 'sonner';
import { Plus, Calendar as CalendarIcon, Clock, User, Car, DollarSign, QrCode, CheckCircle, ArrowRight, AlertCircle, Users, ChevronDown, Package, Trash2, PlusCircle } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export const Appointments = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [dialogOpen, setDialogOpen] = useState(false);
    const [availableModels, setAvailableModels] = useState([]);
    const [serviceCatalog, setServiceCatalog] = useState({});
    const [createdOrder, setCreatedOrder] = useState(null);
    const [showQRDialog, setShowQRDialog] = useState(false);
    const [slotsAvailability, setSlotsAvailability] = useState(null);
    const [loadingSlots, setLoadingSlots] = useState(false);
    
    // Services with individual prices
    const [selectedServices, setSelectedServices] = useState([]);
    // { serviceId: string, serviceName: string, category: string, price: number, isCustom?: boolean }
    
    // Custom service input
    const [customServiceName, setCustomServiceName] = useState('');
    const [customServicePrice, setCustomServicePrice] = useState('');
    
    const [formData, setFormData] = useState({
        client_name: '',
        client_phone: '',
        client_email: '',
        client_cedula: '',
        plate: '',
        brand: '',
        model: '',
        year: '',
        color: '',
        time_slot: '',
        notes: '',
    });

    // Fetch service catalog on mount
    useEffect(() => {
        const fetchCatalog = async () => {
            try {
                const response = await servicesAPI.getCatalog();
                setServiceCatalog(response.data);
            } catch (error) {
                console.error('Error fetching catalog:', error);
            }
        };
        fetchCatalog();
    }, []);

    // Fetch slot availability when date changes
    const fetchSlotsAvailability = useCallback(async (date) => {
        try {
            setLoadingSlots(true);
            const dateStr = format(date, 'yyyy-MM-dd');
            const response = await slotsAPI.getAvailability(dateStr);
            setSlotsAvailability(response.data);
        } catch (error) {
            console.error('Error fetching slots:', error);
            setSlotsAvailability(null);
        } finally {
            setLoadingSlots(false);
        }
    }, []);

    const fetchOrders = useCallback(async (date) => {
        try {
            setLoading(true);
            const dateStr = format(date, 'yyyy-MM-dd');
            const response = await ordersAPI.getAll({ date: dateStr });
            setOrders(response.data);
        } catch (error) {
            console.error('Error fetching orders:', error);
            toast.error('Error al cargar las citas');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchOrders(selectedDate);
        fetchSlotsAvailability(selectedDate);
    }, [selectedDate, fetchOrders, fetchSlotsAvailability]);

    // Update available models when brand changes
    useEffect(() => {
        if (formData.brand && CAR_MODELS[formData.brand]) {
            setAvailableModels(CAR_MODELS[formData.brand]);
        } else {
            setAvailableModels([]);
        }
    }, [formData.brand]);

    // Calculate total from selected services
    const calculateTotal = () => {
        return selectedServices.reduce((sum, svc) => sum + (svc.price || 0), 0);
    };

    const handleDateSelect = (date) => {
        if (date) {
            if (date.getDay() === 0) {
                toast.error('Los domingos no hay servicio');
                return;
            }
            setSelectedDate(date);
            setFormData(prev => ({ ...prev, time_slot: '' }));
        }
    };

    const handleBrandChange = (value) => {
        setFormData(prev => ({ ...prev, brand: value, model: '' }));
    };

    const handleModelChange = (value) => {
        setFormData(prev => ({ ...prev, model: value }));
    };

    const handleTimeSlotChange = (value) => {
        setFormData(prev => ({ ...prev, time_slot: value }));
    };

    // Toggle service selection
    const handleServiceToggle = (serviceId, serviceName, categoryName) => {
        setSelectedServices(prev => {
            const exists = prev.find(s => s.serviceId === serviceId);
            if (exists) {
                return prev.filter(s => s.serviceId !== serviceId);
            } else {
                return [...prev, { serviceId, serviceName, category: categoryName, price: 0 }];
            }
        });
    };

    // Update service price
    const handleServicePriceChange = (serviceId, price) => {
        setSelectedServices(prev => 
            prev.map(s => s.serviceId === serviceId ? { ...s, price: parseFloat(price) || 0 } : s)
        );
    };

    // Add custom service
    const handleAddCustomService = () => {
        if (!customServiceName.trim()) {
            toast.error('Ingresa el nombre del servicio o producto');
            return;
        }
        if (!customServicePrice || parseFloat(customServicePrice) <= 0) {
            toast.error('Ingresa el valor del servicio o producto');
            return;
        }
        
        const customId = `custom_${Date.now()}`;
        setSelectedServices(prev => [...prev, {
            serviceId: customId,
            serviceName: customServiceName.trim(),
            category: 'Personalizado',
            price: parseFloat(customServicePrice),
            isCustom: true
        }]);
        setCustomServiceName('');
        setCustomServicePrice('');
        toast.success('Servicio agregado');
    };

    // Remove service
    const handleRemoveService = (serviceId) => {
        setSelectedServices(prev => prev.filter(s => s.serviceId !== serviceId));
    };

    const resetForm = () => {
        setFormData({
            client_name: '',
            client_phone: '',
            client_email: '',
            client_cedula: '',
            plate: '',
            brand: '',
            model: '',
            year: '',
            color: '',
            time_slot: '',
            notes: '',
        });
        setSelectedServices([]);
        setCustomServiceName('');
        setCustomServicePrice('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (selectedServices.length === 0) {
            toast.error('Selecciona al menos un servicio');
            return;
        }

        if (!formData.time_slot) {
            toast.error('Selecciona una franja horaria');
            return;
        }

        const selectedSlot = slotsAvailability?.slots?.find(s => s.id === formData.time_slot);
        if (selectedSlot && selectedSlot.remaining <= 0) {
            toast.error('Esta franja ya no tiene cupos disponibles');
            return;
        }

        const total = calculateTotal();
        if (total <= 0) {
            toast.error('Ingresa el valor de al menos un servicio');
            return;
        }

        try {
            const servicesData = selectedServices.map(svc => ({
                service: svc.serviceId,
                price: svc.price,
                description: `${svc.category} - ${svc.serviceName}`
            }));

            const submitData = {
                client_name: formData.client_name,
                client_phone: formData.client_phone,
                client_email: formData.client_email || null,
                client_cedula: formData.client_cedula || null,
                plate: formData.plate,
                brand: formData.brand,
                model: formData.model,
                year: formData.year ? parseInt(formData.year) : null,
                color: formData.color || null,
                date: format(selectedDate, 'yyyy-MM-dd'),
                time_slot: formData.time_slot,
                services: servicesData,
                negotiated_value: total,
                notes: formData.notes || null,
            };

            const response = await ordersAPI.create(submitData);
            setCreatedOrder(response.data);
            setDialogOpen(false);
            setShowQRDialog(true);
            fetchOrders(selectedDate);
            fetchSlotsAvailability(selectedDate);
            resetForm();
        } catch (error) {
            toast.error(error.response?.data?.detail || 'Error al agendar cita');
        }
    };

    const handleCloseQRDialog = () => {
        setShowQRDialog(false);
        setCreatedOrder(null);
    };

    const disabledDays = (date) => {
        return date.getDay() === 0;
    };

    const getSlotDisplayName = (slotId) => {
        const slot = slotsAvailability?.slots?.find(s => s.id === slotId);
        if (slot) {
            return `${slot.name} (${slot.start} - ${slot.end})`;
        }
        return slotId;
    };

    const ordersBySlot = slotsAvailability?.slots?.reduce((acc, slot) => {
        acc[slot.id] = orders.filter(o => o.time_slot === slot.id);
        return acc;
    }, {}) || {};

    return (
        <div className="space-y-6" data-testid="appointments-page">
            {/* QR Dialog */}
            <Dialog open={showQRDialog} onOpenChange={setShowQRDialog}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="font-heading text-xl flex items-center gap-2">
                            <CheckCircle className="w-6 h-6 text-green-500" />
                            ¡Cita Agendada!
                        </DialogTitle>
                    </DialogHeader>
                    {createdOrder && (
                        <div className="space-y-4">
                            <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                                <div className="flex items-center gap-2">
                                    <User className="w-4 h-4 text-muted-foreground" />
                                    <span className="font-medium">{createdOrder.client_name}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Car className="w-4 h-4 text-muted-foreground" />
                                    <span className="font-mono">{createdOrder.plate}</span>
                                    <span className="text-muted-foreground">
                                        - {createdOrder.brand} {createdOrder.model}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-muted-foreground" />
                                    <span>{createdOrder.date} • {getSlotDisplayName(createdOrder.time_slot)}</span>
                                </div>
                            </div>

                            {/* Hora específica de la cita */}
                            {createdOrder.scheduled_time && (
                                <div className="p-4 rounded-lg bg-gradient-to-r from-cyan-500/20 to-blue-500/20 border border-cyan-500/40 text-center">
                                    <p className="text-sm text-muted-foreground">Hora de su cita:</p>
                                    <p className="text-3xl font-mono font-bold text-cyan-400">
                                        {createdOrder.scheduled_time}
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        El check-in estará disponible a partir de esta hora
                                    </p>
                                </div>
                            )}

                            <QRDisplay 
                                qrCode={createdOrder.qr_code}
                                orderCode={createdOrder.order_code}
                                clientName={createdOrder.client_name}
                            />

                            <p className="text-sm text-muted-foreground text-center">
                                El cliente debe presentar este código QR al momento del ingreso
                            </p>

                            <div className="flex gap-2">
                                <Button variant="outline" onClick={handleCloseQRDialog} className="flex-1">
                                    Cerrar
                                </Button>
                                <Button 
                                    onClick={() => {
                                        handleCloseQRDialog();
                                        window.location.href = '/checkin';
                                    }}
                                    className="flex-1 brand-glow"
                                >
                                    Ir a Check-in
                                    <ArrowRight className="w-4 h-4 ml-2" />
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="font-heading text-3xl md:text-4xl">Agendamiento</h1>
                    <p className="text-muted-foreground">Gestiona las citas del taller</p>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                        <Button className="brand-glow touch-target" data-testid="new-appointment-btn">
                            <Plus className="w-4 h-4 mr-2" />
                            Nueva Cita
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle className="font-heading text-xl">Agendar Nueva Cita</DialogTitle>
                            <DialogDescription>Complete los datos del cliente, vehículo y servicios</DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-6">
                            {/* Client Info */}
                            <div className="space-y-4">
                                <h3 className="font-heading text-lg flex items-center gap-2">
                                    <User className="w-4 h-4" />
                                    Datos del Cliente
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="client_name">Nombre *</Label>
                                        <Input
                                            id="client_name"
                                            value={formData.client_name}
                                            onChange={(e) => setFormData(prev => ({ ...prev, client_name: e.target.value }))}
                                            required
                                            data-testid="appointment-client-name"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="client_phone">Teléfono *</Label>
                                        <Input
                                            id="client_phone"
                                            value={formData.client_phone}
                                            onChange={(e) => setFormData(prev => ({ ...prev, client_phone: e.target.value }))}
                                            required
                                            data-testid="appointment-client-phone"
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="client_email">Email</Label>
                                        <Input
                                            id="client_email"
                                            type="email"
                                            value={formData.client_email}
                                            onChange={(e) => setFormData(prev => ({ ...prev, client_email: e.target.value }))}
                                            data-testid="appointment-client-email"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="client_cedula">Cédula</Label>
                                        <Input
                                            id="client_cedula"
                                            value={formData.client_cedula}
                                            onChange={(e) => setFormData(prev => ({ ...prev, client_cedula: e.target.value }))}
                                            data-testid="appointment-client-cedula"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Vehicle Info */}
                            <div className="space-y-4">
                                <h3 className="font-heading text-lg flex items-center gap-2">
                                    <Car className="w-4 h-4" />
                                    Datos del Vehículo
                                </h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="plate">Placa *</Label>
                                        <Input
                                            id="plate"
                                            value={formData.plate}
                                            onChange={(e) => setFormData(prev => ({ ...prev, plate: e.target.value.toUpperCase() }))}
                                            className="font-mono"
                                            placeholder="ABC123"
                                            required
                                            data-testid="appointment-plate"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="year">Año</Label>
                                        <Input
                                            id="year"
                                            type="number"
                                            min="1990"
                                            max="2030"
                                            value={formData.year}
                                            onChange={(e) => setFormData(prev => ({ ...prev, year: e.target.value }))}
                                            data-testid="appointment-year"
                                        />
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Marca *</Label>
                                        <Select value={formData.brand} onValueChange={handleBrandChange}>
                                            <SelectTrigger data-testid="appointment-brand">
                                                <SelectValue placeholder="Seleccionar marca" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {CAR_BRANDS.map((brand) => (
                                                    <SelectItem key={brand} value={brand}>{brand}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Modelo *</Label>
                                        <Select 
                                            value={formData.model} 
                                            onValueChange={handleModelChange}
                                            disabled={!formData.brand}
                                        >
                                            <SelectTrigger data-testid="appointment-model">
                                                <SelectValue placeholder={formData.brand ? "Seleccionar modelo" : "Primero seleccione marca"} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {availableModels.map((model) => (
                                                    <SelectItem key={model} value={model}>{model}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>Color</Label>
                                    <Input
                                        value={formData.color}
                                        onChange={(e) => setFormData(prev => ({ ...prev, color: e.target.value }))}
                                        placeholder="Ej: Blanco, Negro, Plata..."
                                        data-testid="appointment-color"
                                    />
                                </div>
                            </div>

                            {/* Date & Time Slot */}
                            <div className="space-y-4">
                                <h3 className="font-heading text-lg flex items-center gap-2">
                                    <CalendarIcon className="w-4 h-4" />
                                    Fecha y Franja Horaria
                                </h3>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Fecha de la Cita *</Label>
                                        <div className="flex justify-center border rounded-lg p-2">
                                            <Calendar
                                                mode="single"
                                                selected={selectedDate}
                                                onSelect={handleDateSelect}
                                                locale={es}
                                                disabled={disabledDays}
                                                className="rounded-md"
                                            />
                                        </div>
                                        <p className="text-xs text-muted-foreground text-center">
                                            Fecha seleccionada: {format(selectedDate, "EEEE, d 'de' MMMM yyyy", { locale: es })}
                                        </p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="flex items-center gap-2">
                                            <Clock className="w-4 h-4" />
                                            Franja Horaria *
                                        </Label>
                                        {!slotsAvailability?.is_open ? (
                                            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 flex items-center gap-2">
                                                <AlertCircle className="w-5 h-5" />
                                                <span>El día seleccionado no tiene servicio</span>
                                            </div>
                                        ) : loadingSlots ? (
                                            <div className="flex justify-center py-4">
                                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                {slotsAvailability?.slots?.map((slot) => (
                                                    <div
                                                        key={slot.id}
                                                        className={`p-3 rounded-lg border transition-all cursor-pointer ${
                                                            formData.time_slot === slot.id
                                                                ? 'border-primary bg-primary/10'
                                                                : slot.available
                                                                ? 'border-border hover:border-primary/50 bg-card'
                                                                : 'border-border bg-muted/50 opacity-60 cursor-not-allowed'
                                                        }`}
                                                        onClick={() => slot.available && handleTimeSlotChange(slot.id)}
                                                        data-testid={`slot-${slot.id}`}
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex items-center gap-3">
                                                                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                                                                    formData.time_slot === slot.id
                                                                        ? 'border-primary bg-primary'
                                                                        : 'border-muted-foreground'
                                                                }`}>
                                                                    {formData.time_slot === slot.id && (
                                                                        <div className="w-2 h-2 rounded-full bg-white" />
                                                                    )}
                                                                </div>
                                                                <div>
                                                                    <p className="font-medium">{slot.name}</p>
                                                                    <p className="text-sm text-muted-foreground">
                                                                        {slot.start} - {slot.end}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <Users className="w-4 h-4 text-muted-foreground" />
                                                                <span className={`text-sm font-medium ${
                                                                    slot.remaining === 0
                                                                        ? 'text-red-500'
                                                                        : slot.remaining <= 3
                                                                        ? 'text-yellow-500'
                                                                        : 'text-green-500'
                                                                }`}>
                                                                    {slot.remaining} / {slot.capacity}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                                <p className="text-xs text-muted-foreground">
                                                    * Registro hasta las {slotsAvailability?.last_registration}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Services by Category */}
                            <div className="space-y-4">
                                <h3 className="font-heading text-lg flex items-center gap-2">
                                    <Package className="w-4 h-4" />
                                    Servicios *
                                </h3>
                                <Accordion type="multiple" className="w-full">
                                    {Object.entries(serviceCatalog).map(([categoryId, category]) => (
                                        <AccordionItem key={categoryId} value={categoryId}>
                                            <AccordionTrigger className="hover:no-underline">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium">{category.name}</span>
                                                    {selectedServices.filter(s => 
                                                        category.services.some(cs => cs.id === s.serviceId)
                                                    ).length > 0 && (
                                                        <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full">
                                                            {selectedServices.filter(s => 
                                                                category.services.some(cs => cs.id === s.serviceId)
                                                            ).length}
                                                        </span>
                                                    )}
                                                </div>
                                            </AccordionTrigger>
                                            <AccordionContent>
                                                <div className="space-y-2 pt-2">
                                                    {category.services.map((service) => {
                                                        const isSelected = selectedServices.some(s => s.serviceId === service.id);
                                                        const selectedService = selectedServices.find(s => s.serviceId === service.id);
                                                        return (
                                                            <div
                                                                key={service.id}
                                                                className={`p-3 rounded-lg border transition-colors ${
                                                                    isSelected ? 'border-primary bg-primary/5' : 'border-border'
                                                                }`}
                                                            >
                                                                <div className="flex items-center gap-3">
                                                                    <Checkbox
                                                                        id={`svc-${service.id}`}
                                                                        checked={isSelected}
                                                                        onCheckedChange={() => handleServiceToggle(service.id, service.name, category.name)}
                                                                        data-testid={`service-${service.id}`}
                                                                    />
                                                                    <label 
                                                                        htmlFor={`svc-${service.id}`} 
                                                                        className="flex-1 cursor-pointer"
                                                                    >
                                                                        {service.name}
                                                                    </label>
                                                                    {isSelected && (
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-sm text-muted-foreground">$</span>
                                                                            <Input
                                                                                type="number"
                                                                                min="0"
                                                                                value={selectedService?.price || ''}
                                                                                onChange={(e) => handleServicePriceChange(service.id, e.target.value)}
                                                                                placeholder="Valor"
                                                                                className="w-32 h-8 text-right"
                                                                                onClick={(e) => e.stopPropagation()}
                                                                                data-testid={`price-${service.id}`}
                                                                            />
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </AccordionContent>
                                        </AccordionItem>
                                    ))}
                                </Accordion>

                                {/* Custom Service Input */}
                                <div className="p-4 rounded-lg border border-dashed border-muted-foreground/50 space-y-3">
                                    <Label className="flex items-center gap-2 text-muted-foreground">
                                        <PlusCircle className="w-4 h-4" />
                                        Agregar Servicio/Producto Personalizado
                                    </Label>
                                    <div className="flex gap-2">
                                        <Input
                                            value={customServiceName}
                                            onChange={(e) => setCustomServiceName(e.target.value)}
                                            placeholder="Nombre del servicio o producto"
                                            className="flex-1"
                                            data-testid="custom-service-name"
                                        />
                                        <div className="flex items-center gap-1">
                                            <span className="text-sm text-muted-foreground">$</span>
                                            <Input
                                                type="number"
                                                min="0"
                                                value={customServicePrice}
                                                onChange={(e) => setCustomServicePrice(e.target.value)}
                                                placeholder="Valor"
                                                className="w-28"
                                                data-testid="custom-service-price"
                                            />
                                        </div>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            onClick={handleAddCustomService}
                                            data-testid="add-custom-service-btn"
                                        >
                                            <Plus className="w-4 h-4" />
                                        </Button>
                                    </div>
                                </div>

                                {/* Selected Services Summary */}
                                {selectedServices.length > 0 && (
                                    <div className="p-4 rounded-lg bg-primary/10 border border-primary/30 space-y-3">
                                        <p className="font-medium">Servicios seleccionados:</p>
                                        <div className="space-y-2">
                                            {selectedServices.map((svc) => (
                                                <div key={svc.serviceId} className="flex items-center justify-between text-sm">
                                                    <div className="flex items-center gap-2">
                                                        {svc.isCustom && (
                                                            <span className="text-xs bg-yellow-500/20 text-yellow-500 px-1.5 py-0.5 rounded">
                                                                Personalizado
                                                            </span>
                                                        )}
                                                        <span>{svc.serviceName}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-mono">{formatCurrency(svc.price)}</span>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-6 w-6 text-red-500 hover:text-red-600"
                                                            onClick={() => handleRemoveService(svc.serviceId)}
                                                        >
                                                            <Trash2 className="w-3 h-3" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="flex justify-between font-bold pt-2 border-t border-primary/30">
                                            <span>Total:</span>
                                            <span className="text-primary">{formatCurrency(calculateTotal())}</span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Notes */}
                            <div className="space-y-2">
                                <Label htmlFor="notes">Notas</Label>
                                <Textarea
                                    id="notes"
                                    value={formData.notes}
                                    onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                                    placeholder="Observaciones adicionales..."
                                    data-testid="appointment-notes"
                                />
                            </div>

                            <Button 
                                type="submit" 
                                className="w-full brand-glow" 
                                data-testid="submit-appointment-btn"
                                disabled={!slotsAvailability?.is_open || selectedServices.length === 0}
                            >
                                <DollarSign className="w-4 h-4 mr-2" />
                                Agendar Cita - {formatCurrency(calculateTotal())}
                            </Button>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Calendar and Schedule */}
            <div className="grid lg:grid-cols-3 gap-6">
                {/* Calendar */}
                <Card className="card-hover">
                    <CardHeader>
                        <CardTitle className="font-heading text-lg flex items-center gap-2">
                            <CalendarIcon className="w-5 h-5 text-primary" />
                            Calendario
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex justify-center">
                        <Calendar
                            mode="single"
                            selected={selectedDate}
                            onSelect={handleDateSelect}
                            locale={es}
                            className="rounded-md border"
                            disabled={disabledDays}
                            data-testid="appointment-calendar"
                        />
                    </CardContent>
                    <CardContent className="pt-0">
                        <div className="p-3 rounded-lg bg-muted/50 text-sm space-y-1">
                            <p className="font-medium">Horarios de operación:</p>
                            <p className="text-muted-foreground">Lun-Vie: 8:30 AM - 6:00 PM</p>
                            <p className="text-muted-foreground">Sábados: 7:30 AM - 6:00 PM</p>
                            <p className="text-red-400 text-xs mt-1">Domingos: Cerrado</p>
                        </div>
                    </CardContent>
                </Card>

                {/* Schedule */}
                <Card className="lg:col-span-2 card-hover">
                    <CardHeader>
                        <CardTitle className="font-heading text-lg flex items-center gap-2">
                            <Clock className="w-5 h-5 text-primary" />
                            {format(selectedDate, "EEEE, d 'de' MMMM", { locale: es })}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {loading || loadingSlots ? (
                            <div className="flex justify-center py-8">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                            </div>
                        ) : !slotsAvailability?.is_open ? (
                            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                <AlertCircle className="w-16 h-16 mb-4 text-red-400" />
                                <p className="text-lg font-medium">Día no disponible</p>
                                <p className="text-sm">{slotsAvailability?.message || 'Selecciona otro día'}</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {slotsAvailability?.slots?.map((slot) => {
                                    const slotOrders = ordersBySlot[slot.id] || [];
                                    return (
                                        <div 
                                            key={slot.id}
                                            className="rounded-lg border bg-card overflow-hidden"
                                            data-testid={`time-slot-${slot.id}`}
                                        >
                                            <div className="flex items-center justify-between p-3 bg-muted/30 border-b">
                                                <div>
                                                    <p className="font-medium">{slot.name}</p>
                                                    <p className="text-sm text-muted-foreground font-mono">
                                                        {slot.start} - {slot.end}
                                                    </p>
                                                </div>
                                                <div className={`px-3 py-1 rounded-full text-sm font-medium flex items-center gap-1 ${
                                                    slot.remaining === 0
                                                        ? 'bg-red-500/10 text-red-500'
                                                        : slot.remaining <= 3
                                                        ? 'bg-yellow-500/10 text-yellow-500'
                                                        : 'bg-green-500/10 text-green-500'
                                                }`}>
                                                    <Users className="w-3 h-3" />
                                                    {slot.remaining} disponibles
                                                </div>
                                            </div>
                                            <div className="p-3">
                                                {slotOrders.length === 0 ? (
                                                    <p className="text-sm text-muted-foreground text-center py-2">
                                                        Sin citas agendadas
                                                    </p>
                                                ) : (
                                                    <div className="space-y-2">
                                                        {slotOrders.map((order) => (
                                                            <div 
                                                                key={order.id}
                                                                className="flex items-center justify-between p-2 rounded bg-muted/30 hover:bg-muted/50 transition-colors"
                                                                data-testid={`order-card-${order.order_code}`}
                                                            >
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-2">
                                                                        {/* Hora específica */}
                                                                        {order.scheduled_time && (
                                                                            <span className="text-sm font-mono font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded">
                                                                                {order.scheduled_time}
                                                                            </span>
                                                                        )}
                                                                        <p className="font-medium truncate">{order.client_name}</p>
                                                                        <span className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                                                                            <QrCode className="w-3 h-3" />
                                                                            {order.order_code}
                                                                        </span>
                                                                    </div>
                                                                    <p className="text-sm text-muted-foreground">
                                                                        <span className="font-mono">{order.plate}</span>
                                                                        {order.brand && ` - ${order.brand}`}
                                                                        {order.model && ` ${order.model}`}
                                                                    </p>
                                                                </div>
                                                                <div className="flex items-center gap-2 shrink-0">
                                                                    <div className="hidden sm:flex gap-1">
                                                                        {order.services?.slice(0, 2).map((s, idx) => (
                                                                            <ServiceBadge key={idx} service={s.service || s} />
                                                                        ))}
                                                                    </div>
                                                                    <OrderStatusBadge status={order.status} />
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default Appointments;
