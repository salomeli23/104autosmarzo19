import React, { useState, useEffect, useCallback } from 'react';
import { ordersAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { OrderStatusBadge } from '../components/OrderStatusBadge';
import { ServiceBadge } from '../components/ServiceBadge';
import { CameraCapture } from '../components/CameraCapture';
import { formatCurrency, formatDateTime } from '../lib/utils';
import { toast } from 'sonner';
import { 
    CreditCard, Car, User, Phone, DollarSign, 
    CheckCircle, Camera, Receipt, Truck, Tag
} from 'lucide-react';

export const Billing = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
    const [deliveryDialogOpen, setDeliveryDialogOpen] = useState(false);
    const [processing, setProcessing] = useState(false);

    // Payment form
    const [paymentMethod, setPaymentMethod] = useState('');
    const [paymentReference, setPaymentReference] = useState('');
    const [discountCode, setDiscountCode] = useState('');
    const [discountAmount, setDiscountAmount] = useState('');

    // Delivery
    const [deliveryPhoto, setDeliveryPhoto] = useState(null);
    const [showDeliveryCamera, setShowDeliveryCamera] = useState(false);

    const fetchOrders = useCallback(async () => {
        try {
            const response = await ordersAPI.getAll();
            // Filter orders that need billing or delivery
            const billingOrders = response.data.filter(o => 
                ['servicio_completado', 'terminado_pagado', 'terminado_falta_pago'].includes(o.status)
            );
            setOrders(billingOrders);
        } catch (error) {
            console.error('Error fetching orders:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchOrders();
    }, [fetchOrders]);

    const openPaymentDialog = (order) => {
        setSelectedOrder(order);
        setPaymentMethod('');
        setPaymentReference('');
        setDiscountCode('');
        setDiscountAmount('');
        setPaymentDialogOpen(true);
    };

    const openDeliveryDialog = (order) => {
        setSelectedOrder(order);
        setDeliveryPhoto(null);
        setDeliveryDialogOpen(true);
    };

    const handleProcessPayment = async () => {
        if (!paymentMethod) {
            toast.error('Selecciona un método de pago');
            return;
        }

        setProcessing(true);
        try {
            await ordersAPI.processPayment({
                order_id: selectedOrder.id,
                payment_method: paymentMethod,
                payment_reference: paymentReference || null,
                discount_code: discountCode || null,
                discount_amount: discountAmount ? parseFloat(discountAmount) : null
            });
            toast.success('Pago procesado correctamente');
            setPaymentDialogOpen(false);
            fetchOrders();
        } catch (error) {
            toast.error(error.response?.data?.detail || 'Error al procesar pago');
        } finally {
            setProcessing(false);
        }
    };

    const handleConfirmDelivery = async () => {
        if (!deliveryPhoto) {
            toast.error('La foto de entrega es obligatoria');
            return;
        }

        setProcessing(true);
        try {
            await ordersAPI.confirmDelivery({
                order_id: selectedOrder.id,
                delivery_photo_url: deliveryPhoto
            });
            toast.success('Entrega confirmada');
            setDeliveryDialogOpen(false);
            fetchOrders();
        } catch (error) {
            toast.error(error.response?.data?.detail || 'Error al confirmar entrega');
        } finally {
            setProcessing(false);
        }
    };

    // Group orders by status
    const completedOrders = orders.filter(o => o.status === 'servicio_completado');
    const paidOrders = orders.filter(o => o.status === 'terminado_pagado');
    const pendingPaymentOrders = orders.filter(o => o.status === 'terminado_falta_pago');

    return (
        <div className="space-y-6" data-testid="billing-page">
            {/* Header */}
            <div>
                <h1 className="font-heading text-3xl md:text-4xl">Facturación y Entrega</h1>
                <p className="text-muted-foreground">
                    Procesa pagos y confirma entregas de vehículos
                </p>
            </div>

            {/* Payment Dialog */}
            <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle className="font-heading text-xl">Procesar Pago</DialogTitle>
                        <DialogDescription>
                            {selectedOrder && `${selectedOrder.plate} - ${selectedOrder.client_name}`}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        {selectedOrder && (
                            <div className="p-4 rounded-lg bg-muted/50">
                                <div className="flex justify-between items-center">
                                    <span className="text-muted-foreground">Valor Total:</span>
                                    <span className="font-mono font-bold text-xl text-primary">
                                        {formatCurrency(selectedOrder.final_value || selectedOrder.negotiated_value)}
                                    </span>
                                </div>
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label>Método de Pago *</Label>
                            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                                <SelectTrigger data-testid="payment-method-select">
                                    <SelectValue placeholder="Seleccionar método" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="efectivo">Efectivo</SelectItem>
                                    <SelectItem value="tarjeta_credito">Tarjeta de Crédito</SelectItem>
                                    <SelectItem value="tarjeta_debito">Tarjeta de Débito</SelectItem>
                                    <SelectItem value="transferencia">Transferencia Bancaria</SelectItem>
                                    <SelectItem value="nequi">Nequi</SelectItem>
                                    <SelectItem value="daviplata">Daviplata</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Referencia de Pago</Label>
                            <Input
                                value={paymentReference}
                                onChange={(e) => setPaymentReference(e.target.value)}
                                placeholder="Número de transacción, etc."
                                data-testid="payment-reference"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label className="flex items-center gap-2">
                                    <Tag className="w-4 h-4" />
                                    Código Descuento
                                </Label>
                                <Input
                                    value={discountCode}
                                    onChange={(e) => setDiscountCode(e.target.value)}
                                    placeholder="PROMO10"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Monto Descuento</Label>
                                <Input
                                    type="number"
                                    value={discountAmount}
                                    onChange={(e) => setDiscountAmount(e.target.value)}
                                    placeholder="0"
                                />
                            </div>
                        </div>

                        <Button 
                            onClick={handleProcessPayment}
                            className="w-full brand-glow"
                            disabled={processing}
                            data-testid="confirm-payment-btn"
                        >
                            <CreditCard className="w-4 h-4 mr-2" />
                            {processing ? 'Procesando...' : 'Confirmar Pago'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Delivery Dialog */}
            <Dialog open={deliveryDialogOpen} onOpenChange={setDeliveryDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="font-heading text-xl">Confirmar Entrega</DialogTitle>
                        <DialogDescription>
                            {selectedOrder && `${selectedOrder.plate} - ${selectedOrder.client_name}`}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="p-4 rounded-lg bg-muted/50">
                            <p className="text-sm text-muted-foreground mb-2">
                                Toma una foto del vehículo al momento de la entrega como evidencia.
                            </p>
                        </div>

                        {showDeliveryCamera ? (
                            <CameraCapture
                                onCapture={(photo) => {
                                    setDeliveryPhoto(photo);
                                    setShowDeliveryCamera(false);
                                }}
                                onClose={() => setShowDeliveryCamera(false)}
                            />
                        ) : deliveryPhoto ? (
                            <div className="space-y-3">
                                <img 
                                    src={deliveryPhoto} 
                                    alt="Foto de entrega" 
                                    className="w-full rounded-lg"
                                />
                                <div className="flex gap-2">
                                    <Button 
                                        variant="outline" 
                                        size="sm" 
                                        onClick={() => setShowDeliveryCamera(true)}
                                    >
                                        Retomar foto
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <Button 
                                variant="outline" 
                                className="w-full h-32"
                                onClick={() => setShowDeliveryCamera(true)}
                                data-testid="delivery-photo-btn"
                            >
                                <Camera className="w-8 h-8 mr-2" />
                                Tomar Foto de Entrega
                            </Button>
                        )}

                        <Button 
                            onClick={handleConfirmDelivery}
                            className="w-full brand-glow"
                            disabled={processing || !deliveryPhoto}
                            data-testid="confirm-delivery-btn"
                        >
                            <Truck className="w-4 h-4 mr-2" />
                            {processing ? 'Procesando...' : 'Confirmar Entrega'}
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
                    <Receipt className="w-16 h-16 mb-4 opacity-50" />
                    <p className="text-lg">No hay órdenes pendientes</p>
                    <p className="text-sm">Las órdenes aparecerán cuando los técnicos completen los servicios</p>
                </div>
            ) : (
                <div className="space-y-8">
                    {/* Services Completed - Need Payment */}
                    {completedOrders.length > 0 && (
                        <div>
                            <h2 className="font-heading text-xl mb-4 flex items-center gap-2">
                                <CreditCard className="w-5 h-5 text-purple-500" />
                                Pendientes de Pago
                                <span className="text-sm text-muted-foreground">({completedOrders.length})</span>
                            </h2>
                            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {completedOrders.map(order => (
                                    <Card key={order.id} className="card-hover border-purple-500/30" data-testid={`order-${order.id}`}>
                                        <CardContent className="p-4">
                                            <div className="flex items-start justify-between mb-3">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-12 h-12 rounded-lg bg-purple-500/20 flex items-center justify-center">
                                                        <Car className="w-6 h-6 text-purple-500" />
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
                                                <div className="flex items-center gap-2">
                                                    <DollarSign className="w-4 h-4 text-primary" />
                                                    <span className="font-mono font-bold text-primary">
                                                        {formatCurrency(order.final_value || order.negotiated_value)}
                                                    </span>
                                                </div>
                                            </div>
                                            
                                            <Button 
                                                className="w-full brand-glow"
                                                onClick={() => openPaymentDialog(order)}
                                                data-testid={`pay-btn-${order.id}`}
                                            >
                                                <CreditCard className="w-4 h-4 mr-2" />
                                                Procesar Pago
                                            </Button>
                                        </CardContent>
                                    </Card>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Paid - Ready for Delivery */}
                    {(paidOrders.length > 0 || pendingPaymentOrders.length > 0) && (
                        <div>
                            <h2 className="font-heading text-xl mb-4 flex items-center gap-2">
                                <Truck className="w-5 h-5 text-green-500" />
                                Listos para Entrega
                                <span className="text-sm text-muted-foreground">({paidOrders.length + pendingPaymentOrders.length})</span>
                            </h2>
                            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {[...paidOrders, ...pendingPaymentOrders].map(order => (
                                    <Card key={order.id} className="card-hover border-green-500/30" data-testid={`order-${order.id}`}>
                                        <CardContent className="p-4">
                                            <div className="flex items-start justify-between mb-3">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-12 h-12 rounded-lg bg-green-500/20 flex items-center justify-center">
                                                        <Truck className="w-6 h-6 text-green-500" />
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
                                                {order.status === 'terminado_falta_pago' && (
                                                    <div className="text-xs text-yellow-500 bg-yellow-500/20 px-2 py-1 rounded">
                                                        Pendiente de pago
                                                    </div>
                                                )}
                                            </div>
                                            
                                            <Button 
                                                className="w-full"
                                                onClick={() => openDeliveryDialog(order)}
                                                data-testid={`deliver-btn-${order.id}`}
                                            >
                                                <CheckCircle className="w-4 h-4 mr-2" />
                                                Confirmar Entrega
                                            </Button>
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

export default Billing;
