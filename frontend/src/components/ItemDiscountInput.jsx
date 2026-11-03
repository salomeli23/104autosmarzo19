import React from 'react';
import { Input } from './ui/input';
import { formatCurrency } from '../lib/utils';
import { Tag } from 'lucide-react';

/** Monto del descuento de un ítem (antes de IVA), nunca mayor al valor del ítem. Igual que el backend. */
export const itemDiscountAmount = (base, type, value) => {
    const b = parseFloat(base) || 0;
    const v = parseFloat(value) || 0;
    if (b <= 0 || v <= 0 || !type) return 0;
    const amount = type === 'percentage' ? Math.round(b * v / 100) : Math.round(v);
    return Math.min(amount, b);
};

/** Campos que se envían al backend para el descuento de un ítem */
export const itemDiscountFields = (item) => (
    parseFloat(item.discount_value) > 0 && item.discount_type
        ? { discount_type: item.discount_type, discount_value: parseFloat(item.discount_value) }
        : { discount_type: null, discount_value: null }
);

/**
 * Descuento de un producto o servicio: valor en % o en $, se aplica antes de IVA.
 * Props: base (valor del ítem sin IVA), type ('percentage'|'fixed'), value, onChange({discount_type, discount_value})
 */
export const ItemDiscountInput = ({ base, type, value, onChange, disabled, testId }) => {
    const kind = type || 'percentage';
    const amount = itemDiscountAmount(base, kind, value);
    return (
        <div className="flex items-center gap-1.5 text-xs" data-testid={testId}>
            <Tag className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-muted-foreground">Desc.</span>
            <Input
                type="number"
                min="0"
                max={kind === 'percentage' ? 100 : undefined}
                value={value ?? ''}
                disabled={disabled}
                onChange={(e) => onChange({ discount_type: kind, discount_value: e.target.value })}
                placeholder="0"
                className="w-20 h-7 text-right text-xs"
                data-testid={testId ? `${testId}-value` : undefined}
            />
            <div className="flex rounded-md border border-input overflow-hidden">
                {[['percentage', '%'], ['fixed', '$']].map(([k, label]) => (
                    <button key={k} type="button" disabled={disabled}
                        onClick={() => onChange({ discount_type: k, discount_value: value })}
                        className={`px-2 h-7 ${kind === k ? 'bg-emerald-500/20 text-emerald-300 font-semibold' : 'text-muted-foreground hover:bg-muted/60'}`}
                        data-testid={testId ? `${testId}-${k}` : undefined}>
                        {label}
                    </button>
                ))}
            </div>
            {amount > 0 && <span className="font-mono text-emerald-400">-{formatCurrency(amount)}</span>}
        </div>
    );
};

export default ItemDiscountInput;
