import React from 'react';
import { Input } from './ui/input';
import { Eraser } from 'lucide-react';
import { REMOVAL_LABEL } from '../lib/removal';

/** Costo de retiro de la película anterior dentro de un servicio de polarizado, PPF o ultrasecure */
export const RemovalCostInput = ({ value, onChange, disabled, testId }) => (
    <div className="flex items-center gap-1.5 text-xs" data-testid={testId}>
        <Eraser className="w-3.5 h-3.5 text-orange-400 shrink-0" />
        <span className="text-muted-foreground">{REMOVAL_LABEL}</span>
        <span>$</span>
        <Input
            type="number"
            min="0"
            value={value ?? ''}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0"
            className="w-28 h-7 text-right text-xs"
            data-testid={testId ? `${testId}-value` : undefined}
        />
    </div>
);

export default RemovalCostInput;
