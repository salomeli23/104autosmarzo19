import React, { useState } from 'react';
import { inspectionsAPI } from '../lib/api';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { CameraCapture } from './CameraCapture';
import { VideoCapture } from './VideoCapture';
import { ConfirmTwiceDialog } from './ConfirmTwiceDialog';
import { INSPECTION_AREAS } from '../lib/utils';
import { toast } from 'sonner';
import { Camera, Image as ImageIcon, AlertTriangle, Check, ArrowLeft, SkipForward, Video } from 'lucide-react';

const CONDITIONS = [
    { value: 'good', label: 'Bueno', color: 'text-blue-500' },
    { value: 'poor', label: 'Malo', color: 'text-red-500' },
];

/**
 * Inline Revisión 360° step embedded inside the CheckIn wizard.
 * Props:
 *   order:    the order just approved (status ingresado)
 *   onComplete(savedOrder): callback after a successful submit
 *   onSkip:   user chose to defer the 360 to /inspections
 */
export const Inspection360Inline = ({ order, onComplete, onSkip }) => {
    const [subStep, setSubStep] = useState(1); // 1 = photos, 2 = video, 3 = checklist
    const [photos, setPhotos] = useState([]);
    const [video, setVideo] = useState(null); // { blob, url }
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [generalNotes, setGeneralNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [items, setItems] = useState(
        INSPECTION_AREAS.map(area => ({
            area: area.id,
            areaName: area.name,
            condition: 'good',
            notes: '',
            has_damage: false,
        }))
    );

    const damageCount = items.filter(it => it.has_damage).length;

    const updateItem = (idx, field, value) => {
        setItems(prev => {
            const next = [...prev];
            next[idx] = { ...next[idx], [field]: value };
            return next;
        });
    };

    const handleSubmit = async () => {
        if (photos.length === 0) {
            toast.error('Capture al menos 1 foto del vehículo');
            setSubStep(1);
            return;
        }
        if (!video) {
            toast.error('Grabe el video de 20 segundos del vehículo');
            setSubStep(2);
            return;
        }
        setSubmitting(true);
        try {
            const { data: uploaded } = await inspectionsAPI.uploadVideo(order.id, video.blob);
            await inspectionsAPI.create({
                vehicle_id: order.id,
                items: items.map(it => ({
                    area: it.area,
                    condition: it.condition,
                    notes: it.notes,
                    has_damage: it.has_damage,
                })),
                general_notes: generalNotes,
                photos,
                video_url: uploaded.video_url,
            });
            toast.success('Revisión 360° completada');
            onComplete?.({ ...order, photos_count: photos.length });
        } catch (err) {
            toast.error(err.response?.data?.detail || 'Error al guardar la revisión');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-4" data-testid="inspection-inline-step">
            {/* Header */}
            <Card className="bg-purple-500/5 border-purple-500/30">
                <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="font-heading text-lg">Revisión 360° — Paso {subStep} de 3</p>
                            <p className="text-sm text-muted-foreground">
                                {subStep === 1 ? 'Captura fotos del vehículo' : subStep === 2 ? 'Graba un video de 20 segundos' : 'Marca el estado de cada área'}
                            </p>
                        </div>
                        <div className="flex items-center gap-3 text-sm">
                            <span className="flex items-center gap-1">
                                <ImageIcon className="w-4 h-4 text-muted-foreground" />
                                {photos.length}/20
                            </span>
                            <span className={`flex items-center gap-1 ${video ? 'text-blue-500' : 'text-muted-foreground'}`}>
                                <Video className="w-4 h-4" />
                                {video ? '1/1' : '0/1'}
                            </span>
                            {damageCount > 0 && (
                                <span className="flex items-center gap-1 text-yellow-500">
                                    <AlertTriangle className="w-4 h-4" />
                                    {damageCount}
                                </span>
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>

            {subStep === 1 && (
                <div className="space-y-4" data-testid="inspection-photos-step">
                    <Card className="bg-primary/5 border-primary/20">
                        <CardContent className="p-4 flex items-start gap-3">
                            <Camera className="w-5 h-5 text-primary mt-0.5" />
                            <div>
                                <p className="font-medium">Captura fotográfica</p>
                                <p className="text-sm text-muted-foreground">
                                    Frente, trasera, laterales, interior y cualquier daño existente.
                                </p>
                            </div>
                        </CardContent>
                    </Card>

                    <CameraCapture
                        photos={photos}
                        onPhotosChange={setPhotos}
                        maxPhotos={20}
                    />

                    <div className="flex flex-col sm:flex-row gap-2">
                        <Button
                            variant="ghost"
                            onClick={onSkip}
                            className="sm:flex-1"
                            data-testid="skip-inspection-btn"
                        >
                            <SkipForward className="w-4 h-4 mr-2" />
                            Omitir (hacerlo después)
                        </Button>
                        <Button
                            onClick={() => setSubStep(2)}
                            disabled={photos.length === 0}
                            className="sm:flex-1 brand-glow"
                            data-testid="inspection-to-video-inline-btn"
                        >
                            Continuar al Video
                        </Button>
                    </div>
                </div>
            )}

            {subStep === 2 && (
                <div className="space-y-4" data-testid="inspection-video-step">
                    <Card className="bg-primary/5 border-primary/20">
                        <CardContent className="p-4 flex items-start gap-3">
                            <Video className="w-5 h-5 text-primary mt-0.5" />
                            <div>
                                <p className="font-medium">Video del vehículo</p>
                                <p className="text-sm text-muted-foreground">
                                    Graba un recorrido de 20 segundos alrededor del vehículo.
                                </p>
                            </div>
                        </CardContent>
                    </Card>

                    <VideoCapture video={video} onVideoChange={setVideo} durationSeconds={20} />

                    <div className="flex flex-col sm:flex-row gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setSubStep(1)}
                            className="sm:flex-1"
                        >
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Atrás
                        </Button>
                        <Button
                            onClick={() => setSubStep(3)}
                            disabled={!video}
                            className="sm:flex-1 brand-glow"
                            data-testid="inspection-to-checklist-inline-btn"
                        >
                            Continuar al Checklist
                        </Button>
                    </div>
                </div>
            )}

            {subStep === 3 && (
                <div className="space-y-3" data-testid="inspection-checklist-step">
                    <div className="space-y-2 max-h-[420px] overflow-y-auto pr-2">
                        {items.map((item, idx) => (
                            <Card
                                key={item.area}
                                className={item.has_damage ? 'border-yellow-500/50' : ''}
                                data-testid={`inspection-inline-item-${item.area}`}
                            >
                                <CardContent className="p-3 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="font-medium text-sm">{item.areaName}</span>
                                        <button
                                            type="button"
                                            onClick={() => updateItem(idx, 'has_damage', !item.has_damage)}
                                            className={`flex items-center gap-2 text-xs px-2 py-1 rounded border transition-colors ${
                                                item.has_damage
                                                    ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-500'
                                                    : 'border-muted-foreground/30 text-muted-foreground hover:border-yellow-500/50'
                                            }`}
                                            data-testid={`inspection-damage-toggle-${item.area}`}
                                        >
                                            <AlertTriangle className="w-3 h-3" />
                                            Daño
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-1">
                                        {CONDITIONS.map(c => (
                                            <Button
                                                key={c.value}
                                                type="button"
                                                size="sm"
                                                variant={item.condition === c.value ? 'default' : 'outline'}
                                                className={`text-xs h-7 ${item.condition === c.value ? '' : c.color}`}
                                                onClick={() => updateItem(idx, 'condition', c.value)}
                                            >
                                                {c.label}
                                            </Button>
                                        ))}
                                    </div>
                                    {item.has_damage && (
                                        <Input
                                            placeholder="Describe el daño..."
                                            value={item.notes}
                                            onChange={(e) => updateItem(idx, 'notes', e.target.value)}
                                            className="text-sm h-8"
                                        />
                                    )}
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    <div className="space-y-2">
                        <Label>Observaciones Generales</Label>
                        <Textarea
                            value={generalNotes}
                            onChange={(e) => setGeneralNotes(e.target.value)}
                            placeholder="Notas adicionales sobre el estado del vehículo..."
                            className="h-20"
                            data-testid="inspection-inline-notes"
                        />
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setSubStep(2)}
                            className="sm:flex-1"
                        >
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Atrás
                        </Button>
                        <Button
                            onClick={() => setConfirmOpen(true)}
                            disabled={submitting}
                            className="sm:flex-1 brand-glow"
                            data-testid="submit-inspection-inline-btn"
                        >
                            {submitting ? (
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                            ) : (
                                <Check className="w-4 h-4 mr-2" />
                            )}
                            Completar Revisión 360°
                        </Button>
                    </div>
                </div>
            )}

            <ConfirmTwiceDialog open={confirmOpen} onOpenChange={setConfirmOpen} onConfirm={handleSubmit} />
        </div>
    );
};

export default Inspection360Inline;
