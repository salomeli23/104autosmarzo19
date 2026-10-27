import React, { useState, useEffect, useCallback } from 'react';
import { paymentsAPI } from '../lib/api';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { PlateBadge } from '../components/PlateBadge';
import { CarAvatar } from '../components/CarAvatar';
import { formatCurrency } from '../lib/utils';
import { toast } from 'sonner';
import { CheckCircle, AlertTriangle, LogOut, Loader2, Clock, DollarSign } from 'lucide-react';
import { PostventaBadge } from '../components/PostventaBadge';

export const AutosSalida = () => {
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [authorizing, setAuthorizing] = useState(null);

    const load = useCallback(async () => {
        try {
            const res = await paymentsAPI.pendingRelease();
            setOrders(res.data);
        } catch (e) {
            toast.error('Error al cargar autos por autorizar salida');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
        const t = setInterval(load, 30000);
        return () => clearInterval(t);
    }, [load]);

    const authorize = async (o) => {
        setAuthorizing(o.id);
        try {
            await paymentsAPI.authorizeRelease(o.id);
            toast.success('Salida autorizada');
            load();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Error al autorizar salida');
        } finally {
            setAuthorizing(null);
        }
    };

    const pending = orders.filter((o) => !o.release_authorized_at);
    const authorized = orders.filter((o) => o.release_authorized_at);

    const renderCard = (o) => {
        const hasBalance = o.balance > 0.01;
        const isAuth = !!o.release_authorized_at;
        return (
            <Card
                key={o.id}
                className={`card-hover ${hasBalance ? 'border-red-500/40' : isAuth ? 'border-green-500/40' : 'border-cyan-500/40'}`}
                data-testid={`salida-row-${o.id}`}
            >
                <CardContent className="p-4 flex flex-col md:flex-row gap-3 items-start md:items-center">
                    <CarAvatar photoUrl={o.profile_photo_url} size={44} />
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <PlateBadge plate={o.plate} size="md" />
                            <PostventaBadge order={o} />
                            {hasBalance && (
                                <Badge className="bg-red-500/20 text-red-500 border-red-500/40" data-testid={`falta-pago-${o.id}`}>
                                    <AlertTriangle className="w-3 h-3 mr-1" /> Falta por pago
                                </Badge>
                            )}
                            {!hasBalance && !isAuth && (
                                <Badge className="bg-cyan-500/20 text-cyan-500 border-cyan-500/40">
                                    Listo para autorizar
                                </Badge>
                            )}
                            {isAuth && (
                                <Badge className="bg-green-500/20 text-green-500 border-green-500/40">
                                    <CheckCircle className="w-3 h-3 mr-1" /> Autorizado
                                </Badge>
                            )}
                        </div>
                        <p className="text-sm mt-1 truncate">{o.brand} {o.model} · {o.client_name}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Clock className="w-3 h-3" />
                            Servicio completado: {o.service_completed_at ? new Date(o.service_completed_at).toLocaleString() : '-'}
                        </p>
                        {isAuth && (
                            <p className="text-xs text-green-500 mt-0.5">
                                Autorizado por: {o.release_authorized_by || '-'} · {new Date(o.release_authorized_at).toLocaleString()}
                            </p>
                        )}
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-right text-sm">
                        <div>
                            <p className="text-[10px] uppercase text-muted-foreground">Total</p>
                            <p className="font-mono">{formatCurrency(o.total)}</p>
                        </div>
                        <div>
                            <p className="text-[10px] uppercase text-muted-foreground">Abonado</p>
                            <p className="font-mono text-green-500">{formatCurrency(o.paid)}</p>
                        </div>
                        <div>
                            <p className="text-[10px] uppercase text-muted-foreground">Saldo</p>
                            <p className={`font-mono font-bold ${hasBalance ? 'text-red-500' : 'text-green-500'}`}>
                                {formatCurrency(o.balance)}
                            </p>
                        </div>
                    </div>
                    {!isAuth && (
                        <Button
                            onClick={() => authorize(o)}
                            disabled={hasBalance || authorizing === o.id}
                            data-testid={`authorize-btn-${o.id}`}
                        >
                            {hasBalance ? (
                                <><DollarSign className="w-4 h-4 mr-2" /> Bloqueado por saldo</>
                            ) : authorizing === o.id ? (
                                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Autorizando...</>
                            ) : (
                                <><LogOut className="w-4 h-4 mr-2" /> Autorizar salida</>
                            )}
                        </Button>
                    )}
                </CardContent>
            </Card>
        );
    };

    return (
        <div className="space-y-6" data-testid="autos-salida-page">
            <div>
                <h1 className="font-heading text-3xl md:text-4xl">Autos por Autorizar Salida</h1>
                <p className="text-muted-foreground">
                    Vehículos con servicio completado. La autorización queda bloqueada hasta que el saldo sea $0.
                </p>
            </div>

            {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin" /></div>
            ) : (
                <>
                    <div>
                        <h2 className="font-heading text-xl mb-3 flex items-center gap-2">
                            Pendientes <Badge variant="outline">{pending.length}</Badge>
                        </h2>
                        {pending.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Sin vehículos pendientes de autorizar.</p>
                        ) : (
                            <div className="grid gap-3">{pending.map(renderCard)}</div>
                        )}
                    </div>

                    {authorized.length > 0 && (
                        <div>
                            <h2 className="font-heading text-xl mb-3 flex items-center gap-2">
                                Ya autorizados <Badge variant="outline">{authorized.length}</Badge>
                            </h2>
                            <div className="grid gap-3">{authorized.map(renderCard)}</div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export default AutosSalida;
