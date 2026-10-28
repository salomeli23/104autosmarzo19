import React, { useState } from 'react';
import { Input } from './ui/input';
import { cn } from '../lib/utils';

// Partes del plan PPF por zona. qty = cantidades disponibles (se guarda "Parales x4").
export const PPF_PART_ZONES = [
    {
        id: 'exterior', label: 'Exterior', parts: [
            { name: 'Parales', qty: [2, 4, 6, 8] },
            { name: 'Triángulos' },
            { name: 'Manijas' },
            { name: 'Uñeros' },
            { name: 'Posapiés', qty: [2, 4] },
            { name: 'Estribos', qty: [2, 4] },
            { name: 'Bocarueda' },
            { name: 'Espejos' },
            { name: 'Stops' },
            { name: 'Farolas' },
            { name: 'Boomerang delantero' },
            { name: 'Boomerang trasero' },
            { name: 'Persiana' },
            { name: 'Tira trasera' },
            { name: 'Filos puertas', qty: [2, 4] },
            { name: 'Borde 5ta puerta' },
            { name: 'Marcos ventanas', qty: [2, 4] },
        ],
    },
    {
        id: 'interior', label: 'Interior', parts: [
            { name: 'Consola' },
            { name: 'Pantalla' },
            { name: 'Switcheras', qty: [2, 4] },
            { name: 'Millare' },
            { name: 'Aire acondicionado' },
            { name: 'Radio' },
            { name: 'Manijas internas' },
        ],
    },
];

const ALL_PARTS = PPF_PART_ZONES.flatMap(z => z.parts.map(p => ({ ...p, zone: z.id })));

// "Parales x4" → { part, qty: 4 }; también reconoce "Parales" sin cantidad
const matchPart = (value) => {
    for (const p of ALL_PARTS) {
        if (value === p.name) return { part: p, qty: null };
        const m = value.match(/^(.*) x(\d+)$/);
        if (m && m[1] === p.name) return { part: p, qty: Number(m[2]) };
    }
    return null;
};

/** Zonas (interior / exterior) según las partes elegidas */
export const ppfZonesFor = (parts = []) => {
    const zones = new Set();
    parts.forEach(v => { const m = matchPart(v); if (m) zones.add(m.part.zone); });
    return PPF_PART_ZONES.map(z => z.id).filter(id => zones.has(id));
};

/**
 * Selector de partes PPF por zona (Exterior / Interior) con cantidades.
 * Props: value (array de textos), onChange(parts), testId
 */
export const PpfPartsPicker = ({ value = [], onChange, testId = 'ppf-parts' }) => {
    const [custom, setCustom] = useState('');
    const selected = new Map();
    const others = [];
    value.forEach(v => {
        const m = matchPart(v);
        if (m) selected.set(m.part.name, { raw: v, qty: m.qty });
        else others.push(v);
    });

    const labelFor = (part, qty) => (qty ? `${part.name} x${qty}` : part.name);
    const toggle = (part) => {
        if (selected.has(part.name)) onChange(value.filter(v => v !== selected.get(part.name).raw));
        else onChange([...value, labelFor(part, part.qty ? part.qty[0] : null)]);
    };
    const setQty = (part, qty) => onChange(value.map(v => (v === selected.get(part.name)?.raw ? labelFor(part, qty) : v)));
    const addCustom = () => {
        const t = custom.trim();
        if (!t || value.some(v => v.toLowerCase() === t.toLowerCase())) { setCustom(''); return; }
        onChange([...value, t.charAt(0).toUpperCase() + t.slice(1)]);
        setCustom('');
    };

    return (
        <div className="space-y-3" onClick={(e) => e.stopPropagation()} data-testid={testId}>
            {PPF_PART_ZONES.map(zone => (
                <div key={zone.id} className="space-y-1.5">
                    <p className="text-[11px] font-semibold tracking-wide text-blue-300 uppercase">{zone.label}</p>
                    <div className="flex flex-wrap gap-1.5">
                        {zone.parts.map(part => {
                            const sel = selected.get(part.name);
                            return (
                                <span
                                    key={part.name}
                                    className={cn(
                                        'inline-flex items-center rounded border text-xs overflow-hidden',
                                        sel ? 'bg-blue-500/25 border-blue-500/60 text-blue-100' : 'border-input text-muted-foreground',
                                    )}
                                >
                                    <button
                                        type="button"
                                        onClick={() => toggle(part)}
                                        className="px-2 py-1 hover:text-blue-100"
                                        data-testid={`${testId}-${zone.id}-${part.name}`}
                                    >
                                        {sel ? '✓ ' : '+ '}{part.name}
                                    </button>
                                    {sel && part.qty && (
                                        <select
                                            value={sel.qty || part.qty[0]}
                                            onChange={(e) => setQty(part, Number(e.target.value))}
                                            className="h-6 bg-blue-950/60 border-l border-blue-500/40 text-[11px] px-1"
                                            data-testid={`${testId}-qty-${part.name}`}
                                        >
                                            {part.qty.map(q => <option key={q} value={q}>x{q}</option>)}
                                        </select>
                                    )}
                                </span>
                            );
                        })}
                    </div>
                </div>
            ))}

            {others.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {others.map(o => (
                        <span key={o} className="inline-flex items-center gap-1 text-xs bg-blue-500/20 text-blue-200 border border-blue-500/40 px-2 py-0.5 rounded">
                            {o}
                            <button type="button" onClick={() => onChange(value.filter(v => v !== o))} className="text-blue-300 hover:text-red-400">×</button>
                        </span>
                    ))}
                </div>
            )}
            <div className="flex gap-2">
                <Input
                    value={custom}
                    onChange={(e) => setCustom(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
                    placeholder="Otra parte (opcional)"
                    className="h-8 text-xs"
                    data-testid={`${testId}-custom`}
                />
                <button type="button" onClick={addCustom} className="text-xs px-3 rounded border border-input hover:border-blue-500/50">Agregar</button>
            </div>
        </div>
    );
};

/** Texto del plan por partes para la orden y el PDF */
export const ppfPartsDescription = (parts = []) => {
    const zones = ppfZonesFor(parts).map(z => (z === 'interior' ? 'Interior' : 'Exterior')).join(' + ') || 'sin zona';
    return `Partes (${zones}) · ${parts.join(', ')}`;
};

export default PpfPartsPicker;
