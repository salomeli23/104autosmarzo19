import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { dashboardAPI, ordersAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { StatusBadge } from '../components/StatusBadge';
import { ServiceBadge } from '../components/ServiceBadge';
import { formatDateTime } from '../lib/utils';
import { PostventaBadge } from '../components/PostventaBadge';
import { 
    Calendar, 
    Car, 
    Clock, 
    CheckCircle2, 
    AlertCircle,
    TrendingUp,
    Wrench,
    FileText
} from 'lucide-react';

export const Dashboard = () => {
    const { user } = useAuth();
    const [stats, setStats] = useState(null);
    const [recentOrders, setRecentOrders] = useState([]);
    const [todayAppointments, setTodayAppointments] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const today = new Date().toISOString().split('T')[0];
                const [statsRes, ordersRes] = await Promise.all([
                    dashboardAPI.getStats(),
                    ordersAPI.getAll({ date: today }),
                ]);
                setStats(statsRes.data);
                setRecentOrders(ordersRes.data.slice(0, 5));
                setTodayAppointments(ordersRes.data);
            } catch (error) {
                console.error('Error fetching dashboard data:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
        );
    }

    const statCards = [
        {
            title: 'Citas Hoy',
            value: stats?.citas_hoy || 0,
            icon: Calendar,
            color: 'text-blue-500',
            bg: 'bg-blue-500/10',
        },
        {
            title: 'En Proceso',
            value: stats?.en_proceso || 0,
            icon: Clock,
            color: 'text-yellow-500',
            bg: 'bg-yellow-500/10',
        },
        {
            title: 'Completados Hoy',
            value: stats?.entregados_hoy || 0,
            icon: CheckCircle2,
            color: 'text-green-500',
            bg: 'bg-green-500/10',
        },
        {
            title: 'Agendados',
            value: stats?.agendados || 0,
            icon: TrendingUp,
            color: 'text-primary',
            bg: 'bg-primary/10',
        },
    ];

    return (
        <div className="space-y-8" data-testid="dashboard">
            {/* Welcome */}
            <div>
                <h1 className="font-heading text-3xl md:text-4xl mb-2">
                    ¡Hola, {user?.name?.split(' ')[0]}!
                </h1>
                <p className="text-muted-foreground">
                    Aquí tienes el resumen de hoy
                </p>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
                {statCards.map((stat, index) => {
                    const Icon = stat.icon;
                    return (
                        <Card key={index} className="card-hover" data-testid={`stat-card-${index}`}>
                            <CardContent className="p-4 md:p-6">
                                <div className="flex items-center justify-between mb-3">
                                    <div className={`p-2 rounded-lg ${stat.bg}`}>
                                        <Icon className={`w-5 h-5 ${stat.color}`} />
                                    </div>
                                </div>
                                <p className="font-heading text-2xl md:text-3xl">{stat.value}</p>
                                <p className="text-sm text-muted-foreground">{stat.title}</p>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            {/* Main content grid */}
            <div className="grid lg:grid-cols-2 gap-6">
                {/* Today's Appointments */}
                <Card className="card-hover">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="font-heading text-xl flex items-center gap-2">
                            <Calendar className="w-5 h-5 text-primary" />
                            Citas de Hoy
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {todayAppointments.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                                <Calendar className="w-12 h-12 mb-2 opacity-50" />
                                <p>No hay citas programadas para hoy</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {todayAppointments.map((appointment) => (
                                    <div 
                                        key={appointment.id}
                                        className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                                        data-testid={`appointment-${appointment.id}`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                                                <Car className="w-5 h-5 text-primary" />
                                            </div>
                                            <div>
                                                <p className="font-medium">{appointment.client_name}</p>
                                                <p className="text-sm text-muted-foreground font-mono">
                                                    {appointment.plate || 'Sin placa'}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-medium">{appointment.time_slot}</p>
                                            <div className="flex gap-1 mt-1">
                                                {(appointment.services || []).slice(0, 2).map((s, idx) => (
                                                    <ServiceBadge key={idx} service={s.service || s} />
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Recent Orders */}
                <Card className="card-hover">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="font-heading text-xl flex items-center gap-2">
                            <Wrench className="w-5 h-5 text-primary" />
                            Órdenes Recientes
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {recentOrders.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                                <FileText className="w-12 h-12 mb-2 opacity-50" />
                                <p>No hay órdenes recientes</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {recentOrders.map((order) => (
                                    <div 
                                        key={order.id}
                                        className={`flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors ${order.status === 'en_proceso' ? 'tracing-beam' : ''}`}
                                        data-testid={`order-${order.id}`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                                                <Wrench className="w-5 h-5 text-primary" />
                                            </div>
                                            <div>
                                                <p className="font-medium font-mono text-sm">
                                                    #{order.order_code || order.id.slice(0, 8).toUpperCase()}
                                                </p>
                                                <p className="text-sm text-muted-foreground">
                                                    {order.plate || 'Sin placa'} - {order.brand}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <PostventaBadge order={order} />
                                            <StatusBadge status={order.status} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Status Overview */}
            <Card className="card-hover">
                <CardHeader>
                    <CardTitle className="font-heading text-xl flex items-center gap-2">
                        <TrendingUp className="w-5 h-5 text-primary" />
                        Estado de Órdenes
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {[
                            { status: 'agendado', label: 'Agendado', count: stats?.agendados || 0 },
                            { status: 'en_proceso', label: 'En Proceso', count: stats?.en_proceso || 0 },
                            { status: 'en_revision', label: 'Técnico por Asignar', count: stats?.en_revision || 0 },
                            { status: 'terminado_pagado', label: 'Terminado', count: stats?.terminado_pagado || 0 },
                        ].map((item) => (
                            <div 
                                key={item.status}
                                className="flex flex-col items-center p-4 rounded-lg bg-muted/50"
                                data-testid={`status-count-${item.status}`}
                            >
                                <StatusBadge status={item.status} className="mb-2" />
                                <p className="font-heading text-2xl">{item.count}</p>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};
