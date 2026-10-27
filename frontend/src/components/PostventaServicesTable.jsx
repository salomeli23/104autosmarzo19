import React from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { formatCurrency } from '../lib/utils';
import { Plus, Trash2, Package } from 'lucide-react';

let nextRowId = 1;
export const newPostventaRow = () => ({ id: `pv-${nextRowId++}`, name: '', price: '0', no_charge: false });

/**
 * Tabla editable de servicios para una cita de postventa. El valor puede ser 0 y
 * cada servicio se puede marcar "Sin pago" (solo existe en postventa).
 * Props:
 *   rows: [{ id, name, price, no_charge }]
 *   onChange(rows)
 *   catalog: catálogo de servicios ({ categoria: { name, services: [{ id, name }] } }) para sugerencias
 */
export const PostventaServicesTable = ({ rows, onChange, catalog = {} }) => {
    const suggestions = Object.values(catalog).flatMap(cat => (cat.services || []).map(s => s.name));
    const total = rows.reduce((sum, r) => sum + (r.no_charge ? 0 : (parseFloat(r.price) || 0)), 0);

    const updateRow = (id, field, value) => {
        onChange(rows.map(r => (r.id === id ? { ...r, [field]: value } : r)));
    };

    const toggleNoCharge = (id, checked) => {
        onChange(rows.map(r => (r.id === id ? { ...r, no_charge: checked, price: checked ? '0' : r.price } : r)));
    };

    return (
        <div className="space-y-3" data-testid="postventa-services-table">
            <datalist id="postventa-service-suggestions">
                {suggestions.map(name => <option key={name} value={name} />)}
            </datalist>

            <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
                        <tr>
                            <th className="text-left font-medium px-3 py-2">Servicio</th>
                            <th className="text-right font-medium px-3 py-2 w-32 sm:w-40">Valor</th>
                            <th className="text-center font-medium px-2 py-2 w-16">Sin pago</th>
                            <th className="w-10" aria-label="Quitar" />
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 ? (
                            <tr>
                                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                                    <Package className="w-6 h-6 mx-auto mb-1 opacity-50" />
                                    Agrega los servicios que se harán en esta postventa.
                                </td>
                            </tr>
                        ) : rows.map((row, idx) => (
                            <tr key={row.id} className="border-t" data-testid={`postventa-row-${idx}`}>
                                <td className="px-2 py-1.5">
                                    <Input
                                        list="postventa-service-suggestions"
                                        value={row.name}
                                        onChange={(e) => updateRow(row.id, 'name', e.target.value)}
                                        placeholder="Ej: Cambio de película vidrio trasero"
                                        className="h-9"
                                        data-testid={`postventa-row-name-${idx}`}
                                    />
                                </td>
                                <td className="px-2 py-1.5">
                                    <div className="flex items-center gap-1">
                                        <span className="text-muted-foreground">$</span>
                                        <Input
                                            type="number"
                                            min="0"
                                            inputMode="numeric"
                                            value={row.price}
                                            onChange={(e) => updateRow(row.id, 'price', e.target.value)}
                                            disabled={row.no_charge}
                                            onBlur={(e) => {
                                                if (e.target.value === '' || parseFloat(e.target.value) < 0) updateRow(row.id, 'price', '0');
                                            }}
                                            className="h-9 text-right"
                                            data-testid={`postventa-row-price-${idx}`}
                                        />
                                    </div>
                                </td>
                                <td className="px-2 py-1.5 text-center">
                                    <input
                                        type="checkbox"
                                        checked={!!row.no_charge}
                                        onChange={(e) => toggleNoCharge(row.id, e.target.checked)}
                                        className="w-5 h-5 accent-primary cursor-pointer align-middle"
                                        aria-label="Marcar servicio sin pago"
                                        data-testid={`postventa-row-nocharge-${idx}`}
                                    />
                                </td>
                                <td className="px-1 py-1.5 text-center">
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-red-500 hover:text-red-600"
                                        onClick={() => onChange(rows.filter(r => r.id !== row.id))}
                                        aria-label="Quitar servicio"
                                        data-testid={`postventa-row-remove-${idx}`}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    {rows.length > 0 && (
                        <tfoot>
                            <tr className="border-t bg-muted/30 font-bold">
                                <td className="px-3 py-2">Total</td>
                                <td className="px-3 py-2 text-right" data-testid="postventa-total">{formatCurrency(total)}</td>
                                <td colSpan={2} />
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>

            <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => onChange([...rows, newPostventaRow()])}
                data-testid="postventa-add-row-btn"
            >
                <Plus className="w-4 h-4 mr-2" />
                Agregar servicio
            </Button>
        </div>
    );
};

export default PostventaServicesTable;
