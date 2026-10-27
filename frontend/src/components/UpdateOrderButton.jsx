import React, { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { ServiceCatalogLabel } from './ServiceCatalogLabel';
import { ordersAPI, servicesAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { formatCurrency, VEHICLE_PARTS } from '../lib/utils';
import { isSunroofLine, findSunroof, stripSunroof, buildSunroofLine } from '../lib/sunroof';
import { toast } from 'sonner';
import { FilePenLine, Plus, PlusCircle, Trash2, Lock, Package, Car, CheckCircle } from 'lucide-react';

const ALLOWED_ROLES = ['admin', 'asesor', 'coordinador'];
const LOCKED_STATUSES = ['entregado', 'desistimiento'];

// Igual que en Check-in
const SERVICES_WITH_PARTS = [
    'nanooptik', 'black_ceramic_autobahn', 'ultraoptik_aswf',
    'ceramic_i3_autobahn', 'ceramic_i3_plus_autobahn', 'huperoptik',
];
const SERVICE_PARTS = VEHICLE_PARTS.filter(p => p.id !== 'sunroof');
const TINT_PERCENTAGES = ['5%', '7%', '10%', '12%', '15%', '20%', '30%', '35%', '50%', '70%'];
const requiresPercentage = (serviceId) => {
    const lower = (serviceId || '').toLowerCase();
    return lower.includes('polarizado') || lower.includes('ultrasecure')
        || ['nanooptik', 'huperoptik', 'black_ceramic', 'ultraoptik', 'ceramic_i3', 'spectra', 'edge'].some(k => lower.includes(k));
};

let nextKey = 1;
const splitDescription = (svc) => {
    const parts = (svc.description || '').split(' - ');
    return parts.length > 1
        ? { category: parts[0], name: parts.slice(1).join(' - ') }
        : { category: 'Servicio', name: svc.description || svc.service };
};
const rowFromService = (svc) => ({
    key: `row-${nextKey++}`,
    base: svc,
    serviceId: svc.service,
    ...splitDescription(svc),
    price: String(svc.price ?? 0),
    no_charge: !!svc.no_charge,
    parts: svc.parts || [],
    part_percentages: svc.part_percentages || {},
    isCustom: svc.service === 'personalizado' || String(svc.service || '').startsWith('custom_'),
});
const extrasSum = (svc) => (svc?.extras || []).reduce((s, e) => s + (parseFloat(e?.price) || 0), 0);
const showsParts = (r) => SERVICES_WITH_PARTS.includes(r.serviceId) || (r.parts || []).length > 0;

const Check = ({ on }) => (
    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0 ${on ? 'bg-primary border-primary' : 'border-muted-foreground/50'}`}>
        {on && (
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
        )}
    </div>
);

/**
 * Botón "Actualizar orden": abre un modal con la misma vista de servicios del Check-in
 * (partes y % por parte, catálogo, personalizado y sunroof adicional). Requiere contraseña.
 * Solo para admin, asesor y coordinador.
 * Props: order, onUpdated(order), className, size
 */
export const UpdateOrderButton = ({ order, onUpdated, className, size = 'sm' }) => {
    const { user } = useAuth();
    const [open, setOpen] = useState(false);
    const [catalog, setCatalog] = useState({});
    const [rows, setRows] = useState([]);
    const [sunroof, setSunroof] = useState({ enabled: false, price: '', percentage: '' });
    const [customName, setCustomName] = useState('');
    const [customPrice, setCustomPrice] = useState('');
    const [password, setPassword] = useState('');
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        const services = (order.services || []).filter(s => typeof s === 'object');
        const found = findSunroof(services);
        setSunroof(found
            ? { enabled: true, price: found.price != null ? String(found.price) : '', percentage: found.percentage || '' }
            : { enabled: false, price: '', percentage: '' });
        setRows(services.filter(s => !isSunroofLine(s)).map(stripSunroof).map(rowFromService));
        setCustomName('');
        setCustomPrice('');
        setPassword('');
        setReason('');
        if (Object.keys(catalog).length === 0) {
            servicesAPI.getCatalog().then(res => setCatalog(res.data || {})).catch(() => {});
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    if (!order || !ALLOWED_ROLES.includes(user?.role) || LOCKED_STATUSES.includes(order.status)) return null;

    const isPostventa = !!order.is_postventa;
    const servicesTotal = rows.reduce((sum, r) => sum + (r.no_charge ? 0 : (parseFloat(r.price) || 0)), 0);
    const extrasTotal = rows.reduce((sum, r) => sum + extrasSum(r.base), 0);
    const sunroofTotal = sunroof.enabled ? (parseFloat(sunroof.price) || 0) : 0;
    const total = servicesTotal + extrasTotal + sunroofTotal;

    const updateRow = (key, changes) => setRows(prev => prev.map(r => (r.key === key ? { ...r, ...changes } : r)));

    const togglePart = (row, partId) => {
        const has = row.parts.includes(partId);
        const pct = { ...row.part_percentages };
        if (has) delete pct[partId];
        updateRow(row.key, { parts: has ? row.parts.filter(p => p !== partId) : [...row.parts, partId], part_percentages: pct });
    };

    const setPartPercentage = (row, partId, value) => {
        const pct = { ...row.part_percentages };
        let parts = row.parts;
        if (value === 'N/A') {
            delete pct[partId];
        } else {
            pct[partId] = value;
            if (!parts.includes(partId)) parts = [...parts, partId];
        }
        updateRow(row.key, { part_percentages: pct, parts });
    };

    const toggleCatalogService = (service, categoryName) => {
        const exists = rows.some(r => r.serviceId === service.id);
        if (exists) {
            setRows(prev => prev.filter(r => r.serviceId !== service.id));
            return;
        }
        setRows(prev => [...prev, {
            key: `row-${nextKey++}`, base: null, serviceId: service.id,
            category: categoryName, name: service.name, price: '0', no_charge: false,
            parts: [], part_percentages: {}, isCustom: false,
        }]);
    };

    const addCustomService = () => {
        if (!customName.trim()) {
            toast.error('Escribe el nombre del servicio o producto');
            return;
        }
        setRows(prev => [...prev, {
            key: `row-${nextKey++}`, base: null, serviceId: 'personalizado',
            category: 'Personalizado', name: customName.trim(), price: customPrice || '0', no_charge: false,
            parts: [], part_percentages: {}, isCustom: true,
        }]);
        setCustomName('');
        setCustomPrice('');
    };

    const handleSave = async () => {
        if (rows.length === 0) {
            toast.error('La orden debe tener al menos un servicio');
            return;
        }
        if (rows.some(r => (parseFloat(r.price) || 0) < 0)) {
            toast.error('El valor de un servicio no puede ser negativo');
            return;
        }
        if (sunroof.enabled && (sunroof.price === '' || !(parseFloat(sunroof.price) >= 0))) {
            toast.error('Ingresa el valor del sunroof adicional');
            return;
        }
        if (!password.trim()) {
            toast.error('Ingresa la contraseña para actualizar la orden');
            return;
        }
        const services = rows.map(r => {
            const price = r.no_charge ? 0 : (parseFloat(r.price) || 0);
            const fields = {
                service: r.serviceId,
                description: `${r.category} - ${r.name}`,
                price,
                no_charge: isPostventa ? r.no_charge : null,
                parts: r.parts,
                part_percentages: r.part_percentages,
            };
            return r.base ? { ...r.base, ...fields } : fields;
        });
        if (sunroof.enabled) services.push(buildSunroofLine(sunroof.price, sunroof.percentage));
        setSaving(true);
        try {
            const res = await ordersAPI.updateServices(order.id, { services, password: password.trim(), reason: reason.trim() || null });
            toast.success('Orden actualizada');
            setOpen(false);
            onUpdated?.(res.data.order);
        } catch (e) {
            const d = e.response?.data?.detail;
            toast.error(typeof d === 'string' ? d : 'No se pudo actualizar la orden');
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <Button
                type="button"
                variant="outline"
                size={size}
                className={`border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10 ${className || ''}`}
                onClick={(e) => { e.stopPropagation(); setOpen(true); }}
                data-testid={`update-order-btn-${order.id}`}
            >
                <FilePenLine className="w-3.5 h-3.5 mr-1" />
                Actualizar orden
            </Button>

            <Dialog open={open} onOpenChange={(v) => !saving && setOpen(v)}>
                <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="update-order-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-heading text-xl flex items-center gap-2">
                            <Package className="w-5 h-5 text-primary" />
                            Actualizar orden
                        </DialogTitle>
                        <DialogDescription>
                            {order.plate} · {order.client_name} · {order.order_code}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        {/* Servicios seleccionados */}
                        <div className="space-y-2">
                            <Label>Servicios Seleccionados</Label>
                            {rows.length === 0 && (
                                <p className="text-sm text-muted-foreground">No hay servicios. Agrega al menos uno.</p>
                            )}
                            {rows.map((r, idx) => {
                                const withParts = showsParts(r);
                                const withPct = requiresPercentage(r.serviceId);
                                return (
                                    <div key={r.key} className="p-3 rounded-lg bg-primary/10 border border-primary/30" data-testid={`update-order-row-${idx}`}>
                                        <div className="flex items-center gap-2">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    {r.isCustom && (
                                                        <span className="text-xs bg-yellow-500/20 text-yellow-500 px-1.5 py-0.5 rounded">Personalizado</span>
                                                    )}
                                                    {!r.base && <span className="text-xs bg-emerald-500/20 text-emerald-500 px-1.5 py-0.5 rounded">Nuevo</span>}
                                                    <p className="font-medium text-sm truncate">{r.name}</p>
                                                </div>
                                                <p className="text-xs text-muted-foreground truncate">
                                                    {r.category}
                                                    {extrasSum(r.base) > 0 && ` · extras ${formatCurrency(extrasSum(r.base))}`}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {isPostventa && (
                                                    <label className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded border cursor-pointer whitespace-nowrap ${r.no_charge ? 'bg-amber-500/15 border-amber-500/50 text-amber-500 font-medium' : 'border-input text-muted-foreground'}`}>
                                                        <input
                                                            type="checkbox"
                                                            checked={r.no_charge}
                                                            onChange={(e) => updateRow(r.key, { no_charge: e.target.checked, price: e.target.checked ? '0' : r.price })}
                                                            className="w-4 h-4 accent-amber-500"
                                                        />
                                                        Sin pago
                                                    </label>
                                                )}
                                                <span className="text-sm">$</span>
                                                <Input
                                                    type="number"
                                                    min="0"
                                                    value={r.no_charge ? '0' : r.price}
                                                    disabled={r.no_charge}
                                                    onChange={(e) => updateRow(r.key, { price: e.target.value })}
                                                    className="w-28 h-8 text-right"
                                                    placeholder="Valor"
                                                    data-testid={`update-order-price-${idx}`}
                                                />
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-red-500 hover:text-red-600"
                                                    onClick={() => setRows(prev => prev.filter(x => x.key !== r.key))}
                                                    aria-label="Quitar servicio"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </Button>
                                            </div>
                                        </div>

                                        {withParts && (
                                            <div className="mt-3 pt-3 border-t border-border/50">
                                                <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                                                    <Car className="w-3 h-3" />
                                                    Selecciona las partes del vehículo
                                                    {withPct && <span className="text-amber-400">· Indica el % por parte</span>}:
                                                </p>
                                                <div className="space-y-2">
                                                    {SERVICE_PARTS.map(part => {
                                                        const on = r.parts.includes(part.id);
                                                        return (
                                                            <div
                                                                key={part.id}
                                                                className={`flex items-center gap-2 p-2 rounded transition-colors ${on ? 'bg-cyan-500/20 border border-cyan-500/40' : 'bg-muted/30 border border-transparent'}`}
                                                            >
                                                                <div className="flex items-center gap-2 flex-1 cursor-pointer" onClick={() => togglePart(r, part.id)} data-testid={`update-order-part-${idx}-${part.id}`}>
                                                                    <Check on={on} />
                                                                    <span className="text-xs select-none">{part.name}</span>
                                                                </div>
                                                                {withPct && (
                                                                    <select
                                                                        className="text-xs px-2 py-1 rounded border border-input bg-background"
                                                                        value={r.part_percentages[part.id] || 'N/A'}
                                                                        onChange={(e) => setPartPercentage(r, part.id, e.target.value)}
                                                                        data-testid={`update-order-pct-${idx}-${part.id}`}
                                                                    >
                                                                        <option value="N/A">N/A</option>
                                                                        {TINT_PERCENTAGES.map(p => <option key={p} value={p}>{p}</option>)}
                                                                    </select>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Agregar servicios del catálogo */}
                        <div className="space-y-2">
                            <Label className="flex items-center gap-2">
                                <Plus className="w-4 h-4" />
                                Agregar Servicios Adicionales
                            </Label>
                            <Accordion type="multiple" className="w-full">
                                {Object.entries(catalog).map(([catKey, cat]) => (
                                    <AccordionItem key={catKey} value={catKey}>
                                        <AccordionTrigger className="hover:no-underline text-sm">
                                            <span>{cat.name}</span>
                                        </AccordionTrigger>
                                        <AccordionContent>
                                            <div className="space-y-1 pt-2">
                                                {(cat.services || []).map(service => {
                                                    const on = rows.some(r => r.serviceId === service.id);
                                                    return (
                                                        <div
                                                            key={service.id}
                                                            className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${on ? 'bg-primary/20 border border-primary/30' : 'hover:bg-muted/50 border border-transparent'}`}
                                                            onClick={() => toggleCatalogService(service, cat.name)}
                                                            data-testid={`update-order-catalog-${service.id}`}
                                                        >
                                                            <Check on={on} />
                                                            <span className="text-sm flex-1"><ServiceCatalogLabel service={service} /></span>
                                                            {on && <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </AccordionContent>
                                    </AccordionItem>
                                ))}
                            </Accordion>
                        </div>

                        {/* Personalizado */}
                        <div className="p-4 rounded-lg border border-dashed border-muted-foreground/50 space-y-3">
                            <Label className="flex items-center gap-2 text-muted-foreground">
                                <PlusCircle className="w-4 h-4" />
                                Agregar Servicio/Producto Personalizado
                            </Label>
                            <div className="flex gap-2">
                                <Input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Nombre del servicio o producto" className="flex-1" />
                                <div className="flex items-center gap-1">
                                    <span className="text-sm text-muted-foreground">$</span>
                                    <Input type="number" min="0" value={customPrice} onChange={(e) => setCustomPrice(e.target.value)} placeholder="Valor" className="w-28" />
                                </div>
                                <Button type="button" variant="outline" size="icon" onClick={addCustomService} data-testid="update-order-add-custom">
                                    <Plus className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>

                        {/* Sunroof adicional */}
                        <div className={`p-3 rounded-lg border space-y-3 ${sunroof.enabled ? 'border-amber-500/50 bg-amber-500/10' : 'border-border bg-muted/30'}`} data-testid="update-order-sunroof">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={sunroof.enabled}
                                    onChange={(e) => setSunroof(prev => ({ ...prev, enabled: e.target.checked }))}
                                    className="w-4 h-4 accent-amber-500"
                                    data-testid="update-order-sunroof-toggle"
                                />
                                <span className="text-sm font-medium">Sunroof (adicional)</span>
                                <span className="text-xs text-muted-foreground">· no está incluido en ningún servicio</span>
                            </label>
                            {sunroof.enabled && (
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <Label className="text-xs">Valor del sunroof *</Label>
                                        <div className="flex items-center gap-1">
                                            <span className="text-sm text-muted-foreground">$</span>
                                            <Input
                                                type="number"
                                                min="0"
                                                value={sunroof.price}
                                                onChange={(e) => setSunroof(prev => ({ ...prev, price: e.target.value }))}
                                                placeholder="Valor"
                                                className="text-right font-mono"
                                                data-testid="update-order-sunroof-price"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <Label className="text-xs">% de polarizado</Label>
                                        <select
                                            value={sunroof.percentage}
                                            onChange={(e) => setSunroof(prev => ({ ...prev, percentage: e.target.value }))}
                                            className="w-full h-9 text-sm px-2 rounded-md border border-input bg-background"
                                        >
                                            <option value="">Sin indicar</option>
                                            {TINT_PERCENTAGES.map(p => <option key={p} value={p}>{p}</option>)}
                                        </select>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Total */}
                        <div className="p-4 rounded-lg bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/30 space-y-1" data-testid="update-order-breakdown">
                            <div className="flex justify-between text-sm text-muted-foreground">
                                <span>Subtotal servicios</span>
                                <span className="font-mono">{formatCurrency(servicesTotal)}</span>
                            </div>
                            {extrasTotal > 0 && (
                                <div className="flex justify-between text-sm text-green-300">
                                    <span>+ Extras</span>
                                    <span className="font-mono">+{formatCurrency(extrasTotal)}</span>
                                </div>
                            )}
                            {sunroof.enabled && (
                                <div className="flex justify-between text-sm text-green-300">
                                    <span>+ Sunroof (adicional)</span>
                                    <span className="font-mono">+{formatCurrency(sunroofTotal)}</span>
                                </div>
                            )}
                            <div className="flex justify-between items-center pt-2 border-t border-cyan-500/20">
                                <span className="font-medium">Total:</span>
                                <span className="text-2xl font-bold text-primary" data-testid="update-order-total">{formatCurrency(total)}</span>
                            </div>
                            {(order.discount_type || order.requires_invoice) && (
                                <p className="text-xs text-muted-foreground pt-1">
                                    Al guardar se vuelven a aplicar {[order.discount_type && 'el descuento', order.requires_invoice && order.final_value != null && 'el IVA'].filter(Boolean).join(' y ')} de la orden.
                                </p>
                            )}
                        </div>

                        <div className="grid sm:grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <Label>Motivo del cambio</Label>
                                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Opcional" rows={2} />
                            </div>
                            <div className="space-y-2">
                                <Label className="flex items-center gap-1"><Lock className="w-3.5 h-3.5" /> Contraseña *</Label>
                                <Input
                                    type="password"
                                    inputMode="numeric"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="Contraseña para actualizar"
                                    data-testid="update-order-password"
                                />
                            </div>
                        </div>

                        <div className="flex flex-col-reverse sm:flex-row gap-2">
                            <Button type="button" variant="outline" className="sm:flex-1" onClick={() => setOpen(false)} disabled={saving}>
                                Cancelar
                            </Button>
                            <Button type="button" className="sm:flex-1 brand-glow" onClick={handleSave} disabled={saving} data-testid="update-order-save">
                                {saving ? 'Guardando...' : 'Guardar cambios'}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
};

export default UpdateOrderButton;
