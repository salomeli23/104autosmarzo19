import React from 'react';
import { cn } from '../lib/utils';

/**
 * Accesorios por grupos (como el formulario): lista desplegable o círculos = una opción por grupo;
 * casillas = varias. Cada opción elegida es una línea de la orden con su propio valor.
 * Props:
 *   category: catálogo de accesorios ({ name, groups })
 *   isSelected(optionId)
 *   onSetGroup(group, optionIds)  reemplaza la selección del grupo
 *   renderPrice(option)           opcional: campo de valor al lado de cada opción elegida
 */
export const AccessoryGroups = ({ category, isSelected, onSetGroup, renderPrice }) => {
    const groups = category?.groups || [];
    if (groups.length === 0) return null;

    return (
        <div className="space-y-3 pt-2" data-testid="accessory-groups">
            {groups.map(group => {
                const chosen = group.options.filter(o => isSelected(o.id));
                return (
                    <div key={group.id} className="p-3 rounded-lg border border-border space-y-2" data-testid={`acc-group-${group.id}`}>
                        <p className="text-sm font-medium flex items-center justify-between gap-2">
                            {group.name}
                            {chosen.length > 0 && (
                                <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/15 text-primary">{chosen.length}</span>
                            )}
                        </p>

                        {group.type === 'select' && (
                            <select
                                value={chosen[0]?.id || ''}
                                onChange={(e) => onSetGroup(group, e.target.value ? [e.target.value] : [])}
                                className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                                data-testid={`acc-select-${group.id}`}
                            >
                                <option value="">Elige…</option>
                                {group.options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                            </select>
                        )}

                        {group.type === 'single' && (
                            <div className="grid sm:grid-cols-2 gap-1">
                                {[{ id: '', name: 'Ninguno' }, ...group.options].map(o => (
                                    <label key={o.id || 'none'} className="flex items-center gap-2 text-sm cursor-pointer p-1.5 rounded hover:bg-muted/50">
                                        <input
                                            type="radio"
                                            name={`acc-${group.id}`}
                                            checked={o.id ? isSelected(o.id) : chosen.length === 0}
                                            onChange={() => onSetGroup(group, o.id ? [o.id] : [])}
                                            className="w-4 h-4 accent-primary"
                                            data-testid={`acc-radio-${o.id || `${group.id}-none`}`}
                                        />
                                        <span className={o.id ? '' : 'text-muted-foreground'}>{o.name}</span>
                                    </label>
                                ))}
                            </div>
                        )}

                        {group.type === 'multi' && (
                            <div className="grid sm:grid-cols-2 gap-1">
                                {group.options.map(o => (
                                    <label key={o.id} className="flex items-center gap-2 text-sm cursor-pointer p-1.5 rounded hover:bg-muted/50">
                                        <input
                                            type="checkbox"
                                            checked={isSelected(o.id)}
                                            onChange={(e) => onSetGroup(group, e.target.checked
                                                ? [...chosen.map(c => c.id), o.id]
                                                : chosen.map(c => c.id).filter(id => id !== o.id))}
                                            className="w-4 h-4 accent-primary"
                                            data-testid={`acc-check-${o.id}`}
                                        />
                                        {o.name}
                                    </label>
                                ))}
                            </div>
                        )}

                        {renderPrice && chosen.length > 0 && (
                            <div className="space-y-1.5 pt-1 border-t border-border/50">
                                {chosen.map(o => (
                                    <div key={o.id} className={cn('flex items-center justify-between gap-2 text-sm')}>
                                        <span className="truncate text-muted-foreground">{o.name}</span>
                                        {renderPrice(o)}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

/** Aplica la selección de un grupo a una lista de servicios: quita los del grupo y agrega los nuevos. */
export const applyAccessoryGroup = (list, group, optionIds, getId, makeItem) => {
    const groupIds = new Set(group.options.map(o => o.id));
    const keep = list.filter(item => !groupIds.has(getId(item)) || optionIds.includes(getId(item)));
    const existing = new Set(keep.map(getId));
    const added = group.options.filter(o => optionIds.includes(o.id) && !existing.has(o.id)).map(makeItem);
    return [...keep, ...added];
};

export default AccessoryGroups;
