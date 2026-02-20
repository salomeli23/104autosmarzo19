import React, { useState, useEffect, useCallback } from 'react';
import { ordersAPI, servicesAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Calendar } from '../components/ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Checkbox } from '../components/ui/checkbox';
import { OrderStatusBadge } from '../components/OrderStatusBadge';
import { ServiceBadge } from '../components/ServiceBadge';
import { TIME_SLOTS, CAR_BRANDS, CAR_MODELS, formatCurrency } from '../lib/utils';
import { toast } from 'sonner';
import { Plus, Calendar as CalendarIcon, Clock, User, Car, DollarSign, QrCode } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export const Appointments = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [dialogOpen, setDialogOpen] = useState(false);
    const [availableModels, setAvailableModels] = useState([]);
    const [serviceCatalog, setServiceCatalog] = useState([]);
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
        services: [],
        negotiated_value: '',
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
    }, [selectedDate, fetchOrders]);

    // Update available models when brand changes
    useEffect(() => {
        if (formData.brand && CAR_MODELS[formData.brand]) {
            setAvailableModels(CAR_MODELS[formData.brand]);
        } else {
            setAvailableModels([]);
        }
    }, [formData.brand]);

    // Calculate suggested price when services change
    useEffect(() => {
        if (formData.services.length > 0 && serviceCatalog.length > 0) {
            const total = formData.services.reduce((sum, serviceKey) => {
                const catalogItem = serviceCatalog.find(c => c.service === serviceKey);
                return sum + (catalogItem?.suggested_price || 0);
            }, 0);
            if (!formData.negotiated_value) {
                setFormData(prev => ({ ...prev, negotiated_value: total.toString() }));
            }
        }
    }, [formData.services, serviceCatalog]);

    const handleDateSelect = (date) => {
        if (date) {
            setSelectedDate(date);
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

    const handleServiceToggle = useCallback((serviceKey) => {
        setFormData(prev => {
            const isSelected = prev.services.includes(serviceKey);
            const newServices = isSelected
                ? prev.services.filter(s => s !== serviceKey)
                : [...prev.services, serviceKey];
            return { ...prev, services: newServices };
        });
    }, []);

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
            services: [],
            negotiated_value: '',
            notes: '',
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (formData.services.length === 0) {
            toast.error('Selecciona al menos un servicio');
            return;
        }

        if (!formData.time_slot) {
            toast.error('Selecciona una franja horaria');
            return;
        }

        if (!formData.negotiated_value || parseFloat(formData.negotiated_value) <= 0) {
            toast.error('Ingresa el valor negociado');
            return;
        }

        try {
            // Build services array with prices from catalog
            const servicesData = formData.services.map(serviceKey => {
                const catalogItem = serviceCatalog.find(c => c.service === serviceKey);
                return {
                    service: serviceKey,
                    price: catalogItem?.suggested_price || 0,
                    description: catalogItem?.description || ''
                };
            });

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
                negotiated_value: parseFloat(formData.negotiated_value),
                notes: formData.notes || null,
            };

            const response = await ordersAPI.create(submitData);
            toast.success(`Cita agendada. Código: ${response.data.order_code}`);
            setDialogOpen(false);
            fetchOrders(selectedDate);
            resetForm();
        } catch (error) {
            toast.error(error.response?.data?.detail || 'Error al agendar cita');
        }
    };

    // Group orders by time slot
    const ordersBySlot = TIME_SLOTS.reduce((acc, slot) => {
        acc[slot] = orders.filter(o => o.time_slot === slot);
        return acc;
    }, {});

    return (
        <div className="space-y-6" data-testid="appointments-page">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="font-heading text-3xl md:text-4xl">Agendamiento</h1>
                    <p className="text-muted-foreground">
                        Gestiona las citas del taller
                    </p>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                        <Button className="brand-glow touch-target" data-testid="new-appointment-btn">
                            <Plus className="w-4 h-4 mr-2" />
                            Nueva Cita
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle className="font-heading text-xl">Agendar Nueva Cita</DialogTitle>
                            <DialogDescription>Complete los datos del cliente y vehículo para agendar una cita</DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleSubmit} className="space-y-4">
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

                            {/* Time Slot */}
                            <div className="space-y-2">
                                <Label>Franja Horaria *</Label>
                                <Select value={formData.time_slot} onValueChange={handleTimeSlotChange}>
                                    <SelectTrigger data-testid="appointment-time-slot">
                                        <SelectValue placeholder="Selecciona un horario" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {TIME_SLOTS.map((slot) => (
                                            <SelectItem key={slot} value={slot}>{slot}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Services */}
                            <div className="space-y-2">
                                <Label>Servicios *</Label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {serviceCatalog.map((item) => (
                                        <div
                                            key={item.service}
                                            className="flex items-center space-x-2 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                                        >
                                            <Checkbox
                                                id={`service-${item.service}`}
                                                checked={formData.services.includes(item.service)}
                                                onCheckedChange={() => handleServiceToggle(item.service)}
                                                data-testid={`service-checkbox-${item.service}`}
                                            />
                                            <label 
                                                htmlFor={`service-${item.service}`} 
                                                className="text-sm cursor-pointer flex-1"
                                            >
                                                <span className="font-medium">{item.name}</span>
                                                <span className="text-muted-foreground ml-2 text-xs">
                                                    {formatCurrency(item.suggested_price)}
                                                </span>
                                            </label>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Negotiated Value */}
                            <div className="space-y-2">
                                <Label htmlFor="negotiated_value" className="flex items-center gap-2">
                                    <DollarSign className="w-4 h-4" />
                                    Valor Negociado *
                                </Label>
                                <Input
                                    id="negotiated_value"
                                    type="number"
                                    min="0"
                                    value={formData.negotiated_value}
                                    onChange={(e) => setFormData(prev => ({ ...prev, negotiated_value: e.target.value }))}
                                    placeholder="0"
                                    required
                                    data-testid="appointment-negotiated-value"
                                />
                                {formData.negotiated_value && (
                                    <p className="text-sm text-muted-foreground">
                                        {formatCurrency(parseFloat(formData.negotiated_value) || 0)}
                                    </p>
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

                            <Button type="submit" className="w-full brand-glow" data-testid="submit-appointment-btn">
                                Agendar Cita
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
                            data-testid="appointment-calendar"
                        />
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
                        {loading ? (
                            <div className="flex justify-center py-8">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {TIME_SLOTS.map((slot) => {
                                    const slotOrders = ordersBySlot[slot] || [];
                                    return (
                                        <div 
                                            key={slot}
                                            className="flex gap-4 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                                            data-testid={`time-slot-${slot.replace(/[:\s-]/g, '')}`}
                                        >
                                            <div className="w-24 shrink-0">
                                                <p className="font-mono text-sm font-medium">{slot}</p>
                                            </div>
                                            <div className="flex-1">
                                                {slotOrders.length === 0 ? (
                                                    <p className="text-sm text-muted-foreground">Disponible</p>
                                                ) : (
                                                    <div className="space-y-2">
                                                        {slotOrders.map((order) => (
                                                            <div 
                                                                key={order.id}
                                                                className="flex items-center justify-between p-2 rounded bg-card border"
                                                                data-testid={`order-card-${order.order_code}`}
                                                            >
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-2">
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
