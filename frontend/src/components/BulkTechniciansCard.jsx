import React, { useState } from 'react';
import { usersAPI } from '../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { toast } from 'sonner';
import { AccessShareCard } from './AccessShareCard';
import { Users, Plus, Trash2, ClipboardPaste, Loader2, Shuffle } from 'lucide-react';

const randomEntryId = () => {
    const n = new Uint32Array(10);
    window.crypto.getRandomValues(n);
    return Array.from(n, (v, i) => (i === 0 ? 1 + (v % 9) : v % 10)).join('');
};
const initialRows = () => Array.from({ length: 6 }, (_, i) => ({ name: `tecnico${i + 1}`, entry_id: '', pin: '1111', phone: '' }));
const validPhone = (p) => !p || /^(\+?57)?3\d{9}$/.test(p.replace(/[\s-]/g, '')) || /^\+\d{8,15}$/.test(p.replace(/[\s-]/g, ''));

// "| tecnico2 | 4632561234 | 1111 | 3001234567 |" o "tecnico2 4632561234 1111 3001234567" → fila (el celular es opcional)
const parseList = (text) => text.split('\n').map(line => {
    const cells = line.split(/[|\t,;]+|\s{2,}/).map(c => c.trim()).filter(Boolean);
    const parts = cells.length >= 2 ? cells : line.trim().split(/\s+/);
    const tens = parts.filter(p => /^\d{10}$/.test(p));
    const entry = tens[0];
    const phone = tens[1] || parts.find(p => /^\+?57\d{10}$/.test(p)) || '';
    const pin = parts.find(p => /^\d{4}$/.test(p));
    const name = parts.find(p => !/^\d+$/.test(p) && !/^-+$/.test(p) && !/^(técnico|tecnico|id de entrada|pin)$/i.test(p));
    return entry && name ? { name, entry_id: entry, pin: pin || '1111', phone } : null;
}).filter(Boolean);

/** Configuración: crea (o actualiza) varios técnicos con ID de entrada y PIN en un solo paso */
export const BulkTechniciansCard = ({ onDone }) => {
    const [rows, setRows] = useState(initialRows);
    const [paste, setPaste] = useState(null);
    const [busy, setBusy] = useState(false);
    const [results, setResults] = useState(null);

    const update = (i, changes) => setRows(prev => prev.map((r, j) => (j === i ? { ...r, ...changes } : r)));

    const applyPaste = () => {
        const parsed = parseList(paste || '');
        if (!parsed.length) {
            toast.error('No encontré filas con nombre e ID de 10 dígitos');
            return;
        }
        setRows(prev => {
            const next = [...prev];
            parsed.forEach(p => {
                const i = next.findIndex(r => r.name.toLowerCase() === p.name.toLowerCase());
                if (i >= 0) next[i] = p; else next.push(p);
            });
            return next;
        });
        setPaste(null);
        toast.success(`${parsed.length} técnico(s) cargados de la lista`);
    };

    const submit = async () => {
        const list = rows.filter(r => r.name.trim());
        const bad = list.find(r => !/^\d{10}$/.test(r.entry_id) || !/^\d{4}$/.test(r.pin));
        if (bad) {
            toast.error(`${bad.name}: el ID de entrada debe tener 10 dígitos y el PIN 4`);
            return;
        }
        const badPhone = list.find(r => !validPhone(r.phone || ''));
        if (badPhone) {
            toast.error(`${badPhone.name}: el celular debe tener 10 dígitos (ej. 3001234567)`);
            return;
        }
        setBusy(true);
        try {
            const res = await usersAPI.bulkTechnicians(list.map(r => ({ name: r.name.trim(), entry_id: r.entry_id, pin: r.pin, phone: (r.phone || '').trim() || null })));
            const pins = Object.fromEntries(list.map(r => [r.name.trim().toLowerCase(), r.pin]));
            setResults(res.data.results.map(r => ({ ...r, pin: pins[r.name.toLowerCase()] })));
            toast.success(res.data.message);
            onDone?.();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudieron crear los técnicos');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Card className="card-hover" data-testid="bulk-technicians-card">
            <CardHeader>
                <CardTitle className="font-heading text-xl flex items-center gap-2">
                    <Users className="w-5 h-5 text-primary" /> Crear técnicos en bloque
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                    Cada técnico entra con su <b>ID de entrada</b> (10 dígitos) y su <b>PIN</b> (4 dígitos) desde "Ingreso de técnicos con PIN".
                    Si ya existe un técnico con ese nombre solo se le asignan el ID y el PIN.
                </p>

                {paste === null ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setPaste('')} data-testid="bulk-paste-btn">
                        <ClipboardPaste className="w-4 h-4 mr-1" /> Pegar lista
                    </Button>
                ) : (
                    <div className="space-y-2">
                        <Textarea rows={6} value={paste} onChange={(e) => setPaste(e.target.value)}
                            placeholder={'Pega la tabla, una fila por técnico (celular opcional):\n| tecnico1 | 4632561234 | 1111 | 3001234567 |'} className="font-mono text-xs" data-testid="bulk-paste-text" />
                        <div className="flex gap-2">
                            <Button type="button" size="sm" onClick={applyPaste} data-testid="bulk-paste-apply">Cargar</Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => setPaste(null)}>Cancelar</Button>
                        </div>
                    </div>
                )}

                <div className="space-y-2 overflow-x-auto">
                    <div className="grid grid-cols-[minmax(8rem,1fr)_10.5rem_9rem_5.5rem_2.25rem] gap-2 text-xs text-muted-foreground px-1">
                        <span>Nombre</span><span>ID de entrada</span><span>Celular (SMS)</span><span>PIN</span><span />
                    </div>
                    {rows.map((r, i) => (
                        <div key={i} className="grid grid-cols-[minmax(8rem,1fr)_10.5rem_9rem_5.5rem_2.25rem] gap-2 items-center" data-testid={`bulk-row-${i}`}>
                            <Input value={r.name} onChange={(e) => update(i, { name: e.target.value })} />
                            <div className="relative">
                                <Input inputMode="numeric" maxLength={10} value={r.entry_id} placeholder="10 dígitos"
                                    onChange={(e) => update(i, { entry_id: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                                    className="font-mono pr-8" data-testid={`bulk-entry-${i}`} />
                                <button type="button" title="Generar ID" onClick={() => update(i, { entry_id: randomEntryId() })}
                                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary">
                                    <Shuffle className="w-4 h-4" />
                                </button>
                            </div>
                            <Input inputMode="tel" value={r.phone || ''} placeholder="3001234567"
                                onChange={(e) => update(i, { phone: e.target.value.replace(/[^\d+\s-]/g, '').slice(0, 16) })}
                                className="font-mono" data-testid={`bulk-phone-${i}`} />
                            <Input inputMode="numeric" maxLength={4} value={r.pin}
                                onChange={(e) => update(i, { pin: e.target.value.replace(/\D/g, '').slice(0, 4) })} className="font-mono" />
                            <Button type="button" variant="ghost" size="icon" className="text-red-500" onClick={() => setRows(prev => prev.filter((_, j) => j !== i))} aria-label="Quitar">
                                <Trash2 className="w-4 h-4" />
                            </Button>
                        </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" onClick={() => setRows(prev => [...prev, { name: `tecnico${prev.length + 1}`, entry_id: '', pin: '1111', phone: '' }])}>
                        <Plus className="w-4 h-4 mr-1" /> Agregar fila
                    </Button>
                </div>

                <Button onClick={submit} disabled={busy || !rows.length} data-testid="bulk-submit">
                    {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Users className="w-4 h-4 mr-2" />}
                    Crear técnicos ({rows.filter(r => r.name.trim()).length})
                </Button>

                {results && (
                    <AccessShareCard
                        accesses={results.map(r => ({ user_id: r.id, name: r.name, role: 'tecnico', entry_id: r.entry_id, pin: r.pin, phone: r.phone, note: r.action }))}
                        onClose={() => setResults(null)} />
                )}
            </CardContent>
        </Card>
    );
};

export default BulkTechniciansCard;
