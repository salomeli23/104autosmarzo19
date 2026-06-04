import React, { useState, useEffect, useCallback } from 'react';
import { cuttingAPI, inventoryAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { toast } from 'sonner';
import { Scissors, Car, Clock, CheckCircle, Play, AlertCircle, Ruler, FileText, Package } from 'lucide-react';
import { LiveTimer } from '../components/LiveTimer';

const CuttingView = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [completeDialog, setCompleteDialog] = useState(false);
    const [partMeasurements, setPartMeasurements] = useState({});
    const [notes, setNotes] = useState('');
    const [ppfSerial, setPpfSerial] = useState('');
    const [ppfModel, setPpfModel] = useState('');
    const [rollos, setRollos] = useState([]);
    const [selectedRolloId, setSelectedRolloId] = useState('');
    const [metersOverride, setMetersOverride] = useState('');
    // Material y rollo POR PIEZA: { part_id: { tipo_rollo, inventory_item_id, is_aprovechamiento } }
    const [partMaterials, setPartMaterials] = useState({});
    // Dimensiones independientes por pieza: { part_id: { largo: '120', ancho: '60' } }
    const [partDims, setPartDims] = useState({});

    // Lookup del porcentaje elegido por el cliente en el check-in para esta parte
    const getPartPercentage = (order, partId) => {
        const services = order?.cutting_services || order?.services || [];
        for (const svc of services) {
            const pct = (svc.part_percentages || {})[partId];
            if (pct) return pct;
        }
        return null;
    };

    // Tipos de rollo disponibles (alineado con Inventory.jsx)
    const ROLLO_TYPES = [
        { value: 'spectra', label: 'Spectra' },
        { value: 'black_ceramic', label: 'Black Ceramic' },
        { value: 'ceramic_i3', label: 'Ceramic i3' },
        { value: 'upper_hoptik', label: 'Upper Hoptik' },
        { value: 'edge', label: 'Edge' },
        { value: 'clear_4mil', label: 'Clear 4mil' },
        { value: 'clear_7mil', label: 'Clear 7mil' },
        { value: 'clear_12mil', label: 'Clear 12mil' },
        { value: 'clear_1500_micras', label: 'Clear 1500 micras' },
        { value: 'xpel_gloss', label: 'Xpel Gloss' },
        { value: 'ppf_xpel_ultimate', label: 'PPF Xpel Ultimate' },
        { value: 'ppf_autoban', label: 'PPF Autoban' },
        { value: 'ppf_techo', label: 'PPF Techo' },
    ];
    const labelForTipoRollo = (tipo) => ROLLO_TYPES.find(t => t.value === tipo)?.label || tipo;

    // Partes del vehículo (mismo set que el check-in)
    const VEHICLE_PARTS = [
        { id: 'panoramico', label: 'Panorámico' },
        { id: 'vidrio_copiloto', label: 'Vidrio Copiloto' },
        { id: 'vidrio_piloto', label: 'Vidrio Piloto' },
        { id: 'vidrio_trasero', label: 'Vidrio Trasero' },
        { id: 'vidrio_trasero_copiloto', label: 'Vidrio Trasero Copiloto' },
        { id: 'trasero', label: 'Trasero' },
        { id: 'luneta', label: 'Luneta' },
        { id: 'sunroof', label: 'Sunroof' },
        { id: 'custodias', label: 'Custodias' },
    ];

    const orderHasPPF = (order) => {
        const services = order?.cutting_services || order?.services || [];
        return services.some(s => {
            const txt = `${s.name || ''} ${s.description || ''} ${s.service || ''}`.toLowerCase();
            return txt.includes('ppf') || txt.includes('proteccion') || txt.includes('protección');
        });
    };

    // Parts already selected during check-in for this order's cutting services
    const orderSelectedParts = (order) => {
        const set = new Set();
        const services = order?.cutting_services || [];
        services.forEach(s => (s.parts || []).forEach(p => set.add(p)));
        return set;
    };

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
        
        // Validation: at least one part must have a measurement
        const filled = Object.values(partMeasurements).filter(v => v && String(v).trim()).length;
        if (filled === 0) {
            toast.error('Ingresa al menos una medida de pieza');
            return;
        }
        
        const isPPF = orderHasPPF(selectedOrder);
        if (isPPF && (!ppfSerial.trim() || !ppfModel.trim())) {
            toast.error('Para servicios PPF debes ingresar serie y modelo del vehículo');
            return;
        }
        
        try {
            const body = {
                part_measurements: partMeasurements,
                notes: notes || null,
                ppf_vehicle_serial: isPPF ? ppfSerial.trim() : null,
                ppf_vehicle_model: isPPF ? ppfModel.trim() : null,
            };
            // Modo granular por pieza (material + marca/rollo + aprovechamiento)
            const cleanedMaterials = {};
            Object.entries(partMaterials).forEach(([pid, m]) => {
                if (m && (m.tipo_rollo || m.inventory_item_id || m.is_aprovechamiento)) {
                    cleanedMaterials[pid] = {
                        tipo_rollo: m.tipo_rollo || null,
                        inventory_item_id: m.inventory_item_id || null,
                        is_aprovechamiento: !!m.is_aprovechamiento,
                    };
                }
            });
            if (Object.keys(cleanedMaterials).length > 0) {
                body.part_materials = cleanedMaterials;
            } else if (selectedRolloId) {
                // Modo legacy agregado
                body.inventory_item_id = selectedRolloId;
                if (metersOverride && parseFloat(metersOverride) > 0) {
                    body.meters_used = parseFloat(metersOverride);
                }
            }
            const res = await cuttingAPI.complete(selectedOrder.id, body);
            const dedu = res.data?.inventory_deduction;
            const aprovs = res.data?.aprovechamientos || [];
            if (dedu) {
                if (dedu.multi) {
                    const parts = dedu.multi.map(d => `${d.rollo_codigo || d.tipo_rollo || d.item_id}: ${d.meters_used}m (quedan ${d.new_remaining}m)`).join(' · ');
                    toast.success(`Corte completado · ${parts}`);
                } else {
                    toast.success(`Corte completado · ${dedu.meters_used} m descontados (quedan ${dedu.new_remaining.toFixed(2)} m)`);
                }
            } else {
                toast.success('Corte completado - Listo para asignación');
            }
            if (aprovs.length > 0) {
                toast.info(`♻ ${aprovs.length} pieza(s) registradas como aprovechamiento (no descontadas del stock)`);
            }
            setCompleteDialog(false);
            setSelectedOrder(null);
            setPartMeasurements({});
            setPartMaterials({});
            setPartDims({});
            setNotes('');
            setPpfSerial('');
            setPpfModel('');
            setSelectedRolloId('');
            setMetersOverride('');
            fetchOrders();
        } catch (error) {
            toast.error(error.response?.data?.detail || 'Error al completar corte');
        }
    };

    const openCompleteDialog = (order) => {
        setSelectedOrder(order);
        // Pre-fill empty measurements only for parts that were selected at check-in
        const selectedSet = orderSelectedParts(order);
        const initial = {};
        VEHICLE_PARTS.forEach(p => {
            if (selectedSet.has(p.id)) initial[p.id] = '';
        });
        setPartMeasurements(initial);
        setPartMaterials({});
        setPartDims({});
        setNotes('');
        setPpfSerial(order?.ppf_vehicle_serial || '');
        setPpfModel(order?.ppf_vehicle_model || '');
        setSelectedRolloId('');
        setMetersOverride('');
        // Fetch available rollos (with metros_restantes > 0)
        inventoryAPI.list({ tipo_articulo: 'rollo' })
            .then(res => {
                const available = (res.data || []).filter(r => (r.metros_restantes ?? 0) > 0);
                setRollos(available);
            })
            .catch(() => setRollos([]));
        setCompleteDialog(true);
    };

    const computeAutoMeters = () => {
        let total = 0;
        Object.values(partMeasurements).forEach(v => {
            if (!v) return;
            const nums = String(v).match(/\d+(?:[.,]\d+)?/g) || [];
            if (nums.length === 0) return;
            const dims = nums.slice(0, 2).map(x => parseFloat(x.replace(',', '.')));
            const cm = Math.max(...dims, 0);
            total += cm / 100;
        });
        return Math.round(total * 100) / 100;
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
                                            onClick={() => openCompleteDialog(order)}
                                            className="bg-green-600 hover:bg-green-700"
                                            data-testid={`complete-cutting-btn-${order.id}`}
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
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
                                <p className="text-xs text-muted-foreground">Cliente: {selectedOrder.client_name}</p>
                            </div>

                            {/* PPF: serie y modelo del carro */}
                            {orderHasPPF(selectedOrder) && (
                                <div className="space-y-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
                                    <Label className="flex items-center gap-2 text-amber-400 font-medium">
                                        <Package className="w-4 h-4" />
                                        Datos del Vehículo PPF (requeridos)
                                    </Label>
                                    <div className="grid sm:grid-cols-2 gap-3">
                                        <div className="space-y-1">
                                            <Label htmlFor="ppf-serial" className="text-xs">Serie del Vehículo</Label>
                                            <Input
                                                id="ppf-serial"
                                                value={ppfSerial}
                                                onChange={(e) => setPpfSerial(e.target.value)}
                                                placeholder="Ej: VIN, número de serie"
                                                data-testid="ppf-serial-input"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label htmlFor="ppf-model" className="text-xs">Modelo</Label>
                                            <Input
                                                id="ppf-model"
                                                value={ppfModel}
                                                onChange={(e) => setPpfModel(e.target.value)}
                                                placeholder="Ej: Mazda 3 2024"
                                                data-testid="ppf-model-input"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Medidas por pieza */}
                            <div className="space-y-3">
                                <Label className="flex items-center gap-2 font-medium">
                                    <Ruler className="w-4 h-4" />
                                    Medida lineal (cm), porcentaje y material por pieza
                                </Label>
                                <p className="text-xs text-muted-foreground -mt-1">
                                    Cada pieza muestra el porcentaje elegido por el cliente en el check-in.
                                    Selecciona el material (tipo de rollo) y el rollo específico del stock para descontar automáticamente.
                                </p>
                                <div className="grid sm:grid-cols-2 gap-3">
                                    {VEHICLE_PARTS.map((part) => {
                                        const wasSelected = orderSelectedParts(selectedOrder).has(part.id);
                                        const pct = getPartPercentage(selectedOrder, part.id);
                                        const material = partMaterials[part.id]?.tipo_rollo || '';
                                        const rolloId = partMaterials[part.id]?.inventory_item_id || '';
                                        const isAprov = !!partMaterials[part.id]?.is_aprovechamiento;
                                        // Medida lineal única (1-350 cm)
                                        const medida = partDims[part.id]?.medida || '';
                                        const updateDim = (value) => {
                                            setPartDims(prev => ({ ...prev, [part.id]: { medida: value } }));
                                            setPartMeasurements(prev => ({
                                                ...prev,
                                                [part.id]: value ? `${value} cm` : '',
                                            }));
                                        };
                                        // Filtrar rollos por material seleccionado
                                        const filteredRollos = material
                                            ? rollos.filter(r => r.tipo_rollo === material)
                                            : rollos;
                                        const selectedRollo = rollos.find(r => r.id === rolloId);
                                        return (
                                            <div
                                                key={part.id}
                                                className={`space-y-2 p-3 rounded-lg ${isAprov ? 'bg-purple-500/5 border border-purple-500/40' : wasSelected ? 'bg-cyan-500/5 border border-cyan-500/30' : 'bg-muted/30 border border-border'}`}
                                                data-testid={`part-block-${part.id}`}
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <Label className="text-sm font-medium flex items-center gap-1.5">
                                                        {wasSelected && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />}
                                                        {part.label}
                                                    </Label>
                                                    {pct ? (
                                                        <span
                                                            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
                                                            data-testid={`part-pct-${part.id}`}
                                                        >
                                                            {pct}
                                                        </span>
                                                    ) : wasSelected ? (
                                                        <span className="text-[10px] text-muted-foreground">sin %</span>
                                                    ) : null}
                                                </div>
                                                {/* Medida lineal única (1-350 cm) */}
                                                <select
                                                    className="w-full px-2 py-1.5 rounded border border-input bg-background text-sm"
                                                    value={medida}
                                                    onChange={(e) => updateDim(e.target.value)}
                                                    data-testid={`part-medida-${part.id}`}
                                                >
                                                    <option value="">Medida lineal (cm)…</option>
                                                    {Array.from({ length: 350 }, (_, i) => i + 1).map(n => (
                                                        <option key={n} value={n}>{n} cm</option>
                                                    ))}
                                                </select>
                                                {/* Material y rollo */}
                                                <div className="grid grid-cols-2 gap-1.5">
                                                    <select
                                                        className="px-2 py-1.5 rounded border border-input bg-background text-xs"
                                                        value={material}
                                                        onChange={(e) => {
                                                            const newTipo = e.target.value;
                                                            setPartMaterials(prev => ({
                                                                ...prev,
                                                                [part.id]: {
                                                                    ...(prev[part.id] || {}),
                                                                    tipo_rollo: newTipo || null,
                                                                    inventory_item_id: rollos.find(r => r.id === prev[part.id]?.inventory_item_id && r.tipo_rollo === newTipo)?.id || null,
                                                                }
                                                            }));
                                                        }}
                                                        data-testid={`part-material-${part.id}`}
                                                    >
                                                        <option value="">Material…</option>
                                                        {ROLLO_TYPES.map(t => (
                                                            <option key={t.value} value={t.value}>{t.label}</option>
                                                        ))}
                                                    </select>
                                                    <select
                                                        className="px-2 py-1.5 rounded border border-input bg-background text-xs"
                                                        value={rolloId}
                                                        onChange={(e) => setPartMaterials(prev => ({
                                                            ...prev,
                                                            [part.id]: {
                                                                ...(prev[part.id] || {}),
                                                                inventory_item_id: e.target.value || null,
                                                            }
                                                        }))}
                                                        disabled={!material}
                                                        data-testid={`part-rollo-${part.id}`}
                                                    >
                                                        <option value="">Marca / Rollo…</option>
                                                        {filteredRollos.map(r => (
                                                            <option key={r.id} value={r.id}>
                                                                {r.codigo} · {r.nombre} ({(r.metros_restantes ?? 0).toFixed(2)}m)
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                                {/* Checkbox Aprovechamiento */}
                                                <label
                                                    className={`flex items-center gap-2 cursor-pointer select-none p-1.5 rounded transition-colors ${isAprov ? 'bg-purple-500/15' : 'hover:bg-muted/40'}`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={isAprov}
                                                        onChange={(e) => setPartMaterials(prev => ({
                                                            ...prev,
                                                            [part.id]: {
                                                                ...(prev[part.id] || {}),
                                                                is_aprovechamiento: e.target.checked,
                                                            }
                                                        }))}
                                                        className="w-4 h-4 accent-purple-500"
                                                        data-testid={`part-aprov-${part.id}`}
                                                    />
                                                    <span className={`text-xs font-medium ${isAprov ? 'text-purple-300' : 'text-muted-foreground'}`}>
                                                        ♻ Aprovechamiento (no descuenta del stock)
                                                    </span>
                                                </label>
                                                {selectedRollo && !isAprov && (
                                                    <p className="text-[11px] text-cyan-400 flex items-center gap-1" data-testid={`part-rollo-info-${part.id}`}>
                                                        <Package className="w-3 h-3" />
                                                        {labelForTipoRollo(selectedRollo.tipo_rollo)} · {selectedRollo.codigo} · quedan {(selectedRollo.metros_restantes ?? 0).toFixed(2)}m
                                                    </p>
                                                )}
                                                {isAprov && (
                                                    <p className="text-[11px] text-purple-400 flex items-center gap-1" data-testid={`part-aprov-info-${part.id}`}>
                                                        <Package className="w-3 h-3" />
                                                        Registrado en base de aprovechamientos (no se descuenta del rollo)
                                                    </p>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Observación general */}
                            <div className="space-y-2">
                                <Label htmlFor="notes" className="flex items-center gap-2">
                                    <FileText className="w-4 h-4" />
                                    Observación
                                </Label>
                                <Textarea
                                    id="notes"
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    placeholder="Observaciones sobre el corte (opcional)..."
                                    rows={3}
                                    data-testid="cutting-notes-input"
                                />
                            </div>

                            {/* Rollo agregado (alternativa - solo si NO se asignó por pieza) */}
                            {Object.values(partMaterials).every(m => !m?.inventory_item_id) && (
                            <div className="space-y-2 p-3 rounded-lg border border-cyan-500/30 bg-cyan-500/5">
                                <Label className="flex items-center gap-2 text-cyan-400 font-medium">
                                    <Package className="w-4 h-4" />
                                    Rollo único para todo el corte (opcional, si no se especificó por pieza)
                                </Label>
                                <select
                                    className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm"
                                    value={selectedRolloId}
                                    onChange={(e) => setSelectedRolloId(e.target.value)}
                                    data-testid="cutting-rollo-select"
                                >
                                    <option value="">— No descontar inventario —</option>
                                    {rollos.map(r => (
                                        <option key={r.id} value={r.id}>
                                            {r.codigo} · {r.nombre} ({(r.metros_restantes ?? 0).toFixed(2)} m restantes)
                                        </option>
                                    ))}
                                </select>
                                {selectedRolloId && (
                                    <div className="grid grid-cols-2 gap-2 items-end">
                                        <div className="space-y-1">
                                            <Label className="text-xs">Metros usados (auto: {computeAutoMeters()} m)</Label>
                                            <Input
                                                type="number"
                                                step="0.01"
                                                value={metersOverride}
                                                onChange={(e) => setMetersOverride(e.target.value)}
                                                placeholder={`${computeAutoMeters()}`}
                                                data-testid="cutting-meters-override"
                                            />
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Dejar vacío para usar el cálculo automático
                                        </p>
                                    </div>
                                )}
                            </div>
                            )}
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCompleteDialog(false)}>
                            Cancelar
                        </Button>
                        <Button
                            onClick={handleCompleteCutting}
                            className="bg-green-600 hover:bg-green-700"
                            data-testid="confirm-complete-cutting-btn"
                        >
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
