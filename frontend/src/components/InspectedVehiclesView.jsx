import React, { useState, useEffect, useCallback } from 'react';
import { inspectionsAPI, ordersAPI } from '../lib/api';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { OrderStatusBadge } from './OrderStatusBadge';
import { toast } from 'sonner';
import { Car, Search, User, Image as ImageIcon, Video, Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { PostventaBadge } from './PostventaBadge';

const formatDate = (iso) => {
    if (!iso) return '';
    return new Date(iso).toLocaleString('es-CO', {
        timeZone: 'America/Bogota', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
};

/**
 * Vehículos ingresados con Revisión 360°: lista y detalle con fotos y video.
 */
export const InspectedVehiclesView = () => {
    const [vehicles, setVehicles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selected, setSelected] = useState(null);
    const [photos, setPhotos] = useState([]);
    const [videoUrl, setVideoUrl] = useState(null);
    const [loadingMedia, setLoadingMedia] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState(null);

    const fetchVehicles = useCallback(async () => {
        try {
            setLoading(true);
            const res = await inspectionsAPI.getInspectedVehicles();
            setVehicles(res.data);
        } catch (error) {
            console.error('Error fetching inspected vehicles:', error);
            toast.error('No se pudieron cargar los vehículos ingresados');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchVehicles();
    }, [fetchVehicles]);

    // Libera el blob del video al cerrar o cambiar de vehículo
    useEffect(() => () => {
        if (videoUrl) URL.revokeObjectURL(videoUrl);
    }, [videoUrl]);

    const openVehicle = async (vehicle) => {
        setSelected(vehicle);
        setPhotos([]);
        setVideoUrl(null);
        setLoadingMedia(true);
        try {
            const [orderRes, videoRes] = await Promise.all([
                ordersAPI.getById(vehicle.id),
                vehicle.inspection_video_url ? inspectionsAPI.getVideo(vehicle.id).catch(() => null) : Promise.resolve(null),
            ]);
            setPhotos(orderRes.data.inspection_photos || []);
            if (videoRes?.data) setVideoUrl(URL.createObjectURL(videoRes.data));
        } catch (error) {
            toast.error('No se pudieron cargar las fotos y el video');
        } finally {
            setLoadingMedia(false);
        }
    };

    const closeVehicle = () => {
        setSelected(null);
        setPhotos([]);
        setVideoUrl(null);
        setLightboxIndex(null);
    };

    const term = searchTerm.toLowerCase();
    const filtered = vehicles.filter(v =>
        (v.plate || '').toLowerCase().includes(term) ||
        (v.client_name || '').toLowerCase().includes(term) ||
        (v.brand || '').toLowerCase().includes(term)
    );

    return (
        <div className="space-y-4" data-testid="inspected-vehicles-view">
            <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                    placeholder="Buscar por placa, cliente o marca..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                    data-testid="inspected-search"
                />
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Car className="w-16 h-16 mb-4 opacity-50" />
                    <p className="text-lg">No hay vehículos ingresados con Revisión 360°</p>
                </div>
            ) : (
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filtered.map((v) => (
                        <Card
                            key={v.id}
                            className="card-hover cursor-pointer"
                            onClick={() => openVehicle(v)}
                            data-testid={`inspected-card-${v.id}`}
                        >
                            <CardContent className="p-4 space-y-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-center gap-3">
                                        <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center">
                                            <Car className="w-6 h-6 text-primary" />
                                        </div>
                                        <div>
                                            <p className="font-mono font-bold text-lg">{v.plate}</p>
                                            <p className="text-sm text-muted-foreground">
                                                {v.brand} {v.model} {v.year}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <PostventaBadge order={v} />
                                        <OrderStatusBadge status={v.status} />
                                    </div>
                                </div>
                                <div className="space-y-1.5 pt-3 border-t text-sm">
                                    <div className="flex items-center gap-2">
                                        <User className="w-4 h-4 text-muted-foreground" />
                                        <span>{v.client_name}</span>
                                    </div>
                                    <div className="flex items-center gap-2 text-muted-foreground">
                                        <Calendar className="w-4 h-4" />
                                        <span>{formatDate(v.inspection_at)}</span>
                                    </div>
                                    <div className="flex items-center gap-4 pt-1">
                                        <span className="flex items-center gap-1">
                                            <ImageIcon className="w-4 h-4 text-muted-foreground" />
                                            {v.photos_count} fotos
                                        </span>
                                        <span className={`flex items-center gap-1 ${v.inspection_video_url ? 'text-blue-500' : 'text-muted-foreground'}`}>
                                            <Video className="w-4 h-4" />
                                            {v.inspection_video_url ? 'Con video' : 'Sin video'}
                                        </span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Detalle: fotos + video */}
            <Dialog open={!!selected} onOpenChange={(open) => !open && closeVehicle()}>
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                    {selected && (
                        <>
                            <DialogHeader>
                                <DialogTitle className="font-heading text-xl flex items-center gap-2">
                                    <span className="font-mono">{selected.plate}</span>
                                    <span className="text-muted-foreground text-base font-normal">
                                        {selected.brand} {selected.model} {selected.year}
                                    </span>
                                </DialogTitle>
                                <DialogDescription>
                                    {selected.client_name} · Revisión 360° del {formatDate(selected.inspection_at)}
                                </DialogDescription>
                            </DialogHeader>

                            {loadingMedia ? (
                                <div className="flex justify-center py-12">
                                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                                </div>
                            ) : (
                                <div className="space-y-5">
                                    <div className="space-y-2">
                                        <h3 className="font-heading flex items-center gap-2">
                                            <Video className="w-4 h-4 text-primary" /> Video
                                        </h3>
                                        {videoUrl ? (
                                            <video
                                                src={videoUrl}
                                                controls
                                                playsInline
                                                className="w-full rounded-lg bg-black aspect-video"
                                                data-testid="inspected-video"
                                            />
                                        ) : (
                                            <p className="text-sm text-muted-foreground">Esta revisión no tiene video.</p>
                                        )}
                                    </div>

                                    <div className="space-y-2">
                                        <h3 className="font-heading flex items-center gap-2">
                                            <ImageIcon className="w-4 h-4 text-primary" /> Fotos ({photos.length})
                                        </h3>
                                        {photos.length === 0 ? (
                                            <p className="text-sm text-muted-foreground">Esta revisión no tiene fotos.</p>
                                        ) : (
                                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2" data-testid="inspected-photos">
                                                {photos.map((photo, i) => (
                                                    <button
                                                        key={i}
                                                        type="button"
                                                        onClick={() => setLightboxIndex(i)}
                                                        className="relative aspect-square rounded-lg overflow-hidden border focus:outline-none focus:ring-2 focus:ring-primary"
                                                    >
                                                        <img src={photo} alt={`Foto ${i + 1}`} className="w-full h-full object-cover" />
                                                        <span className="absolute bottom-1 left-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                                                            {i + 1}
                                                        </span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {selected.inspection_notes && (
                                        <div className="space-y-1">
                                            <h3 className="font-heading">Observaciones</h3>
                                            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selected.inspection_notes}</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {/* Visor de fotos a pantalla completa */}
            <Dialog open={lightboxIndex !== null} onOpenChange={(open) => !open && setLightboxIndex(null)}>
                <DialogContent className="max-w-5xl p-0 bg-black border-0 overflow-hidden [&>button]:hidden">
                    <DialogTitle className="sr-only">Foto {lightboxIndex !== null ? lightboxIndex + 1 : ''}</DialogTitle>
                    {lightboxIndex !== null && photos[lightboxIndex] && (
                        <div className="relative">
                            <img
                                src={photos[lightboxIndex]}
                                alt={`Foto ${lightboxIndex + 1}`}
                                className="w-full max-h-[85vh] object-contain"
                            />
                            <span className="absolute top-3 left-3 bg-black/70 text-white text-sm px-2 py-1 rounded">
                                {lightboxIndex + 1} / {photos.length}
                            </span>
                            <Button
                                size="icon"
                                variant="secondary"
                                className="absolute top-3 right-3"
                                onClick={() => setLightboxIndex(null)}
                            >
                                <X className="w-4 h-4" />
                            </Button>
                            {lightboxIndex > 0 && (
                                <Button
                                    size="icon"
                                    variant="secondary"
                                    className="absolute left-3 top-1/2 -translate-y-1/2"
                                    onClick={() => setLightboxIndex(lightboxIndex - 1)}
                                >
                                    <ChevronLeft className="w-5 h-5" />
                                </Button>
                            )}
                            {lightboxIndex < photos.length - 1 && (
                                <Button
                                    size="icon"
                                    variant="secondary"
                                    className="absolute right-3 top-1/2 -translate-y-1/2"
                                    onClick={() => setLightboxIndex(lightboxIndex + 1)}
                                >
                                    <ChevronRight className="w-5 h-5" />
                                </Button>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default InspectedVehiclesView;
