import React, { useRef, useState } from 'react';

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * <select> nativo que se escoge escribiendo con el teclado: las letras se acumulan (se reinician tras 1,2 s
 * sin escribir) y se elige la primera opción que empieza con ese texto; si ninguna empieza así, la que lo contiene.
 * Borrar (Backspace) quita la última letra. Muestra el texto buscado mientras se escribe.
 * Props: value, onChange(value), options [{value, label, group?}], placeholder, className, ...rest del select
 */
export const TypeAheadSelect = ({ value, onChange, options, placeholder, className = '', ...rest }) => {
    const [query, setQuery] = useState('');
    const timer = useRef(null);

    const pick = (q) => {
        const n = norm(q);
        if (!n) return;
        const hit = options.find(o => norm(o.label).startsWith(n)) || options.find(o => norm(o.label).includes(n));
        if (hit && hit.value !== value) onChange(hit.value);
    };

    const onKeyDown = (e) => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        let next = null;
        if (e.key.length === 1 && (e.key !== ' ' || query)) next = query + e.key;
        else if (e.key === 'Backspace' && query) next = query.slice(0, -1);
        if (next === null) return;
        e.preventDefault();
        setQuery(next);
        pick(next);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setQuery(''), 1200);
    };

    const groups = [];
    options.forEach(o => {
        const g = groups.find(x => x.label === (o.group || null));
        if (g) g.items.push(o); else groups.push({ label: o.group || null, items: [o] });
    });

    return (
        <div className="relative">
            <select value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown}
                onBlur={() => setQuery('')} className={className} {...rest}>
                {placeholder !== undefined && <option value="">{placeholder}</option>}
                {groups.map(g => (g.label
                    ? <optgroup key={g.label} label={g.label}>{g.items.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
                    : g.items.map(o => <option key={o.value} value={o.value}>{o.label}</option>)))}
            </select>
            {query && (
                <span className="pointer-events-none absolute -top-2 right-2 px-1.5 rounded bg-cyan-600 text-white text-[10px] font-mono">
                    {query}
                </span>
            )}
        </div>
    );
};

export default TypeAheadSelect;
