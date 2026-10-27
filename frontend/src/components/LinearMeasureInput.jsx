import React, { useMemo, useRef, useState } from 'react';
import { cn } from '../lib/utils';

const MAX_CM = 600;
// Sugerencias base: de 5 cm en 5 cm hasta 6 m
const BASE_OPTIONS = Array.from({ length: MAX_CM / 5 }, (_, i) => (i + 1) * 5);

export const formatMeters = (cm) => `${(cm / 100).toFixed(2).replace('.', ',')} m`;
export const formatLinear = (cm) => (cm ? `${formatMeters(cm)} · ${Math.round(cm * 10) / 10} cm` : '');

// Interpreta lo escrito: "1,2" / "1.2" / "1.2m" → metros; "120" / "120cm" → centímetros
const parseTyped = (text) => {
    const t = (text || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!t) return null;
    const isCm = t.endsWith('cm');
    const isM = !isCm && (t.endsWith('m') || /[.,]/.test(t));
    const num = parseFloat(t.replace(/cm|m/g, '').replace(',', '.'));
    if (!Number.isFinite(num) || num <= 0) return null;
    const cm = isM ? num * 100 : num;
    return cm > 0 && cm <= MAX_CM ? Math.round(cm * 10) / 10 : null;
};

/**
 * Medida lineal con lista predictiva en metros y centímetros. El valor es en centímetros.
 * Props: value (cm o ''), onChange(cm | ''), testId
 */
export const LinearMeasureInput = ({ value, onChange, testId, className }) => {
    const [text, setText] = useState('');
    const [open, setOpen] = useState(false);
    const [highlight, setHighlight] = useState(0);
    const blurTimer = useRef(null);

    const suggestions = useMemo(() => {
        const typed = text.trim().toLowerCase().replace(/\s+/g, '').replace(/cm|m$/g, '');
        if (!typed) return BASE_OPTIONS.filter(cm => cm % 10 === 0).slice(0, 8);
        const exact = parseTyped(text);
        const metersPrefix = typed.replace('.', ',');
        const matches = BASE_OPTIONS.filter(cm => {
            const m = (cm / 100).toFixed(2).replace('.', ',');
            return String(cm).startsWith(typed) || m.startsWith(metersPrefix);
        });
        const list = exact && !matches.includes(exact) ? [exact, ...matches] : matches;
        return list.slice(0, 8);
    }, [text]);

    const pick = (cm) => {
        onChange(cm);
        setText('');
        setOpen(false);
    };

    const onKeyDown = (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlight(h => Math.min(h + 1, suggestions.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
        else if (e.key === 'Enter') {
            e.preventDefault();
            const cm = suggestions[highlight] ?? parseTyped(text);
            if (cm) pick(cm);
        } else if (e.key === 'Escape') setOpen(false);
    };

    return (
        <div className={cn('relative', className)}>
            <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={open ? text : formatLinear(value)}
                placeholder="Ej. 1,20 m o 120 cm"
                onFocus={() => { setText(''); setOpen(true); setHighlight(0); }}
                onChange={(e) => { setText(e.target.value); setOpen(true); setHighlight(0); }}
                onBlur={() => {
                    // Si escribió una medida válida y no eligió, se toma lo escrito
                    blurTimer.current = setTimeout(() => {
                        const cm = parseTyped(text);
                        if (cm) onChange(cm);
                        setOpen(false);
                        setText('');
                    }, 150);
                }}
                onKeyDown={onKeyDown}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                data-testid={testId}
            />
            {open && suggestions.length > 0 && (
                <ul
                    className="absolute z-50 mt-1 w-full max-h-56 overflow-auto rounded-md border bg-popover shadow-lg py-1"
                    onMouseDown={(e) => { e.preventDefault(); clearTimeout(blurTimer.current); }}
                    data-testid={testId ? `${testId}-options` : undefined}
                >
                    {suggestions.map((cm, i) => (
                        <li
                            key={cm}
                            onClick={() => pick(cm)}
                            onMouseEnter={() => setHighlight(i)}
                            className={cn('px-3 py-1.5 text-sm cursor-pointer flex justify-between gap-2', i === highlight ? 'bg-accent text-accent-foreground' : '')}
                        >
                            <span className="font-mono font-medium">{formatMeters(cm)}</span>
                            <span className={cn('font-mono', i === highlight ? 'opacity-80' : 'text-muted-foreground')}>{Math.round(cm * 10) / 10} cm</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default LinearMeasureInput;
