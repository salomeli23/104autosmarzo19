import React, { useCallback, useEffect, useState } from 'react';
import { notificationsAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { PostventaBadge } from './PostventaBadge';
import { formatDateTime } from '../lib/utils';
import { toast } from 'sonner';
import { Bell, Mail, MessageCircle, UserCog, Search, RefreshCw, Loader2, Phone, CheckCircle2, XCircle } from 'lucide-react';

const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const phoneDigits = (v) => (v || '').replace(/\D/g, '');

const formatDay = (ymd) => {
    if (!ymd) return '';
    const [y, m, d] = ymd.split('-').map(Number);
    const txt = new Date(y, m - 1, d).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
    return txt.charAt(0).toUpperCase() + txt.slice(1);
};

const LastSent = ({ icon: Icon, label, at, to }) => (
    <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Icon className="w-3.5 h-3.5" />
        {at ? <>{label} {formatDateTime(at)}{to && <span className="truncate"> · {to}</span>}</> : <>{label}: nunca</>}
    </p>
);

/**
 * Agenda · Notificaciones: reenviar el correo o el WhatsApp de la cita y corregir el teléfono o correo del cliente.
 */
export const AppointmentNotifications = () => {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [busy, setBusy] = useState(null); // `${id}:email` | `${id}:whatsapp`
    const [editing, setEditing] = useState(null);
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [resendAfter, setResendAfter] = useState(true);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async (q) => {
        setLoading(true);
        try {
            const res = await notificationsAPI.appointments(q);
            setItems(res.data || []);
        } catch (e) {
            toast.error('Error al cargar las citas');
        } finally {
            setLoading(false);
        }
    }, []);

    // Carga inicial y búsqueda al dejar de escribir
    useEffect(() => {
        const t = setTimeout(() => load(query.trim()), 350);
        return () => clearTimeout(t);
    }, [query, load]);

    const sendEmail = async (order, to = order.client_email) => {
        if (!to) {
            toast.error('La cita no tiene correo. Agrégalo con "Editar contacto".');
            return false;
        }
        setBusy(`${order.id}:email`);
        try {
            const res = await notificationsAPI.send({ order_id: order.id, send_email: true, email: to });
            const r = res.data.results?.email;
            if (r?.success) {
                toast.success(`Correo de la cita enviado a ${to}`);
                load(query.trim());
                return true;
            }
            toast.error(r?.error || 'No se pudo enviar el correo');
            load(query.trim());
            return false;
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo enviar el correo');
            return false;
        } finally {
            setBusy(null);
        }
    };

    const sendWhatsApp = async (order, to = order.client_phone) => {
        if (!to) {
            toast.error('La cita no tiene teléfono. Agrégalo con "Editar contacto".');
            return;
        }
        // Abrir la ventana antes del await para que el navegador no la bloquee
        const win = window.open('', '_blank');
        setBusy(`${order.id}:whatsapp`);
        try {
            const res = await notificationsAPI.send({ order_id: order.id, send_whatsapp: true, phone: to });
            const r = res.data.results?.whatsapp;
            if (!r?.success) throw new Error(r?.error || 'No se pudo generar el mensaje');
            if (win) win.location.href = r.url;
            else window.location.href = r.url;
            load(query.trim());
        } catch (e) {
            if (win) win.close();
            toast.error(e.response?.data?.detail || e.message || 'No se pudo abrir WhatsApp');
        } finally {
            setBusy(null);
        }
    };

    const openEdit = (order) => {
        setEditing(order);
        setPhone(order.client_phone || '');
        setEmail(order.client_email || '');
        setResendAfter(true);
    };

    const saveContact = async () => {
        const newPhone = phone.trim();
        const newEmail = email.trim().toLowerCase();
        if (newPhone && !(phoneDigits(newPhone).length >= 7 && phoneDigits(newPhone).length <= 15)) {
            toast.error('Teléfono inválido');
            return;
        }
        if (newEmail && !isValidEmail(newEmail)) {
            toast.error('Correo inválido');
            return;
        }
        const payload = {};
        if (newPhone && newPhone !== (editing.client_phone || '')) payload.client_phone = newPhone;
        if (newEmail && newEmail !== (editing.client_email || '').toLowerCase()) payload.client_email = newEmail;
        if (Object.keys(payload).length === 0) {
            toast.info('No hay cambios');
            return;
        }
        setSaving(true);
        try {
            const res = await notificationsAPI.updateContact(editing.id, payload);
            const updated = res.data.order;
            toast.success('Contacto actualizado');
            setEditing(null);
            load(query.trim());
            if (resendAfter && payload.client_email) {
                await sendEmail(updated, updated.client_email);
            }
        } catch (e) {
            const d = e.response?.data?.detail;
            toast.error(typeof d === 'string' ? d : 'Revisa el teléfono y el correo');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Card className="card-hover" data-testid="appointment-notifications">
            <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <CardTitle className="font-heading text-lg flex items-center gap-2">
                        <Bell className="w-5 h-5 text-primary" />
                        Notificaciones de citas
                    </CardTitle>
                    <Button variant="outline" size="sm" onClick={() => load(query.trim())} disabled={loading}>
                        <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                        Actualizar
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    Reenvía el correo (con el QR) o el WhatsApp de la cita, o corrige el teléfono y el correo del cliente.
                </p>
                <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Buscar por código, placa, cliente, teléfono o correo"
                        className="pl-9"
                        data-testid="notif-search"
                    />
                </div>
                <p className="text-xs text-muted-foreground">
                    {query.trim() ? 'Resultados entre todas las citas agendadas.' : 'Citas agendadas de hoy en adelante.'}
                </p>

                {loading && items.length === 0 ? (
                    <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                ) : items.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No hay citas para mostrar.</p>
                ) : (
                    <div className="space-y-3">
                        {items.map(o => {
                            const lastLog = (o.notifications_log || []).slice(-1)[0];
                            return (
                                <div key={o.id} className="p-3 rounded-lg border bg-muted/30 space-y-3" data-testid={`notif-row-${o.order_code}`}>
                                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-heading text-lg">{o.plate}</span>
                                                <span className="font-mono text-xs text-muted-foreground">#{o.order_code}</span>
                                                <PostventaBadge order={o} />
                                            </div>
                                            <p className="text-sm">{o.client_name} · {o.brand} {o.model}</p>
                                            <p className="text-xs text-muted-foreground">{formatDay(o.date)} · {o.scheduled_time || 'Hora por confirmar'}</p>
                                        </div>
                                        <div className="text-sm space-y-0.5 sm:text-right min-w-0">
                                            <p className="flex sm:justify-end items-center gap-1">
                                                <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                                                {o.client_phone || <span className="text-amber-500">Sin teléfono</span>}
                                            </p>
                                            <p className="flex sm:justify-end items-center gap-1 break-all">
                                                <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                                {o.client_email || <span className="text-amber-500">Sin correo</span>}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="grid sm:grid-cols-2 gap-1">
                                        <LastSent icon={Mail} label="Correo enviado" at={o.last_email_at} to={o.last_email_to} />
                                        <LastSent icon={MessageCircle} label="WhatsApp abierto" at={o.last_whatsapp_at} to={o.last_whatsapp_to} />
                                    </div>
                                    {lastLog && !lastLog.success && (
                                        <p className="text-xs text-red-500 flex items-center gap-1">
                                            <XCircle className="w-3.5 h-3.5" /> Último envío falló: {lastLog.error || 'error desconocido'}
                                        </p>
                                    )}

                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            size="sm"
                                            className="bg-blue-600 hover:bg-blue-700 text-white"
                                            onClick={() => sendEmail(o)}
                                            disabled={busy === `${o.id}:email`}
                                            data-testid={`notif-email-${o.order_code}`}
                                        >
                                            {busy === `${o.id}:email` ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Mail className="w-4 h-4 mr-1" />}
                                            {o.last_email_at ? 'Reenviar correo' : 'Enviar correo'}
                                        </Button>
                                        <Button
                                            size="sm"
                                            className="bg-green-600 hover:bg-green-700 text-white"
                                            onClick={() => sendWhatsApp(o)}
                                            disabled={busy === `${o.id}:whatsapp`}
                                            data-testid={`notif-whatsapp-${o.order_code}`}
                                        >
                                            {busy === `${o.id}:whatsapp` ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <MessageCircle className="w-4 h-4 mr-1" />}
                                            WhatsApp
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={() => openEdit(o)} data-testid={`notif-edit-${o.order_code}`}>
                                            <UserCog className="w-4 h-4 mr-1" />
                                            Editar contacto
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </CardContent>

            <Dialog open={!!editing} onOpenChange={(v) => !saving && !v && setEditing(null)}>
                <DialogContent className="max-w-md" data-testid="notif-edit-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-heading text-xl">Editar contacto</DialogTitle>
                        <DialogDescription>{editing?.plate} · {editing?.client_name} · #{editing?.order_code}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-1">
                            <Label htmlFor="notif-phone">Teléfono (WhatsApp)</Label>
                            <Input id="notif-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="3001234567" data-testid="notif-edit-phone" />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="notif-email">Correo electrónico</Label>
                            <Input id="notif-email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cliente@correo.com" data-testid="notif-edit-email" />
                        </div>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input type="checkbox" checked={resendAfter} onChange={(e) => setResendAfter(e.target.checked)} className="w-4 h-4 accent-primary" />
                            Si cambia el correo, reenviar el correo de la cita
                        </label>
                        <div className="flex flex-col-reverse sm:flex-row gap-2">
                            <Button variant="outline" className="sm:flex-1" onClick={() => setEditing(null)} disabled={saving}>Cancelar</Button>
                            <Button className="sm:flex-1" onClick={saveContact} disabled={saving} data-testid="notif-edit-save">
                                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                                Guardar
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </Card>
    );
};

export default AppointmentNotifications;
