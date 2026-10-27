import React, { useState, useEffect, useCallback } from 'react';
import { ordersAPI, usersAPI, orderRouteAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { OrderStatusBadge } from '../components/OrderStatusBadge';
import { ServiceBadge } from '../components/ServiceBadge';
import { PlateBadge } from '../components/PlateBadge';
import { CarAvatar } from '../components/CarAvatar';
import { LiveTimer } from '../components/LiveTimer';
import { toast } from 'sonner';
import { PostventaBadge } from '../components/PostventaBadge';
import { AccessoryStatusTag } from '../components/AccessoryStatusTag';
import { CheckinByTag } from '../components/CheckinByTag';
import { UpdateOrderButton } from '../components/UpdateOrderButton';
import {
    User, Clock, RefreshCw, ChevronDown, ChevronRight, Play, Check, DollarSign, Wallet, AlertCircle, Wrench, Sparkles, Droplet, Shield, Boxes, Paintbrush, Route as RouteIcon,
} from 'lucide-react';

// Icono por rol
const ROLE_ICONS = {
    lavado: Droplet,
    ceramico: Sparkles,
    polarizado: Shield,
    ppf: Shield,
    accesorios: Boxes,
    detailing: Sparkles,
    latoneria_pintura: Paintbrush,
};

const ROLE_LABELS = {
    lavado: 'Lavado',
    ceramico: 'Cerámico',
    polarizado: 'Polarizado',
    ppf: 'PPF',
    accesorios: 'Accesorios',
    detailing: 'Detailing',
    latoneria_pintura: 'Latonería y Pintura',
};

// Etiqueta de pago (paid / partial / pending)
const paymentInfo = (order) => {
    const total = order.final_value || order.negotiated_value || 0;
    const paid = order.amount_paid || 0;
    if (total <= 0) return { label: 'Sin monto', color: 'bg-muted text-muted-foreground', icon: AlertCircle };
    if (paid >= total - 0.01) return { label: 'Pagado', color: 'bg-green-500/20 text-green-400 border-green-500/40', icon: DollarSign };
    if (paid > 0) return { label: `Abono $${paid.toLocaleString()}`, color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40', icon: Wallet };
    return { label: 'Saldo pendiente', color: 'bg-red-500/20 text-red-400 border-red-500/40', icon: AlertCircle };
};

// ================== Slot Row ==================
const SlotRow = ({ slot, technicians, onAssign, onStart, onComplete }) => {
    const Icon = ROLE_ICONS[slot.role] || Wrench;
    const eligibleTechs = technicians.filter(t => (t.tecnico_roles || []).includes(slot.role));
    const [selectedTech, setSelectedTech] = useState(slot.technician_id || '__none__');
    const [agencia, setAgencia] = useState(slot.agencia_nombre || '');
    const isTerceros = slot.role === 'latoneria_pintura';

    const statusColor = {
        pendiente: 'text-muted-foreground',
        en_proceso: 'text-yellow-400',
        completado: 'text-green-400',
    }[slot.status];

    return (
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,180px)_minmax(0,1fr)_minmax(0,200px)] gap-2 items-center p-2 rounded bg-muted/40" data-testid={`route-slot-${slot.id}`}>
            <div className="flex items-center gap-2">
                <Icon className="w-4 h-4 text-cyan-400" />
                <div>
                    <p className="text-sm font-medium">{slot.label}</p>
                    <p className={`text-[11px] ${statusColor}`}>{slot.status}</p>
                </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-1">
                <Select
                    value={selectedTech}
                    onValueChange={(v) => {
                        setSelectedTech(v);
                        const techId = v === '__none__' ? null : v;
                        onAssign({ technician_id: techId, agencia_nombre: isTerceros ? agencia : null });
                    }}
                    disabled={slot.status === 'completado'}
                >
                    <SelectTrigger className="h-8 text-xs" data-testid={`slot-tech-select-${slot.id}`}>
                        <SelectValue placeholder="Asignar técnico…" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="__none__">(Sin asignar)</SelectItem>
                        {eligibleTechs.length === 0 && (
                            <div className="text-xs text-muted-foreground p-2">No hay técnicos con rol {slot.role}</div>
                        )}
                        {eligibleTechs.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectContent>
                </Select>
                {isTerceros && (
                    <Input
                        placeholder="Nombre agencia (tercero)"
                        value={agencia}
                        onChange={(e) => setAgencia(e.target.value)}
                        onBlur={() => onAssign({ technician_id: selectedTech === '__none__' ? null : selectedTech, agencia_nombre: agencia })}
                        className="h-8 text-xs"
                        data-testid={`slot-agencia-input-${slot.id}`}
                    />
                )}
            </div>

            <div className="flex gap-1 justify-end">
                {slot.status === 'pendiente' && (slot.technician_id || slot.agencia_nombre) && (
                    <Button size="sm" variant="outline" onClick={onStart} data-testid={`slot-start-${slot.id}`}>
                        <Play className="w-3 h-3 mr-1" /> Iniciar
                    </Button>
                )}
                {slot.status === 'en_proceso' && (
                    <Button size="sm" onClick={onComplete} className="bg-green-600 hover:bg-green-700" data-testid={`slot-complete-${slot.id}`}>
                        <Check className="w-3 h-3 mr-1" /> Completar
                    </Button>
                )}
                {slot.status === 'completado' && (
                    <span className="text-[11px] text-green-400 flex items-center gap-1">
                        <Check className="w-3 h-3" /> Completado
                    </span>
                )}
            </div>
        </div>
    );
};

// ================== Order Card ==================
const OrderCard = ({ order, technicians, onRefresh }) => {
    const [expanded, setExpanded] = useState(false);
    const pay = paymentInfo(order);
    const PayIcon = pay.icon;
    const slots = order.route_slots || [];
    const doneCount = slots.filter(s => s.status === 'completado').length;
    const totalCount = slots.length;

    const initRoute = async () => {
        try {
            const r = await orderRouteAPI.init(order.id);
            if (!r.data?.matched_rule) {
                toast.warning('No hay regla que coincida con los servicios. Configura una en Settings.');
            } else {
                toast.success(`Hoja de ruta creada: ${r.data.matched_rule}`);
            }
            setExpanded(true);
            onRefresh();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Error al crear hoja de ruta');
        }
    };

    const doAssign = async (slotId, data) => {
        try {
            await orderRouteAPI.assignSlot(order.id, slotId, data);
            onRefresh();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Error al asignar');
        }
    };
    const doStart = async (slotId) => {
        try {
            await orderRouteAPI.startSlot(order.id, slotId);
            toast.success('Slot iniciado');
            onRefresh();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Error');
        }
    };
    const doComplete = async (slotId) => {
        try {
            const r = await orderRouteAPI.completeSlot(order.id, slotId);
            toast.success(r.data?.all_done ? 'Servicio completado (todos los slots)' : 'Slot completado');
            onRefresh();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Error');
        }
    };

    return (
        <Card className="hover:border-cyan-500/40 transition-colors" data-testid={`order-card-${order.id}`}>
            <CardContent className="p-3 space-y-3">
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                    <button
                        onClick={() => setExpanded(v => !v)}
                        className="flex items-start gap-2 min-w-0 flex-1 text-left"
                    >
                        {expanded ? <ChevronDown className="w-4 h-4 mt-1 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 mt-1 text-muted-foreground" />}
                        <CarAvatar photoUrl={order.profile_photo_url} size={40} />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                                <PlateBadge plate={order.plate} size="md" />
                                <PostventaBadge order={order} />
                                <CheckinByTag order={order} />
                                <AccessoryStatusTag order={order} />
                                <OrderStatusBadge status={order.status} />
                                <span className={`text-[11px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${pay.color}`} data-testid={`payment-tag-${order.id}`}>
                                    <PayIcon className="w-3 h-3" />
                                    {pay.label}
                                </span>
                            </div>
                            <p className="text-sm truncate">{order.client_name}</p>
                            <p className="text-xs text-muted-foreground truncate">{order.brand} {order.model}</p>
                            <div className="flex flex-wrap gap-1 mt-1">
                                {(order.services || []).slice(0, 4).map((s, i) => (
                                    <ServiceBadge key={i} service={typeof s === 'string' ? s : s.service} />
                                ))}
                            </div>
                        </div>
                    </button>
                    <div className="text-right shrink-0">
                        {order.ingreso_at && (
                            <div className="text-[11px] text-muted-foreground flex items-center gap-1 justify-end">
                                <Clock className="w-3 h-3" />
                                <LiveTimer startTime={order.ingreso_at} />
                            </div>
                        )}
                        {totalCount > 0 && (
                            <p className={`text-[11px] font-mono ${doneCount === totalCount ? 'text-green-400' : 'text-cyan-400'}`}>
                                {doneCount}/{totalCount} slots
                            </p>
                        )}
                        <UpdateOrderButton order={order} onUpdated={onRefresh} className="mt-1 h-7 text-xs" />
                    </div>
                </div>

                {/* Expandido: hoja de ruta */}
                {expanded && (
                    <div className="pt-2 border-t border-border space-y-2">
                        {slots.length === 0 ? (
                            <div className="text-center py-4 space-y-2">
                                <p className="text-sm text-muted-foreground">Esta orden aún no tiene hoja de ruta generada.</p>
                                <Button size="sm" onClick={initRoute} data-testid={`init-route-${order.id}`}>
                                    <RouteIcon className="w-3 h-3 mr-1" /> Generar hoja de ruta
                                </Button>
                            </div>
                        ) : (
                            <>
                                {order.route_rule_name && (
                                    <p className="text-[11px] text-cyan-400 flex items-center gap-1">
                                        <RouteIcon className="w-3 h-3" />
                                        Regla: {order.route_rule_name}
                                    </p>
                                )}
                                <div className="space-y-1">
                                    {slots.map(s => (
                                        <SlotRow
                                            key={s.id}
                                            slot={s}
                                            technicians={technicians}
                                            onAssign={(d) => doAssign(s.id, d)}
                                            onStart={() => doStart(s.id)}
                                            onComplete={() => doComplete(s.id)}
                                        />
                                    ))}
                                </div>
                                <div className="flex justify-end">
                                    <Button size="sm" variant="ghost" onClick={initRoute} className="text-xs text-muted-foreground">
                                        Regenerar hoja de ruta
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

// ================== Página ==================
export const AutoAsignar = () => {
    const [orders, setOrders] = useState([]);
    const [technicians, setTechnicians] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchAll = useCallback(async () => {
        try {
            const [ordersRes, techRes] = await Promise.all([
                ordersAPI.getAll(),
                usersAPI.getTechnicians(),
            ]);
            // Filtrar órdenes en estados relevantes (en_revision → servicio_completado)
            const relevantStatus = ['en_revision', 'en_corte', 'corte_completado', 'asignado', 'en_proceso'];
            const filtered = (ordersRes.data || []).filter(o => relevantStatus.includes(o.status));
            setOrders(filtered);
            setTechnicians(techRes.data || []);
        } catch (err) {
            console.error(err);
            toast.error('Error cargando datos');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAll();
        const i = setInterval(fetchAll, 30000);
        return () => clearInterval(i);
    }, [fetchAll]);

    return (
        <div className="space-y-4" data-testid="auto-asignar-page">
            <div className="flex items-start justify-between gap-4 flex-col sm:flex-row">
                <div>
                    <h1 className="font-heading text-3xl md:text-4xl">Autos por Asignar</h1>
                    <p className="text-muted-foreground">
                        Hoja de ruta con múltiples técnicos por servicio.
                        Configura las reglas en <strong>Configuración › Reglas de Hoja de Ruta</strong>.
                    </p>
                </div>
                <Button variant="outline" onClick={fetchAll} data-testid="refresh-btn">
                    <RefreshCw className="w-4 h-4 mr-2" /> Refrescar
                </Button>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
            ) : orders.length === 0 ? (
                <Card>
                    <CardContent className="p-8 text-center text-muted-foreground">
                        No hay autos pendientes de asignación.
                    </CardContent>
                </Card>
            ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                    {orders.map(o => (
                        <OrderCard key={o.id} order={o} technicians={technicians} onRefresh={fetchAll} />
                    ))}
                </div>
            )}
        </div>
    );
};

export default AutoAsignar;
