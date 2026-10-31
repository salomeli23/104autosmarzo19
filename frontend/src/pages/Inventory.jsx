import React, { useState, useEffect, useCallback } from 'react';
import { inventoryAPI, sedesAPI, sedeAssignmentAPI, cuttingCatalogAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { MoveToCuttingStockDialog } from '../components/MoveToCuttingStockDialog';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { formatCurrency, SERVICE_LABELS } from '../lib/utils';
import { toast } from 'sonner';
import { Package, AlertTriangle, Plus, Trash2, Boxes, Wrench, Layers, Edit, Tag, MapPin, Move, RefreshCw, Loader2, Scissors, Warehouse, Image as ImageIcon } from 'lucide-react';

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
    const { isAdmin } = useAuth();
    const [rollGroups, setRollGroups] = useState([]); // referencias oficiales de corte
    const [defaultRollMeters, setDefaultRollMeters] = useState(30.48);
    const [resetOpen, setResetOpen] = useState(false);
    const [stockDialog, setStockDialog] = useState(null); // { item } o { item: null } para leer cualquier caja
    const [stockFilter, setStockFilter] = useState('all'); // all | corte | bodega
    const [resetting, setResetting] = useState(false);
    const [oneEachOpen, setOneEachOpen] = useState(false);
    const [oneEachBusy, setOneEachBusy] = useState(false);
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
        tipo_rollo: '',
        factura_compra: '',
        metros_iniciales: '',
        cantidad_inicial: '',
        costo: '',
        linked_service: '',
        sede_id: '',
        notes: '',
    };
    const [form, setForm] = useState(emptyForm);
    const [sedes, setSedes] = useState([]);
    const [transferDialog, setTransferDialog] = useState(null);  // { item }
    const [transferTargetSede, setTransferTargetSede] = useState('');

    const fetchAll = useCallback(async () => {
        try {
            setLoading(true);
            const [itemsRes, alertsRes, sedesRes] = await Promise.all([
                inventoryAPI.list(),
                inventoryAPI.alerts(),
                sedesAPI.list(),
            ]);
            setItems(itemsRes.data || []);
            setAlerts(alertsRes.data?.alerts || []);
            setSedes(sedesRes.data || []);
        } catch (e) {
            console.error(e);
            toast.error('Error cargando inventario');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    useEffect(() => {
        cuttingCatalogAPI.getMaterials()
            .then(res => {
                setRollGroups(res.data?.groups || []);
                if (res.data?.default_roll_meters) setDefaultRollMeters(res.data.default_roll_meters);
            })
            .catch(() => setRollGroups([]));
    }, []);

    // Al elegir la referencia se completan nombre, categoría y metros del rollo
    const pickReference = (ref) => {
        const group = rollGroups.find(g => g.items.includes(ref));
        setForm(f => ({
            ...f,
            tipo_rollo: ref,
            nombre: f.nombre && f.nombre !== f.tipo_rollo ? f.nombre : ref,
            categoria: group?.categoria || f.categoria,
            metros_iniciales: f.metros_iniciales || String(defaultRollMeters),
        }));
    };

    const handleResetRolls = async () => {
        setResetting(true);
        try {
            const res = await inventoryAPI.resetCuttingRolls();
            toast.success(`${res.data.message} · ${res.data.deactivated} rollos anteriores retirados`);
            setResetOpen(false);
            fetchAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo cargar el inventario de corte');
        } finally {
            setResetting(false);
        }
    };

    const handleOneRollEach = async () => {
        setOneEachBusy(true);
        try {
            const res = await inventoryAPI.oneRollPerReference();
            toast.success(res.data.message);
            setOneEachOpen(false);
            fetchAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo mover los rollos al stock de corte');
        } finally {
            setOneEachBusy(false);
        }
    };

    const openTransfer = (item) => {
        setTransferDialog({ item });
        setTransferTargetSede('');
    };

    const handleTransfer = async () => {
        if (!transferTargetSede) {
            toast.error('Selecciona la sede destino');
            return;
        }
        try {
            const res = await sedeAssignmentAPI.transferInventory(transferDialog.item.id, { target_sede_id: transferTargetSede });
            toast.success(`Movido a ${res.data?.to_sede}`);
            setTransferDialog(null);
            fetchAll();
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Error al transferir');
        }
    };

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
        if (!editingId && form.tipo_articulo === 'rollo' && !form.tipo_rollo) {
            toast.error('Elige la referencia del rollo');
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
                    sede_id: form.sede_id || null,
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
    // en_stock_corte === false → en bodega; los rollos anteriores (sin el campo) cuentan como en corte
    const inCutting = (i) => i.en_stock_corte !== false;
    const allRollos = filteredItems.filter(i => i.tipo_articulo === 'rollo');
    const rollos = allRollos.filter(i => stockFilter === 'all' || (stockFilter === 'corte' ? inCutting(i) : !inCutting(i)));

    const openBoxPhoto = async (item) => {
        try {
            const res = await inventoryAPI.boxPhoto(item.id);
            window.open(URL.createObjectURL(res.data), '_blank');
        } catch {
            toast.error('No se pudo abrir la foto de la caja');
        }
    };
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
                <div className="flex gap-2 flex-wrap">
                    {isAdmin && (
                        <Button variant="outline" onClick={() => setResetOpen(true)} data-testid="reset-cutting-rolls-btn">
                            <RefreshCw className="w-4 h-4 mr-2" /> Cargar inventario de corte
                        </Button>
                    )}
                    {isAdmin && (
                        <Button variant="outline" onClick={() => setOneEachOpen(true)} data-testid="one-roll-each-btn">
                            <Scissors className="w-4 h-4 mr-2" /> 1 rollo de cada referencia a stock
                        </Button>
                    )}
                    <Button variant="outline" onClick={() => setStockDialog({ item: null })} data-testid="move-to-cutting-stock-btn">
                        <Scissors className="w-4 h-4 mr-2" /> Mover al stock de corte
                    </Button>
                    <Button onClick={openNew} data-testid="new-inventory-btn">
                        <Plus className="w-4 h-4 mr-2" /> Nuevo Artículo
                    </Button>
                </div>
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
                                            <p className="text-xs text-muted-foreground">{a.current_count === 1 ? 'rollo' : 'rollos'}</p>
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
                            <div className="md:col-span-2 lg:col-span-3 flex gap-1.5 flex-wrap" data-testid="stock-filter">
                                {[['all', `Todos (${allRollos.length})`], ['corte', `En corte (${allRollos.filter(inCutting).length})`], ['bodega', `En bodega (${allRollos.filter(i => !inCutting(i)).length})`]].map(([v, l]) => (
                                    <Button key={v} size="sm" variant={stockFilter === v ? 'default' : 'outline'} onClick={() => setStockFilter(v)} data-testid={`stock-filter-${v}`}>{l}</Button>
                                ))}
                            </div>
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
                                                    {inCutting(item) ? (
                                                        <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/40 mt-1" data-testid={`stock-badge-${item.codigo}`}>
                                                            <Scissors className="w-3 h-3" /> En stock de corte
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border mt-1" data-testid={`stock-badge-${item.codigo}`}>
                                                            <Warehouse className="w-3 h-3" /> En bodega
                                                        </span>
                                                    )}
                                                    <p className="text-xs text-muted-foreground">
                                                        {item.grupo_corte || (rollGroups.find(g => g.items.includes(item.tipo_rollo))?.label) || item.tipo_rollo}
                                                        {' · '}{item.categoria}
                                                    </p>
                                                </div>
                                                <div className="flex gap-1">
                                                    <Button variant="ghost" size="sm" onClick={() => openTransfer(item)} title="Mover a sede" data-testid={`move-${item.codigo}`}>
                                                        <Move className="w-4 h-4 text-cyan-400" />
                                                    </Button>
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
                                                {item.sede_nombre && (
                                                    <p className="flex items-center gap-1 text-cyan-400">
                                                        <MapPin className="w-3 h-3" />
                                                        {item.sede_nombre}
                                                    </p>
                                                )}
                                                {item.factura_compra && <p>Factura: {item.factura_compra}</p>}
                                                {item.costo > 0 && <p>Costo: {formatCurrency(item.costo)}</p>}
                                                {item.linked_service && (
                                                    <p className="flex items-center gap-1">
                                                        <Tag className="w-3 h-3" />
                                                        {SERVICE_LABELS?.[item.linked_service] || item.linked_service}
                                                    </p>
                                                )}
                                                {item.stock_corte_at && (
                                                    <p>Activado en corte {new Date(item.stock_corte_at).toLocaleString('es-CO')} · {item.stock_corte_by_name}
                                                        {item.lote ? ` · Lote ${item.lote}` : ''}</p>
                                                )}
                                            </div>
                                            {!inCutting(item) ? (
                                                <Button size="sm" className="w-full" onClick={() => setStockDialog({ item })} data-testid={`move-stock-${item.codigo}`}>
                                                    <Scissors className="w-4 h-4 mr-1.5" /> Mover al stock de corte
                                                </Button>
                                            ) : item.caja_foto_url ? (
                                                <Button size="sm" variant="outline" className="w-full" onClick={() => openBoxPhoto(item)} data-testid={`box-photo-${item.codigo}`}>
                                                    <ImageIcon className="w-4 h-4 mr-1.5" /> Ver foto de la caja
                                                </Button>
                                            ) : null}
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
                                                <Button variant="ghost" size="sm" onClick={() => openTransfer(item)} title="Mover a sede">
                                                    <Move className="w-4 h-4 text-cyan-400" />
                                                </Button>
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
                                            {item.sede_nombre && (
                                                <p className="flex items-center gap-1 text-cyan-400">
                                                    <MapPin className="w-3 h-3" />
                                                    {item.sede_nombre}
                                                </p>
                                            )}
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
                                            <Label>Referencia del rollo *</Label>
                                            <select
                                                value={form.tipo_rollo}
                                                onChange={(e) => pickReference(e.target.value)}
                                                className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                                                data-testid="form-tipo-rollo"
                                            >
                                                <option value="">Elige la referencia…</option>
                                                {rollGroups.map(g => (
                                                    <optgroup key={g.id} label={g.label}>
                                                        {g.items.map(ref => <option key={ref} value={ref}>{ref}</option>)}
                                                    </optgroup>
                                                ))}
                                            </select>
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
                            <Label className="flex items-center gap-1"><MapPin className="w-3 h-3" /> Sede</Label>
                            <Select value={form.sede_id || '__none__'} onValueChange={(v) => setForm(f => ({ ...f, sede_id: v === '__none__' ? '' : v }))}>
                                <SelectTrigger data-testid="form-sede"><SelectValue placeholder="(Sin sede asignada)" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">(Sin sede)</SelectItem>
                                    {sedes.map(s => <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>)}
                                </SelectContent>
                            </Select>
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

            {/* Transferir entre sedes */}
            <Dialog open={!!transferDialog} onOpenChange={(o) => !o && setTransferDialog(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Move className="w-5 h-5 text-cyan-400" />
                            Mover artículo a otra sede
                        </DialogTitle>
                    </DialogHeader>
                    {transferDialog && (
                        <div className="space-y-3">
                            <div className="p-3 rounded bg-muted/50">
                                <p className="font-mono text-xs text-muted-foreground">{transferDialog.item.codigo}</p>
                                <p className="font-medium">{transferDialog.item.nombre}</p>
                                <p className="text-xs flex items-center gap-1 mt-1">
                                    <MapPin className="w-3 h-3" />
                                    Sede actual: <span className="font-medium">{transferDialog.item.sede_nombre || '— sin sede —'}</span>
                                </p>
                            </div>
                            <div className="space-y-1">
                                <Label>Sede destino</Label>
                                <Select value={transferTargetSede} onValueChange={setTransferTargetSede}>
                                    <SelectTrigger data-testid="transfer-target-sede"><SelectValue placeholder="Selecciona sede destino" /></SelectTrigger>
                                    <SelectContent>
                                        {sedes
                                            .filter(s => s.id !== transferDialog.item.sede_id)
                                            .map(s => <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setTransferDialog(null)}>Cancelar</Button>
                        <Button onClick={handleTransfer} disabled={!transferTargetSede} data-testid="confirm-transfer-btn">
                            <Move className="w-4 h-4 mr-1" /> Transferir
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {stockDialog && (
                <MoveToCuttingStockDialog
                    open
                    item={stockDialog.item}
                    items={items}
                    rollGroups={rollGroups}
                    defaultRollMeters={defaultRollMeters}
                    onClose={() => setStockDialog(null)}
                    onDone={() => { setStockDialog(null); fetchAll(); }}
                />
            )}

            {/* Activar 1 rollo por referencia en el stock de corte */}
            <Dialog open={oneEachOpen} onOpenChange={(v) => !oneEachBusy && setOneEachOpen(v)}>
                <DialogContent data-testid="one-roll-each-dialog">
                    <DialogHeader>
                        <DialogTitle>1 rollo de cada referencia al stock de corte</DialogTitle>
                        <DialogDescription>
                            Cada una de las <b>{rollGroups.reduce((n, g) => n + g.items.length, 0)} referencias</b> queda con un rollo activo para elegir en el campo <b>Rollo</b> de Corte de piezas.
                            Si la referencia ya tiene un rollo en corte no cambia; si tiene uno en bodega se mueve (sin foto de la caja); si no tiene ninguno se crea uno de {defaultRollMeters} m.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOneEachOpen(false)} disabled={oneEachBusy}>Cancelar</Button>
                        <Button onClick={handleOneRollEach} disabled={oneEachBusy} data-testid="confirm-one-roll-each">
                            {oneEachBusy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Scissors className="w-4 h-4 mr-2" />}
                            Mover a stock de corte
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Reemplazar el inventario de corte por las referencias oficiales */}
            <Dialog open={resetOpen} onOpenChange={(v) => !resetting && setResetOpen(v)}>
                <DialogContent data-testid="reset-cutting-rolls-dialog">
                    <DialogHeader>
                        <DialogTitle>Cargar inventario de corte</DialogTitle>
                        <DialogDescription>
                            Se retiran todos los rollos actuales y se carga <b>1 rollo de {defaultRollMeters} m</b> por cada una de las{' '}
                            <b>{rollGroups.reduce((n, g) => n + g.items.length, 0)} referencias</b> oficiales. Los rollos nuevos quedan <b>en bodega</b> hasta moverlos al stock de corte con la foto de su caja. Los accesorios no cambian.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="max-h-60 overflow-y-auto text-xs space-y-2 rounded border border-border p-2">
                        {rollGroups.map(g => (
                            <div key={g.id}>
                                <p className="font-semibold text-primary">{g.label} ({g.items.length})</p>
                                <p className="text-muted-foreground">{g.items.join(' · ')}</p>
                            </div>
                        ))}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setResetOpen(false)} disabled={resetting}>Cancelar</Button>
                        <Button onClick={handleResetRolls} disabled={resetting || rollGroups.length === 0} data-testid="confirm-reset-cutting-rolls">
                            {resetting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                            Reemplazar inventario de corte
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default Inventory;
