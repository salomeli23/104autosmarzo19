import React, { useRef, useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Eraser, Check } from 'lucide-react';

export const SignaturePad = ({ onSave, onSignatureChange, width = 400, height = 200 }) => {
    const canvasRef = useRef(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [hasSignature, setHasSignature] = useState(false);
    
    // Support both prop names
    const handleSignatureChange = (data) => {
        if (onSave) onSave(data);
        if (onSignatureChange) onSignatureChange(data);
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    }, [width, height]);

    const getCoordinates = (e) => {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        
        if (e.touches) {
            return {
                x: (e.touches[0].clientX - rect.left) * scaleX,
                y: (e.touches[0].clientY - rect.top) * scaleY
            };
        }
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    };

    const startDrawing = (e) => {
        e.preventDefault();
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const { x, y } = getCoordinates(e);
        ctx.beginPath();
        ctx.moveTo(x, y);
        setIsDrawing(true);
    };

    const draw = (e) => {
        if (!isDrawing) return;
        e.preventDefault();
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const { x, y } = getCoordinates(e);
        ctx.lineTo(x, y);
        ctx.stroke();
        setHasSignature(true);
    };

    const stopDrawing = () => {
        setIsDrawing(false);
        if (hasSignature) {
            const canvas = canvasRef.current;
            const dataUrl = canvas.toDataURL('image/png');
            handleSignatureChange(dataUrl);
        }
    };

    const clearSignature = () => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, width, height);
        setHasSignature(false);
        handleSignatureChange(null);
    };

    return (
        <div className="space-y-2">
            <div className="border rounded-lg overflow-hidden bg-white">
                <canvas
                    ref={canvasRef}
                    width={width}
                    height={height}
                    className="w-full touch-none cursor-crosshair"
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                />
            </div>
            <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={clearSignature}>
                    <Eraser className="w-4 h-4 mr-1" /> Borrar
                </Button>
                {hasSignature && (
                    <span className="text-sm text-green-500 flex items-center">
                        <Check className="w-4 h-4 mr-1" /> Firma capturada
                    </span>
                )}
            </div>
        </div>
    );
};
