import React, { useState, useEffect } from 'react';
import { sedesAPI, carSeriesAPI, sedeAssignmentAPI, usersAPI, serviceExtrasAPI, serviceRoutesAPI, userRolesAPI } from '../lib/api';
import { VEHICLE_PARTS } from '../lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { toast } from 'sonner';
import { MapPin, Car, Plus, Trash2, Edit, Building, User as UserIcon, DollarSign, Route, Wrench } from 'lucide-react';

// =================== SEDES ===================
export const SedesSection = () => {
    const [sedes, setSedes] = useState([]);
    const [users, setUsers] = useState([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState({ nombre: '', direccion: '', telefono: '' });

    const fetchAll = async () => {
        try {
            const [sedesRes, usersRes] = await Promise.all([sedesAPI.list(), usersAPI.getAll()]);
            setSedes(sedesRes.data || []);
            setUsers(usersRes.data || []);
        } catch (err) {
            console.error(err);
        }
    };

    useEffect(() => { fetchAll(); }, []);

    const openNew = () => {
        setEditingId(null);
        setForm({ nombre: '', direccion: '', telefono: '' });
        setDialogOpen(true);
    };

    const openEdit = (s) => {
        setEditingId(s.id);
        setForm({ nombre: s.nombre, direccion: s.direccion || '', telefono: s.telefono || '' });
        setDialogOpen(true);
    };

    const handleSave = async () => {
        if (!form.nombre.trim()) {
            toast.error('Nombre requerido');
            return;
        }
        try {
            if (editingId) {
                await sedesAPI.update(editingId, form);
                toast.success('Sede actualizada');
            } else {
                await sedesAPI.create(form);
                toast.success('Sede creada');
            }
            setDialogOpen(false);
            fetchAll();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Error');
        }
    };

    const handleDelete = async (s) => {
        if (!window.confirm(`¿Eliminar sede ${s.nombre}?`)) return;
        try {
            await sedesAPI.delete(s.id);
            toast.success('Sede eliminada');
            fetchAll();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Error');
        }
    };

    const handleSetUserSede = async (userId, sedeId) => {
        try {
            await sedeAssignmentAPI.setUserSede(userId, sedeId || null);
            toast.success('Sede del usuario actualizada');
            fetchAll();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Error');
        }
    };

    return (
        <Card data-testid="sedes-section">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle className="font-heading flex items-center gap-2">
                        <Building className="w-5 h-5 text-cyan-400" />
                        Sedes / Sucursales
                    </CardTitle>
                    <Button size="sm" onClick={openNew} data-testid="new-sede-btn">
                        <Plus className="w-4 h-4 mr-1" /> Nueva Sede
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                {sedes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No hay sedes registradas.</p>
                ) : (
                    <div className="space-y-2">
                        {sedes.map(s => (
                            <div key={s.id} className="flex items-center justify-between p-3 rounded bg-muted/40" data-testid={`sede-row-${s.id}`}>
                                <div className="flex items-center gap-2">
                                    <MapPin className="w-4 h-4 text-cyan-400" />
                                    <div>
                                        <p className="font-medium">{s.nombre}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {s.direccion || '—'} {s.telefono ? `· ${s.telefono}` : ''}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex gap-1">
                                    <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>
                                        <Edit className="w-4 h-4" />
                                    </Button>
                                    <Button variant="ghost" size="sm" onClick={() => handleDelete(s)} className="text-red-500">
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Asignar sede a usuarios */}
                {sedes.length > 0 && users.length > 0 && (
                    <div className="pt-4 border-t border-border">
                        <p className="text-sm font-medium mb-2 flex items-center gap-1">
                            <UserIcon className="w-4 h-4" />
                            Asignar sede a usuarios
                        </p>
                        <div className="space-y-2 max-h-64 overflow-y-auto">
                            {users.map(u => (
                                <div key={u.id} className="flex items-center justify-between gap-2 p-2 rounded bg-muted/30" data-testid={`user-sede-row-${u.id}`}>
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium truncate">{u.name}</p>
                                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                                    </div>
                                    <Select value={u.sede_id || '__none__'} onValueChange={(v) => handleSetUserSede(u.id, v === '__none__' ? null : v)}>
                                        <SelectTrigger className="w-40 h-8 text-xs" data-testid={`user-sede-select-${u.id}`}>
                                            <SelectValue placeholder="(Sin sede)" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__none__">(Sin sede)</SelectItem>
                                            {sedes.map(s => <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </CardContent>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingId ? 'Editar' : 'Nueva'} Sede</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div>
                            <Label>Nombre *</Label>
                            <Input value={form.nombre} onChange={(e) => setForm(f => ({ ...f, nombre: e.target.value }))} data-testid="sede-nombre-input" />
                        </div>
                        <div>
                            <Label>Dirección</Label>
                            <Input value={form.direccion} onChange={(e) => setForm(f => ({ ...f, direccion: e.target.value }))} />
                        </div>
                        <div>
                            <Label>Teléfono</Label>
                            <Input value={form.telefono} onChange={(e) => setForm(f => ({ ...f, telefono: e.target.value }))} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                        <Button onClick={handleSave} data-testid="save-sede-btn">Guardar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
};

// =================== CAR SERIES ===================
export const CarSeriesSection = () => {
    const [series, setSeries] = useState([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState({
        brand: '', model: '', version: '',
        part_measurements: {},
        notes: '',
    });

    const fetchAll = async () => {
        try {
            const res = await carSeriesAPI.list();
            setSeries(res.data || []);
        } catch (err) {
            console.error(err);
        }
    };

    useEffect(() => { fetchAll(); }, []);

    const openNew = () => {
        setEditingId(null);
        setForm({ brand: '', model: '', version: '', part_measurements: {}, notes: '' });
        setDialogOpen(true);
    };

    const openEdit = (s) => {
        setEditingId(s.id);
        setForm({
            brand: s.brand,
            model: s.model,
            version: s.version || '',
            part_measurements: s.part_measurements || {},
            notes: s.notes || '',
        });
        setDialogOpen(true);
    };

    const handleSave = async () => {
        if (!form.brand.trim() || !form.model.trim()) {
            toast.error('Marca y modelo requeridos');
            return;
        }
        // Limpiar medidas vacías
        const cleanMeasures = {};
        Object.entries(form.part_measurements).forEach(([k, v]) => {
            const n = parseFloat(v);
            if (!isNaN(n) && n > 0) cleanMeasures[k] = n;
        });
        try {
            const payload = { ...form, part_measurements: cleanMeasures };
            if (editingId) {
                await carSeriesAPI.update(editingId, payload);
                toast.success('Serie actualizada');
            } else {
                await carSeriesAPI.create(payload);
                toast.success('Serie creada');
            }
            setDialogOpen(false);
            fetchAll();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Error');
        }
    };

    const handleDelete = async (s) => {
        if (!window.confirm(`¿Eliminar ${s.brand} ${s.model}?`)) return;
        try {
            await carSeriesAPI.delete(s.id);
            toast.success('Serie eliminada');
            fetchAll();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Error');
        }
    };

    return (
        <Card data-testid="car-series-section">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle className="font-heading flex items-center gap-2">
                        <Car className="w-5 h-5 text-yellow-400" />
                        Series de Autos (Consejo de Corte)
                    </CardTitle>
                    <Button size="sm" onClick={openNew} data-testid="new-car-series-btn">
                        <Plus className="w-4 h-4 mr-1" /> Nueva Serie
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-2">
                {series.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        No hay series cargadas. Agrega marca + modelo y las medidas por pieza para que el cortador las pueda auto-rellenar.
                    </p>
                ) : (
                    <div className="space-y-2">
                        {series.map(s => (
                            <div key={s.id} className="flex items-center justify-between p-3 rounded bg-muted/40" data-testid={`car-series-row-${s.id}`}>
                                <div>
                                    <p className="font-medium">
                                        {s.brand} {s.model} {s.version && <span className="text-muted-foreground">· {s.version}</span>}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {Object.keys(s.part_measurements || {}).length} medidas cargadas
                                    </p>
                                </div>
                                <div className="flex gap-1">
                                    <Button variant="ghost" size="sm" onClick={() => openEdit(s)}>
                                        <Edit className="w-4 h-4" />
                                    </Button>
                                    <Button variant="ghost" size="sm" onClick={() => handleDelete(s)} className="text-red-500">
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingId ? 'Editar' : 'Nueva'} Serie de Auto</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-2">
                            <div>
                                <Label>Marca *</Label>
                                <Input value={form.brand} onChange={(e) => setForm(f => ({ ...f, brand: e.target.value }))} data-testid="series-brand-input" />
                            </div>
                            <div>
                                <Label>Modelo *</Label>
                                <Input value={form.model} onChange={(e) => setForm(f => ({ ...f, model: e.target.value }))} data-testid="series-model-input" />
                            </div>
                            <div>
                                <Label>Versión</Label>
                                <Input value={form.version} onChange={(e) => setForm(f => ({ ...f, version: e.target.value }))} placeholder="2020, GT, etc." />
                            </div>
                        </div>
                        <div>
                            <Label>Medidas por pieza (cm, 1-350)</Label>
                            <div className="grid grid-cols-2 gap-2 mt-1">
                                {VEHICLE_PARTS.map(p => (
                                    <div key={p.id} className="flex items-center gap-2 p-2 rounded bg-muted/30">
                                        <Label className="text-xs flex-1">{p.label}</Label>
                                        <Input
                                            type="number"
                                            min={1} max={350}
                                            value={form.part_measurements[p.id] ?? ''}
                                            onChange={(e) => setForm(f => ({
                                                ...f,
                                                part_measurements: { ...f.part_measurements, [p.id]: e.target.value }
                                            }))}
                                            className="w-20 h-8 text-sm"
                                            data-testid={`series-measure-${p.id}`}
                                        />
                                        <span className="text-xs text-muted-foreground">cm</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div>
                            <Label>Notas</Label>
                            <Input value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                        <Button onClick={handleSave} data-testid="save-car-series-btn">Guardar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
};


// =================== SERVICE EXTRAS (Sunroof y otros) ===================
export const ServiceExtrasSection = () => {
    const [items, setItems] = useState([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState({ nombre: '', price: '', trigger_part: '', active: true });

    const fetchAll = async () => {
        try {
            const res = await serviceExtrasAPI.list();
            setItems(res.data || []);
        } catch (err) { console.error(err); }
    };

    useEffect(() => { fetchAll(); }, []);

    const openNew = () => {
        setEditingId(null);
        setForm({ nombre: '', price: '', trigger_part: '', active: true });
        setDialogOpen(true);
    };

    const openEdit = (it) => {
        setEditingId(it.id);
        setForm({ nombre: it.nombre, price: it.price, trigger_part: it.trigger_part || '', active: it.active });
        setDialogOpen(true);
    };

    const handleSave = async () => {
        if (!form.nombre.trim()) { toast.error('Nombre requerido'); return; }
        const price = parseFloat(form.price);
        if (isNaN(price) || price < 0) { toast.error('Precio inválido'); return; }
        try {
            const payload = { nombre: form.nombre, price, trigger_part: form.trigger_part || null, active: form.active };
            if (editingId) { await serviceExtrasAPI.update(editingId, payload); toast.success('Extra actualizado'); }
            else { await serviceExtrasAPI.create(payload); toast.success('Extra creado'); }
            setDialogOpen(false);
            fetchAll();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Error');
        }
    };

    const handleDelete = async (it) => {
        if (!window.confirm(`¿Eliminar extra "${it.nombre}"?`)) return;
        try {
            await serviceExtrasAPI.delete(it.id);
            toast.success('Extra eliminado');
            fetchAll();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Error');
        }
    };

    return (
        <Card data-testid="service-extras-section">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle className="font-heading flex items-center gap-2">
                        <DollarSign className="w-5 h-5 text-green-400" />
                        Extras de Servicio (Sunroof y otros)
                    </CardTitle>
                    <Button size="sm" onClick={openNew} data-testid="new-extra-btn">
                        <Plus className="w-4 h-4 mr-1" /> Nuevo Extra
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-2">
                {items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        No hay extras configurados. Ejemplo: "Sunroof adicional" con precio y trigger_part="sunroof".
                    </p>
                ) : (
                    <div className="space-y-2">
                        {items.map(it => (
                            <div key={it.id} className="flex items-center justify-between p-3 rounded bg-muted/40" data-testid={`extra-row-${it.id}`}>
                                <div>
                                    <p className="font-medium">
                                        {it.nombre}{' '}
                                        <span className="text-green-400 font-mono">${(it.price || 0).toLocaleString()}</span>
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {it.trigger_part ? `Se activa cuando se selecciona: ${it.trigger_part}` : 'Sin trigger automático'}
                                        {!it.active && ' · INACTIVO'}
                                    </p>
                                </div>
                                <div className="flex gap-1">
                                    <Button variant="ghost" size="sm" onClick={() => openEdit(it)}><Edit className="w-4 h-4" /></Button>
                                    <Button variant="ghost" size="sm" onClick={() => handleDelete(it)} className="text-red-500"><Trash2 className="w-4 h-4" /></Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingId ? 'Editar' : 'Nuevo'} Extra</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div>
                            <Label>Nombre *</Label>
                            <Input value={form.nombre} onChange={(e) => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Sunroof adicional" data-testid="extra-nombre-input" />
                        </div>
                        <div>
                            <Label>Precio (COP) *</Label>
                            <Input type="number" min={0} value={form.price} onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))} data-testid="extra-price-input" />
                        </div>
                        <div>
                            <Label>Activar automáticamente al seleccionar la parte:</Label>
                            <Select value={form.trigger_part || '__none__'} onValueChange={(v) => setForm(f => ({ ...f, trigger_part: v === '__none__' ? '' : v }))}>
                                <SelectTrigger data-testid="extra-trigger-select"><SelectValue placeholder="(Ninguna)" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">(Manual)</SelectItem>
                                    {VEHICLE_PARTS.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground mt-1">
                                Ej: escoger "sunroof" para que se sume automáticamente cuando el cliente lo pida.
                            </p>
                        </div>
                        <label className="flex items-center gap-2">
                            <input type="checkbox" checked={form.active} onChange={(e) => setForm(f => ({ ...f, active: e.target.checked }))} className="w-4 h-4" />
                            <span className="text-sm">Activo</span>
                        </label>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                        <Button onClick={handleSave} data-testid="save-extra-btn">Guardar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
};

// =================== SERVICE ROUTES (Hoja de Ruta - Reglas) ===================
const AVAILABLE_ROLES = [
    { value: 'corte', label: 'Corte' },
    { value: 'instalacion', label: 'Instalación' },
    { value: 'lavado', label: 'Lavado' },
    { value: 'ceramico', label: 'Cerámico' },
    { value: 'polarizado', label: 'Polarizado' },
    { value: 'ppf', label: 'PPF' },
    { value: 'accesorios', label: 'Accesorios' },
    { value: 'detailing', label: 'Detailing' },
    { value: 'latoneria_pintura', label: 'Latonería y Pintura (tercero)' },
];

export const ServiceRoutesSection = () => {
    const [rules, setRules] = useState([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [form, setForm] = useState({ nombre: '', service_triggers: '', slots: [], active: true });

    const fetchAll = async () => {
        try {
            const res = await serviceRoutesAPI.list();
            setRules(res.data || []);
        } catch (err) { console.error(err); }
    };
    useEffect(() => { fetchAll(); }, []);

    const openNew = () => {
        setEditingId(null);
        setForm({ nombre: '', service_triggers: '', slots: [{ role: 'polarizado', count: 1, label: '' }], active: true });
        setDialogOpen(true);
    };
    const openEdit = (r) => {
        setEditingId(r.id);
        setForm({
            nombre: r.nombre,
            service_triggers: (r.service_triggers || []).join(', '),
            slots: r.slots || [],
            active: r.active,
        });
        setDialogOpen(true);
    };

    const handleSave = async () => {
        if (!form.nombre.trim() || form.slots.length === 0) {
            toast.error('Nombre y al menos 1 slot requeridos');
            return;
        }
        const payload = {
            nombre: form.nombre.trim(),
            service_triggers: form.service_triggers.split(',').map(s => s.trim()).filter(Boolean),
            slots: form.slots.map(s => ({ role: s.role, count: parseInt(s.count) || 1, label: s.label || null })),
            active: form.active,
        };
        try {
            if (editingId) { await serviceRoutesAPI.update(editingId, payload); toast.success('Regla actualizada'); }
            else { await serviceRoutesAPI.create(payload); toast.success('Regla creada'); }
            setDialogOpen(false);
            fetchAll();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Error');
        }
    };

    const handleDelete = async (r) => {
        if (!window.confirm(`¿Eliminar regla "${r.nombre}"?`)) return;
        try {
            await serviceRoutesAPI.delete(r.id);
            toast.success('Regla eliminada');
            fetchAll();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Error');
        }
    };

    const addSlot = () => setForm(f => ({ ...f, slots: [...f.slots, { role: 'polarizado', count: 1, label: '' }] }));
    const removeSlot = (idx) => setForm(f => ({ ...f, slots: f.slots.filter((_, i) => i !== idx) }));
    const updateSlot = (idx, key, val) => setForm(f => ({ ...f, slots: f.slots.map((s, i) => i === idx ? { ...s, [key]: val } : s) }));

    return (
        <Card data-testid="service-routes-section">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle className="font-heading flex items-center gap-2">
                        <Route className="w-5 h-5 text-purple-400" />
                        Reglas de Hoja de Ruta
                    </CardTitle>
                    <Button size="sm" onClick={openNew} data-testid="new-route-btn"><Plus className="w-4 h-4 mr-1" /> Nueva Regla</Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-2">
                {rules.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        Crea reglas que determinen qué técnicos (por rol) se necesitan según la combinación de servicios.
                    </p>
                ) : (
                    rules.map(r => (
                        <div key={r.id} className="p-3 rounded bg-muted/40" data-testid={`route-row-${r.id}`}>
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium">
                                        {r.nombre} {!r.active && <span className="text-xs text-red-400">· INACTIVA</span>}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        Triggers: {(r.service_triggers || []).join(' + ') || '—'}
                                    </p>
                                    <p className="text-xs mt-1 flex flex-wrap gap-1">
                                        {(r.slots || []).map((s, i) => (
                                            <span key={i} className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 text-[11px]">
                                                {s.count}× {AVAILABLE_ROLES.find(x => x.value === s.role)?.label || s.role}
                                            </span>
                                        ))}
                                    </p>
                                </div>
                                <div className="flex gap-1">
                                    <Button variant="ghost" size="sm" onClick={() => openEdit(r)}><Edit className="w-4 h-4" /></Button>
                                    <Button variant="ghost" size="sm" onClick={() => handleDelete(r)} className="text-red-500"><Trash2 className="w-4 h-4" /></Button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </CardContent>

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{editingId ? 'Editar' : 'Nueva'} Regla</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div>
                            <Label>Nombre *</Label>
                            <Input value={form.nombre} onChange={(e) => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej: Detailing + Polarizado" data-testid="route-nombre-input" />
                        </div>
                        <div>
                            <Label>Servicios que disparan (separados por coma)</Label>
                            <Input value={form.service_triggers} onChange={(e) => setForm(f => ({ ...f, service_triggers: e.target.value }))} placeholder="detailing, polarizado" data-testid="route-triggers-input" />
                            <p className="text-xs text-muted-foreground mt-1">
                                Todos deben estar presentes (parcial, case-insensitive). Ej: "ppf, detailing"
                            </p>
                        </div>
                        <div>
                            <Label>Slots requeridos</Label>
                            <div className="space-y-2 mt-1">
                                {form.slots.map((s, idx) => (
                                    <div key={idx} className="flex items-center gap-2 p-2 rounded bg-muted/40">
                                        <Select value={s.role} onValueChange={(v) => updateSlot(idx, 'role', v)}>
                                            <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {AVAILABLE_ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                        <Input type="number" min={1} value={s.count} onChange={(e) => updateSlot(idx, 'count', e.target.value)} className="w-16 h-8 text-xs" />
                                        <Input placeholder="Etiqueta (opc)" value={s.label || ''} onChange={(e) => updateSlot(idx, 'label', e.target.value)} className="flex-1 h-8 text-xs" />
                                        <Button variant="ghost" size="sm" onClick={() => removeSlot(idx)} className="text-red-500"><Trash2 className="w-4 h-4" /></Button>
                                    </div>
                                ))}
                                <Button size="sm" variant="outline" onClick={addSlot}><Plus className="w-3 h-3 mr-1" /> Agregar slot</Button>
                            </div>
                        </div>
                        <label className="flex items-center gap-2">
                            <input type="checkbox" checked={form.active} onChange={(e) => setForm(f => ({ ...f, active: e.target.checked }))} className="w-4 h-4" />
                            <span className="text-sm">Activa</span>
                        </label>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
                        <Button onClick={handleSave} data-testid="save-route-btn">Guardar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
};


// =================== TÉCNICOS: ROLES ===================
export const TechnicianRolesSection = () => {
    const [techs, setTechs] = useState([]);

    const fetchAll = async () => {
        try {
            const res = await usersAPI.getTechnicians();
            setTechs(res.data || []);
        } catch (err) { console.error(err); }
    };
    useEffect(() => { fetchAll(); }, []);

    const toggleRole = async (tech, role) => {
        const current = new Set(tech.tecnico_roles || []);
        if (current.has(role)) current.delete(role);
        else current.add(role);
        const arr = Array.from(current);
        try {
            await userRolesAPI.setTecnicoRoles(tech.id, arr);
            setTechs(prev => prev.map(t => t.id === tech.id ? { ...t, tecnico_roles: arr } : t));
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Error');
        }
    };

    return (
        <Card data-testid="tecnico-roles-section">
            <CardHeader>
                <CardTitle className="font-heading flex items-center gap-2">
                    <Wrench className="w-5 h-5 text-orange-400" />
                    Roles funcionales de Técnicos
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
                {techs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No hay técnicos registrados.</p>
                ) : techs.map(t => (
                    <div key={t.id} className="p-3 rounded bg-muted/40" data-testid={`tecnico-row-${t.id}`}>
                        <p className="font-medium text-sm">{t.name}</p>
                        <p className="text-xs text-muted-foreground mb-2">{t.email}</p>
                        <div className="flex flex-wrap gap-1">
                            {AVAILABLE_ROLES.map(r => {
                                const active = (t.tecnico_roles || []).includes(r.value);
                                return (
                                    <button
                                        key={r.value}
                                        type="button"
                                        onClick={() => toggleRole(t, r.value)}
                                        className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                                            active ? 'bg-cyan-500/25 border-cyan-500/60 text-cyan-200' : 'border-input hover:border-cyan-500/40 text-muted-foreground'
                                        }`}
                                        data-testid={`tecnico-role-toggle-${t.id}-${r.value}`}
                                    >
                                        {r.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </CardContent>
        </Card>
    );
};

