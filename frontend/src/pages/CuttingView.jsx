import React, { useState, useEffect, useCallback } from 'react';
import { cuttingAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { toast } from 'sonner';
import { Scissors, Car, Clock, CheckCircle, Play, AlertCircle, Ruler, FileText, Package } from 'lucide-react';

const CuttingView = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [completeDialog, setCompleteDialog] = useState(false);
    const [measurements, setMeasurements] = useState('');
    const [notes, setNotes] = useState('');

    const fetchOrders = useCallback(async () => {
        try {
            const response = await cuttingAPI.getPending();
            setOrders(response.data);
        } catch (error) {
            console.error('Error fetching cutting orders:', error);
            toast.error('Error al cargar órdenes de corte');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchOrders();
        // Refresh every 30 seconds
        const interval = setInterval(fetchOrders, 30000);
        return () => clearInterval(interval);
    }, [fetchOrders]);

    const handleStartCutting = async (order) => {
        try {
            await cuttingAPI.start(order.id);
            toast.success('Corte iniciado');
            fetchOrders();
        } catch (error) {
            toast.error('Error al iniciar corte');
        }
    };

    const handleCompleteCutting = async () => {
        if (!selectedOrder) return;
        
        try {
            await cuttingAPI.complete(selectedOrder.id, measurements, notes);
            toast.success('Corte completado - Listo para asignación');
            setCompleteDialog(false);
            setSelectedOrder(null);
            setMeasurements('');
            setNotes('');
            fetchOrders();
        } catch (error) {
            toast.error('Error al completar corte');
        }
    };

    const getStatusBadge = (order) => {
        if (order.cutting_status === 'completado') {
            return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Completado</Badge>;
        } else if (order.cutting_status === 'en_proceso' || order.status === 'en_corte') {
            return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">En Proceso</Badge>;
        }
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Pendiente</Badge>;
    };

    const pendingOrders = orders.filter(o => o.cutting_status !== 'completado' && o.cutting_status !== 'en_proceso' && o.status !== 'en_corte');
    const inProgressOrders = orders.filter(o => o.cutting_status === 'en_proceso' || o.status === 'en_corte');
    const completedOrders = orders.filter(o => o.cutting_status === 'completado');

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <div className="space-y-6" data-testid="cutting-view">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="font-heading text-2xl md:text-3xl flex items-center gap-3">
                        <Scissors className="w-8 h-8 text-primary" />
                        Módulo de Corte
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Gestión de corte de piezas para polarizado y PPF
                    </p>
                </div>
                <Button variant="outline" onClick={fetchOrders}>
                    Actualizar
                </Button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="border-blue-500/30 bg-blue-500/5">
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-4">
                            <div className="p-3 rounded-full bg-blue-500/20">
                                <AlertCircle className="w-6 h-6 text-blue-400" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{pendingOrders.length}</p>
                                <p className="text-sm text-muted-foreground">Pendientes</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-yellow-500/30 bg-yellow-500/5">
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-4">
                            <div className="p-3 rounded-full bg-yellow-500/20">
                                <Play className="w-6 h-6 text-yellow-400" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{inProgressOrders.length}</p>
                                <p className="text-sm text-muted-foreground">En Proceso</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-green-500/30 bg-green-500/5">
                    <CardContent className="pt-6">
                        <div className="flex items-center gap-4">
                            <div className="p-3 rounded-full bg-green-500/20">
                                <CheckCircle className="w-6 h-6 text-green-400" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{completedOrders.length}</p>
                                <p className="text-sm text-muted-foreground">Completados</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Pending Orders */}
            {pendingOrders.length > 0 && (
                <div className="space-y-4">
                    <h2 className="font-heading text-xl flex items-center gap-2">
                        <AlertCircle className="w-5 h-5 text-blue-400" />
                        Pendientes de Corte
                    </h2>
                    <div className="grid gap-4">
                        {pendingOrders.map((order) => (
                            <Card key={order.id} className="border-blue-500/30 hover:border-blue-500/50 transition-colors">
                                <CardContent className="pt-6">
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                        <div className="flex items-start gap-4">
                                            <div className="p-3 rounded-lg bg-blue-500/10">
                                                <Car className="w-8 h-8 text-blue-400" />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <h3 className="font-bold text-lg">{order.plate}</h3>
                                                    {getStatusBadge(order)}
                                                </div>
                                                <p className="text-muted-foreground">{order.brand} {order.model}</p>
                                                <p className="text-sm text-muted-foreground">Cliente: {order.client_name}</p>
                                                <p className="text-xs text-muted-foreground">Código: {order.order_code}</p>
                                            </div>
                                        </div>
                                        
                                        <div className="flex-1 md:max-w-md">
                                            <p className="text-sm font-medium mb-2 flex items-center gap-1">
                                                <Package className="w-4 h-4" />
                                                Servicios a cortar:
                                            </p>
                                            <div className="space-y-1">
                                                {order.cutting_services?.map((svc, idx) => (
                                                    <div key={idx} className="p-2 rounded bg-muted/30 text-sm">
                                                        <span className="font-medium">{svc.name}</span>
                                                        {svc.parts?.length > 0 && (
                                                            <div className="flex flex-wrap gap-1 mt-1">
                                                                {svc.parts.map((part, pidx) => (
                                                                    <span key={pidx} className="text-xs bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded">
                                                                        {part.replace(/_/g, ' ')}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                        
                                        <Button 
                                            onClick={() => handleStartCutting(order)}
                                            className="bg-blue-600 hover:bg-blue-700"
                                        >
                                            <Play className="w-4 h-4 mr-2" />
                                            Iniciar Corte
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>
            )}

            {/* In Progress Orders */}
            {inProgressOrders.length > 0 && (
                <div className="space-y-4">
                    <h2 className="font-heading text-xl flex items-center gap-2">
                        <Play className="w-5 h-5 text-yellow-400" />
                        En Proceso
                    </h2>
                    <div className="grid gap-4">
                        {inProgressOrders.map((order) => (
                            <Card key={order.id} className="border-yellow-500/30 bg-yellow-500/5">
                                <CardContent className="pt-6">
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                        <div className="flex items-start gap-4">
                                            <div className="p-3 rounded-lg bg-yellow-500/10 animate-pulse">
                                                <Scissors className="w-8 h-8 text-yellow-400" />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <h3 className="font-bold text-lg">{order.plate}</h3>
                                                    {getStatusBadge(order)}
                                                </div>
                                                <p className="text-muted-foreground">{order.brand} {order.model}</p>
                                                <p className="text-sm text-muted-foreground">Cliente: {order.client_name}</p>
                                                {order.cutting_started_at && (
                                                    <p className="text-xs text-yellow-400 flex items-center gap-1 mt-1">
                                                        <Clock className="w-3 h-3" />
                                                        Iniciado: {new Date(order.cutting_started_at).toLocaleTimeString()}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        
                                        <div className="flex-1 md:max-w-md">
                                            <p className="text-sm font-medium mb-2">Servicios:</p>
                                            <div className="space-y-1">
                                                {order.cutting_services?.map((svc, idx) => (
                                                    <div key={idx} className="p-2 rounded bg-muted/30 text-sm">
                                                        <span className="font-medium">{svc.name}</span>
                                                        {svc.parts?.length > 0 && (
                                                            <div className="flex flex-wrap gap-1 mt-1">
                                                                {svc.parts.map((part, pidx) => (
                                                                    <span key={pidx} className="text-xs bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded">
                                                                        {part.replace(/_/g, ' ')}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                        
                                        <Button 
                                            onClick={() => {
                                                setSelectedOrder(order);
                                                setCompleteDialog(true);
                                            }}
                                            className="bg-green-600 hover:bg-green-700"
                                        >
                                            <CheckCircle className="w-4 h-4 mr-2" />
                                            Completar Corte
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>
            )}

            {/* Completed Orders */}
            {completedOrders.length > 0 && (
                <div className="space-y-4">
                    <h2 className="font-heading text-xl flex items-center gap-2">
                        <CheckCircle className="w-5 h-5 text-green-400" />
                        Completados (Listos para Asignación)
                    </h2>
                    <div className="grid gap-4">
                        {completedOrders.map((order) => (
                            <Card key={order.id} className="border-green-500/30 bg-green-500/5 opacity-80">
                                <CardContent className="pt-6">
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                        <div className="flex items-start gap-4">
                                            <div className="p-3 rounded-lg bg-green-500/10">
                                                <CheckCircle className="w-8 h-8 text-green-400" />
                                            </div>
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <h3 className="font-bold text-lg">{order.plate}</h3>
                                                    {getStatusBadge(order)}
                                                </div>
                                                <p className="text-muted-foreground">{order.brand} {order.model}</p>
                                                <p className="text-sm text-muted-foreground">Cliente: {order.client_name}</p>
                                                {order.cutting_measurements && (
                                                    <p className="text-xs text-green-400 flex items-center gap-1 mt-1">
                                                        <Ruler className="w-3 h-3" />
                                                        Medidas: {order.cutting_measurements}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        
                                        <div className="flex-1 md:max-w-md">
                                            {order.cutting_notes && (
                                                <div className="p-2 rounded bg-muted/30 text-sm">
                                                    <p className="flex items-center gap-1 text-muted-foreground">
                                                        <FileText className="w-3 h-3" />
                                                        Notas: {order.cutting_notes}
                                                    </p>
                                                </div>
                                            )}
                                        </div>
                                        
                                        <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                                            Listo para Asignar
                                        </Badge>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>
            )}

            {/* Empty State */}
            {orders.length === 0 && (
                <Card className="border-dashed">
                    <CardContent className="pt-6 text-center py-12">
                        <Scissors className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                        <h3 className="font-heading text-lg mb-2">Sin órdenes de corte</h3>
                        <p className="text-muted-foreground">
                            No hay vehículos pendientes de corte de piezas
                        </p>
                    </CardContent>
                </Card>
            )}

            {/* Complete Dialog */}
            <Dialog open={completeDialog} onOpenChange={setCompleteDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <CheckCircle className="w-5 h-5 text-green-500" />
                            Completar Corte
                        </DialogTitle>
                    </DialogHeader>
                    {selectedOrder && (
                        <div className="space-y-4">
                            <div className="p-4 rounded-lg bg-muted/50">
                                <p className="font-bold">{selectedOrder.plate}</p>
                                <p className="text-muted-foreground">{selectedOrder.brand} {selectedOrder.model}</p>
                            </div>
                            
                            <div className="space-y-2">
                                <Label htmlFor="measurements" className="flex items-center gap-2">
                                    <Ruler className="w-4 h-4" />
                                    Medidas (opcional)
                                </Label>
                                <Input
                                    id="measurements"
                                    value={measurements}
                                    onChange={(e) => setMeasurements(e.target.value)}
                                    placeholder="Ej: Panorámico 120x60cm, Laterales 50x40cm"
                                />
                            </div>
                            
                            <div className="space-y-2">
                                <Label htmlFor="notes" className="flex items-center gap-2">
                                    <FileText className="w-4 h-4" />
                                    Notas (opcional)
                                </Label>
                                <Textarea
                                    id="notes"
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    placeholder="Observaciones sobre el corte..."
                                    rows={3}
                                />
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCompleteDialog(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={handleCompleteCutting} className="bg-green-600 hover:bg-green-700">
                            <CheckCircle className="w-4 h-4 mr-2" />
                            Confirmar Corte Completado
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default CuttingView;
