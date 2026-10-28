import React from 'react';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { cn } from '../lib/utils';

// Categorías del catálogo donde siempre se ofrece el sunroof adicional
export const SUNROOF_CATEGORIES = ['polarizado', 'ppf', 'ultrasecure'];

const TINT_PERCENTAGES = ['5%', '7%', '10%', '12%', '15%', '20%', '30%', '35%', '50%', '70%'];

/**
 * Sunroof adicional: un solo valor por orden (se cobra una vez), visible en Polarizado, PPF y Ultrasecure.
 * Props: value { enabled, price, percentage? }, onChange(next), withPercentage, testId, className
 */
export const SunroofAddon = ({ value, onChange, withPercentage = false, testId = 'sunroof-addon', className }) => {
    const set = (changes) => onChange({ ...value, ...changes });
    return (
        <div
            className={cn('p-3 rounded-lg border space-y-2', value.enabled ? 'border-amber-500/50 bg-amber-500/10' : 'border-dashed border-amber-500/40 bg-amber-500/5', className)}
            onClick={(e) => e.stopPropagation()}
            data-testid={testId}
        >
            <label className="flex items-center gap-2 cursor-pointer flex-wrap">
                <input
                    type="checkbox"
                    checked={!!value.enabled}
                    onChange={(e) => set({ enabled: e.target.checked })}
                    className="w-4 h-4 accent-amber-500"
                    data-testid={`${testId}-toggle`}
                />
                <span className="text-sm font-medium">Sunroof (adicional)</span>
                <span className="text-xs text-muted-foreground">· se cobra aparte, una sola vez por orden</span>
            </label>
            {value.enabled && (
                <div className={cn('grid gap-3', withPercentage ? 'grid-cols-2' : 'grid-cols-1')}>
                    <div className="space-y-1">
                        <Label className="text-xs">Valor del sunroof *</Label>
                        <div className="flex items-center gap-1">
                            <span className="text-sm text-muted-foreground">$</span>
                            <Input
                                type="number"
                                min="0"
                                value={value.price}
                                onChange={(e) => set({ price: e.target.value })}
                                placeholder="Valor"
                                className="h-9 text-right font-mono max-w-[200px]"
                                data-testid={`${testId}-price`}
                            />
                        </div>
                    </div>
                    {withPercentage && (
                        <div className="space-y-1">
                            <Label className="text-xs">% de polarizado</Label>
                            <select
                                value={value.percentage || ''}
                                onChange={(e) => set({ percentage: e.target.value })}
                                className="w-full h-9 text-sm px-2 rounded-md border border-input bg-background"
                                data-testid={`${testId}-percentage`}
                            >
                                <option value="">Sin indicar</option>
                                {TINT_PERCENTAGES.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default SunroofAddon;
