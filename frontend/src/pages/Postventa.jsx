import React, { useState, useEffect } from 'react';
import { ordersAPI, slotsAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Calendar } from '../components/ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { formatCurrency, ORDER_STATUS_LABELS } from '../lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import { Search, ShieldCheck, Car, History, CalendarIcon, Clock, AlertCircle, ArrowRight } from 'lucide-react';

const POSTVENTA_TYPES = [
    { value: 'garantia', label: 'Garantía', color: 'text-green-400' },
    { value: 'postventa', label: 'Postventa / Revisión', color: 'text-blue-400' },
];

export const Postventa = () => {
    const [plate, setPlate] = useState('');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [searchedPlate, setSearchedPlate] = useState('');

    // Dialog for new postventa appointment
    const [dialogOpen, setDialogOpen] = useState(false);
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [slotsAvailability, setSlotsAvailability] = useState(null);
    const [form, setForm] = useState({
        time_slot: '',
        postventa_type: 'garantia',
        postventa_motivo: '',
        confirmation_pin: '',
    });
    const [saving, setSaving] = useState(false);

    const handleSearch = async (e) => {
        e?.preventDefault();
        const p = plate.trim().toUpperCase();
        if (!p) {
            toast.error('Ingresa una placa');
            return;
        }
        try {
            setLoading(true);
            const res = await ordersAPI.historyByPlate(p);
            setResult(res.data);
            setSearchedPlate(p);
            if (!res.data?.orders || res.data.orders.length === 0) {
                toast.error(`No hay servicios anteriores para ${p}`);
            }
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Error al buscar placa');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!dialogOpen) return;
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        slotsAPI.getAvailability(dateStr)
            .then(r => setSlotsAvailability(r.data))
            .catch(() => setSlotsAvailability(null));
    }, [dialogOpen, selectedDate]);

    const openScheduleDialog = () => {
        setForm({
            time_slot: '',
            postventa_type: 'garantia',
            postventa_motivo: '',
            confirmation_pin: '',
        });
        setSelectedDate(new Date());
        setDialogOpen(true);
    };

    const handleSchedule = async () => {
        if (!result?.vehicle_data) return;
        if (!form.time_slot) { toast.error('Selecciona una franja'); return; }
        if (!form.postventa_motivo.trim()) { toast.error('Describe el motivo'); return; }
        if (!form.confirmation_pin) { toast.error('Ingresa el PIN de confirmación'); return; }
        try {
            setSaving(true);
            const v = result.vehicle_data;
            const lastOrder = result.orders?.[0];
            const payload = {
                client_name: v.client_name,
                client_phone: v.client_phone,
                client_email: v.client_email || null,
                client_cedula: v.client_cedula || null,
                plate: result.plate,
                brand: v.brand,
                model: v.model,
                year: v.year,
                color: v.color,
                date: format(selectedDate, 'yyyy-MM-dd'),
                time_slot: form.time_slot,
                services: [{
                    service: form.postventa_type === 'garantia' ? 'garantia' : 'postventa',
                    description: `${form.postventa_type === 'garantia' ? 'Garantía' : 'Postventa'} - ${form.postventa_motivo}`,
                    price: 0,
                }],
                negotiated_value: 0,
                notes: form.postventa_motivo,
                confirmation_pin: form.confirmation_pin.trim(),
                is_postventa: true,
                postventa_type: form.postventa_type,
                postventa_motivo: form.postventa_motivo.trim(),
                original_order_id: lastOrder?.id || null,
            };
            const res = await ordersAPI.create(payload);
            toast.success(`${form.postventa_type === 'garantia' ? 'Garantía' : 'Postventa'} agendada: ${res.data.order_code} - ${res.data.scheduled_time}`);
            setDialogOpen(false);
            // Refresh results
            handleSearch();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Error al agendar');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-6" data-testid="postventa-page">
            <div>
                <h1 className="font-heading text-3xl md:text-4xl flex items-center gap-2">
                    <ShieldCheck className="w-8 h-8 text-primary" />
                    Postventa / Garantías
                </h1>
                <p className="text-muted-foreground">Agenda servicios de garantía o postventa para vehículos con historial</p>
            </div>

            {/* Search */}
            <Card>
                <CardHeader>
                    <CardTitle className="font-heading text-xl flex items-center gap-2">
                        <Search className="w-5 h-5 text-cyan-400" />
                        Buscar Vehículo por Placa
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
                        <Input
                            value={plate}
                            onChange={(e) => setPlate(e.target.value.toUpperCase())}
                            placeholder="Ej: ABC123"
                            className="flex-1 font-mono text-lg"
                            data-testid="postventa-plate-input"
                        />
                        <Button type="submit" disabled={loading} data-testid="postventa-search-btn">
                            <Search className="w-4 h-4 mr-2" />
                            {loading ? 'Buscando...' : 'Buscar Historial'}
                        </Button>
                    </form>
                </CardContent>
            </Card>

            {/* Results */}
            {result && (
                <Card className={result.orders?.length > 0 ? 'border-green-500/30' : 'border-yellow-500/30'}>
                    <CardHeader>
                        <CardTitle className="font-heading text-xl flex items-center gap-2">
                            <Car className="w-5 h-5 text-primary" />
                            {result.plate}
                            {result.orders?.length > 0 && (
                                <span className="text-sm font-normal text-muted-foreground ml-2">
                                    ({result.orders.length} servicio(s) anterior(es))
                                </span>
                            )}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {result.orders?.length === 0 ? (
                            <div className="text-center py-6">
                                <AlertCircle className="w-12 h-12 mx-auto text-yellow-500 mb-2" />
                                <p className="text-muted-foreground">No hay servicios anteriores para esta placa.</p>
                                <p className="text-sm text-muted-foreground mt-1">Solo se puede agendar postventa para vehículos con historial.</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {/* Client data summary */}
                                {result.vehicle_data && (
                                    <div className="p-4 rounded-lg bg-muted/40 grid sm:grid-cols-2 gap-2 text-sm">
                                        <div><span className="text-muted-foreground">Cliente:</span> <span className="font-medium">{result.vehicle_data.client_name}</span></div>
                                        <div><span className="text-muted-foreground">Teléfono:</span> <span className="font-medium">{result.vehicle_data.client_phone}</span></div>
                                        <div><span className="text-muted-foreground">Vehículo:</span> <span className="font-medium">{result.vehicle_data.brand} {result.vehicle_data.model}</span></div>
                                        {result.vehicle_data.client_email && <div><span className="text-muted-foreground">Email:</span> <span>{result.vehicle_data.client_email}</span></div>}
                                    </div>
                                )}

                                {/* History list */}
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                        <History className="w-4 h-4" />
                                        Historial de servicios
                                    </div>
                                    <div className="divide-y divide-border rounded-lg border">
                                        {result.orders.map((o) => (
                                            <div key={o.id} className="p-3 flex items-center justify-between gap-3" data-testid={`history-row-${o.order_code}`}>
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="font-mono text-xs text-muted-foreground">{o.order_code}</span>
                                                        <span className="text-sm font-medium">{o.date} · {o.scheduled_time || '--:--'}</span>
                                                        {o.is_postventa && (
                                                            <span className="px-2 py-0.5 rounded-full text-xs bg-green-500/20 text-green-400">
                                                                {o.postventa_type === 'garantia' ? 'Garantía' : 'Postventa'}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-muted-foreground truncate">
                                                        {o.services?.map(s => s.description).join(', ') || '—'}
                                                    </p>
                                                </div>
                                                <div className="flex flex-col items-end gap-1">
                                                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                                                        {ORDER_STATUS_LABELS[o.status] || o.status}
                                                    </span>
                                                    {!o.is_postventa && o.final_value > 0 && (
                                                        <span className="text-xs text-muted-foreground">{formatCurrency(o.final_value)}</span>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <Button
                                    onClick={openScheduleDialog}
                                    className="w-full brand-glow"
                                    data-testid="schedule-postventa-btn"
                                >
                                    <ShieldCheck className="w-4 h-4 mr-2" />
                                    Agendar Postventa / Garantía
                                    <ArrowRight className="w-4 h-4 ml-2" />
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Schedule Postventa Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <ShieldCheck className="w-5 h-5 text-primary" />
                            Agendar Postventa / Garantía
                        </DialogTitle>
                        <DialogDescription>
                            {result?.plate} · {result?.vehicle_data?.brand} {result?.vehicle_data?.model} · {result?.vehicle_data?.client_name}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label>Tipo de cita *</Label>
                                <Select value={form.postventa_type} onValueChange={(v) => setForm(f => ({ ...f, postventa_type: v }))}>
                                    <SelectTrigger data-testid="postventa-type-select"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {POSTVENTA_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1">
                                <Label>Fecha *</Label>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" className="w-full justify-start" data-testid="postventa-date-btn">
                                            <CalendarIcon className="w-4 h-4 mr-2" />
                                            {format(selectedDate, "d 'de' MMM, yyyy", { locale: es })}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent>
                                        <Calendar
                                            mode="single"
                                            selected={selectedDate}
                                            onSelect={(d) => d && setSelectedDate(d)}
                                            disabled={(d) => d < new Date(new Date().setHours(0,0,0,0))}
                                        />
                                    </PopoverContent>
                                </Popover>
                            </div>
                        </div>

                        <div className="space-y-1">
                            <Label>Motivo *</Label>
                            <textarea
                                className="w-full min-h-[70px] px-3 py-2 rounded-md border border-input bg-background text-sm"
                                value={form.postventa_motivo}
                                onChange={(e) => setForm(f => ({ ...f, postventa_motivo: e.target.value }))}
                                placeholder="Describe el motivo (ej: burbuja en panorámico, despegue en lateral, etc.)"
                                data-testid="postventa-motivo-input"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label className="flex items-center gap-2">
                                <Clock className="w-4 h-4" />
                                Franja Horaria *
                            </Label>
                            {!slotsAvailability ? (
                                <p className="text-sm text-muted-foreground">Cargando franjas...</p>
                            ) : !slotsAvailability.is_open ? (
                                <p className="text-sm text-yellow-500">No hay servicio en esta fecha</p>
                            ) : (
                                <div className="grid sm:grid-cols-3 gap-2">
                                    {(slotsAvailability.slots || []).map((slot) => {
                                        const disabled = !slot.available;
                                        const isSel = form.time_slot === slot.id;
                                        return (
                                            <button
                                                key={slot.id}
                                                type="button"
                                                disabled={disabled}
                                                onClick={() => setForm(f => ({ ...f, time_slot: slot.id }))}
                                                className={`p-2 rounded-lg border text-sm ${isSel ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40'} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                data-testid={`postventa-slot-${slot.id}`}
                                            >
                                                <p className="font-medium">{slot.name || slot.id}</p>
                                                <p className="text-xs text-muted-foreground">{slot.start} - {slot.end}</p>
                                                <p className="text-xs">{slot.current}/{slot.capacity}</p>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="space-y-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
                            <Label className="flex items-center gap-2 text-amber-400">
                                <AlertCircle className="w-4 h-4" />
                                PIN de Confirmación *
                            </Label>
                            <Input
                                type="password"
                                inputMode="numeric"
                                maxLength={10}
                                value={form.confirmation_pin}
                                onChange={(e) => setForm(f => ({ ...f, confirmation_pin: e.target.value.replace(/\D/g, '') }))}
                                placeholder="PIN para agendar"
                                data-testid="postventa-pin-input"
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancelar</Button>
                        <Button onClick={handleSchedule} disabled={saving} className="brand-glow" data-testid="postventa-confirm-btn">
                            {saving ? 'Agendando...' : 'Agendar Postventa'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default Postventa;
