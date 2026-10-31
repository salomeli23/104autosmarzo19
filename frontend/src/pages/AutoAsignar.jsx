import React, { useState, useEffect, useCallback } from 'react';
import { ordersAPI, usersAPI } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { OrderStatusBadge } from '../components/OrderStatusBadge';
import { ServiceBadge } from '../components/ServiceBadge';
import { PlateBadge } from '../components/PlateBadge';
import { CarAvatar } from '../components/CarAvatar';
import { LiveTimer } from '../components/LiveTimer';
import { toast } from 'sonner';
import { PostventaBadge } from '../components/PostventaBadge';
import { AccessoryStatusTag } from '../components/AccessoryStatusTag';
import { CheckinByTag } from '../components/CheckinByTag';
import { OrderTimers } from '../components/OrderTimers';
import { UpdateOrderButton } from '../components/UpdateOrderButton';
import { AssignTechniciansDialog } from '../components/AssignTechniciansDialog';
import { WorkflowSteps } from '../components/WorkflowSteps';
import { orderTechnicians } from '../lib/workflow';
import {
    Clock, RefreshCw, DollarSign, Wallet, AlertCircle, Wrench, UserPlus, Users, Scissors, Play,
} from 'lucide-react';

// Etiqueta de pago (paid / partial / pending)
const paymentInfo = (order) => {
    const total = order.final_value || order.negotiated_value || 0;
    const paid = order.amount_paid || 0;
    if (total <= 0) return { label: 'Sin monto', color: 'bg-muted text-muted-foreground', icon: AlertCircle };
    if (paid >= total - 0.01) return { label: 'Pagado', color: 'bg-green-500/20 text-green-400 border-green-500/40', icon: DollarSign };
    if (paid > 0) return { label: `Abono $${paid.toLocaleString()}`, color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40', icon: Wallet };
    return { label: 'Saldo pendiente', color: 'bg-red-500/20 text-red-400 border-red-500/40', icon: AlertCircle };
};

// Secciones del flujo: 360° → técnicos → corte → instalación
const SECTIONS = [
    { status: 'en_revision', title: 'Por asignar técnicos', icon: UserPlus, color: 'text-indigo-400' },
    { status: 'en_corte', title: 'En corte', icon: Scissors, color: 'text-pink-400' },
    { status: 'asignado', title: 'Por instalar', icon: Wrench, color: 'text-orange-400' },
    { status: 'en_proceso', title: 'En instalación', icon: Play, color: 'text-yellow-400' },
];

// ================== Order Card ==================
const OrderCard = ({ order, onAssign, onRefresh }) => {
    const pay = paymentInfo(order);
    const PayIcon = pay.icon;
    const techs = orderTechnicians(order);
    const canChangeTechs = ['en_revision', 'en_corte', 'asignado'].includes(order.status);

    return (
        <Card className="hover:border-cyan-500/40 transition-colors" data-testid={`order-card-${order.id}`}>
            <CardContent className="p-3 space-y-3">
                <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                        <CarAvatar photoUrl={order.profile_photo_url} size={40} />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                                <PlateBadge plate={order.plate} size="md" />
                                <PostventaBadge order={order} />
                                <OrderStatusBadge status={order.status} />
                                <span className={`text-[11px] px-2 py-0.5 rounded-full border flex items-center gap-1 ${pay.color}`} data-testid={`payment-tag-${order.id}`}>
                                    <PayIcon className="w-3 h-3" />
                                    {pay.label}
                                </span>
                            </div>
                            <p className="text-sm truncate">{order.client_name}</p>
                            <p className="text-xs text-muted-foreground truncate">{order.brand} {order.model}</p>
                            <div className="flex flex-wrap gap-1 mt-1">
                                <CheckinByTag order={order} />
                                <OrderTimers order={order} />
                                <AccessoryStatusTag order={order} />
                            </div>
                            <div className="flex flex-wrap gap-1 mt-1">
                                {(order.services || []).slice(0, 4).map((s, i) => (
                                    <ServiceBadge key={i} service={typeof s === 'string' ? s : s.service} />
                                ))}
                            </div>
                        </div>
                    </div>
                    <div className="text-right shrink-0">
                        {order.ingreso_at && (
                            <div className="text-[11px] text-muted-foreground flex items-center gap-1 justify-end">
                                <Clock className="w-3 h-3" />
                                <LiveTimer startTime={order.ingreso_at} />
                            </div>
                        )}
                        <UpdateOrderButton order={order} onUpdated={onRefresh} className="mt-1 h-7 text-xs" />
                    </div>
                </div>

                <WorkflowSteps order={order} />

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
                    <div className="text-xs min-w-0">
                        {techs.length === 0 ? (
                            <span className="text-orange-400 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Sin técnicos asignados</span>
                        ) : (
                            <span className="flex items-center gap-1 flex-wrap" data-testid={`order-techs-${order.id}`}>
                                <Users className="w-3.5 h-3.5 text-cyan-400" />
                                {techs.map(t => (
                                    <span key={t.id} className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300">
                                        {t.name} <span className="text-muted-foreground">· {t.role}</span>
                                    </span>
                                ))}
                            </span>
                        )}
                    </div>
                    {canChangeTechs && (
                        <Button
                            size="sm"
                            variant={techs.length === 0 ? 'default' : 'outline'}
                            className="h-8 text-xs shrink-0"
                            onClick={() => onAssign(order)}
                            data-testid={`assign-techs-btn-${order.id}`}
                        >
                            <UserPlus className="w-3.5 h-3.5 mr-1" />
                            {techs.length === 0 ? 'Asignar técnicos' : 'Cambiar'}
                        </Button>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};

// ================== Página ==================
export const AutoAsignar = () => {
    const [orders, setOrders] = useState([]);
    const [technicians, setTechnicians] = useState([]);
    const [loading, setLoading] = useState(true);
    const [assigning, setAssigning] = useState(null);

    const fetchAll = useCallback(async () => {
        try {
            const [ordersRes, techRes] = await Promise.all([
                ordersAPI.getAll(),
                usersAPI.getTechnicians(),
            ]);
            const relevant = SECTIONS.map(sec => sec.status);
            setOrders((ordersRes.data || []).filter(o => relevant.includes(o.status)));
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
        <div className="space-y-6" data-testid="auto-asignar-page">
            <div className="flex items-start justify-between gap-4 flex-col sm:flex-row">
                <div>
                    <h1 className="font-heading text-3xl md:text-4xl">Autos por Asignar</h1>
                    <p className="text-muted-foreground">
                        Asigna hasta 6 técnicos y el servicio de cada uno (Polarizado, PPF, Ultrasecure, Accesorios o Detailing). Con Polarizado, PPF o Ultrasecure el vehículo pasa a Corte y de Corte a Instalación.
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
            ) : (
                SECTIONS.map(sec => {
                    const list = orders.filter(o => o.status === sec.status);
                    const Icon = sec.icon;
                    return (
                        <section key={sec.status} className="space-y-2" data-testid={`section-${sec.status}`}>
                            <h2 className={`font-heading text-lg flex items-center gap-2 ${sec.color}`}>
                                <Icon className="w-5 h-5" />
                                {sec.title}
                                <span className="text-sm text-muted-foreground">({list.length})</span>
                            </h2>
                            {list.length === 0 ? (
                                <p className="text-sm text-muted-foreground">Sin vehículos.</p>
                            ) : (
                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                                    {list.map(o => (
                                        <OrderCard key={o.id} order={o} onAssign={setAssigning} onRefresh={fetchAll} />
                                    ))}
                                </div>
                            )}
                        </section>
                    );
                })
            )}

            <AssignTechniciansDialog
                order={assigning}
                technicians={technicians}
                onClose={() => setAssigning(null)}
                onAssigned={fetchAll}
            />
        </div>
    );
};

export default AutoAsignar;
