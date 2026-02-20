import React, { useState, useEffect } from 'react';
import { ordersAPI, servicesAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { OrderStatusBadge } from '../components/OrderStatusBadge';
import { ServiceBadge } from '../components/ServiceBadge';
import { SERVICE_LABELS, formatCurrency, formatDateTime } from '../lib/utils';
import { toast } from 'sonner';
import { Plus, FileText, Car, Trash2, Check, X } from 'lucide-react';

const SERVICE_PRICES = {
    polarizado: 350000,
    nanoceramica: 800000,
    autobahn_black: 1200000,
    ultrasecure: 500000,
};

export const Quotes = () => {
    const [orders, setOrders] = useState([]);
    const [serviceCatalog, setServiceCatalog] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchData = async () => {
        try {
            const [ordersRes, catalogRes] = await Promise.all([
                ordersAPI.getAll(),
                servicesAPI.getCatalog(),
            ]);
            setOrders(ordersRes.data);
            setServiceCatalog(catalogRes.data);
        } catch (error) {
            console.error('Error fetching data:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const addItem = (service) => {
        const existing = items.find(i => i.service === service);
        if (existing) {
            toast.error('Este servicio ya está agregado');
            return;
        }
        setItems([...items, {
            service,
            description: SERVICE_LABELS[service],
            price: SERVICE_PRICES[service],
            quantity: 1,
        }]);
    };

    const removeItem = (index) => {
        setItems(items.filter((_, i) => i !== index));
    };

    const calculateTotals = () => {
        const subtotal = items.reduce((acc, item) => acc + (item.price * item.quantity), 0);
        const tax = subtotal * 0.19;
        const total = subtotal + tax;
        return { subtotal, tax, total };
    };

    const handleSubmit = async () => {
        if (!selectedVehicle) {
            toast.error('Selecciona un vehículo');
            return;
        }
        if (items.length === 0) {
            toast.error('Agrega al menos un servicio');
            return;
        }

        try {
            await quotesAPI.create({
                vehicle_id: selectedVehicle.id,
                client_name: selectedVehicle.client_name,
                client_email: selectedVehicle.client_email,
                items: items.map(item => ({
                    service: item.service,
                    description: item.description,
                    price: item.price,
                    quantity: item.quantity,
                })),
                notes,
            });
            toast.success('Cotización creada exitosamente');
            setDialogOpen(false);
            resetForm();
            fetchData();
        } catch (error) {
            toast.error(error.response?.data?.detail || 'Error al crear cotización');
        }
    };

    const handleApprove = async (quoteId) => {
        try {
            await quotesAPI.approve(quoteId);
            toast.success('Cotización aprobada');
            fetchData();
        } catch (error) {
            toast.error('Error al aprobar cotización');
        }
    };

    const resetForm = () => {
        setSelectedVehicle(null);
        setItems([]);
        setNotes('');
    };

    const { subtotal, tax, total } = calculateTotals();

    return (
        <div className="space-y-6" data-testid="quotes-page">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="font-heading text-3xl md:text-4xl">Cotizaciones</h1>
                    <p className="text-muted-foreground">
                        Genera y gestiona cotizaciones para tus clientes
                    </p>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                        <Button className="brand-glow touch-target" data-testid="new-quote-btn">
                            <Plus className="w-4 h-4 mr-2" />
                            Nueva Cotización
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle className="font-heading text-xl">Nueva Cotización</DialogTitle>
                            <DialogDescription>Seleccione el vehículo y agregue los servicios a cotizar</DialogDescription>
                        </DialogHeader>

                        <div className="space-y-6">
                            {/* Vehicle Selection */}
                            <div className="space-y-2">
                                <Label>Seleccionar Vehículo *</Label>
                                <Select
                                    value={selectedVehicle?.id}
                                    onValueChange={(value) => {
                                        const vehicle = vehicles.find(v => v.id === value);
                                        setSelectedVehicle(vehicle);
                                    }}
                                >
                                    <SelectTrigger data-testid="quote-vehicle-select">
                                        <SelectValue placeholder="Buscar vehículo..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {vehicles.map((vehicle) => (
                                            <SelectItem key={vehicle.id} value={vehicle.id}>
                                                <span className="font-mono">{vehicle.plate}</span>
                                                {' - '}{vehicle.brand} {vehicle.model} - {vehicle.client_name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Add Services */}
                            <div className="space-y-2">
                                <Label>Agregar Servicios</Label>
                                <div className="grid grid-cols-2 gap-2">
                                    {Object.entries(SERVICE_LABELS).map(([service, label]) => (
                                        <Button
                                            key={service}
                                            type="button"
                                            variant="outline"
                                            className="justify-start"
                                            onClick={() => addItem(service)}
                                            data-testid={`add-service-${service}`}
                                        >
                                            <Plus className="w-4 h-4 mr-2" />
                                            {label}
                                        </Button>
                                    ))}
                                </div>
                            </div>

                            {/* Items List */}
                            {items.length > 0 && (
                                <div className="space-y-2">
                                    <Label>Servicios Seleccionados</Label>
                                    <div className="space-y-2">
                                        {items.map((item, index) => (
                                            <div 
                                                key={index}
                                                className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                                                data-testid={`quote-item-${index}`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <ServiceBadge service={item.service} />
                                                    <span className="text-sm">{item.description}</span>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <span className="font-mono font-medium">
                                                        {formatCurrency(item.price)}
                                                    </span>
                                                    <Button
                                                        type="button"
                                                        variant="ghost"
                                                        size="icon"
                                                        onClick={() => removeItem(index)}
                                                    >
                                                        <Trash2 className="w-4 h-4 text-destructive" />
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Totals */}
                                    <div className="space-y-2 pt-4 border-t">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">Subtotal</span>
                                            <span className="font-mono">{formatCurrency(subtotal)}</span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">IVA (19%)</span>
                                            <span className="font-mono">{formatCurrency(tax)}</span>
                                        </div>
                                        <div className="flex justify-between font-bold text-lg">
                                            <span>Total</span>
                                            <span className="font-mono text-primary">{formatCurrency(total)}</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Notes */}
                            <div className="space-y-2">
                                <Label>Notas</Label>
                                <Textarea
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    placeholder="Observaciones adicionales..."
                                    data-testid="quote-notes"
                                />
                            </div>

                            <Button 
                                onClick={handleSubmit}
                                className="w-full brand-glow"
                                disabled={!selectedVehicle || items.length === 0}
                                data-testid="submit-quote-btn"
                            >
                                Crear Cotización
                            </Button>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Quotes List */}
            {loading ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
            ) : quotes.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <FileText className="w-16 h-16 mb-4 opacity-50" />
                    <p className="text-lg">No hay cotizaciones</p>
                    <p className="text-sm">Crea tu primera cotización para comenzar</p>
                </div>
            ) : (
                <div className="grid gap-4">
                    {quotes.map((quote) => (
                        <Card key={quote.id} className="card-hover" data-testid={`quote-card-${quote.id}`}>
                            <CardContent className="p-4">
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                    <div className="flex items-start gap-4">
                                        <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
                                            <FileText className="w-6 h-6 text-primary" />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <p className="font-mono font-bold">#{quote.id.slice(0, 8).toUpperCase()}</p>
                                                <StatusBadge status={quote.status} />
                                            </div>
                                            <p className="text-sm text-muted-foreground">{quote.client_name}</p>
                                            <div className="flex flex-wrap gap-1 mt-2">
                                                {quote.items.map((item, idx) => (
                                                    <ServiceBadge key={idx} service={item.service} />
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="text-right">
                                            <p className="font-mono font-bold text-lg text-primary">
                                                {formatCurrency(quote.total)}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {formatDateTime(quote.created_at)}
                                            </p>
                                        </div>
                                        {quote.status === 'pending' && (
                                            <Button
                                                size="sm"
                                                onClick={() => handleApprove(quote.id)}
                                                data-testid={`approve-quote-${quote.id}`}
                                            >
                                                <Check className="w-4 h-4 mr-1" />
                                                Aprobar
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
};
