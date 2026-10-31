import React, { useState, useEffect, useCallback } from 'react';
import { orderTechnicians } from '../lib/workflow';
import { cuttingAPI } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import { Scissors, Car, Clock, CheckCircle, Play, AlertCircle, Ruler, FileText, Package, HandHelping, Recycle } from 'lucide-react';
import { LiveTimer } from '../components/LiveTimer';
import { TechMeasurementsSummary } from '../components/TechMeasurements';
import { CompleteCuttingDialog } from '../components/CompleteCuttingDialog';
import { ReusablePiecesDialog } from '../components/ReusablePiecesDialog';
import { partLabel } from '../lib/opacity';

const CuttingView = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [completeDialog, setCompleteDialog] = useState(false);
    const [piecesOpen, setPiecesOpen] = useState(false);
    const [pieces, setPieces] = useState([]);

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
        cuttingAPI.reusablePieces().then(res => setPieces(res.data || [])).catch(() => {});
    }, [completeDialog]);

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

    const handleDeliverMaterial = async (order) => {
        const names = orderTechnicians(order).map(t => t.name).join(' y ') || 'el técnico';
        if (!window.confirm(`¿Confirmas que entregaste el material de ${order.plate} a ${names}?`)) return;
        try {
            await cuttingAPI.deliver(order.id);
            toast.success(`Material entregado a ${names} · listo para instalación`);
            fetchOrders();
        } catch (error) {
            toast.error(error.response?.data?.detail || 'No se pudo confirmar la entrega');
        }
    };

    const openCompleteDialog = (order) => {
        setSelectedOrder(order);
        setCompleteDialog(true);
    };

    const getStatusBadge = (order) => {
        if (order.cutting_status === 'completado') {
            return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Material listo</Badge>;
        } else if (order.cutting_status === 'en_proceso') {
            return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">En Proceso</Badge>;
        }
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Pendiente</Badge>;
    };

    // Todas llegan en estado en_corte (con técnicos asignados); se separan por avance del corte
    const pendingOrders = orders.filter(o => o.cutting_status !== 'completado' && o.cutting_status !== 'en_proceso');
    const inProgressOrders = orders.filter(o => o.cutting_status === 'en_proceso');
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
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="font-heading text-2xl md:text-3xl flex items-center gap-3">
                        <Scissors className="w-8 h-8 text-primary" />
                        Módulo de Corte
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Gestión de corte de piezas para polarizado y PPF
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setPiecesOpen(true)} className="border-emerald-500/40" data-testid="reusable-pieces-btn">
                        <Recycle className="w-4 h-4 mr-2 text-emerald-400" /> Piezas reutilizables
                        {pieces.length > 0 && <Badge className="ml-2 bg-emerald-500/20 text-emerald-300 border-emerald-500/40">{pieces.length}</Badge>}
                    </Button>
                    <Button variant="outline" onClick={fetchOrders}>
                        Actualizar
                    </Button>
                </div>
            </div>

            {pieces.length > 0 && (
                <div className="p-3 rounded-lg border border-emerald-500/40 bg-emerald-500/5 text-sm flex items-start gap-2" data-testid="reusable-pieces-banner">
                    <Recycle className="w-5 h-5 text-emerald-400 shrink-0" />
                    <p>
                        ♻ Hay <b>{pieces.length}</b> pieza(s) reutilizable(s) en {new Set(pieces.map(p => p.referencia)).size} referencia(s).
                        Al completar un corte te avisamos si la referencia tiene piezas que puedes usar antes de cortar del rollo.
                    </p>
                </div>
            )}

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
                                <p className="text-sm text-muted-foreground">Material listo por entregar</p>
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
                                                {orderTechnicians(order).length > 0 && (
                                                    <p className="text-xs text-cyan-400" data-testid={`cutting-techs-${order.id}`}>
                                                        Instalan: {orderTechnicians(order).map(t => t.name).join(' y ')}
                                                    </p>
                                                )}
                                                {order.ingreso_at && (
                                                    <div className="mt-1">
                                                        <LiveTimer
                                                            startTime={order.ingreso_at}
                                                            label="En taller"
                                                            colorClass="text-blue-400"
                                                            testId={`pending-timer-ingreso-${order.id}`}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        
                                        <div className="flex-1 md:max-w-md">
                                            <div className="mb-2"><TechMeasurementsSummary order={order} compact /></div>
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
                                                                        {partLabel(part)}{svc.part_percentages?.[part] ? ` · ${svc.part_percentages[part]}` : ''}
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
                                                <div className="mt-2 flex flex-wrap gap-3">
                                                    {order.ingreso_at && (
                                                        <LiveTimer
                                                            startTime={order.ingreso_at}
                                                            label="En taller"
                                                            colorClass="text-blue-400"
                                                            testId={`cutting-timer-ingreso-${order.id}`}
                                                        />
                                                    )}
                                                    {order.cutting_started_at && (
                                                        <LiveTimer
                                                            startTime={order.cutting_started_at}
                                                            label="En corte"
                                                            colorClass="text-yellow-400"
                                                            testId={`cutting-timer-${order.id}`}
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        
                                        <div className="flex-1 md:max-w-md">
                                            <div className="mb-2"><TechMeasurementsSummary order={order} compact /></div>
                                            <p className="text-sm font-medium mb-2">Servicios:</p>
                                            <div className="space-y-1">
                                                {order.cutting_services?.map((svc, idx) => (
                                                    <div key={idx} className="p-2 rounded bg-muted/30 text-sm">
                                                        <span className="font-medium">{svc.name}</span>
                                                        {svc.parts?.length > 0 && (
                                                            <div className="flex flex-wrap gap-1 mt-1">
                                                                {svc.parts.map((part, pidx) => (
                                                                    <span key={pidx} className="text-xs bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded">
                                                                        {partLabel(part)}{svc.part_percentages?.[part] ? ` · ${svc.part_percentages[part]}` : ''}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                        
                                        <Button 
                                            onClick={() => openCompleteDialog(order)}
                                            className="bg-green-600 hover:bg-green-700"
                                            disabled={!order.tech_measurements?.confirmed_at}
                                            title={order.tech_measurements?.confirmed_at ? '' : 'El técnico debe colocar las medidas primero'}
                                            data-testid={`complete-cutting-btn-${order.id}`}
                                        >
                                            <CheckCircle className="w-4 h-4 mr-2" />
                                            {order.tech_measurements?.confirmed_at ? 'Completar Corte' : 'Esperando medidas'}
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
                        Material listo · por entregar al técnico
                    </h2>
                    <div className="grid gap-4">
                        {completedOrders.map((order) => (
                            <Card key={order.id} className="border-green-500/30 bg-green-500/5">
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
                                        
                                        <div className="space-y-1 text-right">
                                            {orderTechnicians(order).length > 0 && (
                                                <p className="text-xs text-cyan-400">Para: {orderTechnicians(order).map(t => t.name).join(' y ')}</p>
                                            )}
                                            <Button
                                                onClick={() => handleDeliverMaterial(order)}
                                                className="bg-emerald-600 hover:bg-emerald-700"
                                                data-testid={`deliver-material-btn-${order.id}`}
                                            >
                                                <HandHelping className="w-4 h-4 mr-2" />
                                                Confirmar entrega al técnico
                                            </Button>
                                        </div>
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

            <CompleteCuttingDialog
                order={completeDialog ? selectedOrder : null}
                onClose={() => { setCompleteDialog(false); setSelectedOrder(null); }}
                onCompleted={fetchOrders}
            />
            <ReusablePiecesDialog open={piecesOpen} onOpenChange={setPiecesOpen} onChanged={setPieces} />
        </div>
    );
};

export default CuttingView;
