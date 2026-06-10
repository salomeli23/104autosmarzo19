import React, { useState, useEffect } from 'react';
import { sedesAPI, carSeriesAPI, sedeAssignmentAPI, usersAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { toast } from 'sonner';
import { MapPin, Car, Plus, Trash2, Edit, Building, User as UserIcon } from 'lucide-react';

const VEHICLE_PARTS = [
    { id: 'panoramico', label: 'Panorámico' },
    { id: 'vidrio_copiloto', label: 'Vidrio Copiloto' },
    { id: 'vidrio_piloto', label: 'Vidrio Piloto' },
    { id: 'vidrio_trasero', label: 'Vidrio Trasero' },
    { id: 'vidrio_trasero_copiloto', label: 'Vidrio Trasero Copiloto' },
    { id: 'trasero', label: 'Trasero' },
    { id: 'capo', label: 'Capó' },
    { id: 'techo', label: 'Techo' },
    { id: 'estriberas', label: 'Estriberas' },
    { id: 'paragolpe', label: 'Paragolpe' },
];

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
