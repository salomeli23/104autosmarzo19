import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { accessoryRequestsAPI, inventoryAPI, servicesAPI, usersAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { formatCurrency, formatDateTime } from '../lib/utils';
import { toast } from 'sonner';
import { PackageCheck, PackageOpen, Truck, Wrench, Boxes, Plus, Edit, Trash2, AlertTriangle, RefreshCw, PackagePlus } from 'lucide-react';

const STATUS_META = {
    pendiente: { label: 'Por despachar', className: 'bg-amber-500/15 text-amber-500 border-amber-500/30' },
    despachado: { label: 'Despachado · por entregar', className: 'bg-sky-500/15 text-sky-500 border-sky-500/30' },
    entregado: { label: 'Entregado al técnico', className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' },
};

const FILTERS = [
    { value: 'pendiente', label: 'Por despachar' },
    { value: 'despachado', label: 'Por entregar' },
    { value: 'entregado', label: 'Entregados' },
    { value: 'all', label: 'Todas' },
];

const DEFAULT_MIN_STOCK = 2;
const isLowStock = (it) => (it.cantidad_restante ?? 0) <= (it.stock_minimo ?? DEFAULT_MIN_STOCK);

const selectClass = 'w-full h-9 rounded-md border border-input bg-background px-2 text-sm';

// Artículo de inventario sugerido para un accesorio de la orden
const suggestInventoryItem = (reqItem, inventory) => {
    const withStock = inventory.filter(i => (i.cantidad_restante ?? 0) > 0);
    const byService = withStock.find(i => i.linked_service && i.linked_service === reqItem.service_id);
    if (byService) return byService;
    const name = (reqItem.name || '').toLowerCase();
    return withStock.find(i => (i.nombre || '').toLowerCase() === name) || null;
};

export const Accesorios = () => {
    const { user } = useAuth();
    const canManage = ['admin', 'accesorios'].includes(user?.role);

    const [requests, setRequests] = useState([]);
    const [inventory, setInventory] = useState([]);
    const [catalog, setCatalog] = useState([]);
    const [technicians, setTechnicians] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('pendiente');

    const [dispatchReq, setDispatchReq] = useState(null);
    const [dispatchRows, setDispatchRows] = useState([]);
    const [dispatchNotes, setDispatchNotes] = useState('');
    const [deliverReq, setDeliverReq] = useState(null);
    const [deliverTech, setDeliverTech] = useState('');
    const [deliverNotes, setDeliverNotes] = useState('');
    const [saving, setSaving] = useState(false);

    const emptyItemForm = { nombre: '', linked_service: '', cantidad_inicial: '', costo: '', stock_minimo: String(DEFAULT_MIN_STOCK), factura_compra: '', notes: '' };
    const [itemDialog, setItemDialog] = useState(null); // { id? }
    const [itemForm, setItemForm] = useState(emptyItemForm);
    const [restockItem, setRestockItem] = useState(null);
    const [restockQty, setRestockQty] = useState('');
    const [restockInvoice, setRestockInvoice] = useState('');

    const fetchAll = useCallback(async () => {
        try {
            setLoading(true);
            const [reqRes, invRes, catRes, techRes] = await Promise.all([
                accessoryRequestsAPI.list(),
                inventoryAPI.list({ categoria: 'accesorio' }),
                servicesAPI.getCatalog(),
                usersAPI.getTechnicians(),
            ]);
            setRequests(reqRes.data || []);
            setInventory((invRes.data || []).filter(i => i.tipo_articulo === 'cantidad'));
            setCatalog(catRes.data?.accesorios?.services || []);
            setTechnicians(techRes.data || []);
        } catch (e) {
            toast.error('Error cargando accesorios');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    const counts = useMemo(() => ({
        pendiente: requests.filter(r => r.status === 'pendiente').length,
        despachado: requests.filter(r => r.status === 'despachado').length,
        entregado: requests.filter(r => r.status === 'entregado').length,
        lowStock: inventory.filter(isLowStock).length,
    }), [requests, inventory]);

    const visibleRequests = filter === 'all' ? requests : requests.filter(r => r.status === filter);
    const catalogName = (id) => catalog.find(c => c.id === id)?.name;

    // ---------- Despacho ----------
    const openDispatch = (req) => {
        setDispatchReq(req);
        setDispatchNotes('');
        setDispatchRows(req.items.map(it => ({
            inventory_item_id: suggestInventoryItem(it, inventory)?.id || '',
            cantidad: String(it.cantidad || 1),
        })));
    };

    const updateDispatchRow = (idx, changes) => setDispatchRows(prev => prev.map((r, i) => (i === idx ? { ...r, ...changes } : r)));

    const handleDispatch = async () => {
        const items = dispatchRows.map(r => ({ inventory_item_id: r.inventory_item_id || null, cantidad: parseInt(r.cantidad, 10) || 0 }));
        if (items.some(i => i.cantidad <= 0)) {
            toast.error('La cantidad de cada accesorio debe ser mayor a 0');
            return;
        }
        setSaving(true);
        try {
            await accessoryRequestsAPI.dispatch(dispatchReq.id, { items, notes: dispatchNotes.trim() || null });
            toast.success(`Pedido ${dispatchReq.code} despachado`);
            setDispatchReq(null);
            fetchAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo despachar');
        } finally {
            setSaving(false);
        }
    };

    // ---------- Entrega al técnico ----------
    const openDeliver = (req) => {
        setDeliverReq(req);
        setDeliverTech(req.assigned_technician_id || '');
        setDeliverNotes('');
    };

    const handleDeliver = async () => {
        if (!deliverTech) {
            toast.error('Selecciona el técnico instalador');
            return;
        }
        setSaving(true);
        try {
            await accessoryRequestsAPI.deliver(deliverReq.id, { technician_id: deliverTech, notes: deliverNotes.trim() || null });
            toast.success('Accesorios entregados al técnico');
            setDeliverReq(null);
            fetchAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo registrar la entrega');
        } finally {
            setSaving(false);
        }
    };

    // ---------- Inventario ----------
    const openNewItem = () => {
        setItemForm(emptyItemForm);
        setItemDialog({});
    };

    const openEditItem = (it) => {
        setItemForm({
            nombre: it.nombre || '',
            linked_service: it.linked_service || '',
            cantidad_inicial: String(it.cantidad_restante ?? ''),
            costo: String(it.costo ?? ''),
            stock_minimo: String(it.stock_minimo ?? DEFAULT_MIN_STOCK),
            factura_compra: it.factura_compra || '',
            notes: it.notes || '',
        });
        setItemDialog({ id: it.id });
    };

    const handleSaveItem = async () => {
        if (!itemForm.nombre.trim()) {
            toast.error('Escribe el nombre del accesorio');
            return;
        }
        const qty = parseInt(itemForm.cantidad_inicial, 10);
        if (!itemDialog.id && !(qty > 0)) {
            toast.error('La cantidad inicial debe ser mayor a 0');
            return;
        }
        const common = {
            nombre: itemForm.nombre.trim(),
            linked_service: itemForm.linked_service || null,
            costo: parseFloat(itemForm.costo) || 0,
            stock_minimo: itemForm.stock_minimo === '' ? null : parseInt(itemForm.stock_minimo, 10),
            factura_compra: itemForm.factura_compra.trim() || null,
            notes: itemForm.notes.trim() || null,
        };
        setSaving(true);
        try {
            if (itemDialog.id) {
                await inventoryAPI.update(itemDialog.id, { ...common, cantidad_restante: Number.isNaN(qty) ? undefined : qty });
                toast.success('Accesorio actualizado');
            } else {
                await inventoryAPI.create({ ...common, categoria: 'accesorio', tipo_articulo: 'cantidad', cantidad_inicial: qty });
                toast.success('Accesorio agregado al inventario');
            }
            setItemDialog(null);
            fetchAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo guardar');
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteItem = async (it) => {
        if (!window.confirm(`¿Eliminar ${it.nombre} del inventario?`)) return;
        try {
            await inventoryAPI.delete(it.id);
            toast.success('Accesorio eliminado');
            fetchAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo eliminar');
        }
    };

    const handleRestock = async () => {
        const qty = parseInt(restockQty, 10);
        if (!(qty > 0)) {
            toast.error('La cantidad debe ser mayor a 0');
            return;
        }
        setSaving(true);
        try {
            await inventoryAPI.restock(restockItem.id, { cantidad: qty, factura_compra: restockInvoice.trim() || null });
            toast.success(`Ingresaste ${qty} unidades de ${restockItem.nombre}`);
            setRestockItem(null);
            fetchAll();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo ingresar');
        } finally {
            setSaving(false);
        }
    };

    const stats = [
        { label: 'Por despachar', value: counts.pendiente, icon: PackageOpen, color: 'text-amber-500' },
        { label: 'Por entregar al técnico', value: counts.despachado, icon: Truck, color: 'text-sky-500' },
        { label: 'Entregados', value: counts.entregado, icon: PackageCheck, color: 'text-emerald-500' },
        { label: 'Accesorios con bajo stock', value: counts.lowStock, icon: AlertTriangle, color: 'text-red-500' },
    ];

    return (
        <div className="space-y-6" data-testid="accesorios-page">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <h1 className="font-heading text-3xl md:text-4xl">Accesorios</h1>
                    <p className="text-muted-foreground">Despacha los accesorios de cada orden y entrégalos al técnico instalador</p>
                </div>
                <Button variant="outline" onClick={fetchAll} disabled={loading}>
                    <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                    Actualizar
                </Button>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {stats.map(s => (
                    <Card key={s.label}>
                        <CardContent className="p-4 flex items-center gap-3">
                            <s.icon className={`w-8 h-8 ${s.color}`} />
                            <div>
                                <p className="text-2xl font-bold">{s.value}</p>
                                <p className="text-xs text-muted-foreground">{s.label}</p>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Tabs defaultValue="solicitudes">
                <TabsList>
                    <TabsTrigger value="solicitudes" data-testid="tab-accessory-requests">Solicitudes</TabsTrigger>
                    <TabsTrigger value="inventario" data-testid="tab-accessory-inventory">Inventario de accesorios</TabsTrigger>
                </TabsList>

                <TabsContent value="solicitudes" className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                        {FILTERS.map(f => (
                            <Button
                                key={f.value}
                                size="sm"
                                variant={filter === f.value ? 'default' : 'outline'}
                                onClick={() => setFilter(f.value)}
                                data-testid={`accessory-filter-${f.value}`}
                            >
                                {f.label}
                                {f.value !== 'all' && <span className="ml-1.5 opacity-70">{counts[f.value]}</span>}
                            </Button>
                        ))}
                    </div>

                    {!loading && visibleRequests.length === 0 && (
                        <Card><CardContent className="p-8 text-center text-muted-foreground">No hay solicitudes en esta lista.</CardContent></Card>
                    )}

                    <div className="grid md:grid-cols-2 gap-4">
                        {visibleRequests.map(req => {
                            const meta = STATUS_META[req.status] || STATUS_META.pendiente;
                            return (
                                <Card key={req.id} data-testid={`accessory-request-${req.code}`}>
                                    <CardContent className="p-4 space-y-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <div>
                                                <p className="font-heading text-xl">{req.plate}</p>
                                                <p className="text-sm text-muted-foreground">{req.client_name} · {req.brand} {req.model}</p>
                                                <p className="text-xs text-muted-foreground font-mono">{req.code} · Orden {req.order_code}</p>
                                            </div>
                                            <span className={`text-xs px-2 py-1 rounded-full border whitespace-nowrap ${meta.className}`}>{meta.label}</span>
                                        </div>

                                        <ul className="space-y-1 text-sm">
                                            {req.items.map((it, idx) => (
                                                <li key={idx} className="flex justify-between gap-2 p-2 rounded bg-muted/40">
                                                    <span>{it.cantidad || 1} × {it.name}</span>
                                                    {it.inventory_codigo && <span className="text-xs text-muted-foreground font-mono">{it.inventory_codigo}</span>}
                                                </li>
                                            ))}
                                        </ul>

                                        <div className="text-xs text-muted-foreground space-y-0.5">
                                            <p className="flex items-center gap-1">
                                                <Wrench className="w-3.5 h-3.5" />
                                                {req.status === 'entregado'
                                                    ? <>Entregado a <b className="text-foreground">{req.delivered_to_name}</b> · {formatDateTime(req.delivered_at)}</>
                                                    : req.assigned_technician_name
                                                        ? <>Técnico asignado: <b className="text-foreground">{req.assigned_technician_name}</b></>
                                                        : 'Técnico por asignar'}
                                            </p>
                                            <p>Solicitado {formatDateTime(req.created_at)}{req.requested_by_name && ` por ${req.requested_by_name}`}</p>
                                            {req.dispatched_at && <p>Despachado {formatDateTime(req.dispatched_at)} por {req.dispatched_by_name}</p>}
                                        </div>

                                        {canManage && req.status === 'pendiente' && (
                                            <Button className="w-full" onClick={() => openDispatch(req)} data-testid={`dispatch-btn-${req.code}`}>
                                                <PackageOpen className="w-4 h-4 mr-2" />
                                                Despachar pedido
                                            </Button>
                                        )}
                                        {canManage && req.status === 'despachado' && (
                                            <Button className="w-full" onClick={() => openDeliver(req)} data-testid={`deliver-btn-${req.code}`}>
                                                <Truck className="w-4 h-4 mr-2" />
                                                Entregar al técnico
                                            </Button>
                                        )}
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                </TabsContent>

                <TabsContent value="inventario" className="space-y-4">
                    {canManage && (
                        <div className="flex justify-end">
                            <Button onClick={openNewItem} data-testid="new-accessory-item">
                                <Plus className="w-4 h-4 mr-2" />
                                Nuevo accesorio
                            </Button>
                        </div>
                    )}
                    {!loading && inventory.length === 0 && (
                        <Card><CardContent className="p-8 text-center text-muted-foreground">
                            <Boxes className="w-10 h-10 mx-auto mb-2 opacity-50" />
                            Aún no hay accesorios en el inventario.
                        </CardContent></Card>
                    )}
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {inventory.map(it => {
                            const low = isLowStock(it);
                            return (
                                <Card key={it.id} className={low ? 'border-red-500/50' : ''} data-testid={`accessory-item-${it.codigo}`}>
                                    <CardContent className="p-4 space-y-2">
                                        <div className="flex justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="font-medium truncate">{it.nombre}</p>
                                                <p className="text-xs text-muted-foreground font-mono">{it.codigo}</p>
                                                {it.linked_service && (
                                                    <p className="text-xs text-muted-foreground">Catálogo: {catalogName(it.linked_service) || it.linked_service}</p>
                                                )}
                                            </div>
                                            <div className="text-right">
                                                <p className={`text-2xl font-bold ${low ? 'text-red-500' : ''}`} data-testid={`accessory-stock-${it.codigo}`}>{it.cantidad_restante ?? 0}</p>
                                                <p className="text-[11px] text-muted-foreground">unidades</p>
                                            </div>
                                        </div>
                                        {low && (
                                            <p className="text-xs text-red-500 flex items-center gap-1">
                                                <AlertTriangle className="w-3.5 h-3.5" /> Bajo stock (mínimo {it.stock_minimo ?? DEFAULT_MIN_STOCK})
                                            </p>
                                        )}
                                        <p className="text-xs text-muted-foreground">Costo unitario {formatCurrency(it.costo || 0)}</p>
                                        {canManage && (
                                            <div className="flex gap-2 pt-1">
                                                <Button size="sm" className="flex-1" onClick={() => { setRestockItem(it); setRestockQty(''); setRestockInvoice(''); }} data-testid={`restock-btn-${it.codigo}`}>
                                                    <PackagePlus className="w-3.5 h-3.5 mr-1" /> Ingresar
                                                </Button>
                                                <Button size="sm" variant="outline" onClick={() => openEditItem(it)} aria-label="Editar">
                                                    <Edit className="w-3.5 h-3.5" />
                                                </Button>
                                                <Button size="sm" variant="outline" className="text-red-500" onClick={() => handleDeleteItem(it)} aria-label="Eliminar">
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </Button>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            );
                        })}
                    </div>
                </TabsContent>
            </Tabs>

            {/* Despachar */}
            <Dialog open={!!dispatchReq} onOpenChange={(v) => !saving && !v && setDispatchReq(null)}>
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dispatch-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-heading text-xl">Despachar pedido {dispatchReq?.code}</DialogTitle>
                        <DialogDescription>{dispatchReq?.plate} · {dispatchReq?.client_name}. Se descuenta del inventario de accesorios.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        {dispatchReq?.items.map((it, idx) => {
                            const row = dispatchRows[idx] || {};
                            const inv = inventory.find(i => i.id === row.inventory_item_id);
                            const short = inv && (parseInt(row.cantidad, 10) || 0) > (inv.cantidad_restante ?? 0);
                            return (
                                <div key={idx} className="p-3 rounded-lg border space-y-2" data-testid={`dispatch-row-${idx}`}>
                                    <p className="font-medium text-sm">{it.name}</p>
                                    <div className="flex gap-2">
                                        <select
                                            value={row.inventory_item_id || ''}
                                            onChange={(e) => updateDispatchRow(idx, { inventory_item_id: e.target.value })}
                                            className={selectClass}
                                            data-testid={`dispatch-item-select-${idx}`}
                                        >
                                            <option value="">Sin descontar de inventario</option>
                                            {inventory.map(i => (
                                                <option key={i.id} value={i.id}>{i.nombre} · {i.cantidad_restante ?? 0} disp.</option>
                                            ))}
                                        </select>
                                        <Input
                                            type="number"
                                            min="1"
                                            value={row.cantidad || ''}
                                            onChange={(e) => updateDispatchRow(idx, { cantidad: e.target.value })}
                                            className="w-20"
                                            data-testid={`dispatch-qty-${idx}`}
                                        />
                                    </div>
                                    {!row.inventory_item_id && (
                                        <p className="text-xs text-amber-500">No hay un artículo de inventario seleccionado: no se descontará stock.</p>
                                    )}
                                    {short && <p className="text-xs text-red-500">Stock insuficiente: quedan {inv.cantidad_restante ?? 0}.</p>}
                                </div>
                            );
                        })}
                        <div className="space-y-1">
                            <Label>Notas</Label>
                            <Textarea value={dispatchNotes} onChange={(e) => setDispatchNotes(e.target.value)} rows={2} placeholder="Opcional" />
                        </div>
                        <div className="flex flex-col-reverse sm:flex-row gap-2">
                            <Button variant="outline" className="sm:flex-1" onClick={() => setDispatchReq(null)} disabled={saving}>Cancelar</Button>
                            <Button className="sm:flex-1" onClick={handleDispatch} disabled={saving} data-testid="dispatch-confirm">
                                {saving ? 'Despachando...' : 'Confirmar despacho'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Entregar al técnico */}
            <Dialog open={!!deliverReq} onOpenChange={(v) => !saving && !v && setDeliverReq(null)}>
                <DialogContent className="max-w-md" data-testid="deliver-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-heading text-xl">Entregar al técnico</DialogTitle>
                        <DialogDescription>{deliverReq?.code} · {deliverReq?.plate}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <ul className="text-sm space-y-1">
                            {deliverReq?.items.map((it, idx) => <li key={idx}>• {it.cantidad || 1} × {it.name}</li>)}
                        </ul>
                        <div className="space-y-1">
                            <Label>Técnico instalador *</Label>
                            <select value={deliverTech} onChange={(e) => setDeliverTech(e.target.value)} className={selectClass} data-testid="deliver-tech-select">
                                <option value="">Seleccionar técnico...</option>
                                {technicians.map(t => (
                                    <option key={t.id} value={t.id}>
                                        {t.name}{t.id === deliverReq?.assigned_technician_id ? ' (asignado a la orden)' : ''}
                                    </option>
                                ))}
                            </select>
                            {!deliverReq?.assigned_technician_id && (
                                <p className="text-xs text-muted-foreground">La orden aún no tiene técnico asignado.</p>
                            )}
                        </div>
                        <div className="space-y-1">
                            <Label>Notas</Label>
                            <Textarea value={deliverNotes} onChange={(e) => setDeliverNotes(e.target.value)} rows={2} placeholder="Opcional" />
                        </div>
                        <div className="flex flex-col-reverse sm:flex-row gap-2">
                            <Button variant="outline" className="sm:flex-1" onClick={() => setDeliverReq(null)} disabled={saving}>Cancelar</Button>
                            <Button className="sm:flex-1" onClick={handleDeliver} disabled={saving} data-testid="deliver-confirm">
                                {saving ? 'Guardando...' : 'Confirmar entrega'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Nuevo / editar accesorio */}
            <Dialog open={!!itemDialog} onOpenChange={(v) => !saving && !v && setItemDialog(null)}>
                <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" data-testid="accessory-item-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-heading text-xl">{itemDialog?.id ? 'Editar accesorio' : 'Nuevo accesorio'}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-1">
                            <Label>Accesorio del catálogo</Label>
                            <select
                                value={itemForm.linked_service}
                                onChange={(e) => {
                                    const id = e.target.value;
                                    setItemForm(f => ({ ...f, linked_service: id, nombre: f.nombre || catalogName(id) || '' }));
                                }}
                                className={selectClass}
                                data-testid="accessory-item-catalog"
                            >
                                <option value="">Ninguno</option>
                                {catalog.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                            <p className="text-xs text-muted-foreground">Con esto se sugiere al despachar las órdenes que lo lleven.</p>
                        </div>
                        <div className="space-y-1">
                            <Label>Nombre *</Label>
                            <Input value={itemForm.nombre} onChange={(e) => setItemForm(f => ({ ...f, nombre: e.target.value }))} data-testid="accessory-item-name" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label>{itemDialog?.id ? 'Unidades disponibles' : 'Cantidad inicial *'}</Label>
                                <Input type="number" min="0" value={itemForm.cantidad_inicial} onChange={(e) => setItemForm(f => ({ ...f, cantidad_inicial: e.target.value }))} data-testid="accessory-item-qty" />
                            </div>
                            <div className="space-y-1">
                                <Label>Stock mínimo</Label>
                                <Input type="number" min="0" value={itemForm.stock_minimo} onChange={(e) => setItemForm(f => ({ ...f, stock_minimo: e.target.value }))} />
                            </div>
                            <div className="space-y-1">
                                <Label>Costo unitario</Label>
                                <Input type="number" min="0" value={itemForm.costo} onChange={(e) => setItemForm(f => ({ ...f, costo: e.target.value }))} />
                            </div>
                            <div className="space-y-1">
                                <Label>Factura de compra</Label>
                                <Input value={itemForm.factura_compra} onChange={(e) => setItemForm(f => ({ ...f, factura_compra: e.target.value }))} />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <Label>Notas</Label>
                            <Textarea value={itemForm.notes} onChange={(e) => setItemForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
                        </div>
                        <div className="flex flex-col-reverse sm:flex-row gap-2">
                            <Button variant="outline" className="sm:flex-1" onClick={() => setItemDialog(null)} disabled={saving}>Cancelar</Button>
                            <Button className="sm:flex-1" onClick={handleSaveItem} disabled={saving} data-testid="accessory-item-save">
                                {saving ? 'Guardando...' : 'Guardar'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Ingresar unidades */}
            <Dialog open={!!restockItem} onOpenChange={(v) => !saving && !v && setRestockItem(null)}>
                <DialogContent className="max-w-sm" data-testid="restock-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-heading text-xl">Ingresar unidades</DialogTitle>
                        <DialogDescription>{restockItem?.nombre} · hay {restockItem?.cantidad_restante ?? 0}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="space-y-1">
                            <Label>Cantidad *</Label>
                            <Input type="number" min="1" value={restockQty} onChange={(e) => setRestockQty(e.target.value)} data-testid="restock-qty" />
                        </div>
                        <div className="space-y-1">
                            <Label>Factura de compra</Label>
                            <Input value={restockInvoice} onChange={(e) => setRestockInvoice(e.target.value)} placeholder="Opcional" />
                        </div>
                        <div className="flex flex-col-reverse sm:flex-row gap-2">
                            <Button variant="outline" className="sm:flex-1" onClick={() => setRestockItem(null)} disabled={saving}>Cancelar</Button>
                            <Button className="sm:flex-1" onClick={handleRestock} disabled={saving} data-testid="restock-confirm">
                                {saving ? 'Guardando...' : 'Ingresar'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default Accesorios;
