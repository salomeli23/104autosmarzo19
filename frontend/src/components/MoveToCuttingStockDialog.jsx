import React, { useMemo, useState } from 'react';
import { inventoryAPI } from '../lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { CameraCapture } from './CameraCapture';
import { toast } from 'sonner';
import { ScanText, Loader2, Scissors, PencilLine, RotateCcw } from 'lucide-react';

const selectClass = 'w-full h-9 rounded-md border border-input bg-background px-2 text-sm';
const NEW_ROLL = '__nuevo__';

const BOX_FIELDS = [
    ['marca', 'Marca'], ['producto', 'Producto'], ['porcentaje', 'Porcentaje'],
    ['ancho', 'Ancho'], ['largo', 'Largo'], ['lote', 'Lote'], ['serial', 'Serial'], ['fecha', 'Fecha'],
];

const CONFIDENCE = {
    alta: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40',
    media: 'bg-amber-500/15 text-amber-400 border-amber-500/40',
    baja: 'bg-red-500/15 text-red-400 border-red-500/40',
};

/**
 * Mover un rollo al stock de corte: foto de la caja → lectura de datos → activar rollo.
 * Props: open, onClose, onDone, items (inventario), rollGroups, defaultRollMeters, item (rollo elegido desde su tarjeta)
 */
export const MoveToCuttingStockDialog = ({ open, onClose, onDone, items = [], rollGroups = [], defaultRollMeters = 30.48, item = null }) => {
    const [photos, setPhotos] = useState([]);
    const [step, setStep] = useState('foto'); // foto | datos
    const [reading, setReading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [box, setBox] = useState({});
    const [read, setRead] = useState(false); // la caja se leyó automáticamente
    const [referencia, setReferencia] = useState(item?.tipo_rollo || '');
    const [rollId, setRollId] = useState(item?.id || '');
    const [metros, setMetros] = useState(String(item?.metros_restantes || defaultRollMeters));

    const photo = photos[photos.length - 1];
    const bodegaRolls = useMemo(() => items.filter(i => i.tipo_articulo === 'rollo' && i.en_stock_corte === false
        && i.tipo_rollo === referencia), [items, referencia]);

    const pickReference = (ref) => {
        setReferencia(ref);
        const first = items.find(i => i.tipo_articulo === 'rollo' && i.en_stock_corte === false && i.tipo_rollo === ref);
        setRollId(first ? first.id : NEW_ROLL);
    };

    const readBox = async () => {
        if (!photo) { toast.error('Toma la foto de la caja'); return; }
        setReading(true);
        try {
            const { data } = await inventoryAPI.readRollBox(photo);
            setBox(data.box || {});
            setRead(true);
            if (data.box?.metros) setMetros(String(data.box.metros));
            if (!item && data.box?.referencia) {
                setReferencia(data.box.referencia);
                setRollId(data.candidates?.[0]?.id || NEW_ROLL);
            }
            if (item && data.box?.referencia && data.box.referencia !== item.tipo_rollo) {
                toast.warning(`La caja parece ser ${data.box.referencia}, pero el rollo es ${item.tipo_rollo}. Revisa antes de activar.`);
            } else if (!data.box?.referencia) {
                toast.warning('No se reconoció la referencia: elígela de la lista');
            } else {
                toast.success('Datos de la caja leídos');
            }
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo leer la caja. Escribe los datos a mano.');
        } finally {
            setReading(false);
            setStep('datos');
        }
    };

    const save = async () => {
        if (!photo) { toast.error('Toma la foto de la caja'); return; }
        if (!referencia) { toast.error('Elige la referencia del rollo'); return; }
        if (!rollId) { toast.error('Elige el rollo que vas a activar'); return; }
        setSaving(true);
        try {
            const { data } = await inventoryAPI.moveToCuttingStock({
                item_id: rollId === NEW_ROLL ? null : rollId,
                referencia,
                photo,
                metros: parseFloat(metros) || null,
                box: { ...box, referencia },
            });
            toast.success(data.message);
            onDone();
        } catch (e) {
            toast.error(e.response?.data?.detail || 'No se pudo mover el rollo al stock de corte');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(v) => !v && !saving && onClose()}>
            <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto" data-testid="cutting-stock-dialog">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><Scissors className="w-5 h-5 text-primary" /> Mover al stock de corte</DialogTitle>
                    <DialogDescription>
                        {item ? <>Rollo <b>{item.codigo}</b> · {item.nombre}. </> : null}
                        Toma una foto de la caja del rollo: se leen sus datos y el rollo queda activo para usar en Corte.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>Foto de la caja *</Label>
                        {photo ? (
                            <div className="relative">
                                <img src={photo} alt="Caja del rollo" className="w-full max-h-56 object-contain rounded-lg border bg-black" data-testid="box-photo-preview" />
                                <Button type="button" size="sm" variant="secondary" className="absolute top-2 right-2"
                                    onClick={() => { setPhotos([]); setStep('foto'); setRead(false); }} data-testid="box-photo-retake">
                                    <RotateCcw className="w-4 h-4 mr-1" /> Otra foto
                                </Button>
                            </div>
                        ) : (
                            <CameraCapture photos={photos} onPhotosChange={setPhotos} maxPhotos={1} />
                        )}
                    </div>

                    {step === 'foto' ? (
                        <div className="flex flex-col sm:flex-row gap-2">
                            <Button className="flex-1" onClick={readBox} disabled={!photo || reading} data-testid="read-box-btn">
                                {reading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ScanText className="w-4 h-4 mr-2" />}
                                {reading ? 'Leyendo la caja…' : 'Leer datos de la caja'}
                            </Button>
                            <Button variant="outline" onClick={() => setStep('datos')} disabled={!photo || reading} data-testid="manual-box-btn">
                                <PencilLine className="w-4 h-4 mr-2" /> Escribir a mano
                            </Button>
                        </div>
                    ) : (
                        <>
                            {read && (
                                <div className="flex items-center gap-2 text-xs">
                                    <span className="text-muted-foreground">Leído de la caja</span>
                                    {box.confianza && <Badge className={CONFIDENCE[box.confianza]}>confianza {box.confianza}</Badge>}
                                </div>
                            )}
                            <div className="space-y-1">
                                <Label>Referencia *</Label>
                                <select value={referencia} onChange={(e) => pickReference(e.target.value)} disabled={!!item}
                                    className={selectClass} data-testid="stock-referencia">
                                    <option value="">Elige la referencia…</option>
                                    {rollGroups.map(g => (
                                        <optgroup key={g.id} label={g.label}>
                                            {g.items.map(r => <option key={r} value={r}>{r}</option>)}
                                        </optgroup>
                                    ))}
                                </select>
                            </div>
                            {referencia && !item && (
                                <div className="space-y-1">
                                    <Label>Rollo a activar *</Label>
                                    <select value={rollId} onChange={(e) => setRollId(e.target.value)} className={selectClass} data-testid="stock-roll">
                                        {bodegaRolls.map(r => (
                                            <option key={r.id} value={r.id}>{r.codigo} · en bodega · {r.metros_restantes} m</option>
                                        ))}
                                        <option value={NEW_ROLL}>+ Rollo nuevo (no está registrado)</option>
                                    </select>
                                </div>
                            )}
                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1 col-span-2 sm:col-span-1">
                                    <Label>Metros del rollo</Label>
                                    <Input type="number" step="0.01" value={metros} onChange={(e) => setMetros(e.target.value)} data-testid="stock-metros" />
                                </div>
                                {BOX_FIELDS.map(([k, label]) => (
                                    <div key={k} className="space-y-1">
                                        <Label className="text-xs">{label}</Label>
                                        <Input value={box[k] || ''} onChange={(e) => setBox(b => ({ ...b, [k]: e.target.value }))}
                                            className="h-8 text-sm" data-testid={`stock-box-${k}`} />
                                    </div>
                                ))}
                            </div>
                            <Button className="w-full" onClick={save} disabled={saving || !photo || !referencia || !rollId} data-testid="confirm-cutting-stock">
                                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Scissors className="w-4 h-4 mr-2" />}
                                Activar en el stock de corte
                            </Button>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default MoveToCuttingStockDialog;
