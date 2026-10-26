import React, { useEffect, useRef, useState } from 'react';

const PLATE_LENGTH = 6;
const clean = (text) => (text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const toSlots = (text) => Array.from({ length: PLATE_LENGTH }, (_, i) => clean(text)[i] || '');

/**
 * Placa en 6 casillas grandes (solo letras y números), estilo placa colombiana:
 * fondo amarillo y letra negra.
 * Props: value (string), onChange(string), testId
 */
export const PlateInput = ({ value = '', onChange, testId = 'plate-input' }) => {
    // Cada casilla conserva su posición aunque haya casillas vacías en medio
    const [slots, setSlots] = useState(() => toSlots(value));
    const refs = useRef([]);

    // Sincroniza cuando el valor cambia desde afuera (limpiar formulario, autollenado)
    useEffect(() => {
        if (value !== slots.join('')) setSlots(toSlots(value));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const commit = (next) => {
        setSlots(next);
        onChange(next.join(''));
    };

    const setAt = (index, text) => {
        const next = [...slots];
        const incoming = clean(text);
        if (!incoming) {
            if (text === '') {
                next[index] = '';
                commit(next);
            }
            return;
        }
        // Permite escribir o pegar varios caracteres desde una casilla
        let i = index;
        for (const ch of incoming) {
            if (i >= PLATE_LENGTH) break;
            next[i] = ch;
            i += 1;
        }
        commit(next);
        refs.current[Math.min(i, PLATE_LENGTH - 1)]?.focus();
    };

    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !slots[index] && index > 0) {
            e.preventDefault();
            const next = [...slots];
            next[index - 1] = '';
            commit(next);
            refs.current[index - 1]?.focus();
        } else if (e.key === 'ArrowLeft' && index > 0) {
            e.preventDefault();
            refs.current[index - 1]?.focus();
        } else if (e.key === 'ArrowRight' && index < PLATE_LENGTH - 1) {
            e.preventDefault();
            refs.current[index + 1]?.focus();
        }
    };

    return (
        <div className="flex gap-1.5 sm:gap-2" data-testid={testId}>
            {slots.map((ch, i) => (
                <input
                    key={i}
                    ref={(el) => { refs.current[i] = el; }}
                    value={ch}
                    onChange={(e) => {
                        const raw = e.target.value;
                        // Si la casilla ya tenía un carácter, se reemplaza por el nuevo
                        const text = ch && raw.length === 2 ? (raw[0] === ch ? raw[1] : raw[0]) : raw;
                        setAt(i, text);
                    }}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    onPaste={(e) => {
                        e.preventDefault();
                        setAt(i, e.clipboardData.getData('text'));
                    }}
                    onFocus={(e) => e.target.select()}
                    inputMode="text"
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={PLATE_LENGTH}
                    aria-label={`Placa, carácter ${i + 1}`}
                    className="flex-1 min-w-0 max-w-[3.5rem] h-14 sm:h-16 rounded-md border-2 border-black bg-yellow-400 text-black text-center font-mono font-bold text-2xl sm:text-3xl uppercase focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
                    data-testid={`${testId}-${i}`}
                />
            ))}
        </div>
    );
};

export default PlateInput;
