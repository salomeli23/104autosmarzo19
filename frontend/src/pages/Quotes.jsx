import React, { useState, useEffect } from 'react';
import { ordersAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { OrderStatusBadge } from '../components/OrderStatusBadge';
import { ServiceBadge } from '../components/ServiceBadge';
import { formatCurrency, formatDateTime } from '../lib/utils';
import { FileText, Car } from 'lucide-react';
import { PostventaBadge } from '../components/PostventaBadge';

export const Quotes = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const response = await ordersAPI.getAll();
                setOrders(response.data);
            } catch (error) {
                console.error('Error fetching data:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    return (
        <div className="space-y-6" data-testid="quotes-page">
            {/* Header */}
            <div>
                <h1 className="font-heading text-3xl md:text-4xl">Órdenes y Cotizaciones</h1>
                <p className="text-muted-foreground">
                    Historial de todas las órdenes de servicio
                </p>
            </div>

            {/* Orders List */}
            {loading ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
            ) : orders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <FileText className="w-16 h-16 mb-4 opacity-50" />
                    <p className="text-lg">No hay órdenes</p>
                    <p className="text-sm">Las órdenes aparecerán cuando se creen citas</p>
                </div>
            ) : (
                <div className="grid gap-4">
                    {orders.map((order) => (
                        <Card key={order.id} className="card-hover" data-testid={`order-card-${order.id}`}>
                            <CardContent className="p-4">
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                    <div className="flex items-start gap-4">
                                        <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
                                            <Car className="w-6 h-6 text-primary" />
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <p className="font-mono font-bold">#{order.order_code}</p>
                                                <PostventaBadge order={order} />
                                                <OrderStatusBadge status={order.status} />
                                            </div>
                                            <p className="text-sm">{order.client_name}</p>
                                            <p className="text-sm text-muted-foreground">
                                                {order.plate} - {order.brand} {order.model}
                                            </p>
                                            <div className="flex flex-wrap gap-1 mt-2">
                                                {(order.services || []).map((item, idx) => (
                                                    <ServiceBadge key={idx} service={item.service || item} />
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-mono font-bold text-lg text-primary">
                                            {formatCurrency(order.final_value || order.negotiated_value)}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {formatDateTime(order.created_at)}
                                        </p>
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

export default Quotes;
