import React, { useState, useEffect, useCallback } from 'react';
import { inventoryAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { formatCurrency, SERVICE_LABELS } from '../lib/utils';
import { toast } from 'sonner';
import { Package, AlertTriangle, Plus, Trash2, Boxes, Wrench, Layers, Edit, Tag } from 'lucide-react';

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

const CATEGORIES = [
    { value: 'polarizado', label: 'Polarizado' },
    { value: 'ultrasecure', label: 'Ultrasecure' },
    { value: 'ppf', label: 'PPF' },
    { value: 'accesorio', label: 'Accesorio' },
    { value: 'material', label: 'Material' },
];

const SERVICE_OPTIONS = Object.entries(SERVICE_LABELS || {}).map(([v, l]) => ({ value: v, label: l }));

const severityClass = (s) => s === 'critical' ? 'border-red-500 bg-red-500/10' : s === 'high' ? 'border-orange-500 bg-orange-500/10' : 'border-yellow-500 bg-yellow-500/10';
const severityTextClass = (s) => s === 'critical' ? 'text-red-400' : s === 'high' ? 'text-orange-400' : 'text-yellow-400';

export const Inventory = () => {
    const [items, setItems] = useState([]);
    const [alerts, setAlerts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterCategoria, setFilterCategoria] = useState('all');
    const [dialogOpen, setDialogOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editingId, setEditingId] = useState(null);

    const emptyForm = {
        nombre: '',
        categoria: 'polarizado',
        tipo_articulo: 'rollo',
        tipo_rollo: 'spectra',
        factura_compra: '',
        metros_iniciales: '',
        cantidad_inicial: '',
        costo: '',
        linked_service: '',
        notes: '',
    };
    const [form, setForm] = useState(emptyForm);

    const fetchAll = useCallback(async () => {
        try {
            setLoading(true);
            const [itemsRes, alertsRes] = await Promise.all([
                inventoryAPI.list(),
                inventoryAPI.alerts(),
            ]);
            setItems(itemsRes.data || []);
            setAlerts(alertsRes.data?.alerts || []);
        } catch (e) {
            console.error(e);
            toast.error('Error cargando inventario');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    const openNew = () => {
        setEditingId(null);
        setForm(emptyForm);
        setDialogOpen(true);
    };

    const openEdit = (item) => {
        setEditingId(item.id);
        setForm({
            nombre: item.nombre || '',
            categoria: item.categoria || 'polarizado',
            tipo_articulo: item.tipo_articulo || 'rollo',
            tipo_rollo: item.tipo_rollo || '',
            factura_compra: item.factura_compra || '',
            metros_iniciales: item.metros_iniciales ?? '',
            cantidad_inicial: item.cantidad_inicial ?? '',
            costo: item.costo ?? '',
            linked_service: item.linked_service || '',
            notes: item.notes || '',
        });
        setDialogOpen(true);
    };

    const handleSave = async () => {
        if (!form.nombre.trim()) {
            toast.error('El nombre es requerido');
            return;
        }
        try {
            setSaving(true);
            if (editingId) {
                // Only allow updating common fields
                await inventoryAPI.update(editingId, {
                    nombre: form.nombre,
                    factura_compra: form.factura_compra || null,
                    costo: form.costo ? parseFloat(form.costo) : null,
                    linked_service: form.linked_service || null,
                    notes: form.notes || null,
                });
                toast.success('Artículo actualizado');
            } else {
                const payload = {
                    nombre: form.nombre,
                    categoria: form.categoria,
                    tipo_articulo: form.tipo_articulo,
                    tipo_rollo: form.tipo_articulo === 'rollo' ? form.tipo_rollo : null,
                    factura_compra: form.factura_compra || null,
                    metros_iniciales: form.tipo_articulo === 'rollo' ? parseFloat(form.metros_iniciales || 0) : null,
                    cantidad_inicial: form.tipo_articulo === 'cantidad' ? parseInt(form.cantidad_inicial || 0, 10) : null,
                    costo: parseFloat(form.costo || 0),
                    linked_service: form.linked_service || null,
                    notes: form.notes || null,
                };
                await inventoryAPI.create(payload);
                toast.success('Artículo registrado');
            }
            setDialogOpen(false);
            fetchAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'Error al guardar');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (item) => {
        if (!window.confirm(`¿Eliminar ${item.nombre}?`)) return;
        try {
            await inventoryAPI.delete(item.id);
            toast.success('Artículo eliminado');
            fetchAll();
        } catch {
            toast.error('Error al eliminar');
        }
    };

    const filteredItems = items.filter(i => filterCategoria === 'all' || i.categoria === filterCategoria);
    const rollos = filteredItems.filter(i => i.tipo_articulo === 'rollo');
    const otros = filteredItems.filter(i => i.tipo_articulo !== 'rollo');

    return (
        <div className="space-y-6" data-testid="inventory-page">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                    <h1 className="font-heading text-3xl md:text-4xl flex items-center gap-2">
                        <Boxes className="w-8 h-8 text-primary" />
                        Inventario
                    </h1>
                    <p className="text-muted-foreground">Gestión de rollos, accesorios y materiales</p>
                </div>
                <Button onClick={openNew} data-testid="new-inventory-btn">
                    <Plus className="w-4 h-4 mr-2" /> Nuevo Artículo
                </Button>
            </div>

            {/* Alerts */}
            {alerts.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="font-heading text-xl flex items-center gap-2">
                            <AlertTriangle className="w-5 h-5 text-amber-500" />
                            Alertas de Bajo Stock
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {alerts.map(a => (
                                <div key={a.tipo_rollo} className={`p-3 rounded-lg border ${severityClass(a.severity)}`} data-testid={`alert-${a.tipo_rollo}`}>
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <p className="font-medium">{a.label}</p>
                                            <p className={`text-2xl font-mono font-bold ${severityTextClass(a.severity)}`}>{a.current_count}</p>
                                            <p className="text-xs text-muted-foreground">/ {a.threshold} rollos</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs text-muted-foreground">Restante</p>
                                            <p className="text-sm font-mono">{a.total_metros_restantes} m</p>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Filters */}
            <div className="flex items-center gap-3">
                <Label className="text-sm">Categoría:</Label>
                <Select value={filterCategoria} onValueChange={setFilterCategoria}>
                    <SelectTrigger className="w-48" data-testid="filter-categoria">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todas</SelectItem>
                        {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>

            <Tabs defaultValue="rollos">
                <TabsList>
                    <TabsTrigger value="rollos" data-testid="tab-rollos">
                        <Layers className="w-4 h-4 mr-1" /> Rollos ({rollos.length})
                    </TabsTrigger>
                    <TabsTrigger value="otros" data-testid="tab-otros">
                        <Wrench className="w-4 h-4 mr-1" /> Accesorios/Materiales ({otros.length})
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="rollos">
                    {loading ? (
                        <div className="flex justify-center py-8 text-muted-foreground">Cargando...</div>
                    ) : rollos.length === 0 ? (
                        <div className="flex flex-col items-center py-8 text-muted-foreground">
                            <Package className="w-12 h-12 mb-2 opacity-50" />
                            No hay rollos registrados
                        </div>
                    ) : (
                        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {rollos.map(item => {
                                const pct = item.metros_iniciales > 0 ? (item.metros_restantes / item.metros_iniciales) * 100 : 0;
                                const barColor = pct > 50 ? 'bg-green-500' : pct > 25 ? 'bg-yellow-500' : 'bg-red-500';
                                return (
                                    <Card key={item.id} className="card-hover" data-testid={`item-${item.codigo}`}>
                                        <CardContent className="p-4 space-y-2">
                                            <div className="flex justify-between items-start gap-2">
                                                <div className="flex-1">
                                                    <p className="font-mono text-xs text-muted-foreground">{item.codigo}</p>
                                                    <p className="font-bold">{item.nombre}</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {ROLLO_TYPES.find(t => t.value === item.tipo_rollo)?.label || item.tipo_rollo}
                                                        {' · '}{item.categoria}
                                                    </p>
                                                </div>
                                                <div className="flex gap-1">
                                                    <Button variant="ghost" size="sm" onClick={() => openEdit(item)} data-testid={`edit-${item.codigo}`}>
                                                        <Edit className="w-4 h-4" />
                                                    </Button>
                                                    <Button variant="ghost" size="sm" onClick={() => handleDelete(item)} className="text-red-500">
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </div>
                                            </div>
                                            <div>
                                                <div className="flex justify-between text-sm">
                                                    <span className="text-muted-foreground">Metros restantes</span>
                                                    <span className="font-mono font-medium">{(item.metros_restantes ?? 0).toFixed(2)} / {(item.metros_iniciales ?? 0).toFixed(2)} m</span>
                                                </div>
                                                <div className="w-full h-2 bg-muted rounded-full overflow-hidden mt-1">
                                                    <div className={`h-full ${barColor}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                                                </div>
                                            </div>
                                            <div className="text-xs text-muted-foreground space-y-0.5">
                                                {item.factura_compra && <p>Factura: {item.factura_compra}</p>}
                                                {item.costo > 0 && <p>Costo: {formatCurrency(item.costo)}</p>}
                                                {item.linked_service && (
                                                    <p className="flex items-center gap-1">
                                                        <Tag className="w-3 h-3" />
                                                        {SERVICE_LABELS?.[item.linked_service] || item.linked_service}
                                                    </p>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="otros">
                    {loading ? (
                        <div className="flex justify-center py-8 text-muted-foreground">Cargando...</div>
                    ) : otros.length === 0 ? (
                        <div className="flex flex-col items-center py-8 text-muted-foreground">
                            <Wrench className="w-12 h-12 mb-2 opacity-50" />
                            No hay accesorios ni materiales registrados
                        </div>
                    ) : (
                        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {otros.map(item => (
                                <Card key={item.id} className="card-hover" data-testid={`item-${item.codigo}`}>
                                    <CardContent className="p-4 space-y-2">
                                        <div className="flex justify-between items-start gap-2">
                                            <div className="flex-1">
                                                <p className="font-mono text-xs text-muted-foreground">{item.codigo}</p>
                                                <p className="font-bold">{item.nombre}</p>
                                                <p className="text-xs text-muted-foreground">{item.categoria}</p>
                                            </div>
                                            <div className="flex gap-1">
                                                <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>
                                                    <Edit className="w-4 h-4" />
                                                </Button>
                                                <Button variant="ghost" size="sm" onClick={() => handleDelete(item)} className="text-red-500">
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">Cantidad</span>
                                            <span className="font-mono font-medium">{item.cantidad_restante ?? 0} / {item.cantidad_inicial ?? 0}</span>
                                        </div>
                                        <div className="text-xs text-muted-foreground space-y-0.5">
                                            {item.factura_compra && <p>Factura: {item.factura_compra}</p>}
                                            {item.costo > 0 && <p>Costo: {formatCurrency(item.costo)}</p>}
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>
            </Tabs>

            {/* New / Edit Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingId ? 'Editar Artículo' : 'Nuevo Artículo de Inventario'}</DialogTitle>
                        <DialogDescription>
                            Registra rollos (en metros) o accesorios/materiales (por cantidad).
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label>Nombre *</Label>
                                <Input value={form.nombre} onChange={(e) => setForm(f => ({ ...f, nombre: e.target.value }))} data-testid="form-nombre" />
                            </div>
                            <div className="space-y-1">
                                <Label>Factura de compra</Label>
                                <Input value={form.factura_compra} onChange={(e) => setForm(f => ({ ...f, factura_compra: e.target.value }))} data-testid="form-factura" />
                            </div>
                        </div>

                        {!editingId && (
                            <>
                                <div className="grid sm:grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <Label>Categoría *</Label>
                                        <Select value={form.categoria} onValueChange={(v) => setForm(f => ({ ...f, categoria: v }))}>
                                            <SelectTrigger data-testid="form-categoria"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Tipo *</Label>
                                        <Select value={form.tipo_articulo} onValueChange={(v) => setForm(f => ({ ...f, tipo_articulo: v }))}>
                                            <SelectTrigger data-testid="form-tipo"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="rollo">Rollo (metros)</SelectItem>
                                                <SelectItem value="cantidad">Accesorio / Material (unidades)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                {form.tipo_articulo === 'rollo' && (
                                    <div className="grid sm:grid-cols-2 gap-3">
                                        <div className="space-y-1">
                                            <Label>Marca / Tipo de rollo *</Label>
                                            <Select value={form.tipo_rollo} onValueChange={(v) => setForm(f => ({ ...f, tipo_rollo: v }))}>
                                                <SelectTrigger data-testid="form-tipo-rollo"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    {ROLLO_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1">
                                            <Label>Metros iniciales *</Label>
                                            <Input
                                                type="number"
                                                step="0.01"
                                                value={form.metros_iniciales}
                                                onChange={(e) => setForm(f => ({ ...f, metros_iniciales: e.target.value }))}
                                                placeholder="Ej: 30"
                                                data-testid="form-metros"
                                            />
                                        </div>
                                    </div>
                                )}

                                {form.tipo_articulo === 'cantidad' && (
                                    <div className="space-y-1">
                                        <Label>Cantidad inicial *</Label>
                                        <Input
                                            type="number"
                                            value={form.cantidad_inicial}
                                            onChange={(e) => setForm(f => ({ ...f, cantidad_inicial: e.target.value }))}
                                            placeholder="Ej: 50"
                                            data-testid="form-cantidad"
                                        />
                                    </div>
                                )}
                            </>
                        )}

                        <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label>Costo (COP)</Label>
                                <Input type="number" value={form.costo} onChange={(e) => setForm(f => ({ ...f, costo: e.target.value }))} data-testid="form-costo" />
                            </div>
                            <div className="space-y-1">
                                <Label>Vincular a servicio</Label>
                                <Select value={form.linked_service} onValueChange={(v) => setForm(f => ({ ...f, linked_service: v }))}>
                                    <SelectTrigger data-testid="form-linked-service"><SelectValue placeholder="(Opcional)" /></SelectTrigger>
                                    <SelectContent>
                                        {SERVICE_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-1">
                            <Label>Notas</Label>
                            <textarea
                                className="w-full min-h-[60px] px-3 py-2 rounded-md border border-input bg-background text-sm"
                                value={form.notes}
                                onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancelar</Button>
                        <Button onClick={handleSave} disabled={saving} data-testid="save-inventory-btn">
                            {saving ? 'Guardando...' : (editingId ? 'Actualizar' : 'Registrar')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default Inventory;
