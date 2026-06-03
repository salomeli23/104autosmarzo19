import React, { useState, useEffect, useCallback } from 'react';
import { ordersAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { OrderStatusBadge } from '../components/OrderStatusBadge';
import { ServiceBadge } from '../components/ServiceBadge';
import { formatCurrency, formatDateTime } from '../lib/utils';
import { toast } from 'sonner';
import { 
    Wrench, Play, CheckCircle, Clock, Car, User, 
    Phone, AlertTriangle, Timer, FileText, LogIn, Scissors, Warehouse
} from 'lucide-react';

// Formats elapsed time between an ISO timestamp and now as "Xh Ym"
const formatElapsed = (isoStart, isoEnd = null) => {
    if (!isoStart) return null;
    const start = new Date(isoStart).getTime();
    const end = isoEnd ? new Date(isoEnd).getTime() : Date.now();
    const diffMs = end - start;
    if (diffMs < 0) return '0m';
    const mins = Math.floor(diffMs / 60000);
    if (mins < 60) return `${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
};

// Small inline timer row used in technician cards
const TimerRow = ({ icon: Icon, label, startedAt, completedAt, color = 'text-muted-foreground' }) => {
    if (!startedAt) return null;
    const elapsed = formatElapsed(startedAt, completedAt);
    return (
        <div className={`flex items-center justify-between text-xs ${color}`} data-testid={`timer-${label.toLowerCase()}`}>
            <span className="flex items-center gap-1">
                <Icon className="w-3 h-3" />
                {label}
            </span>
            <span className="font-mono">{elapsed}{completedAt ? '' : ' (en curso)'}</span>
        </div>
    );
};

export const TechnicianView = () => {
    const { user } = useAuth();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [completionNotes, setCompletionNotes] = useState('');
    const [completionPhotos, setCompletionPhotos] = useState([]);
    const [processing, setProcessing] = useState(false);

    const fetchOrders = useCallback(async () => {
        try {
            // Get orders assigned to this technician
            const response = await ordersAPI.getAll();
            // Filter orders that are assigned or in process for this technician
            const myOrders = response.data.filter(o => 
                (o.status === 'asignado' || o.status === 'en_proceso') &&
                o.assigned_technician_id === user?.id
            );
            setOrders(myOrders);
        } catch (error) {
            console.error('Error fetching orders:', error);
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        fetchOrders();
        // Refresh every 30 seconds
        const interval = setInterval(fetchOrders, 30000);
        return () => clearInterval(interval);
    }, [fetchOrders]);

    // Live tick once per minute so elapsed times re-render
    const [, setTick] = useState(0);
    useEffect(() => {
        const t = setInterval(() => setTick(v => v + 1), 60000);
        return () => clearInterval(t);
    }, []);

    const handleStartService = async (orderId) => {
        setProcessing(true);
        try {
            await ordersAPI.startService(orderId);
            toast.success('Servicio iniciado');
            fetchOrders();
        } catch (error) {
            toast.error(error.response?.data?.detail || 'Error al iniciar servicio');
        } finally {
            setProcessing(false);
        }
    };

    const handleCompleteService = async () => {
        if (!completionNotes.trim()) {
            toast.error('Agrega observaciones del trabajo realizado');
            return;
        }
        if (completionPhotos.length === 0) {
            toast.error('Sube al menos una foto del servicio terminado');
            return;
        }

        setProcessing(true);
        try {
            await ordersAPI.completeService({
                order_id: selectedOrder.id,
                notes: completionNotes,
                completion_photos: completionPhotos,
            });
            toast.success('Servicio completado · Bahía liberada');
            setDialogOpen(false);
            setSelectedOrder(null);
            setCompletionNotes('');
            setCompletionPhotos([]);
            fetchOrders();
        } catch (error) {
            toast.error(error.response?.data?.detail || 'Error al completar servicio');
        } finally {
            setProcessing(false);
        }
    };

    const handlePhotoCapture = (e) => {
        const files = Array.from(e.target.files || []);
        if (completionPhotos.length + files.length > 10) {
            toast.error('Máximo 10 fotos');
            return;
        }
        files.forEach(f => {
            const reader = new FileReader();
            reader.onload = (ev) => setCompletionPhotos(prev => [...prev, ev.target.result]);
            reader.readAsDataURL(f);
        });
    };

    const openCompleteDialog = (order) => {
        setSelectedOrder(order);
        setCompletionNotes('');
        setCompletionPhotos([]);
        setDialogOpen(true);
    };

    // Calculate remaining time
    const getRemainingTime = (order) => {
        if (!order.service_started_at || !order.service_time_minutes) return null;
        
        const startTime = new Date(order.service_started_at);
        const endTime = new Date(startTime.getTime() + order.service_time_minutes * 60000);
        const now = new Date();
        const remaining = endTime - now;
        
        if (remaining <= 0) return { expired: true, minutes: 0 };
        
        const minutes = Math.floor(remaining / 60000);
        return { expired: false, minutes };
    };

    // Group orders by status
    const assignedOrders = orders.filter(o => o.status === 'asignado');
    const inProcessOrders = orders.filter(o => o.status === 'en_proceso');

    return (
        <div className="space-y-6" data-testid="technician-page">
            {/* Header */}
            <div>
                <h1 className="font-heading text-3xl md:text-4xl">Mis Servicios</h1>
                <p className="text-muted-foreground">
                    Gestiona los servicios asignados a ti
                </p>
            </div>

            {/* Complete Service Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="font-heading text-xl">Completar Servicio</DialogTitle>
                        <DialogDescription>
                            {selectedOrder && (
                                <span className="font-mono">{selectedOrder.plate}</span>
                            )}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        {selectedOrder && (
                            <Card className="bg-muted/50">
                                <CardContent className="p-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                                            <Car className="w-5 h-5 text-primary" />
                                        </div>
                                        <div>
                                            <p className="font-medium">{selectedOrder.client_name}</p>
                                            <div className="flex gap-1 mt-1">
                                                {selectedOrder.services?.slice(0, 3).map((s, idx) => (
                                                    <ServiceBadge key={idx} service={typeof s === 'string' ? s : s.service} />
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        )}
                        <div className="space-y-2">
                            <label className="text-sm font-medium flex items-center gap-2">
                                <FileText className="w-4 h-4" />
                                Observaciones del Trabajo *
                            </label>
                            <Textarea
                                value={completionNotes}
                                onChange={(e) => setCompletionNotes(e.target.value)}
                                placeholder="Describe el trabajo realizado, materiales utilizados, observaciones..."
                                rows={4}
                                data-testid="completion-notes"
                            />
                        </div>
                        
                        <div className="space-y-2">
                            <label className="text-sm font-medium flex items-center gap-2">
                                <FileText className="w-4 h-4" />
                                Fotos del Servicio Terminado * ({completionPhotos.length}/10)
                            </label>
                            <input
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={handlePhotoCapture}
                                disabled={completionPhotos.length >= 10}
                                className="w-full text-sm"
                                data-testid="completion-photo-input"
                            />
                            {completionPhotos.length > 0 && (
                                <div className="flex flex-wrap gap-2 mt-2">
                                    {completionPhotos.map((p, i) => (
                                        <div key={i} className="relative w-16 h-16 rounded overflow-hidden border">
                                            <img src={p} alt={`f${i}`} className="w-full h-full object-cover" />
                                            <button
                                                type="button"
                                                onClick={() => setCompletionPhotos(prev => prev.filter((_, idx) => idx !== i))}
                                                className="absolute top-0 right-0 bg-red-500 text-white text-xs w-5 h-5 flex items-center justify-center rounded-bl"
                                            >×</button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            <p className="text-xs text-muted-foreground">
                                Al confirmar, la bahía se libera automáticamente y la orden pasa a Facturación.
                            </p>
                        </div>
                        
                        <Button 
                            onClick={handleCompleteService}
                            className="w-full brand-glow"
                            disabled={processing || !completionNotes.trim() || completionPhotos.length === 0}
                            data-testid="confirm-complete-btn"
                        >
                            <CheckCircle className="w-4 h-4 mr-2" />
                            {processing ? 'Procesando...' : 'Confirmar Completado'}
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
                    <Wrench className="w-16 h-16 mb-4 opacity-50" />
                    <p className="text-lg">No tienes servicios asignados</p>
                    <p className="text-sm">Los servicios aparecerán cuando el coordinador te asigne</p>
                </div>
            ) : (
                <div className="space-y-8">
                    {/* In Process - Priority */}
                    {inProcessOrders.length > 0 && (
                        <div>
                            <h2 className="font-heading text-xl mb-4 flex items-center gap-2">
                                <Clock className="w-5 h-5 text-yellow-500" />
                                En Proceso
                                <span className="text-sm text-muted-foreground">({inProcessOrders.length})</span>
                            </h2>
                            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {inProcessOrders.map(order => {
                                    const timeInfo = getRemainingTime(order);
                                    return (
                                        <Card 
                                            key={order.id} 
                                            className={`card-hover ${timeInfo?.expired ? 'border-red-500/50' : 'border-yellow-500/30'}`}
                                            data-testid={`order-${order.id}`}
                                        >
                                            <CardContent className="p-4">
                                                <div className="flex items-start justify-between mb-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-12 h-12 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                                                            <Wrench className="w-6 h-6 text-yellow-500" />
                                                        </div>
                                                        <div>
                                                            <p className="font-mono font-bold text-lg">{order.plate}</p>
                                                            <p className="text-sm text-muted-foreground">
                                                                {order.brand} {order.model}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    {timeInfo && (
                                                        <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
                                                            timeInfo.expired 
                                                                ? 'bg-red-500/20 text-red-500' 
                                                                : 'bg-yellow-500/20 text-yellow-500'
                                                        }`}>
                                                            {timeInfo.expired ? (
                                                                <AlertTriangle className="w-3 h-3" />
                                                            ) : (
                                                                <Timer className="w-3 h-3" />
                                                            )}
                                                            {timeInfo.expired ? 'Tiempo excedido' : `${timeInfo.minutes} min`}
                                                        </div>
                                                    )}
                                                </div>
                                                
                                                <div className="space-y-2 mb-4">
                                                    <div className="flex items-center gap-2 text-sm">
                                                        <User className="w-4 h-4 text-muted-foreground" />
                                                        <span>{order.client_name}</span>
                                                    </div>
                                                    <div className="flex flex-wrap gap-1">
                                                        {order.services?.map((s, idx) => (
                                                            <ServiceBadge key={idx} service={typeof s === 'string' ? s : s.service} />
                                                        ))}
                                                    </div>
                                                </div>

                                                {/* Tiempos de la orden */}
                                                <div className="space-y-1.5 mb-4 p-2 rounded-lg bg-muted/40 border border-muted">
                                                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-semibold">Tiempos</p>
                                                    <TimerRow icon={LogIn} label="Ingreso" startedAt={order.ingreso_at} completedAt={order.inspection_at} color="text-blue-400" />
                                                    <TimerRow icon={Scissors} label="Corte" startedAt={order.cutting_started_at} completedAt={order.cutting_completed_at} color="text-orange-400" />
                                                    <TimerRow icon={Wrench} label="Servicio" startedAt={order.service_started_at} completedAt={order.service_completed_at} color="text-yellow-400" />
                                                    <TimerRow icon={Warehouse} label="Bahía" startedAt={order.assigned_at} completedAt={order.service_completed_at} color="text-cyan-400" />
                                                </div>

                                                <Button 
                                                    className="w-full"
                                                    onClick={() => openCompleteDialog(order)}
                                                    data-testid={`complete-btn-${order.id}`}
                                                >
                                                    <CheckCircle className="w-4 h-4 mr-2" />
                                                    Completar Servicio
                                                </Button>
                                            </CardContent>
                                        </Card>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Assigned - Pending to start */}
                    {assignedOrders.length > 0 && (
                        <div>
                            <h2 className="font-heading text-xl mb-4 flex items-center gap-2">
                                <Play className="w-5 h-5 text-blue-500" />
                                Pendientes de Iniciar
                                <span className="text-sm text-muted-foreground">({assignedOrders.length})</span>
                            </h2>
                            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {assignedOrders.map(order => (
                                    <Card key={order.id} className="card-hover border-blue-500/30" data-testid={`order-${order.id}`}>
                                        <CardContent className="p-4">
                                            <div className="flex items-start justify-between mb-3">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-12 h-12 rounded-lg bg-blue-500/20 flex items-center justify-center">
                                                        <Car className="w-6 h-6 text-blue-500" />
                                                    </div>
                                                    <div>
                                                        <p className="font-mono font-bold text-lg">{order.plate}</p>
                                                        <p className="text-sm text-muted-foreground">
                                                            {order.brand} {order.model}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-primary/20 text-primary text-xs">
                                                    <Timer className="w-3 h-3" />
                                                    {order.service_time_minutes} min
                                                </div>
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
                                                <div className="flex flex-wrap gap-1">
                                                    {order.services?.map((s, idx) => (
                                                        <ServiceBadge key={idx} service={typeof s === 'string' ? s : s.service} />
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Tiempos de la orden */}
                                            <div className="space-y-1.5 mb-4 p-2 rounded-lg bg-muted/40 border border-muted">
                                                <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-semibold">Tiempos</p>
                                                <TimerRow icon={LogIn} label="Ingreso" startedAt={order.ingreso_at} completedAt={order.inspection_at} color="text-blue-400" />
                                                <TimerRow icon={Scissors} label="Corte" startedAt={order.cutting_started_at} completedAt={order.cutting_completed_at} color="text-orange-400" />
                                                <TimerRow icon={Warehouse} label="Bahía" startedAt={order.assigned_at} completedAt={null} color="text-cyan-400" />
                                            </div>
                                            
                                            <Button 
                                                className="w-full brand-glow"
                                                onClick={() => handleStartService(order.id)}
                                                disabled={processing}
                                                data-testid={`start-btn-${order.id}`}
                                            >
                                                <Play className="w-4 h-4 mr-2" />
                                                Iniciar Servicio
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

export default TechnicianView;
